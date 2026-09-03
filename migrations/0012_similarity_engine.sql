-- Benzerlik motoru katman 2 ve oran hesabı (GÖREV 3 · madde 5-6).
--
-- EKLEMELİ ve GERİYE UYUMLU: hiçbir tablo düşürülmez, hiçbir satır silinmez,
-- var olan sütunlar değiştirilmez. Eski parça satırlarında yeni sütunlar NULL
-- kalır; okuma tarafı NULL'a dayanıklıdır (word_start NULL → ayrık aralık
-- varsayımı; feature_json NULL → doğrulama özellikleri yok sayılır).
--
-- Uygulama şeması aynı sütunları çalışma anında da ekler
-- (app/lib/workflow-db.ts · SIMILARITY_CHUNK_COLUMNS); bu dosya kayıt ve elle
-- çalıştırma içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0012_similarity_engine.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1) KELİME AKIŞI KONUMU (madde 6)
--
-- Oran = eşleşen özgün içerik / toplam karşılaştırılabilir özgün içerik.
-- Çakışan parçaların ortak kelimeleri iki kez SAYILMASIN diye her parça,
-- karşılaştırılabilir belge kelime akışındaki başlangıç konumunu taşır;
-- kapsama [word_start, word_start + word_count) aralıklarının birleşimiyle
-- hesaplanır.
-- ---------------------------------------------------------------------------
ALTER TABLE similarity_chunks ADD COLUMN word_start INTEGER;

-- ---------------------------------------------------------------------------
-- 2) DOĞRULAMA ÖZELLİKLERİ (madde 5 · Katman 2)
--
-- Embedding eşleşmesi TEK BAŞINA alarm üretemez; ayırt edici teknik ifadeler
-- ve özgün sayısal değerler destek sinyali olarak aranır. Ham kelime yerine
-- 32-bit özetler ve katlanmış sayı belirteçleri saklanır:
--   {"rare": [..fnv özetleri..], "nums": ["450newton", "3.2saniye", ...]}
-- ---------------------------------------------------------------------------
ALTER TABLE similarity_chunks ADD COLUMN feature_json TEXT;

INSERT OR IGNORE INTO schema_migrations (name, applied_at)
VALUES ('0012_similarity_engine', datetime('now'));

PRAGMA optimize;
