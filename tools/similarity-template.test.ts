/**
 * RESMÎ RAPOR ŞABLONU DEPOSU ve FİLTRESİ (GÖREV 3 · madde 3) birim testleri.
 * Ücretli çağrı YAPMAZ; D1 akışı node:sqlite üzerinde göç dosyalarıyla denenir.
 *
 *   - Şablon shingle kümesi MinHash ile aynı normalizasyonu kullanır.
 *   - Sıfır shingle üreten metin asla benzer sayılmaz (0 döner, 1.0 değil).
 *   - Şablon parçaları karşılaştırma dışı kalır ama SİLİNMEZ (denetim).
 *   - Aynı resmî şablonu paylaşan ama projeleri farklı iki rapor %20 uyarı
 *     eşiğini AŞAMAZ (madde 12 · senaryo 1).
 *   - Sürümleme idempotenttir; şablon değişimi sonuçları "güncel değil" yapar,
 *     eski sürüm satırı SİLİNMEZ, embedding önbelleğine dokunulmaz.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  TEMPLATE_CHUNK_OVERLAP,
  TEMPLATE_FILTER_VERSION,
  approximateReportSimilarity,
  chunkMinHash,
  chunkTemplateOverlap,
  shingleHashesOf,
  templateFoldedLines,
  templateShingleHashes,
  type PeerChunk,
  type ScoredChunk,
} from "../app/lib/similarity-text.ts";

function paragraph(seed: string, words = 200): string {
  const vocabulary = Array.from({ length: 40 }, (_, index) => `${seed}kelime${index}`);
  return Array.from({ length: words }, (_, index) => vocabulary[(index * 7 + index % 11) % vocabulary.length]).join(" ");
}

/* ------------------------- Shingle filtresi (saf) ------------------------- */

test("şablon shingle kümesi deterministiktir ve harf/aksan katlamasıyla uyumludur", () => {
  const upper = templateShingleHashes(["ÖLÇÜM ve DENEY yöntemi bu bölümde açıklanır"]);
  const lower = templateShingleHashes(["ölçüm ve deney yöntemi bu bölümde açıklanır"]);
  assert.ok(upper.size > 0, "Yeterli kelime shingle üretmelidir.");
  assert.deepEqual([...upper].sort(), [...lower].sort(),
    "Büyük/küçük harf ve aksan farkı shingle kümesini değiştirmemelidir (MinHash normalizasyonu).");
  assert.equal(TEMPLATE_FILTER_VERSION, "sablon-v1");
});

test("sıfır shingle üreten metin asla benzer sayılmaz: boş taraflar 0 döner", () => {
  const template = templateShingleHashes([paragraph("sablon", 100)]);
  assert.equal(chunkTemplateOverlap("", template), 0, "Boş parça 0 örtüşme almalıdır.");
  assert.equal(chunkTemplateOverlap("tek", template), 0, "Normalizasyon sonrası shingle'sız metin 0 almalıdır.");
  assert.equal(chunkTemplateOverlap(paragraph("dolu", 50), new Set<number>()), 0,
    "Şablon boşken hiçbir parça şablon sayılmaz (asla 1.0 değil).");
  assert.equal(shingleHashesOf("").size, 0);
});

test("şablondan kopyalanan parça işaretlenir; özgün ve karışık parçalar eşik altında kalır", () => {
  const templateText = paragraph("resmisablon", 200);
  const shingles = templateShingleHashes([templateText]);
  assert.ok(chunkTemplateOverlap(templateText, shingles) >= 0.99, "Birebir kopya ~1.0 örtüşmelidir.");
  assert.ok(chunkTemplateOverlap(paragraph("ozgunproje", 200), shingles) < 0.05,
    "Özgün proje metni ~0 örtüşmelidir.");
  const mixed = `${templateText.split(" ").slice(0, 100).join(" ")} ${paragraph("ozgunproje", 100)}`;
  assert.ok(chunkTemplateOverlap(mixed, shingles) < TEMPLATE_CHUNK_OVERLAP,
    "Yarısı özgün olan parça şablon sayılmamalıdır (eşik 0.6).");
});

test("madde 12/1: aynı resmî şablon, farklı projeler — şablon tek başına %20 uyarı eşiğini aşamaz", () => {
  const templateText = paragraph("ortaksablon", 300);
  const shingles = templateShingleHashes([templateText]);
  const flag = (text: string) => chunkTemplateOverlap(text, shingles) >= TEMPLATE_CHUNK_OVERLAP;
  const scored = (index: number, text: string): ScoredChunk => ({
    index, wordCount: text.split(" ").length, pageStart: index + 1, text,
    minHash: chunkMinHash(text), embedding: null, template: flag(text),
  });
  const peer = (index: number, text: string): PeerChunk => ({
    index, wordCount: text.split(" ").length, pageStart: index + 1,
    minHash: chunkMinHash(text), embedding: null, template: flag(text),
  });
  const own = [scored(0, templateText), scored(1, paragraph("birinciproje", 300))];
  const other = [peer(0, templateText), peer(1, paragraph("ikinciproje", 300))];
  // Şablon parçaları İŞARETLİDİR ama listeden SİLİNMEMİŞTİR (denetim şartı).
  assert.equal(own.length, 2);
  assert.ok(own[0].template && !own[1].template);
  const result = approximateReportSimilarity(own, other);
  assert.ok(result.approxPercent < 20,
    `Ortak şablon tek başına %20 eşiğini aşamaz (ölçülen %${result.approxPercent}).`);
  assert.equal(result.comparableWords, own[1].wordCount,
    "Karşılaştırılabilir içerik yalnızca şablon dışı parçalardır.");
});

test("katlanmış şablon satırları boş girdileri eler ve birebir karşılaştırma anahtarı üretir", () => {
  const folded = templateFoldedLines(["  ", "Çözüm Yaklaşımınızı Açıklayınız", "çözüm yaklaşımınızı açıklayınız!"]);
  assert.equal(folded.size, 1, "Aynı satırın harf/noktalama çeşitleri tek anahtara katlanmalıdır.");
});

/* --------------------- D1 sürüm akışı (node:sqlite + göçler) --------------------- */

const MIGRATION_FILES = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const name of MIGRATION_FILES) {
    database.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  return database;
}

function insertTemplate(database: DatabaseSync, id: string, version: number, pdfHash: string, isCurrent = 1): void {
  database.prepare(
    `INSERT INTO similarity_templates
      (id, competition_id, competition_key, version, pdf_hash, file_key, text_key, file_name,
       page_count, word_count, shingle_count, pipeline_version, is_current, created_by, created_by_name, created_at)
     VALUES (?, 'comp-1', 'roket--2026--ktr', ?, ?, ?, ?, 'sablon.pdf', 12, 3400, 900, ?, ?, 'manager-1', 'Yönetici', '2026-09-01')`,
  ).run(id, version, pdfHash, `k/${id}.pdf`, `k/${id}.json`, TEMPLATE_FILTER_VERSION, isCurrent);
}

test("şablon sürüm akışı: idempotent yeniden yükleme, sürümleme, eski sürümün korunması ve sonuç eskitme", () => {
  const database = migratedDatabase();
  insertTemplate(database, "t1", 1, "hash-a");
  database.prepare(
    `INSERT INTO similarity_results
      (id, application_id, submission_version_id, pdf_hash, competition_key,
       pipeline_version, status, approx_percent, report_json, analyzed_at, template_version, is_stale)
     VALUES ('r1', 'app-1', 'v1', 'pdf-1', 'roket--2026--ktr', 'sim-v2:x', 'completed', 12, '{}', '2026-09-01', 1, 0)`,
  ).run();

  // İdempotent kontrol (saveSimilarityTemplate'in okuduğu satır): aynı pdf_hash
  // + aynı filtre sürümü geldiğinde sürüm AÇILMAZ.
  const current = database.prepare(
    `SELECT version, pdf_hash, pipeline_version FROM similarity_templates
     WHERE competition_key = 'roket--2026--ktr' AND is_current = 1 ORDER BY version DESC LIMIT 1`,
  ).get() as { version: number; pdf_hash: string; pipeline_version: string };
  assert.equal(current.version, 1);
  assert.ok(current.pdf_hash === "hash-a" && current.pipeline_version === TEMPLATE_FILTER_VERSION,
    "Değişmeyen içerik idempotent karşılaştırmayla yakalanır (unchanged).");

  // İçerik değişti: saveSimilarityTemplate'in batch'i ile aynı üç adım.
  database.prepare(`UPDATE similarity_templates SET is_current = 0 WHERE competition_key = 'roket--2026--ktr'`).run();
  insertTemplate(database, "t2", 2, "hash-b");
  database.prepare(
    `UPDATE similarity_results SET is_stale = 1, stale_reason = ?
     WHERE competition_key = 'roket--2026--ktr' AND is_stale = 0`,
  ).run("Resmî şablon sürümü değişti (v2); benzerlik analizini yenileyin.");

  const v1 = database.prepare(`SELECT is_current FROM similarity_templates WHERE id = 't1'`).get() as { is_current: number };
  assert.equal(v1.is_current, 0, "Eski sürüm SİLİNMEZ; yalnızca güncelliği düşer (denetim).");
  const v2 = database.prepare(`SELECT is_current, version FROM similarity_templates WHERE id = 't2'`).get() as { is_current: number; version: number };
  assert.deepEqual({ ...v2 }, { is_current: 1, version: 2 });
  const stale = database.prepare(`SELECT is_stale, stale_reason FROM similarity_results WHERE id = 'r1'`).get() as { is_stale: number; stale_reason: string };
  assert.equal(stale.is_stale, 1, "Şablon değişimi eski sonuçları 'güncel değil' yapmalıdır.");
  assert.match(stale.stale_reason, /şablon sürümü değişti/i);

  // Yeni analiz (saveSimilarityResult eşdeğeri) her zaman güncel yazar.
  database.prepare(`DELETE FROM similarity_results WHERE application_id = 'app-1'`).run();
  database.prepare(
    `INSERT INTO similarity_results
      (id, application_id, submission_version_id, pdf_hash, competition_key,
       pipeline_version, status, approx_percent, report_json, analyzed_at, template_version, is_stale, stale_reason)
     VALUES ('r2', 'app-1', 'v1', 'pdf-1', 'roket--2026--ktr', 'sim-v2:x', 'completed', 14, '{}', '2026-09-02', 2, 0, NULL)`,
  ).run();
  const fresh = database.prepare(`SELECT is_stale, template_version FROM similarity_results WHERE id = 'r2'`).get() as { is_stale: number; template_version: number };
  assert.deepEqual({ ...fresh }, { is_stale: 0, template_version: 2 });

  // Aynı (yarışma anahtarı, sürüm) çifti ikinci kez yazılamaz.
  assert.throws(() => insertTemplate(database, "t2b", 2, "hash-c"), /UNIQUE|constraint/i);
  database.close();
});

test("eski parça/sonuç satırları yeni sütunlarla (DEFAULT 0 / NULL) okunmaya devam eder", () => {
  const database = migratedDatabase();
  // 0009 dönemi sütun listesiyle yazılmış eski satır (yeni kolonlar belirtilmez).
  database.prepare(
    `INSERT INTO similarity_chunks
      (id, application_id, submission_version_id, competition_key, pdf_hash, chunk_index,
       page_start, page_end, word_count, text_hash, min_hash_json, pipeline_version, created_at)
     VALUES ('v1:sim-v1:0', 'app-1', 'v1', 'roket--2026--ktr', 'pdfhash', 0, 1, 2, 180, 'th-0', '[]', 'sim-v1', '2026-08-26')`,
  ).run();
  const chunk = database.prepare(
    `SELECT section, is_template, template_version, chunk_kind, block_start FROM similarity_chunks WHERE id = 'v1:sim-v1:0'`,
  ).get() as Record<string, unknown>;
  assert.deepEqual({ ...chunk }, {
    section: "", is_template: 0, template_version: null, chunk_kind: "text", block_start: null,
  });
  database.close();
});

/* ----------------------------- Kaynak denetimi ----------------------------- */

test("şablon deposu eski sürümü silmez; eskitme ORTAK işlevden geçer", () => {
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const save = db.slice(db.indexOf("export async function saveSimilarityTemplate"));
  const saveBody = save.slice(0, save.indexOf("\nexport ") > 0 ? save.indexOf("\nexport ") : undefined);
  assert.ok(!/DELETE FROM similarity_templates/.test(db), "Şablon satırı hiçbir yerde silinmez (denetim).");
  assert.match(saveBody, /SET is_current = 0/, "Eski sürüm yalnızca güncellikten düşer.");
  assert.match(saveBody, /unchanged: true/, "Aynı içerik idempotent dönmelidir (sürüm artmaz).");
  assert.match(saveBody, /is_stale = 1/, "Sürüm değişimi sonuçları aynı batch'te eskitmelidir.");
  assert.ok(!/DELETE FROM similarity_chunks/.test(saveBody),
    "Şablon değişimi embedding önbelleğine DOKUNMAZ (yeniden embedding yok).");
  assert.match(db, /export async function markSimilarityResultsStale/,
    "Havuz eskitmesi için ortak giriş noktası dışa açık olmalıdır.");
});

test("şablon değişikliği önbellekli parçalara KISMEN uygulanır ve rapor bunu açıkça söyler", () => {
  // Blok düzeyi şablon ayıklaması parçalama anında donar; önbellekli koşu
  // yalnızca parça düzeyi shingle işaretlerini güncel şablonla yeniler.
  // Sonuç, sahip olmadığı bir güncelliği İDDİA EDEMEZ: damga eskiyse rapora
  // Türkçe sınır notu eklenir (is_stale anlamı değişmez).
  const route = readFileSync("app/api/applications/[id]/similarity/route.ts", "utf8");
  assert.match(route, /const templateStampChanged = cacheValid && cachedTemplateVersion !== templateVersion;/,
    "Önbellek şablon damgası güncel şablonla karşılaştırılmalıdır.");
  assert.match(route, /templateStampChanged\s*\?\s*\n?\s*" Şablon değişikliği parça düzeyinde uygulandı; blok düzeyi ayıklama raporun yeniden analizinde tam uygulanır\."/,
    "Kısmi uygulama notu yalnızca damga eskiyken rapora eklenmelidir.");
  // Not, kartın gösterdiği report.note alanına eklenir (buildNote + ek).
  assert.match(route, /buildNote\(\{ level, comparedCount, approxPercent: percent, closestLabel, method \}\) \+ noteSuffix/,
    "Sınır notu kaydedilen raporun note alanında taşınmalıdır.");
});

test("şablon ucu 01-sahiplik ister, 413 kapısını gövde okumadan uygular ve OCR çağırmaz", () => {
  const route = readFileSync("app/api/competitions/[id]/similarity-template/route.ts", "utf8");
  assert.match(route, /requirePermission\(request, "manage_similarity_template"\)/);
  assert.match(route, /ownsCompetition\(/, "Sahiplik sunucuda doğrulanmalıdır.");
  // Madde 9: başlık kapısı (hızlı yol) formData'dan önce durur; gövde ARTIK
  // sınırsız request.formData() ile değil AKIŞLI bayt kapısıyla okunur.
  const gate = route.indexOf("requestBodyTooLarge");
  const form = route.indexOf("readFormDataWithLimit(");
  assert.ok(gate >= 0 && form > gate, "Boyut kapısı formData'dan ÖNCE çalışmalıdır.");
  assert.ok(!/await request\.formData\(\)/.test(route), "Gövde sınırsız request.formData() ile biriktirilmemelidir.");
  assert.match(route, /instanceof PdfTextLayerError/, "Taranmış şablon kontrollü reddedilmelidir.");
  assert.match(route, /jsonError\(422,\s*\n?\s*"Şablon PDF'inde okunabilir metin katmanı yok/,
    "Metin katmansız şablon 422 + açık Türkçe mesajla reddedilir.");
  assert.ok(!/extractPdfStructureViaOcr|pdf-ocr/.test(route), "Şablon için OCR (ücretli) yolu YOKTUR.");
  assert.match(route, /reportBucket\(\)\.delete/, "D1 hatasında R2 nesneleri telafiyle geri alınmalıdır.");
});
