-- Yarışma önceliği (Problem 4 · Değerlendirme Yöneticisi operasyonel aksiyonu)
--
-- Başvuru yığılan veya hakem değerlendirmesi geciken yarışmalar tek tıkla
-- ÖNCELİKLİ işaretlenir; hakem panelinde 🔥 rozetiyle görünür ve listenin
-- başında sıralanır.
--
-- EKLEMELİ ve geriye uyumlu: varsayılan 0, mevcut satırlar etkilenmez.
-- Uygulama şeması `app/lib/workflow-db.ts · COMPETITION_COLUMNS` üzerinden de
-- aynı sütunu ekler; bu dosya kayıt ve elle çalıştırma içindir.

ALTER TABLE competitions ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitions ADD COLUMN priority_note TEXT;
ALTER TABLE competitions ADD COLUMN priority_set_at TEXT;

CREATE INDEX IF NOT EXISTS idx_competitions_priority
  ON competitions (is_priority DESC, updated_at DESC);
