-- 0010 — Katılımcı rapor sürümlerinin bütünlük alanları ve çift başvuru koruması.
--
-- Bu göç YALNIZCA EKLER: hiçbir tablo düşürülmez, hiçbir satır silinmez.
--
-- 1. submission_versions.pdf_hash
--    İlk başvuruda ve her revizyonda yüklenen PDF'in SHA-256 özeti kaydedilir.
--    Değerlendirme sonucu bu özete bağlanır; katılımcı yeni sürüm yüklediğinde
--    eski analizin hangi belgeye ait olduğu kanıtlanabilir kalır.
--
-- 2. submission_versions.byte_length
--    R2'ye yazılan nesnenin doğrulanmış uzunluğu. Revizyon yüklemesi akış
--    (stream) ile yapıldığında içerik uzunluğu bilinmediği için boş/yarım
--    nesne yazılabiliyordu; sürüm ancak doğrulanmış uzunlukla kesinleşir.
--
-- 3. idx_applications_participant_competition
--    Aynı katılımcının aynı yarışmada ARŞİVLENMEMİŞ tek aktif başvurusu
--    olmasını sağlayan benzersiz dizin. Çift tıklama ile açılan ikinci başvuru
--    veri tabanı düzeyinde reddedilir; istemci koruması tek savunma değildir.
--    Arşivlenmiş (deleted_at dolu) kayıtlar dizine girmez: bir başvuru
--    kaldırıldıktan sonra katılımcı yeniden başvurabilir.

ALTER TABLE submission_versions ADD COLUMN pdf_hash TEXT;
ALTER TABLE submission_versions ADD COLUMN byte_length INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_participant_competition
  ON competition_applications (participant_id, competition_key)
  WHERE deleted_at IS NULL;

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0010_submission_integrity', datetime('now'));

PRAGMA optimize;
