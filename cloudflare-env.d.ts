/**
 * Worker bağlamaları ve sunucu tarafı ortam değişkenleri.
 * `.openai/hosting.json` içindeki `d1` alanı bağlama adını belirler; bu dosya
 * yalnızca tip tarafını tanımlar. Bağlama yoksa `DB` undefined gelir ve
 * yönetici uçları anlaşılır bir hata döndürür.
 */
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    /** Katılımcı başvuru PDF'lerinin saklandığı özel nesne deposu. */
    REPORTS?: R2Bucket;
    /**
     * Oturum çerezini imzalayan anahtar. ZORUNLU: tanımlı değilse yönetici
     * uçları açık kalmaz, 503 ile reddedilir (fail-closed).
     */
    MODERATOR_SECRET?: string;
    /** İlk 00 hesabını açmak için tek seferlik kurulum anahtarı. */
    MODERATOR_BOOTSTRAP_TOKEN?: string;
    /** Yalnızca yerel geliştirmede rol kısayollarını açar. Üretimde yok sayılır. */
    ALLOW_DEV_LOGIN?: string;
    /**
     * Yerel "Kurulum Admini oluştur" (admin / 1234) ucunun AÇIK izni.
     * Tek başına yetmez: APP_ENV=development + loopback istek + sıfır aktif
     * Admin koşulları da birlikte sağlanmalıdır. Üretimde ASLA açılmamalıdır.
     */
    ALLOW_LOCAL_ADMIN_BOOTSTRAP?: string;
    /** Tanımlıysa hesap e-postaları Resend üzerinden gerçekten gönderilir. */
    RESEND_API_KEY?: string;
    /** Gönderen adresi, ör. "Kriter Atölyesi <yonetim@ornek.org>". */
    MAIL_FROM?: string;
    MAIL_REPLY_TO?: string;
    /** Mailde gösterilecek giriş adresi. */
    APP_BASE_URL?: string;
    /**
     * "development" ise geliştirme kolaylıkları açılır. EKSİKSE ya da
     * tanınmayan bir değerse sistem production sayılır (fail-closed);
     * bkz. app/lib/session.ts · runtimeEnvironment.
     */
    APP_ENV?: string;
    NODE_ENV?: string;
    /**
     * Benzerlik Katman 3 (LLM açıklama kontrolü) kapatma anahtarı: "off" veya
     * "0" kapatır; tanımsız/başka değer AÇIK demektir. Kapalıyken deterministik
     * MinHash+embedding sonucu aynen üretilir (app/lib/similarity-config.ts).
     */
    SIMILARITY_LLM_ENABLED?: string;
    /** Benzerlik eşikleri (kalibre edilebilir; geçersiz değer varsayılana düşer). */
    SIMILARITY_DIRECT_HIGH?: string;
    SIMILARITY_DIRECT_REVIEW?: string;
    SIMILARITY_SEMANTIC_HIGH?: string;
    SIMILARITY_SEMANTIC_REVIEW?: string;
    /** Rapor seviye bantları (varsayılan 20/40; madde 6). */
    SIMILARITY_REPORT_REVIEW_PERCENT?: string;
    SIMILARITY_REPORT_HIGH_PERCENT?: string;
    /** Katman 3'e giden en güçlü eşleşme sayısı (1-5, varsayılan 3). */
    SIMILARITY_LLM_TOP_K?: string;
    /** Çalışma zamanı sınırları (madde 8): havuz üst sınırı (varsayılan 200 başvuru). */
    SIMILARITY_POOL_MAX_APPS?: string;
    /** İstek başına süre bütçesi (varsayılan 15000 ms); dolunca koşu sürdürülür. */
    SIMILARITY_TIME_BUDGET_MS?: string;
    /** Parti başına eş başvuru sayısı (varsayılan 10). */
    SIMILARITY_PEER_BATCH_APPS?: string;
    /** Belge başına parça tavanı (varsayılan 400); aşan kuyruk denetime "tavan" olarak yazılır. */
    SIMILARITY_MAX_CHUNKS?: string;
    /** Benzerlik JSON gövde tavanı (varsayılan 8 MB; madde 9 akışlı bayt kapısı). */
    SIMILARITY_MAX_BODY_BYTES?: string;
    /** Ortak readJson gövde tavanı (varsayılan 2 MB). */
    REQUEST_JSON_MAX_BYTES?: string;
    /** save_evaluation gövde tavanı (varsayılan 4 MB). */
    EVALUATION_JSON_MAX_BYTES?: string;
  }
}
