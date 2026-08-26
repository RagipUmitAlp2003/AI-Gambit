-- Değerlendirme bütünlüğü, kriter sürümleme, yarışma yaşam döngüsü ve
-- kullanıcı adıyla giriş (Problem 4 · maddeler 2, 3, 4, 6, 7, 8, 11, 12).
--
-- EKLEMELİ ve GERİYE UYUMLU: hiçbir tablo düşürülmez, hiçbir satır silinmez,
-- var olan sütunlar değiştirilmez. Eski kayıtlar yeni sütunların varsayılan
-- değerleriyle çalışmaya devam eder.
--
-- Uygulama şeması aynı değişiklikleri çalışma anında da uygular
-- (app/lib/workflow-db.ts ve app/lib/admin-db.ts); bu dosya kayıt ve elle
-- çalıştırma içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0008_integrity_and_lifecycle.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1) DEĞİŞMEZ KRİTER SÜRÜMLERİ (madde 2)
--
-- Yarışma Yöneticisi kriterleri her yayımladığında BURAYA yeni bir satır
-- yazılır; var olan satır asla güncellenmez. Hakem analizi daima en son
-- sürümü kullanır; geçmiş değerlendirmeler kendi sürümüyle denetlenebilir
-- kalır ve yeni kriterlerle sessizce değişmez.
--
-- `criteria_json` o andaki kriter setinin tam anlık görüntüsüdür. Kaynak
-- sayfa ve kaynak alıntı kilidi (madde 12) bu anlık görüntüden okunur.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS criteria_profile_versions (
  id TEXT PRIMARY KEY,
  criteria_profile_id TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  criteria_version INTEGER NOT NULL,
  criteria_hash TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  criteria_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_by_name TEXT NOT NULL DEFAULT '',
  UNIQUE (competition_key, criteria_version)
);

CREATE INDEX IF NOT EXISTS idx_criteria_versions_competition
  ON criteria_profile_versions (competition_key, criteria_version DESC);
CREATE INDEX IF NOT EXISTS idx_criteria_versions_profile
  ON criteria_profile_versions (criteria_profile_id, criteria_version ASC);

-- ---------------------------------------------------------------------------
-- 2) KRİTERİN PDF'DEN DENETLENEBİLİRLİĞİ (madde 4)
--
-- PDF_DENETLENEBILIR · HARICI_KANIT_GEREKLI · HAKEM_KONTROLU_GEREKLI
-- Video, saha teslimi veya kurul kararı gerektiren kurallar rapor analizinde
-- ihlal SAYILMAZ. Varsayılan, eski satırların davranışını korur.
-- ---------------------------------------------------------------------------
ALTER TABLE criteria ADD COLUMN verifiability TEXT NOT NULL DEFAULT 'PDF_DENETLENEBILIR';

-- ---------------------------------------------------------------------------
-- 3) DEĞERLENDİRME BÜTÜNLÜĞÜ (madde 3)
--
-- Kaydedilen AI sonucu, üretildiği kriter sürümüne ve PDF sürümüne bağlanır.
-- Sunucu kaydetmeden önce bu bağı doğrular; uyuşmazlıkta kayıt yapılmaz.
-- ---------------------------------------------------------------------------
ALTER TABLE evaluation_results ADD COLUMN criteria_version INTEGER;
ALTER TABLE evaluation_results ADD COLUMN criteria_hash TEXT;
ALTER TABLE evaluation_results ADD COLUMN pdf_hash TEXT;

ALTER TABLE competition_applications ADD COLUMN evaluation_criteria_version INTEGER;
ALTER TABLE competition_applications ADD COLUMN evaluation_criteria_hash TEXT;
ALTER TABLE competition_applications ADD COLUMN evaluation_pdf_hash TEXT;
ALTER TABLE competition_applications ADD COLUMN evaluation_version_id TEXT;

-- ---------------------------------------------------------------------------
-- 4) YARIŞMA AKTİF / PASİF (madde 6)
--
-- Süreç aşamasından (status) BAĞIMSIZ bir anahtardır. Pasif yarışma
-- yarışmacının listesinde görünmez ve yeni başvuru kabul etmez; hakem geçmiş
-- başvuruları görmeye devam eder. Varsayılan 1 (aktif): eski satırlar
-- davranış değiştirmez.
-- ---------------------------------------------------------------------------
ALTER TABLE competitions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE competitions ADD COLUMN activation_note TEXT;
ALTER TABLE competitions ADD COLUMN activation_changed_at TEXT;
ALTER TABLE competitions ADD COLUMN activation_changed_by TEXT;
ALTER TABLE competitions ADD COLUMN activation_changed_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_competitions_active
  ON competitions (is_active, status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 5) SOFT DELETE / ARŞİVLEME (maddeler 8 ve 11)
--
-- Arayüzdeki hiçbir silme işlemi fiziksel silme yapmaz. Kayıt yerinde kalır;
-- kim, ne zaman ve hangi gerekçeyle kaldırdığı saklanır ve Değerlendirme
-- Yöneticisi panosunda görüntülenir.
-- ---------------------------------------------------------------------------
ALTER TABLE competitions ADD COLUMN deleted_at TEXT;
ALTER TABLE competitions ADD COLUMN deleted_by TEXT;
ALTER TABLE competitions ADD COLUMN deleted_by_name TEXT;
ALTER TABLE competitions ADD COLUMN deleted_reason TEXT;

ALTER TABLE competition_applications ADD COLUMN deleted_at TEXT;
ALTER TABLE competition_applications ADD COLUMN deleted_by TEXT;
ALTER TABLE competition_applications ADD COLUMN deleted_by_name TEXT;
ALTER TABLE competition_applications ADD COLUMN deleted_reason TEXT;

-- ---------------------------------------------------------------------------
-- 6) KULLANICI ADIYLA GİRİŞ (madde 7)
--
-- Giriş formu kullanıcı adını da e-postayı da kabul eder; rol SEÇİLMEZ, panel
-- hesabın rolüne göre açılır. Sütun isteğe bağlıdır: var olan hesaplar
-- e-postayla girmeye devam eder. Kısmi benzersiz dizin yalnızca dolu
-- değerleri kapsar, böylece birden çok NULL sorun çıkarmaz.
-- ---------------------------------------------------------------------------
ALTER TABLE admin_accounts ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_username
  ON admin_accounts (username) WHERE username IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0008_integrity_and_lifecycle', datetime('now'));

PRAGMA optimize;
