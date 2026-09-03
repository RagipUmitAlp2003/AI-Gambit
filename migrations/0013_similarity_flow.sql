-- Benzerlik akışı ve CPU dayanıklılığı (GÖREV 3 · madde 7-8).
--
-- EKLEMELİ ve GERİYE UYUMLU: hiçbir tablo düşürülmez, hiçbir satır silinmez,
-- var olan sütunlar değiştirilmez. Eski parça satırlarında embedding_sketch
-- NULL kalır; okuma tarafı NULL'a dayanıklıdır (iz yoksa kayıtlı vektörden
-- ÜCRETSİZ yeniden üretilir — embedding API'si asla yeniden çağrılmaz).
--
-- Uygulama şeması aynı nesneleri çalışma anında da ekler
-- (app/lib/workflow-db.ts · SIMILARITY_CHUNK_COLUMNS / WORKFLOW_SCHEMA);
-- bu dosya kayıt ve elle çalıştırma içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0013_similarity_flow.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1) EMBEDDING İŞARET İZİ (madde 8 · CPU koruması)
--
-- 64 bitlik işaret izdüşümü (hex 16 karakter): pahalı 768 boyutlu kosinüs
-- karşılaştırması yalnızca iz uzaklığı eşiği geçen EN GÜÇLÜ adaylara uygulanır.
-- İz, kayıtlı vektörden yerel olarak üretilir; hiçbir API çağrısı gerektirmez.
-- ---------------------------------------------------------------------------
ALTER TABLE similarity_chunks ADD COLUMN embedding_sketch TEXT;

-- ---------------------------------------------------------------------------
-- 2) YARIM KALAN BENZERLİK KOŞUSU (madde 8 · tekrar başlatılabilirlik)
--
-- Büyük havuzlarda tarama kontrollü partilere bölünür; süre bütçesi dolunca
-- ilerleme bu satıra yazılır ve istemci aynı koşuyu kaldığı yerden sürdürür.
-- Ödenen embedding maliyeti CPU sınırı nedeniyle ASLA kaybolmaz: parçalar ve
-- vektörler koşudan ÖNCE kalıcıdır. Başvuru başına tek koşu satırı bulunur;
-- yeni bir analiz eski koşuyu siler.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS similarity_runs (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL UNIQUE,
  pdf_hash TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  cursor_application_id TEXT NOT NULL DEFAULT '',
  processed_peers INTEGER NOT NULL DEFAULT 0,
  total_peers INTEGER NOT NULL DEFAULT 0,
  pool_truncated INTEGER NOT NULL DEFAULT 0,
  best_json TEXT NOT NULL DEFAULT 'null',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0013_similarity_flow', datetime('now'));

PRAGMA optimize;
