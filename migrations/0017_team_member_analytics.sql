-- Takım üyesi demografi/eğitim bilgileri ve başvuru düzeyinde duyuru kaynağı.
--
-- Bilgiler HESAP tablosuna değil, başvuruya bağlı satırlara yazılır: başvuru
-- yapıldığı andaki değişmez görüntüdür. Eski satırlarda sütunlar NULL kalır ve
-- okuma tarafı NULL'u "Belirtilmedi" (unspecified) olarak yorumlar.
--
-- Bu sütunlar AI değerlendirmesini, kriter sonuçlarını, hakem kararını,
-- benzerlik hesabını ve kabul/ret sonucunu ETKİLEMEZ; yalnızca Değerlendirme
-- Yöneticisinin toplulaştırılmış analitiğinde kullanılır.

-- Başvuru sahibi de takımın bir üyesidir: yeni başvurularda is_applicant = 1
-- olan tek bir satırla temsil edilir. Eski başvurularda bu satır yoktur; okuma
-- tarafı başvuru sahibini "Belirtilmedi" alanlarıyla örtük olarak sayar.
ALTER TABLE application_team_members ADD COLUMN is_applicant INTEGER NOT NULL DEFAULT 0;
ALTER TABLE application_team_members ADD COLUMN gender TEXT;
ALTER TABLE application_team_members ADD COLUMN education_level TEXT;
ALTER TABLE application_team_members ADD COLUMN grade_level TEXT;
ALTER TABLE application_team_members ADD COLUMN institution TEXT;
ALTER TABLE application_team_members ADD COLUMN city TEXT;
ALTER TABLE application_team_members ADD COLUMN teknofest_history TEXT;

CREATE INDEX IF NOT EXISTS idx_application_team_members_applicant
ON application_team_members (application_id, is_applicant);

-- Duyuru kaynağı BAŞVURU/TAKIM başına tek değerdir; üye sayısıyla çoğaltılmaz.
-- team_size başvuru sahibi dâhil, başvuru anında hesaplanan takım büyüklüğüdür.
ALTER TABLE application_submission_details ADD COLUMN discovery_source TEXT;
ALTER TABLE application_submission_details ADD COLUMN team_size INTEGER;

PRAGMA optimize;
