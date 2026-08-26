/**
 * Gemini `generateContent` çağrılarının ortak katmanı — TEK ÇAĞRI politikası.
 *
 * Kural: bir kullanıcı işlemi (şartname analizi, rapor analizi) için modele
 * TAM OLARAK BİR üretim isteği gider. Gizli model turu, model taraması
 * (sweep), yedek model kademesi veya arka planda çalışan yeniden deneme
 * döngüsü YOKTUR. Daha önceki sürümlerde 2 turluk 3 modellik bir plan
 * çalışıyor, üstelik tanılamaya `apiCalls: 1` yazılıyordu; kullanıcı tek çağrı
 * sandığı işlem için altı istek ödeyebiliyordu.
 *
 * Geçici bir aksaklıkta (429 hız sınırı, 503 model yoğunluğu, zaman aşımı)
 * karar kullanıcıya bırakılır: uç açık bir hata döndürür, `retryable` bayrağını
 * işaretler ve arayüz "Yeniden dene" düğmesini gösterir. Böylece hem gerçek
 * çağrı sayısı ölçülebilir kalır hem de kullanıcı ne olduğunu bilir.
 *
 * Modelin ürettiği metin ve API anahtarı hiçbir günlüğe yazılmaz.
 */

/**
 * PDF sayfalarının modele hangi görüntü çözünürlüğüyle verileceği.
 *
 * NEDEN "LOW": `MEDIA_RESOLUTION_MEDIUM` ile çok sayfalı şartnameler Gemini
 * tarafında yüksek kapasiteli istek sayılıyor ve model bunları **503 "This
 * model is currently experiencing high demand"** ile reddediyor. Ölçüm
 * (29 sayfalık İnsansız Deniz Aracı şartnamesi, 1,8 MB, aynı istek gövdesi):
 *
 *   MEDIA_RESOLUTION_MEDIUM  → 4/4 denemede 503 (veya zaman aşımı)
 *   çözünürlük belirtilmemiş → 503
 *   MEDIA_RESOLUTION_LOW     → 3/3 denemede başarılı · 30–108 sn
 *                              16 719 giriş tokenı · 14 kriter · 14/14 kaynak sayfa
 *
 * Kriter ve kanıt metinleri PDF'in METİN katmanından okunur; düşük görüntü
 * çözünürlüğü kriter sayısını ve kaynak sayfa doluluğunu değiştirmedi. Şema
 * çizimi gibi görsel ayrıntı gerektiren belgelerde `GEMINI_MEDIA_RESOLUTION`
 * ile yükseltilebilir — ancak 503 riski geri gelir.
 */
export const MEDIA_RESOLUTION = (() => {
  const requested = (process.env.GEMINI_MEDIA_RESOLUTION || "").toUpperCase();
  const allowed = ["LOW", "MEDIUM", "HIGH"];
  const level = allowed.includes(requested) ? requested : "LOW";
  return `MEDIA_RESOLUTION_${level}`;
})();

/** PDF'i modele verirken kullanılacak `mediaResolution` bloğu. */
export function mediaResolutionPart() {
  return { mediaResolution: { level: MEDIA_RESOLUTION } };
}

export type GenerationOutcome =
  | { ok: true; payload: unknown; model: string; apiCalls: 1 }
  | { ok: false; status: number; detail: string; model: string; apiCalls: 0 | 1 };

export type GenerationInput = {
  apiKey: string;
  /** Hazır `generateContent` gövdesi (JSON dizgesi). */
  body: string;
  /** Kullanılacak TEK model. */
  model: string;
  /** İstek zaman aşımı. */
  timeoutMs: number;
  /** Günlük satırlarını ayırt etmek için kısa etiket. */
  label: string;
};

/**
 * Modele tek bir `generateContent` isteği gönderir ve sonucu döndürür.
 *
 * `apiCalls` alanı GERÇEKTEN yapılan üretim isteği sayısıdır: istek gidip yanıt
 * gelmediğinde (zaman aşımı) 1; ağ katmanına hiç çıkılamadığında (DNS, TLS,
 * bağlantı reddi) veya çağrı hiç başlatılmadığında 0. Böylece ölçüm gerçek
 * faturayla ayrışmaz. Tanılama ve kullanım ölçümü bu değeri olduğu gibi yazar.
 */
export async function runSingleGeneration(input: GenerationInput): Promise<GenerationOutcome> {
  const { apiKey, body, model, timeoutMs, label } = input;
  if (!model) return { ok: false, status: 502, detail: "Denenecek model tanımlı değil.", model: "", apiCalls: 0 };

  let response: Response;
  const startedAt = Date.now();
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (error) {
    // Eskiden bu blok `catch {}` idi: zaman aşımı, DNS hatası, TLS/vekil engeli
    // ve bağlantı kopması AYNI 504 mesajına çıkıyor, sunucuda hiçbir kayıt
    // bırakmıyordu. Üretimdeki 150 sn'lik başarısızlığın neden olduğunu
    // anlamak bu yüzden imkânsızdı; artık neden ayırt edilir ve günlüğe yazılır.
    const elapsedMs = Date.now() - startedAt;
    const name = error instanceof Error ? error.name : "UnknownError";
    const cause = (error as { cause?: { code?: string } } | undefined)?.cause?.code ?? "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    console.error(`[gemini:${label}] generateContent yanıtsız kaldı`, { model, elapsedMs, timeoutMs, errorName: name, cause });
    if (timedOut) {
      // İstek gerçekten gitti, yanıt gelmedi; çağrı sayılır.
      return { ok: false, status: 504, detail: `AI modeli ${Math.round(timeoutMs / 1000)} sn içinde yanıt vermedi.`, model, apiCalls: 1 };
    }
    // Ağ katmanına hiç çıkılamadı: model bir istek görmedi, faturalanmaz.
    return {
      ok: false,
      status: 502,
      detail: `AI servisine ağ üzerinden ulaşılamadı (${cause || name}). Bu bir model veya kota hatası değildir.`,
      model,
      apiCalls: 0,
    };
  }

  if (response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, status: 502, detail: "AI servisi geçerli JSON taşımayan bir yanıt döndürdü.", model, apiCalls: 1 };
    }
    return { ok: true, payload, model, apiCalls: 1 };
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
  return {
    ok: false,
    status: [429, 503, 401, 403].includes(response.status) ? response.status : 502,
    detail: errorPayload.error?.message || `AI isteği ${response.status} koduyla başarısız oldu.`,
    model,
    apiCalls: 1,
  };
}

export type GeminiFailureDescription = {
  message: string;
  /**
   * İstemciye dönecek HTTP kod.
   *
   * 401/403 → 502: uygulamanın kendi oturum katmanı 401'i "yeniden giriş yap"
   * saydığı için yukarı akış kimlik hatası oturumu düşürmemeli.
   *
   * 429/503/504 → 503: model geçici olarak yok; arayüz "Yeniden dene" sunar.
   */
  httpStatus: number;
  /** Geçici model yokluğu mu (yeniden denemeye değer) yoksa yapılandırma hatası mı? */
  transient: boolean;
};

/**
 * Yukarı akış hatasını kullanıcıya gösterilecek Türkçe cümleye çevirir.
 * `subject` mesajın öznesidir: "AI belge analizi" / "AI rapor analizi".
 *
 * "İşlem tamamlanamadı." gibi içi boş bir cümle üretilmez: sınıflandırılamayan
 * hatada sunucunun bildirdiği neden mesaja yazılır.
 */
export function describeGeminiFailure(status: number, detail: string, subject: string): GeminiFailureDescription {
  const upstreamAuthFailure = status === 401 || status === 403;
  // Google tükenmiş bakiyeyi de 429 ile bildiriyor; "bir dakika sonra dene"
  // yönlendirmesi bu durumda yanlış olduğu için mesaj ayrıştırılır.
  const billingDepleted = /prepayment credits|billing|exceeded your current quota/i.test(detail);
  const message = status === 504
    // Ölçülen kök neden: bazı model adları bu istek gövdesinde kararsız biçimde
    // hiç yanıt üretmiyor (bir ölçümde 13 denemenin 8'i yanıtsız kaldı).
    // Eski mesaj yalnızca "yeniden dene" diyordu; kullanıcı aynı duvara tekrar
    // tekrar çarpıyordu. Yönlendirme bu yüzden GEMINI_MODEL'i de söyler.
    ? `${subject} zaman sınırı içinde tamamlanamadı: AI modeli yanıt vermedi. “Yeniden dene” ile aynı belgeyi tekrar gönderebilirsiniz. `
      + `AYNI belge her denemede zaman aşımına uğruyorsa sorun geçici değildir: yapılandırılan model bu belgeyi işleyemiyor olabilir, `
      + `.env.local içindeki GEMINI_MODEL değerini çalıştığı doğrulanmış bir modele alın (npm run check:gemini).`
    : billingDepleted
      ? "AI servisi isteği bakiye/kota nedeniyle reddetti: Google AI Studio projesinin ön ödemeli kredisi tükenmiş görünüyor. Anahtar geçerli; ai.dev/projects üzerinden faturalama bakiyesini yenileyin."
    : status === 429
      ? "AI servisinin geçici kullanım sınırına ulaşıldı. Yaklaşık bir dakika sonra “Yeniden dene” ile tekrar deneyin."
    : status === 503
      // 503 "high demand" yalnızca genel yoğunluk değildir: Gemini, çok sayfalı
      // PDF'leri yüksek görüntü çözünürlüğüyle işlemeyi de bu kodla reddediyor.
      // Aynı belge tekrar tekrar 503 alıyorsa neden kapasite değil ayardır;
      // yönlendirme bu yüzden GEMINI_MEDIA_RESOLUTION'ı da söyler.
      ? `${subject} yapılamadı: AI servisi isteği kapasite nedeniyle reddetti (503). Sistem sizin adınıza otomatik yeniden deneme yapmaz; birkaç dakika sonra “Yeniden dene” düğmesini kullanın. `
        + `AYNI belge her denemede 503 alıyorsa sorun geçici yoğunluk değildir: ${MEDIA_RESOLUTION !== "MEDIA_RESOLUTION_LOW" ? "GEMINI_MEDIA_RESOLUTION değerini LOW yapın" : "belge çok uzun olabilir, GEMINI_MODEL değerini erişilebilir başka bir modele alın"}.`
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
