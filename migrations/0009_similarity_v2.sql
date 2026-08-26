-- Hibrit benzerlik sistemi (Problem 4 · Nihai Hakem Akışı · madde 9).
--
-- EKLEMELİ ve GERİYE UYUMLU: hiçbir tablo düşürülmez, hiçbir satır silinmez,
-- var olan sütunlar değiştirilmez. Mevcut MinHash havuzu
-- (submission_fingerprints) KORUNUR; bu göç onu tamamlayan iki tablo ekler.
--
-- Uygulama şeması aynı tabloları çalışma anında da oluşturur
-- (app/lib/workflow-db.ts); bu dosya kayıt ve elle çalıştırma içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0009_similarity_v2.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1) BENZERLİK PARÇALARI (madde 9.5–9.7)
--
-- Ham rapor metni D1'e YAZILMAZ: satır yalnızca kimlik, sayfa konumu, kelime
-- sayısı, metin özeti (SHA-256), MinHash izi ve embedding vektörü taşır.
-- Parça metinleri özel R2 nesnesinde tutulur (similarity/<basvuru>/<surum>.json).
--
-- Bu tablo aynı zamanda EMBEDDING ÖNBELLEĞİDİR: aynı PDF sürümü + özet +
-- model + boru hattı sürümü için embedding yalnızca bir kez üretilir. Farklı
-- embedding modellerinin vektörleri birbiriyle karşılaştırılmaz
-- (embedding_model sütunu karşılaştırma önünde filtredir).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS similarity_chunks (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  submission_version_id TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  pdf_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL,
  text_hash TEXT NOT NULL,
  min_hash_json TEXT NOT NULL,
  embedding_json TEXT,
  embedding_model TEXT,
  embedding_dim INTEGER,
  pipeline_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (submission_version_id, pipeline_version, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_similarity_chunks_scope
  ON similarity_chunks (competition_key, application_id, submission_version_id);

-- ---------------------------------------------------------------------------
-- 2) RAPOR DÜZEYİ BENZERLİK SONUCU (madde 9.8–9.13)
--
-- Sonuç, başvurunun GEÇERLİ PDF sürümüne (pdf_hash) ve boru hattı sürümüne
-- bağlanır. "AI analizini sil" bu satırı kaldırır; embedding önbelleği
-- (similarity_chunks) yerinde kalır. Yaklaşık oran içerik kapsamasına göre
-- hesaplanır; otomatik ihlal veya ret kararı DEĞİLDİR.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS similarity_results (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  submission_version_id TEXT,
  pdf_hash TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  minhash_version TEXT NOT NULL DEFAULT 'minhash-v1',
  embedding_model TEXT,
  embedding_dim INTEGER,
  pipeline_version TEXT NOT NULL,
  status TEXT NOT NULL,
  approx_percent INTEGER,
  closest_application_id TEXT,
  closest_label TEXT,
  report_json TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_similarity_results_application
  ON similarity_results (application_id, analyzed_at DESC);

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0009_similarity_v2', datetime('now'));

PRAGMA optimize;
