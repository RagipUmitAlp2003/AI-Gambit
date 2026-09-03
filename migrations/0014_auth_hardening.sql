-- Kimlik doğrulama sertleştirmesi (GÖREV 3 · madde 10).
--
-- EKLEMELİ ve GERİYE UYUMLU: hiçbir tablo düşürülmez, hiçbir satır silinmez,
-- var olan sütunlar değiştirilmez. Eski proses içi kaba kuvvet sayacının
-- (app/api/admin/session · Map) yerini alan D1 tablosu eklenir: sayaç artık
-- Cloudflare izolatları arasında paylaşılır, pencere süreli çalışır ve süresi
-- geçen satırlar uygulama tarafında fırsatçı TTL ile temizlenir.
--
-- GİZLİLİK: anahtar SHA-256(ip|kimlik) özetidir; açık IP adresi, kullanıcı
-- adı veya e-posta SAKLANMAZ.
--
-- Uygulama şeması aynı tabloyu çalışma anında da oluşturur
-- (app/lib/admin-db.ts); bu dosya kayıt ve elle çalıştırma içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0014_auth_hardening.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- DAĞITIK GİRİŞ KABA KUVVET SAYACI
--
-- window_started_at: kayan pencerenin başlangıcı (ISO 8601). Pencere dolunca
-- sayaç uygulamadaki tek upsert ile 1'e döner.
-- last_failed_at: TTL temizliği bu sütuna bakar (pencerenin 2 katından eski
-- satırlar her yazımda silinir; sınırsız büyüme yok).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_login_failures (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 1,
  last_failed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_failures_last
  ON admin_login_failures (last_failed_at);

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0010_auth_hardening', datetime('now'));

PRAGMA optimize;
