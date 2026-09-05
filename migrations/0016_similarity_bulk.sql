CREATE TABLE IF NOT EXISTS similarity_preparations (
 id TEXT PRIMARY KEY, application_id TEXT NOT NULL, state TEXT NOT NULL,
 summary_json TEXT, message TEXT NOT NULL DEFAULT '', lease TEXT, expires_at INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS similarity_bulk_runs (
 id TEXT PRIMARY KEY, competition_key TEXT NOT NULL, actor_id TEXT NOT NULL, snapshot TEXT NOT NULL,
 data_json TEXT NOT NULL, lease TEXT, expires_at INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
