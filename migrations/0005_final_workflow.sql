-- Nihai Creathon Problem 4 rol dizilimi ve operasyonel iş akışı.
-- 03 = Yarışmacı, 04 = Değerlendirme Yöneticisi.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

UPDATE admin_accounts  SET role_code  = '03__' WHERE role_code  = '03';
UPDATE admin_accounts  SET role_code  = '03'   WHERE role_code  = '04';
UPDATE admin_accounts  SET role_code  = '04'   WHERE role_code  = '03__';
UPDATE admin_audit_log SET actor_role = '03__' WHERE actor_role = '03';
UPDATE admin_audit_log SET actor_role = '03'   WHERE actor_role = '04';
UPDATE admin_audit_log SET actor_role = '04'   WHERE actor_role = '03__';

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0005_roles_v3_restore_03_participant_04_operations', datetime('now'));

CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY, competition_key TEXT NOT NULL UNIQUE, competition_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft_criteria', current_profile_id TEXT,
  decisions_locked INTEGER NOT NULL DEFAULT 0, results_published_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_competitions_status ON competitions (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS criteria (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL,
  applicability TEXT NOT NULL, effect TEXT NOT NULL, max_score REAL, active INTEGER NOT NULL DEFAULT 0,
  source_page INTEGER, source_text TEXT NOT NULL, criterion_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(profile_id, position)
);
CREATE INDEX IF NOT EXISTS idx_criteria_profile ON criteria (profile_id, active, position);

CREATE TABLE IF NOT EXISTS submission_versions (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, version_number INTEGER NOT NULL,
  file_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
  UNIQUE(application_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_submission_versions_application ON submission_versions (application_id, version_number DESC);

CREATE TABLE IF NOT EXISTS evaluation_results (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, submission_version_id TEXT, profile_id TEXT,
  status TEXT NOT NULL, ai_raw_analysis TEXT, model TEXT, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_evaluation_results_application ON evaluation_results (application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS submission_fingerprints (
  application_id TEXT PRIMARY KEY, submission_version_id TEXT, competition_key TEXT NOT NULL,
  participant_label TEXT NOT NULL, fingerprint_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submission_fingerprints_scope ON submission_fingerprints (competition_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS application_assignments (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, judge_id TEXT NOT NULL, judge_name TEXT NOT NULL,
  assigned_by TEXT NOT NULL, assigned_by_name TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, assigned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_application ON application_assignments (application_id, active, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_judge ON application_assignments (judge_id, active, assigned_at DESC);

ALTER TABLE competition_applications ADD COLUMN assigned_judge_id TEXT;
ALTER TABLE competition_applications ADD COLUMN assigned_judge_name TEXT;
ALTER TABLE competition_applications ADD COLUMN current_version_id TEXT;

PRAGMA optimize;
