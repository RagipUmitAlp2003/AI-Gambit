-- Kalıcı şartname analiz önbelleği
--
-- Daha önce analiz edilmiş bir şartname (aynı belge içeriği + aynı analiz
-- yapılandırması) yeniden analiz edildiğinde model HİÇ çağrılmaz: kayıttaki
-- ham çıktı okunur, normalizasyon yeniden çalışır ve sonuç 0 token /
-- apiCalls: 0 ile döner. Süreç içi bellek önbelleğinin aksine sunucu yeniden
-- başlatıldığında da kaybolmaz.
--
-- `cache_key`: belge SHA-256'sı + istem sürümü + model + çözünürlük + düşünme
-- bütçesi + sayfa sayısından türetilen özet; ayar değişince eski kayıt doğal
-- olarak eşleşmez ve belge bir kez yeniden analiz edilir.
--
-- Uygulama şeması `app/lib/workflow-db.ts · WORKFLOW_SCHEMA` üzerinden de
-- aynı tabloyu oluşturur; bu dosya kayıt ve elle çalıştırma içindir.

CREATE TABLE IF NOT EXISTS criteria_analysis_cache (
  cache_key TEXT PRIMARY KEY,
  document_hash TEXT NOT NULL,
  source_document_name TEXT NOT NULL,
  model TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_recency
  ON criteria_analysis_cache (last_used_at DESC);
