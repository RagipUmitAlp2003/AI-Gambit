-- Yarışmacı parola bayrağı düzeltmesi (GÖREV 3 · madde 10 · must_change_password akışı).
--
-- Yarışmacı, kayıt sırasında parolasını KENDİSİ seçer; buna rağmen eski kayıt
-- akışı must_change_password bayrağını varsayılan 1 bırakıyordu. Gerçek parola
-- değiştirme akışı (app/api/admin/password) devreye girince bu bayrak
-- yarışmacıyı yanlış yere zorunlu değişime sokardı. Bu göç yalnızca kendi
-- kaydını açan (created_by = 'yarışmacı kaydı') 03 hesaplarının bayrağını
-- temizler; yönetici eliyle geçici parolayla açılan hesaplara DOKUNMAZ.
--
-- EKLEMELİ ve GERİYE UYUMLU: tablo/sütun değişmez, hiçbir satır silinmez.
-- Uygulama aynı düzeltmeyi çalışma anında tek seferlik uygular
-- (app/lib/admin-db.ts · applyParticipantPasswordFlagMigration); bu dosya
-- kayıt ve elle çalıştırma içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0011_participant_password_flag.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

UPDATE admin_accounts
SET must_change_password = 0
WHERE role_code = '03' AND created_by = 'yarışmacı kaydı';

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0011_participant_password_flag', datetime('now'));

PRAGMA optimize;
