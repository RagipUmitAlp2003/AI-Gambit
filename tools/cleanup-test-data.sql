-- ---------------------------------------------------------------------------
-- Test/mock verisi temizliği
--
-- AMAÇ: Kriter Geçmişi, Yayımlanan Profiller, Değerlendirme Atölyesi ve
-- operasyon panellerinde YALNIZCA Çelikkubbe Hava Savunma Sistemleri Yarışması
-- kalsın; yarışmacının "Başvurularım" sekmesi boş başlasın.
--
-- KAPSAM: Silinecek yarışmalar aşağıdaki geçici tabloda ADIYLA sayılır.
-- Betik hiçbir yerde "hepsini sil" demez; adı listede olmayan hiçbir yarışma,
-- profil veya kriter etkilenmez. Bu yüzden üretim verisi üzerinde de güvenle
-- çalıştırılabilir.
--
-- ÇALIŞTIRMA (YALNIZCA YEREL GELİŞTİRME):
--   Yerel (miniflare D1):  node tools/cleanup_test_data.mjs --apply
--   Kuru çalıştırma:       node tools/cleanup_test_data.mjs
--
-- Bu dosyayı üretim veri tabanında çalıştırmayın. Bütün geliştirme verisini
-- sıfırlamak için: node tools/dev_reset.mjs --apply
--
-- NOT: Başvuru PDF'leri R2'de durur. SQL bunları silemez; nesne anahtarları
-- temizlik öncesi raporlanır (bkz. tools/cleanup_test_data.mjs · --apply çıktısı).
-- ---------------------------------------------------------------------------

BEGIN TRANSACTION;

-- 1) Silinecek yarışmaların adları. Yeni bir test yarışması eklemek için
--    buraya bir satır daha yazmak yeterlidir.
CREATE TEMP TABLE purge_names(name TEXT PRIMARY KEY);
INSERT INTO purge_names(name) VALUES
  ('Sahiplik Testi'),
  ('2026 Akıllı Ulaşım Sistemleri Yarışması'),
  ('İnsansız Deniz Aracı Yarışması');

-- 2) Adların tam eşleşmesi yeterli değildir: test kayıtları benzersizlik için
--    zaman damgalı ek alabiliyor ("Sahiplik Testi mt9ehpxv"). Bu yüzden
--    "ad" veya "ad + boşluk + ek" kalıbı eşleştirilir.
CREATE TEMP TABLE purge_keys(competition_key TEXT PRIMARY KEY);
INSERT OR IGNORE INTO purge_keys(competition_key)
SELECT c.competition_key
FROM competitions c
JOIN purge_names p
  ON c.competition_name = p.name OR c.competition_name LIKE p.name || ' %';
INSERT OR IGNORE INTO purge_keys(competition_key)
SELECT cp.competition_key
FROM competition_profiles cp
JOIN purge_names p
  ON cp.competition_name = p.name OR cp.competition_name LIKE p.name || ' %';

-- 3) Bu yarışmalara bağlı başvurular.
CREATE TEMP TABLE purge_applications(id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO purge_applications(id)
SELECT id FROM competition_applications WHERE competition_key IN (SELECT competition_key FROM purge_keys);

-- 4) Bu yarışmalara bağlı profiller.
CREATE TEMP TABLE purge_profiles(id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO purge_profiles(id)
SELECT id FROM competition_profiles WHERE competition_key IN (SELECT competition_key FROM purge_keys);

-- ---------------------------------------------------------------------------
-- SİLME · yapraktan köke doğru, yabancı anahtar sırası korunarak
-- ---------------------------------------------------------------------------

-- Başvuru yaprakları
DELETE FROM submission_fingerprints WHERE application_id IN (SELECT id FROM purge_applications);
DELETE FROM evaluation_results      WHERE application_id IN (SELECT id FROM purge_applications);
DELETE FROM application_assignments WHERE application_id IN (SELECT id FROM purge_applications);
DELETE FROM application_team_members WHERE application_id IN (SELECT id FROM purge_applications);
DELETE FROM application_submission_details WHERE application_id IN (SELECT id FROM purge_applications);
DELETE FROM submission_versions     WHERE application_id IN (SELECT id FROM purge_applications);
DELETE FROM workflow_events
  WHERE subject_type = 'application' AND subject_id IN (SELECT id FROM purge_applications);
DELETE FROM competition_applications WHERE id IN (SELECT id FROM purge_applications);

-- Profil yaprakları
DELETE FROM evaluation_results WHERE profile_id IN (SELECT id FROM purge_profiles);
DELETE FROM criteria           WHERE profile_id IN (SELECT id FROM purge_profiles);
DELETE FROM criteria_extraction_runs WHERE profile_id IN (SELECT id FROM purge_profiles);
DELETE FROM workflow_events
  WHERE subject_type = 'profile' AND subject_id IN (SELECT id FROM purge_profiles);

-- Ayıklama geçmişinde profile bağlanmamış (yayımlanmamış) test kayıtları
DELETE FROM criteria_extraction_runs
WHERE profile_id IS NULL
  AND competition_name IN (SELECT name FROM purge_names);

-- Yarışma ve profil kayıtları
UPDATE competitions SET current_profile_id = NULL
  WHERE current_profile_id IN (SELECT id FROM purge_profiles);
DELETE FROM competition_profiles WHERE id IN (SELECT id FROM purge_profiles);
DELETE FROM competitions WHERE competition_key IN (SELECT competition_key FROM purge_keys);

-- ---------------------------------------------------------------------------
-- ÖKSÜZ YARIŞMA SATIRLARI
--
-- Aynı yarışmanın farklı yıl/aşama anahtarıyla açılmış, hiç profil yayımlanmamış
-- ve hiç başvuru almamış kayıtları. Bunlar panellerde "kriter profili yok"
-- satırı olarak görünüp listeyi kirletiyordu. Yayımlanmış profili olan hiçbir
-- yarışma bu koşula girmez.
-- ---------------------------------------------------------------------------
DELETE FROM competitions
WHERE current_profile_id IS NULL
  AND competition_key NOT IN (SELECT competition_key FROM competition_profiles)
  AND competition_key NOT IN (SELECT competition_key FROM competition_applications);

DROP TABLE purge_applications;
DROP TABLE purge_profiles;
DROP TABLE purge_keys;
DROP TABLE purge_names;

COMMIT;
