-- Katılım profili ve başvuru anındaki değişmez analitik görüntüsü.
-- Alanlar değerlendirme kararını etkilemez; yalnızca toplu yönetim analitiğidir.
CREATE TABLE IF NOT EXISTS participant_profiles (
  account_id TEXT PRIMARY KEY,
  education_status TEXT NOT NULL,
  education_grade TEXT NOT NULL DEFAULT '',
  institution_name TEXT NOT NULL,
  city TEXT NOT NULL,
  gender TEXT,
  discovery_source TEXT NOT NULL,
  teknofest_history TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participant_profiles_dimensions
ON participant_profiles (education_status, city, discovery_source, teknofest_history);

CREATE TABLE IF NOT EXISTS application_participant_snapshots (
  application_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  education_status TEXT NOT NULL DEFAULT 'belirtilmedi',
  education_grade TEXT NOT NULL DEFAULT '',
  institution_name TEXT NOT NULL DEFAULT 'Belirtilmedi',
  city TEXT NOT NULL DEFAULT 'Belirtilmedi',
  gender TEXT,
  discovery_source TEXT NOT NULL DEFAULT 'belirtilmedi',
  teknofest_history TEXT NOT NULL DEFAULT 'belirtilmedi',
  team_size INTEGER NOT NULL DEFAULT 1,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_application_snapshots_dimensions
ON application_participant_snapshots (education_status, city, discovery_source, teknofest_history, team_size);
