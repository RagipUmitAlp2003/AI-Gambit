-- Benzerlik motoru v3 (GÖREV 3 · madde 2-4): yapısal parçalama ve resmî şablon filtresi.
--
-- EKLEMELİ ve GERİYE UYUMLU: hiçbir tablo düşürülmez, hiçbir satır silinmez,
-- var olan sütunlar değiştirilmez. Eski sim-v1 parça satırları SİLİNMEZ;
-- boru hattı sürümü filtreleri onları doğal olarak devre dışı bırakır.
--
-- Uygulama şeması aynı tabloyu ve sütunları çalışma anında da ekler
-- (app/lib/workflow-db.ts · SIMILARITY_CHUNK_COLUMNS / SIMILARITY_RESULT_COLUMNS);
-- bu dosya kayıt ve elle çalıştırma içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0010_similarity_v3.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1) RESMÎ RAPOR ŞABLONU DEPOSU (madde 3)
--
-- Bu şablon KRİTER ÜRETMEZ ve rapor uygunluğu kararı VERMEZ; yalnızca
-- benzerlik analizindeki beklenen ortak metni ayıklar. Kriter akışının
-- emekliye ayrılan templateProfile alanıyla (types.ts) İLGİSİZDİR.
--
-- Eski şablon sürümleri hiçbir zaman silinmez (is_current = 0 olur): denetim
-- amacıyla "benzerlik puanına katılmayan ortak/şablon içeriği" okunur kalır.
-- Şablon PDF'i ve metin/shingle nesnesi R2'de durur (file_key / text_key).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS similarity_templates (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  pdf_hash TEXT NOT NULL,
  file_key TEXT NOT NULL,
  text_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  shingle_count INTEGER NOT NULL,
  pipeline_version TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (competition_key, version)
);

CREATE INDEX IF NOT EXISTS idx_similarity_templates_current
  ON similarity_templates (competition_key, is_current, version DESC);

-- ---------------------------------------------------------------------------
-- 2) PARÇA META VERİSİ (madde 4)
--
-- Yapısal parçalama her parçaya bölüm, blok konumu (paragraf/tablo), parça
-- türü ve üretim anındaki şablon sürümünü damgalar. template_version yalnızca
-- DENETİM içindir: embedding önbellek anahtarına GİRMEZ (şablon değişimi
-- ücretli embedding çağrısını tekrarlatmaz; yalnızca sonuçları eskitir).
-- ---------------------------------------------------------------------------
ALTER TABLE similarity_chunks ADD COLUMN template_version INTEGER;
ALTER TABLE similarity_chunks ADD COLUMN block_start INTEGER;
ALTER TABLE similarity_chunks ADD COLUMN block_end INTEGER;
ALTER TABLE similarity_chunks ADD COLUMN chunk_kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE similarity_chunks ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3) SONUÇ ESKİME İŞARETİ (madde 3)
--
-- Şablon sürümü değiştiğinde eski benzerlik sonuçları "güncel değil" olarak
-- işaretlenir; sonuç satırı silinmez, hakem yeniden analizle tazeler.
-- ---------------------------------------------------------------------------
ALTER TABLE similarity_results ADD COLUMN template_version INTEGER;
ALTER TABLE similarity_results ADD COLUMN is_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE similarity_results ADD COLUMN stale_reason TEXT;

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0010_similarity_v3', datetime('now'));

PRAGMA optimize;
