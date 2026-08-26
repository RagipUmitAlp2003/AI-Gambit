/**
 * Gemini `generateContent` çağrılarının ortak katmanı.
 *
 * MALİYET PRENSİBİ (değişmedi): bir kullanıcı işlemi (şartname analizi, rapor
 * analizi) için modele ÜCRETLİ olarak TAM OLARAK BİR üretim isteği gider. Gizli
 * model turu, model taraması (sweep) veya yedek model kademesi YOKTUR. Daha
 * önceki sürümlerde 2 turluk 3 modellik bir plan çalışıyor, üstelik tanılamaya
 * `apiCalls: 1` yazılıyordu; kullanıcı tek çağrı sandığı işlem için altı istek
 * ödeyebiliyordu.
 *
 * ERİŞİLEBİLİRLİK (bu sürümde eklendi): Gemini, çok sayfalı PDF içeren
 * istekleri kesintili olarak **503 UNAVAILABLE — "This model is currently
 * experiencing high demand"** ile reddediyor. Ölçüm (aynı gövde, aynı anahtar,
 * 20 sayfalık şartname PDF dosyası, `MEDIA_RESOLUTION_LOW`, ~6,4k giriş tokenı):
 *
 *   gemini-3.7-flash        → 5 denemenin 3'ü 503 (düz metin isteğinde bile)
 *   gemini-3.5-flash        → 12 denemenin 5'i 503 veya zaman aşımı
 *   gemini-3-flash-preview  → 503
 *
 * Bu reddedilen istekler MODELE HİÇ GİRMİYOR: yanıtta `usageMetadata` yok, tek
 * bir token bile faturalanmıyor. Dolayısıyla 503'ü yeniden denemek maliyet
 * prensibini bozmaz — bozan şey, %40 dolayında bir üst akış reddini kullanıcıya
 * "analiz başarısız" olarak geçirmekti: hakem "Yeniden dene" düğmesine üç kez
 * bastığında her seferinde aynı yazı tura atılıyordu.
 *
 * Bu yüzden burada YALNIZCA BEDELSİZ RED KODLARI (503 UNAVAILABLE, 500
 * INTERNAL) sınırlı sayıda, artan bekleme ve toplam süre bütçesiyle yeniden
 * denenir. 429 (kota/hız) yeniden DENENMEZ: orada tekrar denemek sınırı daha da
 * kötüleştirir. 4xx (geçersiz anahtar, hatalı gövde) yeniden DENENMEZ: aynı
 * istek aynı yanıtı verir. Zaman aşımı yeniden DENENMEZ: istek modele girmiş
 * olabilir, ücretlendirilmiş sayılır.
 *
 * Sayaçlar dürüst kalır: `apiCalls` yalnızca ÜCRETLİ deneme sayısıdır (başarılı
 * üretim veya zaman aşımı → 1), `rejectedAttempts` ise bedelsiz 503/500
 * reddidir. `attempts` ikisinin toplamı, yani gerçekten kurulan HTTP isteği
 * sayısıdır. Böylece `callsPerAnalysis` ölçütü 1'i aşmaz ama üst akıştaki
 * kararsızlık da günlükte görünür.
 *
 * Modelin ürettiği metin ve API anahtarı hiçbir günlüğe yazılmaz.
 */

/**
 * PDF sayfalarının modele hangi görüntü çözünürlüğüyle verileceği.
 *
 * NEDEN "LOW": `MEDIA_RESOLUTION_MEDIUM` ile çok sayfalı şartnameler Gemini
 * tarafında yüksek kapasiteli istek sayılıyor ve model bunları 503 ile
 * reddediyor. Ölçüm (29 sayfalık İnsansız Deniz Aracı şartnamesi, 1,8 MB, aynı
 * istek gövdesi):
 *
 *   MEDIA_RESOLUTION_MEDIUM  → 4/4 denemede 503 (veya zaman aşımı)
 *   çözünürlük belirtilmemiş → 503
 *   MEDIA_RESOLUTION_LOW     → 3/3 denemede başarılı · 30–108 sn
 *                              16 719 giriş tokenı · 14 kriter · 14/14 kaynak sayfa
 *
 * `countTokens` ile doğrulandı: parça düzeyinde `mediaResolution` GERÇEKTEN
 * uygulanıyor — aynı PDF için 12 880 → 6 440 belge tokenı. Kriter ve kanıt
 * metinleri PDF metin katmanından okunur; düşük görüntü çözünürlüğü kriter
 * sayısını ve kaynak sayfa doluluğunu değiştirmedi. Şema çizimi gibi görsel
 * ayrıntı gerektiren belgelerde `GEMINI_MEDIA_RESOLUTION` ile yükseltilebilir —
 * ancak 503 riski geri gelir.
 */
export const MEDIA_RESOLUTION = (() => {
  const requested = (process.env.GEMINI_MEDIA_RESOLUTION || "").toUpperCase();
  const allowed = ["LOW", "MEDIUM", "HIGH"];
  const level = allowed.includes(requested) ? requested : "LOW";
  return `MEDIA_RESOLUTION_${level}`;
})();

/** PDF dosyasını modele verirken kullanılacak `mediaResolution` bloğu. */
export function mediaResolutionPart() {
  return { mediaResolution: { level: MEDIA_RESOLUTION } };
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/**
 * Bedelsiz üst akış reddinde kaç HTTP isteği kurulacağı (ilk deneme dahil).
 * 1 yazıldığında yeniden deneme tamamen kapanır ve eski davranışa dönülür.
 */
export const MAX_ATTEMPTS = positiveInteger(process.env.GEMINI_MAX_ATTEMPTS, 4, 6);

/**
 * Bir kullanıcı işleminin modelde geçirebileceği toplam süre. Yeni bir deneme
 * yalnızca bütçede bir tam denemeye yer kaldığında başlatılır; aksi hâlde
 * elimizdeki son hata döndürülür.
 */
export const TOTAL_BUDGET_MS = positiveInteger(process.env.GEMINI_TOTAL_BUDGET_MS, 300_000, 600_000);

/** Yeniden denenmesi maliyetsiz olan üst akış kodları. */
const FREE_REJECTION_STATUSES = [500, 503];

export type GenerationOutcome =
  | {
      ok: true;
      payload: unknown;
      model: string;
      /** ÜCRETLİ üretim isteği sayısı. Başarılı sonuçta her zaman 1. */
      apiCalls: number;
      /** Kurulan toplam HTTP isteği sayısı (bedelsiz redler dahil). */
      attempts: number;
      /** Modele hiç girmeyen, faturalanmayan 503/500 reddi sayısı. */
      rejectedAttempts: number;
    }
  | {
      ok: false;
      status: number;
      detail: string;
      model: string;
      apiCalls: number;
      attempts: number;
      rejectedAttempts: number;
    };

export type GenerationInput = {
  apiKey: string;
  /** Hazır `generateContent` gövdesi (JSON dizgesi). */
  body: string;
  /** Kullanılacak TEK model. */
  model: string;
  /** TEK bir denemenin zaman aşımı. */
  timeoutMs: number;
  /** Günlük satırlarını ayırt etmek için kısa etiket. */
  label: string;
  /** Bedelsiz redde en fazla kaç HTTP isteği kurulacağı; varsayılan MAX_ATTEMPTS. */
  maxAttempts?: number;
  /** Tüm denemeler için toplam süre bütçesi; varsayılan TOTAL_BUDGET_MS. */
  totalBudgetMs?: number;
};

/**
 * Bedelsiz reddin ardından ne kadar bekleneceği. Üst akış `Retry-After`
 * söylüyorsa ona uyulur; söylemiyorsa artan bekleme + rastgele saçılma
 * uygulanır (aynı anda gelen istekler aynı saniyede geri dönmesin).
 */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(30_000, Math.ceil(retryAfterSeconds * 1000));
  }
  const base = Math.min(12_000, 1_500 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 750);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Modele üretim isteği gönderir; yalnızca bedelsiz üst akış reddinde (503/500)
 * sınırlı sayıda yeniden dener.
 *
 * `apiCalls` alanı GERÇEKTEN ücretlendirilen üretim isteği sayısıdır: ağ
 * katmanına çıkılıp yanıt alınamadığında (zaman aşımı/bağlantı hatası) 1, çağrı
 * hiç başlatılmadıysa 0, başarılı üretimde 1. Tanılama ve kullanım ölçümü bu
 * değeri olduğu gibi yazar; bedelsiz redler `rejectedAttempts` ile ayrı
 * raporlanır.
 */
export async function runSingleGeneration(input: GenerationInput): Promise<GenerationOutcome> {
  const { apiKey, body, model, timeoutMs, label } = input;
  if (!model) {
    return { ok: false, status: 502, detail: "Denenecek model tanımlı değil.", model: "", apiCalls: 0, attempts: 0, rejectedAttempts: 0 };
  }

  const maxAttempts = Math.max(1, input.maxAttempts ?? MAX_ATTEMPTS);
  const totalBudgetMs = input.totalBudgetMs ?? TOTAL_BUDGET_MS;
  const startedAt = Date.now();
  let rejectedAttempts = 0;
  let attempts = 0;
  let lastFailure = { status: 502, detail: "AI isteği tamamlanamadı." };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts += 1;
    let response: Response;
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
    } catch {
      // İstek gitti ama yanıt gelmedi; model işi yapmış olabilir, ücretli sayılır
      // ve yeniden DENENMEZ.
      return {
        ok: false,
        status: 504,
        detail: "AI modeli zaman sınırı içinde yanıt vermedi.",
        model,
        apiCalls: 1,
        attempts,
        rejectedAttempts,
      };
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          ok: false,
          status: 502,
          detail: "AI servisi geçerli JSON taşımayan bir yanıt döndürdü.",
          model,
          apiCalls: 1,
          attempts,
          rejectedAttempts,
        };
      }
      if (rejectedAttempts > 0) {
        console.warn(`[gemini:${label}] ${rejectedAttempts} bedelsiz 503/500 reddinden sonra başarılı`, { model, attempts });
      }
      return { ok: true, payload, model, apiCalls: 1, attempts, rejectedAttempts };
    }

    const errorPayload = await response.json().catch(() => ({})) as {
      error?: { message?: string; status?: string; details?: unknown[] };
    };
    // Yalnızca servis hata tanısı günlüğe yazılır; anahtar ve belge içeriği yazılmaz.
    console.error(`[gemini:${label}] generateContent reddedildi`, {
      model,
      attempt,
      maxAttempts,
      httpStatus: response.status,
      status: errorPayload.error?.status,
      message: errorPayload.error?.message,
      details: errorPayload.error?.details,
    });

    const mappedStatus = [429, 503, 401, 403].includes(response.status) ? response.status : 502;
    lastFailure = {
      status: mappedStatus,
      detail: errorPayload.error?.message || `AI isteği ${response.status} koduyla başarısız oldu.`,
    };

    if (!FREE_REJECTION_STATUSES.includes(response.status)) {
      // 429 / 4xx: yeniden denemek yardımcı olmaz, hemen yukarıya taşınır.
      // Sınıflandırması belirsiz olduğu için ücretli sayılır (temkinli ölçüm).
      return { ok: false, ...lastFailure, model, apiCalls: 1, attempts, rejectedAttempts };
    }

    rejectedAttempts += 1;
    if (attempt >= maxAttempts) break;

    const wait = backoffMs(attempt, response.headers.get("retry-after"));
    const elapsed = Date.now() - startedAt;
    // Bütçede bekleme + bir tam deneme sığmıyorsa yeni tur başlatılmaz; kullanıcı
    // boşuna bir zaman aşımı daha beklemek yerine hemen "Yeniden dene" görür.
    if (elapsed + wait + timeoutMs > totalBudgetMs) {
      console.warn(`[gemini:${label}] süre bütçesi doldu, yeniden deneme durduruldu`, { model, attempts, elapsed, totalBudgetMs });
      break;
    }
    await sleep(wait);
  }

  // Tüm denemeler bedelsiz redle bitti: modele hiç girilmedi, ücret oluşmadı.
  return { ok: false, ...lastFailure, model, apiCalls: 0, attempts, rejectedAttempts };
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
export function describeGeminiFailure(
  status: number,
  detail: string,
  subject: string,
  /** Bedelsiz olarak reddedilip yeniden denenen istek sayısı; mesaja yazılır. */
  rejectedAttempts = 0,
): GeminiFailureDescription {
  const upstreamAuthFailure = status === 401 || status === 403;
  // Google tükenmiş bakiyeyi de 429 ile bildiriyor; "bir dakika sonra dene"
  // yönlendirmesi bu durumda yanlış olduğu için mesaj ayrıştırılır.
  const billingDepleted = /prepayment credits|billing|exceeded your current quota/i.test(detail);
  const message = status === 504
    ? `${subject} zaman sınırı içinde tamamlanamadı: AI modeli yanıt vermedi. “Yeniden dene” ile aynı belgeyi tekrar gönderebilirsiniz.`
    : billingDepleted
      ? "AI servisi isteği bakiye/kota nedeniyle reddetti: Google AI Studio projesinin ön ödemeli kredisi tükenmiş görünüyor. Anahtar geçerli; ai.dev/projects üzerinden faturalama bakiyesini yenileyin."
    : status === 429
      ? "AI servisinin geçici kullanım sınırına ulaşıldı. Yaklaşık bir dakika sonra “Yeniden dene” ile tekrar deneyin."
    : status === 503
      // 503 "high demand" yalnızca genel yoğunluk değildir: Gemini, çok sayfalı
      // PDF dosyalarını bu kodla kesintili olarak reddediyor. Sunucu bu reddi
      // zaten kendisi birkaç kez yeniden denedi (bedelsiz); yine de geçmediyse
      // sorun anlık bir dalgalanma değil, bu yüzden mesaj ayarı da söyler.
      ? `${subject} yapılamadı: AI servisi isteği kapasite nedeniyle reddetti (503). `
        + `Sunucu ${rejectedAttempts > 1 ? `${rejectedAttempts} kez` : "yeniden"} denedi, model yine yanıt vermedi; bu redler faturalanmaz. `
        + `Birkaç dakika sonra “Yeniden dene” düğmesini kullanın. `
        + `AYNI belge her denemede 503 alıyorsa sorun geçici yoğunluk değildir: `
        + `${MEDIA_RESOLUTION !== "MEDIA_RESOLUTION_LOW" ? "GEMINI_MEDIA_RESOLUTION değerini LOW yapın, sürerse " : ""}`
        + `GEMINI_MODEL değerini daha kararlı bir modele alın (ölçümde gemini-3.5-flash, gemini-3.7-flash'tan belirgin biçimde güvenilirdi).`
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
