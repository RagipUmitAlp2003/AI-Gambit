-- Nihai rol modeli (v2) ve olay bazlı zaman çizelgesi.
--
-- Uygulama bu düzeltmeleri her izolatta bir kez kendisi çalıştırır
-- (app/lib/admin-db.ts + app/lib/workflow-db.ts). Bu dosya elle kurulum ve
-- gözden geçirme içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0004_roles_v2.sql
--
-- VERİ KAYBI YOKTUR: hiçbir hesap, yarışma, kriter, profil veya değerlendirme
-- kaydı silinmez. Yalnızca rol kodları takas edilir ve yeni sütun/tablolar eklenir.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 1) Rol numaralandırması: eski 03 = Yarışmacı, 04 = Değerlendirme Yöneticisi.
--    Nihai model: 03 = Değerlendirme Yöneticisi, 04 = Yarışmacı.
--    Kişiler değişmedi; yalnızca rolün kodu değişti. Denetim izindeki actor_role
--    da aynı takasla düzeltilir, aksi hâlde geçmiş kayıtlar yanlış rolü gösterir.
UPDATE admin_accounts   SET role_code  = '03__' WHERE role_code  = '03';
UPDATE admin_accounts   SET role_code  = '03'   WHERE role_code  = '04';
UPDATE admin_accounts   SET role_code  = '04'   WHERE role_code  = '03__';

UPDATE admin_audit_log  SET actor_role = '03__' WHERE actor_role = '03';
UPDATE admin_audit_log  SET actor_role = '03'   WHERE actor_role = '04';
UPDATE admin_audit_log  SET actor_role = '04'   WHERE actor_role = '03__';

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0004_roles_v2_swap_03_04', datetime('now'));

-- 2) Olay bazlı süreç zaman çizelgesi.
--    Eski `document_flows` / `document_handoffs` zinciri belgeyi 01 → 02 → 03 → 04
--    sırasıyla devrediyordu; bu model kaldırıldı. Tablolar tarihsel kayıt olarak
--    yerinde bırakılır, uygulama artık okumaz.
CREATE TABLE IF NOT EXISTS workflow_events (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  event TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL DEFAULT 'sistem',
  actor_role TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_subject
ON workflow_events (subject_type, subject_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_workflow_events_created
ON workflow_events (created_at DESC);

-- 3) Değerlendirme profili artık hakem doğrulamasından geçer.
--    draft → judge_review_pending → (changes_requested) → approved
--    Eski 'published' satırlar zaten yürürlükteydi; 'approved' sayılırlar.
ALTER TABLE competition_profiles ADD COLUMN created_by_name TEXT NOT NULL DEFAULT '';
ALTER TABLE competition_profiles ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE competition_profiles ADD COLUMN reviewed_by TEXT;
ALTER TABLE competition_profiles ADD COLUMN reviewed_by_name TEXT;
ALTER TABLE competition_profiles ADD COLUMN reviewed_at TEXT;
ALTER TABLE competition_profiles ADD COLUMN submitted_at TEXT;

UPDATE competition_profiles SET status = 'approved' WHERE status = 'published';

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0004_profile_review_columns', datetime('now'));

PRAGMA optimize;
