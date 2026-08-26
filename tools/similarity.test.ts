/**
 * HİBRİT BENZERLİK SİSTEMİ (madde 9) birim testleri — ücretli çağrı YAPMAZ.
 *
 *   - MinHash birinci katmandır ve doğrudan kopyayı yakalar.
 *   - Embedding (mock) ikinci katmandır ve farklı kelimelerle anlatımı yakalar.
 *   - Resmî şablon parçaları karşılaştırmadan çıkarılır.
 *   - Tek benzer paragraf bütün raporu %90 benzer GÖSTERMEZ; oran içerik
 *     kapsamasına göre hesaplanır.
 *   - Embedding API sözleşmesi (model, görev türü, boyut, parti, 429 geri
 *     çekilmesi) mock fetch ile doğrulanır; gerçek Gemini çağrısı yoktur.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildMinHash, minHashSimilarity } from "../app/lib/similarity-engine.ts";
import {
  CHUNK_MIN_WORDS,
  CHUNK_MAX_WORDS,
  CHUNK_OVERLAP_WORDS,
  SIMILARITY_EMBEDDING_DIM,
  SIMILARITY_EMBEDDING_MODEL,
  approximateReportSimilarity,
  chunkMatchStrength,
  chunkMinHash,
  chunkPages,
  isTemplateChunkHash,
  normalizePages,
  type PeerChunk,
  type ScoredChunk,
} from "../app/lib/similarity-text.ts";
import { embedTexts } from "../app/lib/similarity-embedding.ts";

/** Deterministik sahte paragraf üretimi: her tohum farklı kelime dağarcığı verir. */
function paragraph(seed: string, words = 120): string {
  const vocabulary = Array.from({ length: 40 }, (_, index) => `${seed}kelime${index}`);
  return Array.from({ length: words }, (_, index) => vocabulary[(index * 7 + index % 11) % vocabulary.length]).join(" ");
}

/* ------------------------------ Parçalama ------------------------------ */

test("metin 300-500 kelimelik, çakışmalı ve sayfa konumlu parçalara bölünür", () => {
  const pages = [paragraph("bir", 600), paragraph("iki", 600), paragraph("uc", 600)];
  const chunks = chunkPages(pages);
  assert.ok(chunks.length >= 3, "Uzun metin birden çok parçaya bölünmelidir.");
  for (const chunk of chunks) {
    assert.ok(chunk.wordCount >= CHUNK_MIN_WORDS && chunk.wordCount <= CHUNK_MAX_WORDS,
      `Parça ${chunk.wordCount} kelime; ${CHUNK_MIN_WORDS}-${CHUNK_MAX_WORDS} aralığında olmalı.`);
    assert.ok(chunk.pageStart >= 1 && chunk.pageEnd >= chunk.pageStart, "Sayfa konumu korunmalıdır.");
  }
  // Ardışık parçalar arasında çakışma vardır (yaklaşık 50 kelime).
  const first = chunks[0].text.split(" ");
  const second = chunks[1].text.split(" ");
  const overlap = first.slice(-CHUNK_OVERLAP_WORDS).join(" ");
  assert.ok(second.slice(0, CHUNK_OVERLAP_WORDS).join(" ") === overlap, "Parçalar ~50 kelime çakışmalıdır.");
});

test("çok kısa veya yalnızca başlıktan oluşan parçalar atlanır", () => {
  const chunks = chunkPages(["Kısa başlık"]);
  assert.equal(chunks.length, 0, "40 kelimenin altındaki içerik parça olmamalıdır.");
});

/* ------------------------- Şablon/kimlik temizliği ------------------------- */

test("üstbilgi, sayfa numarası, yarışma ve takım adı karşılaştırma öncesi silinir", () => {
  const header = "2026 Roket Yarışması Kritik Tasarım Raporu";
  const pages = [1, 2, 3, 4, 5].map((page) =>
    `${header}\nTakım Yıldız\n${paragraph(`sayfa${page}`, 80)}\nSayfa ${page} / 5`);
  const cleaned = normalizePages(pages, { competitionName: "2026 Roket Yarışması", participantNames: ["Takım Yıldız"] });
  for (const page of cleaned) {
    assert.ok(!page.includes("Takım Yıldız"), "Takım adı silinmelidir.");
    assert.ok(!page.includes("2026 Roket Yarışması"), "Yarışma adı silinmelidir.");
    assert.ok(!/Sayfa \d/.test(page), "Sayfa numarası satırı silinmelidir.");
    assert.ok(!page.includes("Kritik Tasarım Raporu"), "Her sayfada tekrarlanan üstbilgi silinmelidir.");
  }
  // Asıl içerik yerinde kalır.
  assert.ok(cleaned[0].includes("sayfa1kelime0"), "Gerçek içerik korunmalıdır.");
});

test("havuzun çoğunda birebir bulunan parça şablon sayılır ve karşılaştırılmaz", () => {
  const counts = new Map([["sablon-ozet", 4], ["ozgun-ozet", 1]]);
  assert.ok(isTemplateChunkHash("sablon-ozet", counts, 5), "Havuzun yarısından fazlasında görülen parça şablondur.");
  assert.ok(!isTemplateChunkHash("ozgun-ozet", counts, 5), "Tek başvuruda görülen parça şablon değildir.");
  assert.ok(!isTemplateChunkHash("sablon-ozet", counts, 1), "Tek kişilik havuzda şablon çıkarımı yapılmaz.");
});

/* ------------------------------ Eşleşme kuvveti ------------------------------ */

test("doğrudan kopya MinHash ile yakalanır; eşik altı benzerlik eşleşme sayılmaz", () => {
  const original = paragraph("ozgun", 200);
  const copied = original; // kelimesi kelimesine kopya
  const different = paragraph("bambaska", 200);
  const lexicalCopy = minHashSimilarity(buildMinHash(original).signature, buildMinHash(copied).signature);
  const lexicalDiff = minHashSimilarity(buildMinHash(original).signature, buildMinHash(different).signature);
  assert.ok(lexicalCopy >= 0.55, `Kopya yüksek doğrudan benzerlik vermeli (ölçülen ${lexicalCopy}).`);
  assert.ok(lexicalDiff < 0.30, `Farklı metin normal kalmalı (ölçülen ${lexicalDiff}).`);
  assert.ok(chunkMatchStrength(lexicalCopy, null)?.kind === "direct", "Kopya, doğrudan eşleşme türü almalıdır.");
  assert.equal(chunkMatchStrength(lexicalDiff, null), null, "Eşik altı parça eşleşme SAYILMAZ.");
});

test("farklı kelimelerle anlatım embedding (anlamsal) katmanıyla yakalanır", () => {
  // MinHash düşük, cosine yüksek: yalnızca anlamsal kanal eşleşir.
  const semanticOnly = chunkMatchStrength(0.05, 0.93);
  assert.ok(semanticOnly && semanticOnly.kind === "semantic" && semanticOnly.strength === 1,
    "Yüksek cosine, anlamsal eşleşme üretmelidir.");
  const reviewLevel = chunkMatchStrength(0.05, 0.85);
  assert.ok(reviewLevel && reviewLevel.strength === 0.6, "0.82-0.90 arası cosine 'incelenmeli' kuvvetindedir.");
  assert.equal(chunkMatchStrength(0.05, 0.5), null, "Düşük cosine eşleşme değildir.");
});

/* --------------------- Rapor düzeyi yaklaşık oran --------------------- */

function scoredChunk(index: number, text: string, embedding: number[] | null = null, template = false): ScoredChunk {
  return { index, wordCount: text.split(" ").length, pageStart: index + 1, text, minHash: chunkMinHash(text), embedding, template };
}

function peerChunk(index: number, text: string, embedding: number[] | null = null, template = false): PeerChunk {
  return { index, wordCount: text.split(" ").length, pageStart: index + 1, minHash: chunkMinHash(text), embedding, template };
}

test("tek benzer paragraf bütün raporu yanlış biçimde %90 benzer göstermez", () => {
  const shared = paragraph("ortak", 400);
  const own = [
    scoredChunk(0, shared),
    scoredChunk(1, paragraph("birinci", 400)),
    scoredChunk(2, paragraph("ikinci", 400)),
    scoredChunk(3, paragraph("ucuncu", 400)),
    scoredChunk(4, paragraph("dorduncu", 400)),
  ];
  const peer = [peerChunk(0, shared), peerChunk(1, paragraph("besinci", 400))];
  const result = approximateReportSimilarity(own, peer);
  assert.ok(result.approxPercent <= 25, `Beşte biri eşleşen rapor ~%20 olmalı, %90 değil (ölçülen %${result.approxPercent}).`);
  assert.ok(result.approxPercent >= 15, `Eşleşen beşte bir kapsama orana yansımalı (ölçülen %${result.approxPercent}).`);
  assert.equal(result.matches.length, 1, "Yalnızca eşleşen parça eşleşme listesine girer.");
});

test("tamamen farklı iki rapor işaretlenmez; büyük ölçüde eşleşen rapor yüksek oran alır", () => {
  const different = approximateReportSimilarity(
    [scoredChunk(0, paragraph("apayri", 400))],
    [peerChunk(0, paragraph("digerleri", 400))],
  );
  assert.equal(different.approxPercent, 0, "Farklı raporlar 0'a yakın kalmalıdır.");

  const sharedA = paragraph("kopyaA", 400);
  const sharedB = paragraph("kopyaB", 400);
  const mostlyCopied = approximateReportSimilarity(
    [scoredChunk(0, sharedA), scoredChunk(1, sharedB), scoredChunk(2, paragraph("ozgunKisim", 400))],
    [peerChunk(0, sharedA), peerChunk(1, sharedB)],
  );
  assert.ok(mostlyCopied.approxPercent >= 55, `Büyük bölümü eşleşen rapor yüksek oran almalı (ölçülen %${mostlyCopied.approxPercent}).`);
});

test("yalnızca resmî şablonu paylaşan raporlar yüksek benzerlik almaz", () => {
  const template = paragraph("resmisablon", 400);
  const own = [scoredChunk(0, template, null, true), scoredChunk(1, paragraph("kendioz", 400))];
  const peer = [peerChunk(0, template, null, true), peerChunk(1, paragraph("digeroz", 400))];
  const result = approximateReportSimilarity(own, peer);
  assert.equal(result.approxPercent, 0, "Şablon parçaları karşılaştırılabilir içerik sayılmaz.");
});

/* ------------------------- Embedding API sözleşmesi ------------------------- */

type FetchCall = { url: string; body: Record<string, unknown> };

function mockFetch(responses: Array<{ status: number; payload: unknown }>, calls: FetchCall[]): typeof fetch {
  let index = 0;
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    const step = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(step.payload), { status: step.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function vectors(count: number): { embeddings: Array<{ values: number[] }> } {
  return { embeddings: Array.from({ length: count }, (_, index) => ({ values: Array.from({ length: SIMILARITY_EMBEDDING_DIM }, () => index + 0.1) })) };
}

test("embedding çağrısı doğru model, görev türü ve boyutla kontrollü partiler hâlinde gider", async () => {
  const calls: FetchCall[] = [];
  const texts = Array.from({ length: 20 }, (_, index) => `parça ${index}`);
  const outcome = await embedTexts("test-key", texts, mockFetch([
    { status: 200, payload: vectors(16) },
    { status: 200, payload: vectors(4) },
  ], calls));
  assert.ok(outcome.ok, "Başarılı partiler embedding döndürmelidir.");
  assert.equal(outcome.ok && outcome.embeddings.length, 20);
  assert.equal(calls.length, 2, "20 metin, 16'lık iki partiye bölünmelidir; aşırı eşzamanlı istek açılmaz.");
  assert.ok(calls[0].url.includes(`${SIMILARITY_EMBEDDING_MODEL}:batchEmbedContents`), "Model gemini-embedding-001 olmalıdır.");
  const firstRequest = (calls[0].body.requests as Array<Record<string, unknown>>)[0];
  assert.equal(firstRequest.taskType, "SEMANTIC_SIMILARITY", "Görev türü SEMANTIC_SIMILARITY olmalıdır.");
  assert.equal(firstRequest.outputDimensionality, SIMILARITY_EMBEDDING_DIM, "Boyut 768 olmalıdır.");
});

test("429'da kısa ve SINIRLI geri çekilme uygulanır; sonsuz tekrar yoktur", async () => {
  const calls: FetchCall[] = [];
  const outcome = await embedTexts("test-key", ["parça"], mockFetch([
    { status: 429, payload: { error: { message: "rate" } } },
    { status: 429, payload: { error: { message: "rate" } } },
    { status: 200, payload: vectors(1) },
  ], calls));
  assert.ok(!outcome.ok, "İki kez 429 alan parti başarısız sayılmalıdır.");
  assert.ok(!outcome.ok && outcome.rateLimited, "429 hız sınırı olarak işaretlenmelidir.");
  assert.equal(calls.length, 2, "429 sonrası EN FAZLA bir yeniden deneme yapılır.");
});

test("boş veya bozuk embedding asla kabul edilmez", async () => {
  const broken = await embedTexts("test-key", ["parça"], mockFetch([
    { status: 200, payload: { embeddings: [{ values: [0.1, 0.2] }] } }, // yanlış boyut
  ], []));
  assert.ok(!broken.ok, "Eksik boyutlu vektör reddedilmelidir.");
  const empty = await embedTexts("test-key", ["parça"], mockFetch([
    { status: 200, payload: { embeddings: [] } },
  ], []));
  assert.ok(!empty.ok, "Boş vektör listesi reddedilmelidir.");
});

/* --------------------- Akış ve bütünlük (kaynak denetimi) --------------------- */

test("benzerlik ucu PDF özetini bağlar, kapsamı sunucuda çözer ve kendisiyle karşılaştırmaz", () => {
  const route = readFileSync("app/api/applications/[id]/similarity/route.ts", "utf8");
  // PDF bağlama: istemcinin metni, R2'deki geçerli sürümün SHA-256'sına bağlanır.
  assert.match(route, /serverPdfHash !== claimedPdfHash/, "Farklı PDF sürümünün metni reddedilmelidir.");
  assert.match(route, /resolveSimilarityContext\(applicationId, auth\.account\)/, "Kapsam sunucuda çözülmelidir.");
  assert.ok(!/body\.competition/.test(route), "Kapsam istemcinin bildirdiği yarışma adına göre belirlenmemelidir.");
  // MinHash katmanı korunur; embedding onu tamamlar.
  assert.match(route, /buildMinHash\(/, "MinHash birinci katman olarak korunmalıdır.");
  assert.match(route, /saveAndListSimilarityFingerprints/, "Mevcut parmak izi havuzu korunmalıdır.");
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const peers = db.slice(db.indexOf("export async function listPeerSimilarityChunks"));
  const peersBody = peers.slice(0, peers.indexOf("\nexport "));
  assert.match(peersBody, /s\.application_id <> \?/, "Başvuru KENDİSİYLE karşılaştırılmamalıdır.");
  assert.match(peersBody, /a\.current_version_id = s\.submission_version_id/, "Yalnızca GEÇERLİ PDF sürümleri havuza girer.");
  assert.match(peersBody, /a\.deleted_at IS NULL/, "Arşivlenmiş başvuru karşılaştırmaya girmez.");
  assert.match(peersBody, /s\.competition_key = \?/, "Yalnızca aynı yarışma anahtarı (ad+yıl+aşama) karşılaştırılır.");
});

test("aynı PDF sürümü için embedding ikinci kez üretilmez; yeni sürüm eski embedding kullanmaz", () => {
  const route = readFileSync("app/api/applications/[id]/similarity/route.ts", "utf8");
  assert.match(route, /findStoredSimilarityChunks/, "Önbellek okuması bulunmalıdır.");
  assert.match(
    route,
    /cacheValid && cached!\.every\(\(row\) => row\.embedding\)/,
    "Önbellek geçerliyse embedding API'si çağrılmamalıdır.",
  );
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const save = db.slice(db.indexOf("export async function saveSimilarityChunks"));
  const saveBody = save.slice(0, save.indexOf("\nexport "));
  assert.match(saveBody, /DELETE FROM similarity_chunks WHERE application_id = \?/,
    "Yeni PDF sürümünde eski sürümün parça/embedding kayıtları havuzdan düşmelidir.");
  const find = db.slice(db.indexOf("export async function findStoredSimilarityChunks"));
  const findBody = find.slice(0, find.indexOf("\nexport "));
  assert.match(findBody, /submission_version_id = \? AND pdf_hash = \?/,
    "Önbellek anahtarı PDF sürümü ve özetiyle nitelenmelidir.");
});

test("kriter analizi ile benzerlik aynı akışta paralel başlar; benzerlik hatası analizi düşürmez", () => {
  const app = readFileSync("app/components/evaluation-app.tsx", "utf8");
  assert.match(app, /Promise\.allSettled\(\[\s*evaluateReport\(/, "İki işlem allSettled ile paralel yürümelidir.");
  assert.match(app, /extractPdfText\(file\)/, "PDF metni BİR KEZ çıkarılmalıdır.");
  assert.ok(!/extractPdfText\([^)]*\)[\s\S]*extractPdfText\(/.test(app.slice(app.indexOf("async function analyze"))),
    "Aynı PDF iki işlem için tekrar okunmamalıdır.");
  assert.match(app, /status === 429/, "429'da kontrollü yeniden deneme bulunmalıdır.");
  assert.match(app, /Benzerlik kontrolü tamamlanamadı/, "Benzerlik hatası yalnızca uyarı üretmelidir.");
  // Benzerlik sonucu hakem sayaçlarına girmez ve otomatik karar üretmez.
  assert.ok(!/similarityReport[\s\S]{0,120}judgeDecisionCounts/.test(app), "Benzerlik, hakem sayaçlarına karışmamalıdır.");
});

test("AI analizi silindiğinde benzerlik sonucu da kaldırılır; embedding önbelleği kalır", () => {
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const remove = db.slice(db.indexOf("export async function deleteApplicationEvaluation"));
  const removeBody = remove.slice(0, remove.indexOf("\nexport "));
  assert.match(removeBody, /DELETE FROM similarity_results WHERE application_id = \?/,
    "Analiz silinince benzerlik sonucu kaldırılmalıdır.");
  assert.ok(!/DELETE FROM similarity_chunks/.test(removeBody),
    "Embedding önbelleği (parçalar) analiz silmede korunur; yeniden analizde API tekrar çağrılmaz.");
  assert.match(removeBody, /status <> 'completed'/, "Kesinleşmiş karar yeniden açılmadan analiz silinememelidir.");
});

test("test temizliği benzerlik izlerini de güvenli biçimde kapsar", () => {
  const reset = readFileSync("tools/dev_reset.mjs", "utf8");
  assert.match(reset, /"similarity_results",\s*\n\s*"similarity_chunks"/, "Sıfırlama benzerlik tablolarını silmelidir.");
  assert.match(reset, /similarity\/'/, "Sıfırlama R2 benzerlik nesnelerini raporlamalıdır.");
  // Genel silme yok: yalnızca yerel miniflare dosyası ve üretim reddi korunur.
  assert.match(reset, /assertNotProduction/, "Temizlik üretimde çalışmamalıdır.");
});
