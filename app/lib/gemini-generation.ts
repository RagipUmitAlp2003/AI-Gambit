/**
 * Gemini `generateContent` çağrılarının ortak dayanıklılık katmanı.
 *
 * `/api/analyze` (şartnameden kriter çıkarma) bu politikayı önce kendi içinde
 * geliştirmişti; `/api/evaluate-report` (katılımcı raporunun değerlendirilmesi)
 * ise tek turluk, iki modelli ince bir döngü kullanıyordu ve birincil model
 * 503 döndüğünde analiz komple düşüyordu. İki uç artık aynı kaynaktan beslenir:
 *
 *   - model listesi birden çok tur taranır (`GEMINI_MODEL_SWEEPS`),
 *   - yanıt vermeyen model kısa süre soğumaya alınır ve bu bilgi iki uç arasında
 *     paylaşılır (aynı süreçteki başka bir istek de o modeli atlar),
 *   - yeniden denemeler bir duvar saati bütçesiyle sınırlanır,
 *   - hata nedeni ayrıştırılır: tükenmiş bakiye · hız sınırı · model yoğunluğu ·
 *     kimlik doğrulama · zaman aşımı.
 *
 * Modelin ürettiği metin ve API anahtarı hiçbir günlüğe yazılmaz.
 */

export const MODEL_SWEEPS = Math.min(4, Math.max(1, Number(process.env.GEMINI_MODEL_SWEEPS) || 2));

/** Yeniden denemeler için toplam duvar saati bütçesi; istek süresiz uzamaz. */
export const MODEL_RETRY_BUDGET_MS = Math.max(60_000, Number(process.env.GEMINI_RETRY_BUDGET_MS) || 300_000);

/**
 * Yanıt vermeyen model kısa süre devre dışı bırakılır; süre dolunca kendiliğinden
 * yeniden denenir. Geçici bir kesinti modeli kalıcı olarak dışlamaz.
 */
export const MODEL_COOLDOWN_MS = Number(process.env.MODEL_COOLDOWN_MS) > 0
  ? Number(process.env.MODEL_COOLDOWN_MS)
  : 10 * 60 * 1000;

const breakerHost = globalThis as unknown as { __kriterModelCooldown?: Map<string, number> };

function modelCooldown(): Map<string, number> {
  if (!breakerHost.__kriterModelCooldown) breakerHost.__kriterModelCooldown = new Map();
  return breakerHost.__kriterModelCooldown;
}

export function isModelCooling(model: string): boolean {
  const until = modelCooldown().get(model);
  if (!until) return false;
  if (Date.now() >= until) { modelCooldown().delete(model); return false; }
  return true;
}

export function markModelUnavailable(model: string) {
  modelCooldown().set(model, Date.now() + MODEL_COOLDOWN_MS);
}

export function markModelHealthy(model: string) {
  modelCooldown().delete(model);
}

/** Denenecek modeller: soğumada olanlar atlanır, hepsi soğumadaysa liste korunur. */
export function usableModels(models: string[]): { models: string[]; skipped: string[] } {
  const skipped = models.filter(isModelCooling);
  const usable = models.filter((model) => !isModelCooling(model));
  return usable.length ? { models: usable, skipped } : { models, skipped: [] };
}

export function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export type GenerationOutcome =
  | { ok: true; payload: unknown; model: string }
  | { ok: false; status: number; detail: string };

export type GenerationInput = {
  apiKey: string;
  /** Hazır `generateContent` gövdesi (JSON dizgesi). */
  body: string;
  /** Denenecek model kademeleri, öncelik sırasıyla. */
  models: string[];
  /** Birincil model için istek zaman aşımı; yedeklere en az 110 sn verilir. */
  timeoutMs?: number;
  /** Yeniden deneme bütçesinin başlangıcı (genelde isteğin başlangıcı). */
  startedAt: number;
  /** Günlük satırlarını ayırt etmek için kısa etiket. */
  label: string;
};

/**
 * Model listesini turlar hâlinde tarar ve ilk başarılı yanıtı döndürür.
 * Kimlik doğrulama ve şema hataları yeniden denenmez; geçici hatalar denenir.
 */
export async function runGeneration(input: GenerationInput): Promise<GenerationOutcome> {
  const { apiKey, body, startedAt, label } = input;
  const timeoutMs = input.timeoutMs ?? 80_000;
  const { models: attempts } = usableModels([...new Set(input.models.filter(Boolean))]);
  if (!attempts.length) return { ok: false, status: 502, detail: "Denenecek model tanımlı değil." };
  const primary = attempts[0];

  let lastDetail = "AI çağrısı tamamlanamadı.";
  let lastStatus = 502;
  const plan: string[] = [];
  for (let sweep = 0; sweep < MODEL_SWEEPS; sweep += 1) plan.push(...attempts);

  for (let planIndex = 0; planIndex < plan.length; planIndex += 1) {
    const model = plan[planIndex];
    // Soğumadaki model, ileride denenecek başka kademe varken atlanır; son çare
    // konumunda yine denenir — hiçbir zaman denemeden vazgeçilmez.
    const alternativeAhead = plan.slice(planIndex + 1).some((candidate) => !isModelCooling(candidate));
    if (isModelCooling(model) && alternativeAhead) continue;
    if (planIndex > 0 && Date.now() - startedAt > MODEL_RETRY_BUDGET_MS) break;

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal: AbortSignal.timeout(model === primary ? timeoutMs : Math.max(timeoutMs, 110_000)),
        },
      );
    } catch {
      markModelUnavailable(model);
      lastDetail = "AI modeli zaman sınırı içinde yanıt vermedi.";
      lastStatus = 504;
      continue;
    }

    if (response.ok) {
      let payload: unknown;
      try { payload = await response.json(); }
      catch {
        return { ok: false, status: 502, detail: "AI servisi geçerli JSON taşımayan bir yanıt döndürdü." };
      }
      markModelHealthy(model);
      return { ok: true, payload, model };
    }

    const errorPayload = await response.json().catch(() => ({})) as {
      error?: { message?: string; status?: string; details?: unknown[] };
    };
    // Yalnızca servis hata tanısı günlüğe yazılır; anahtar ve belge içeriği yazılmaz.
    console.error(`[gemini:${label}] generateContent reddedildi`, {
      model,
      httpStatus: response.status,
      status: errorPayload.error?.status,
      message: errorPayload.error?.message,
      details: errorPayload.error?.details,
    });
    lastDetail = errorPayload.error?.message || `AI isteği ${response.status} koduyla başarısız oldu.`;
    lastStatus = [429, 503, 401, 403].includes(response.status) ? response.status : 502;

    const retryable = [429, 500, 502, 503, 504].includes(response.status);
    if (!retryable) return { ok: false, status: lastStatus, detail: lastDetail };
    if ([500, 502, 503, 504].includes(response.status)) markModelUnavailable(model);
    if (planIndex + 1 < plan.length) {
      // Kademe değişiminde kısa, aynı kademenin tekrarında artan bekleme:
      // "high demand" dalgaları genelde saniyeler içinde geçiyor.
      const sweepIndex = Math.floor(planIndex / Math.max(1, attempts.length));
      const base = lastStatus === 429 ? 2_500 : 1_200;
      await delay(Math.min(12_000, base * 2 ** sweepIndex));
    }
  }
  return { ok: false, status: /zaman sınırı/i.test(lastDetail) ? 504 : lastStatus, detail: lastDetail };
}

/**
 * Yukarı akış hatasını kullanıcıya gösterilecek Türkçe cümleye çevirir.
 * `subject` mesajın öznesidir: "AI belge analizi" / "AI rapor analizi".
 */
export function describeGeminiFailure(status: number, detail: string, subject: string): {
  message: string;
  /**
   * İstemciye dönecek HTTP kod.
   *
   * 401/403 → 502: uygulamanın kendi oturum katmanı 401'i “yeniden giriş yap”
   * saydığı için yukarı akış kimlik hatası oturumu düşürmemeli.
   *
   * 429/503/504 → 503: model geçici olarak yok. Rapor değerlendirme istemcisi
   * 503'ü “motor şu an yok” olarak okur ve deterministik ön kontrollere düşer;
   * böylece Hakem tamamen boş bir ekranla kalmaz, sonucu uyarısıyla görür.
   */
  httpStatus: number;
  /** Geçici model yokluğu mu (yeniden denemeye değer) yoksa yapılandırma hatası mı? */
  transient: boolean;
} {
  const upstreamAuthFailure = status === 401 || status === 403;
  // Google tükenmiş bakiyeyi de 429 ile bildiriyor; "bir dakika sonra dene"
  // yönlendirmesi bu durumda yanlış olduğu için mesaj ayrıştırılır.
  const billingDepleted = /prepayment credits|billing|exceeded your current quota/i.test(detail);
  const message = status === 504
    ? `${subject} zaman sınırı içinde tamamlanamadı: AI modeli yanıt vermedi. Lütfen yeniden deneyin.`
    : billingDepleted
      ? "AI servisi isteği bakiye/kota nedeniyle reddetti: Google AI Studio projesinin ön ödemeli kredisi tükenmiş görünüyor. Anahtar geçerli; ai.dev/projects üzerinden faturalama bakiyesini yenileyin."
    : status === 429
      ? "AI servisinin geçici kullanım sınırına ulaşıldı. Yaklaşık bir dakika sonra yeniden deneyin."
    : status === 503
      ? `${subject} yapılamadı: AI modeli şu anda yoğun ve yedek modeller de yanıt vermedi. Birkaç dakika sonra yeniden deneyin; sorun sürerse GEMINI_MODEL değerini erişilebilir başka bir modele alın.`
    : upstreamAuthFailure
      ? "AI servisi anahtarı reddetti (kimlik doğrulama hatası). Bu bir kota sorunu değildir: GEMINI_API_KEY geçersiz, süresi dolmuş ya da Gemini API için yetkili değil."
    : `${subject} tamamlanamadı. Sunucunun bildirdiği neden: ${detail.slice(0, 300)}`;
  const transient = [429, 503, 504].includes(status);
  return {
    message,
    httpStatus: upstreamAuthFailure ? 502 : transient ? 503 : status,
    transient,
  };
}
