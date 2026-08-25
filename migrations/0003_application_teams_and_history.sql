CREATE TABLE IF NOT EXISTS application_submission_details (
  application_id TEXT PRIMARY KEY,
  applicant_full_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending',
  outcome_note TEXT NOT NULL DEFAULT '',
  decided_at TEXT,
  FOREIGN KEY (application_id) REFERENCES competition_applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_team_members (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  member_order INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES competition_applications(id) ON DELETE CASCADE,
  UNIQUE (application_id, member_order)
);

CREATE INDEX IF NOT EXISTS idx_application_team_members_application
ON application_team_members (application_id, member_order);

CREATE TABLE IF NOT EXISTS criteria_extraction_runs (
  id TEXT PRIMARY KEY,
  source_document_name TEXT NOT NULL,
  competition_name TEXT NOT NULL,
  criteria_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'analyzed',
  profile_id TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_owner
ON criteria_extraction_runs (created_by, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_status
ON criteria_extraction_runs (status, updated_at DESC);

PRAGMA optimize;
