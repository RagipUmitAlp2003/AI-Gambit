/**
 * Worker bağlamaları ve sunucu tarafı ortam değişkenleri.
 * `.openai/hosting.json` içindeki `d1` alanı bağlama adını belirler; bu dosya
 * yalnızca tip tarafını tanımlar. Bağlama yoksa `DB` undefined gelir ve
 * yönetici uçları anlaşılır bir hata döndürür.
 */
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    /**
     * Oturum çerezini imzalayan anahtar. ZORUNLU: tanımlı değilse yönetici
     * uçları açık kalmaz, 503 ile reddedilir (fail-closed).
     */
    MODERATOR_SECRET?: string;
    /** İlk 00 hesabını açmak için tek seferlik kurulum anahtarı. */
    MODERATOR_BOOTSTRAP_TOKEN?: string;
    /** Tanımlıysa hesap e-postaları Resend üzerinden gerçekten gönderilir. */
    RESEND_API_KEY?: string;
    /** Gönderen adresi, ör. "Kriter Atölyesi <yonetim@ornek.org>". */
    MAIL_FROM?: string;
    MAIL_REPLY_TO?: string;
    /** Mailde gösterilecek giriş adresi. */
    APP_BASE_URL?: string;
    /** "production" ise geliştirme kolaylıkları kapanır. */
    APP_ENV?: string;
    NODE_ENV?: string;
  }
}
