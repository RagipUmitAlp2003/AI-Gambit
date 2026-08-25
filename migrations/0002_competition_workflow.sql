CREATE TABLE IF NOT EXISTS competition_profiles (
  id TEXT PRIMARY KEY,
  competition_key TEXT NOT NULL,
  competition_name TEXT NOT NULL,
  category TEXT NOT NULL,
  stage TEXT NOT NULL,
  report_type TEXT NOT NULL,
  source_document_name TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_competition
ON competition_profiles (competition_key, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS competition_applications (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  participant_email TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  competition_name TEXT NOT NULL,
  profile_id TEXT,
  file_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  evaluation_json TEXT,
  review_json TEXT,
  judge_id TEXT,
  judge_name TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_participant
ON competition_applications (participant_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_queue
ON competition_applications (status, submitted_at ASC);

CREATE INDEX IF NOT EXISTS idx_applications_competition
ON competition_applications (competition_key, submitted_at DESC);
