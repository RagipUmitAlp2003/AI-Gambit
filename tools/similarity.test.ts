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
  CHUNK_SOFT_MAX_WORDS,
  SIMILARITY_EMBEDDING_DIM,
  SIMILARITY_EMBEDDING_MODEL,
  SIMILARITY_PIPELINE_VERSION,
  approximateReportSimilarity,
  chunkMatchStrength,
  chunkMinHash,
  chunkPages,
  chunkStructuredBlocks,
  classifyBlocks,
  isTemplateChunkHash,
  normalizePages,
  templateFoldedLines,
  type PeerChunk,
  type ScoredChunk,
  type SimilarityBlockInput,
  type TemplateFilter,
} from "../app/lib/similarity-text.ts";
import { PDF_STRUCTURE_VERSION } from "../app/lib/pdf-structure.ts";
import { embedTexts } from "../app/lib/similarity-embedding.ts";
import { comparableWordUnion } from "../app/lib/similarity-text.ts";
import {
  DEFAULT_SIMILARITY_THRESHOLDS,
  MAX_CHUNKS_PER_DOC,
  reportBandLevel,
  similarityLlmEnabled,
  similarityMaxChunksPerDoc,
  similarityRuntimeLimits,
  similarityThresholds,
} from "../app/lib/similarity-config.ts";
import {
  chunkFeatures,
  corroborationOf,
  poolFeatureCounts,
  stripPoolCommonFeatures,
  type SimilarityChunkFeatures,
} from "../app/lib/similarity-corroboration.ts";
import { similarityResultOf } from "../app/lib/report-prechecks.ts";
import type { PreCheck } from "../app/lib/types.ts";

/** Deterministik sahte paragraf üretimi: her tohum farklı kelime dağarcığı verir. */
function paragraph(seed: string, words = 120): string {
  const vocabulary = Array.from({ length: 40 }, (_, index) => `${seed}kelime${index}`);
  return Array.from({ length: words }, (_, index) => vocabulary[(index * 7 + index % 11) % vocabulary.length]).join(" ");
}

/* ------------------------------ Parçalama ------------------------------ */

test("yedek yol: metin 100-220 kelimelik, ~30 kelime çakışmalı ve sayfa konumlu parçalara bölünür", () => {
  const pages = [paragraph("bir", 600), paragraph("iki", 600), paragraph("uc", 600)];
  const chunks = chunkPages(pages);
  assert.ok(chunks.length >= 3, "Uzun metin birden çok parçaya bölünmelidir.");
  for (const chunk of chunks) {
    assert.ok(chunk.wordCount >= CHUNK_MIN_WORDS && chunk.wordCount <= CHUNK_MAX_WORDS,
      `Parça ${chunk.wordCount} kelime; ${CHUNK_MIN_WORDS}-${CHUNK_MAX_WORDS} aralığında olmalı.`);
    assert.ok(chunk.pageStart >= 1 && chunk.pageEnd >= chunk.pageStart, "Sayfa konumu korunmalıdır.");
  }
  // Ardışık parçalar arasında çakışma vardır (yaklaşık 30 kelime, madde 4).
  const first = chunks[0].text.split(" ");
  const second = chunks[1].text.split(" ");
  const overlap = first.slice(-CHUNK_OVERLAP_WORDS).join(" ");
  assert.ok(second.slice(0, CHUNK_OVERLAP_WORDS).join(" ") === overlap, "Parçalar ~30 kelime çakışmalıdır.");
});

test("çok kısa veya yalnızca başlıktan oluşan parçalar atlanır", () => {
  const chunks = chunkPages(["Kısa başlık"]);
  assert.equal(chunks.length, 0, `${CHUNK_MIN_WORDS} kelimenin altındaki içerik parça olmamalıdır.`);
});

test("işlem sürümü yapısal sürüme bileşiktir: pdf-structure değişince benzerlik önbelleği de eskir", () => {
  assert.ok(SIMILARITY_PIPELINE_VERSION.startsWith("sim-v3-frontmatter-furniture:"),
    "Ayıklama kuralı değiştiğinde damga artmalıdır: eski parça önbelleği yeni kurallarla karışamaz.");
  assert.ok(SIMILARITY_PIPELINE_VERSION.includes(PDF_STRUCTURE_VERSION),
    "Boru hattı sürümü PDF yapı sürümünü içermelidir (bileşik sürüm).");
});

/* --------------- Yapısal ayıklama ve sınıflandırma (madde 2 ve 4) --------------- */

function structBlock(input: Partial<SimilarityBlockInput> & { text: string }): SimilarityBlockInput {
  return {
    page: input.page ?? 2,
    sectionTitle: input.sectionTitle ?? "Tasarım",
    subsectionTitle: input.subsectionTitle ?? "",
    blockType: input.blockType ?? "PARAGRAPH",
    text: input.text,
    ordinal: input.ordinal ?? 0,
  };
}

test("kaynakça bölümü karşılaştırma dışıdır ama denetim için gerekçesiyle SAKLANIR", () => {
  const entry = "Yazar A (2020) Roket gövde tasarımında kompozit malzeme kullanımı üzerine kapsamlı inceleme";
  const body = paragraph("govde", 40);
  const { included, excluded } = classifyBlocks([
    structBlock({ blockType: "HEADING", text: "Kaynakça", sectionTitle: "Kaynakça", ordinal: 0 }),
    structBlock({ text: entry, sectionTitle: "Kaynakça", ordinal: 1 }),
    structBlock({ blockType: "HEADING", text: "Sonuç", sectionTitle: "Sonuç", ordinal: 2 }),
    structBlock({ text: body, sectionTitle: "Sonuç", ordinal: 3 }),
  ]);
  assert.equal(included.length, 1, "Yalnızca kaynakça dışı içerik karşılaştırmaya girer.");
  assert.equal(included[0].text, body);
  const bibliography = excluded.filter((block) => block.reason === "kaynakca");
  assert.ok(bibliography.some((block) => block.text === entry),
    "Kaynakça satırı SİLİNMEZ; 'kaynakca' gerekçesiyle denetim listesinde durur.");
});

test("başlıklar parça içeriği olmaz ama bölüm bağlamını taşır", () => {
  const body = paragraph("icerik", 60);
  const { included, excluded } = classifyBlocks([
    structBlock({ blockType: "HEADING", text: "Sistem Mimarisi", sectionTitle: "Sistem Mimarisi", ordinal: 0 }),
    structBlock({ text: body, sectionTitle: "Sistem Mimarisi", ordinal: 1 }),
  ]);
  assert.ok(excluded.some((block) => block.reason === "baslik" && block.text === "Sistem Mimarisi"));
  const { chunks } = chunkStructuredBlocks(included);
  assert.equal(chunks.length, 1);
  assert.ok(!chunks[0].text.includes("Sistem Mimarisi"), "Başlık metni parçaya karışmamalıdır.");
  assert.equal(chunks[0].section, "Sistem Mimarisi", "Bölüm bağlamı parça meta verisinde kalmalıdır.");
});

test("içindekiler bölümü ve çok kısa artıklar ayıklanır", () => {
  const { included, excluded } = classifyBlocks([
    structBlock({ blockType: "HEADING", text: "İçindekiler", sectionTitle: "İçindekiler", page: 2, ordinal: 0 }),
    structBlock({ text: "Giriş 3", sectionTitle: "İçindekiler", page: 2, ordinal: 1 }),
    structBlock({ blockType: "HEADING", text: "Giriş", sectionTitle: "Giriş", page: 3, ordinal: 2 }),
    structBlock({ text: "Üç kelimelik metin", sectionTitle: "Giriş", page: 3, ordinal: 3 }),
    structBlock({ text: paragraph("uzun", 40), sectionTitle: "Giriş", page: 3, ordinal: 4 }),
  ]);
  assert.ok(excluded.some((block) => block.reason === "kapak-icindekiler" && block.text === "Giriş 3"));
  assert.ok(excluded.some((block) => block.reason === "cok-kisa" && block.text === "Üç kelimelik metin"));
  assert.equal(included.length, 1, "Yalnızca gerçek içerik paragraf olarak kalır.");
});

/* --- Gerçek belge doğrulaması (madde 2): numaralı başlık, kapak, altbilgi --- */

test("numaralı kaynakça başlığı ('8.3 Kaynakça') tanınır; karma üst başlık bölümün TAMAMINI kaynakça yapmaz", () => {
  const risk = paragraph("risk", 40);
  const takvim = paragraph("takvim", 40);
  const { included, excluded } = classifyBlocks([
    structBlock({ blockType: "HEADING", text: "8. Risk, Takvim ve Kaynakça", page: 10, ordinal: 0 }),
    structBlock({ blockType: "HEADING", text: "8.1 Başlıca riskler", page: 10, ordinal: 1 }),
    structBlock({ text: risk, page: 10, ordinal: 2 }),
    structBlock({ blockType: "HEADING", text: "8.2 Kalan takvim", page: 10, ordinal: 3 }),
    structBlock({ text: takvim, page: 10, ordinal: 4 }),
    structBlock({ blockType: "HEADING", text: "8.3 Kaynakça", page: 10, ordinal: 5 }),
    structBlock({ blockType: "LIST_ITEM", text: "• IEC 60204-1, Safety of machinery - Electrical equipment of machines.", page: 10, ordinal: 6 }),
  ]);
  assert.deepEqual(included.map((block) => block.text), [risk, takvim],
    "Risk ve takvim alt bölümleri karşılaştırmada KALMALIDIR; yalnızca kaynakça alt bölümü ayıklanır.");
  assert.ok(excluded.some((block) => block.reason === "kaynakca" && block.text.includes("IEC 60204-1")),
    "Numaralı kaynakça başlığı altındaki kaynak satırı 'kaynakca' gerekçesiyle ayıklanmalıdır.");
});

test("numaralı içindekiler başlığı altındaki tablo ayıklanır; aynı bölümün gerçek beyanı KORUNUR", () => {
  const beyan = paragraph("beyan", 40);
  const kapsam = paragraph("kapsam", 40);
  const { included, excluded } = classifyBlocks([
    structBlock({ blockType: "HEADING", text: "0. İçindekiler ve Beyan", page: 2, ordinal: 0 }),
    structBlock({ blockType: "TABLE_ROW", text: "3 Sistem Mimarisi 5", page: 2, ordinal: 1 }),
    structBlock({ blockType: "HEADING", text: "0.1 Özgünlük ve kaynak beyanı", page: 2, ordinal: 2 }),
    structBlock({ text: beyan, page: 2, ordinal: 3 }),
    structBlock({ blockType: "HEADING", text: "0.3 Rapor kapsamı", page: 2, ordinal: 4 }),
    structBlock({ text: kapsam, page: 2, ordinal: 5 }),
  ]);
  assert.ok(excluded.some((block) => block.reason === "kapak-icindekiler" && block.text === "3 Sistem Mimarisi 5"),
    "İçindekiler tablosu satırı karşılaştırmaya girmemelidir.");
  assert.deepEqual(included.map((block) => block.text), [beyan, kapsam],
    "Komşu olduğu için gerçek beyan ve rapor kapsamı SİLİNMEZ.");
});

test("sayfaların çoğunda tekrarlanan altbilgi, sayfa numarası değişse bile ayıklanır", () => {
  const blocks: SimilarityBlockInput[] = [];
  for (let page = 1; page <= 6; page += 1) {
    blocks.push(structBlock({ blockType: "HEADING", text: `${page}. Bölüm`, page, ordinal: blocks.length }));
    blocks.push(structBlock({ text: paragraph(`icerik${page}`, 40), page, ordinal: blocks.length }));
    blocks.push(structBlock({ text: `Sentetik test raporu · Benzerlik modülü doğrulaması Sayfa ${page}`, page, ordinal: blocks.length }));
  }
  const { included, excluded } = classifyBlocks(blocks);
  assert.equal(excluded.filter((block) => block.reason === "tekrarlanan-altbilgi").length, 6,
    "Her sayfadaki altbilgi ayıklanmalıdır (sayfa numarası anahtarın parçası olmamalı).");
  assert.ok(included.every((block) => !block.text.includes("Sentetik test raporu")),
    "Altbilgi hiçbir karşılaştırma bloğunda kalmamalıdır.");
});

test("kapak: numaralı ilk bölüme kadar olan 1. sayfa üst verisi uzun olsa da karşılaştırmaya girmez", () => {
  const govde = paragraph("govde", 40);
  const { included, excluded } = classifyBlocks([
    structBlock({ blockType: "HEADING", text: "KRİTİK TASARIM RAPORU", page: 1, ordinal: 0 }),
    structBlock({ text: "Rapor kodu HN26-KTR-v1.0 Takım kaptanı Elif Su Demir Danışman Dr. Kerem Aydın Rapor türü Kritik Tasarım Raporu Sürüm 1.0", page: 1, ordinal: 1 }),
    structBlock({ blockType: "HEADING", text: "1. Yönetici Özeti", page: 3, ordinal: 2 }),
    structBlock({ text: govde, page: 3, ordinal: 3 }),
  ]);
  assert.ok(excluded.some((block) => block.reason === "kapak-icindekiler" && block.text.startsWith("Rapor kodu")),
    "Kapak künyesi kelime sayısına bakılmaksızın ayıklanmalıdır.");
  assert.deepEqual(included.map((block) => block.text), [govde]);
});

test("başlık sanılan kaydırılmış gövde cümlesi başlık SAYILMAZ ve kaynakça durumunu bozmaz", () => {
  const kaynak = "• ISO 13850, Safety of machinery - Emergency stop function.";
  const govdeParcasi = "Doğrulama planı, her şartname maddesini ölçülebilir bir kabul koşuluna bağlar. Testler kapalı";
  const { included, excluded } = classifyBlocks([
    structBlock({ blockType: "HEADING", text: "7. Doğrulama ve Testler", page: 9, ordinal: 0 }),
    structBlock({ blockType: "HEADING", text: govdeParcasi, page: 9, ordinal: 1 }),
    structBlock({ text: paragraph("devam", 40), page: 9, ordinal: 2 }),
    structBlock({ blockType: "HEADING", text: "8.3 Kaynakça", page: 10, ordinal: 3 }),
    structBlock({ blockType: "LIST_ITEM", text: kaynak, page: 10, ordinal: 4 }),
  ]);
  assert.ok(included.some((block) => block.text === govdeParcasi),
    "Gövde cümlesi 'baslik' gerekçesiyle karşılaştırma dışı bırakılamaz.");
  assert.ok(!excluded.some((block) => block.reason === "baslik" && block.text === govdeParcasi));
  assert.ok(excluded.some((block) => block.reason === "kaynakca" && block.text === kaynak),
    "Sahte başlık, sonraki gerçek kaynakça başlığının çalışmasını engellememelidir.");
});

test("takım/yarışma adları sökülür; '%98' içeren takım adı hiçbir orana sızamaz", () => {
  const teamName = "Takım %98 Yıldız";
  const body = `${paragraph("anlatim", 30)} ${teamName} ${paragraph("devam", 30)}`;
  const { included, excluded } = classifyBlocks([
    structBlock({ text: teamName, ordinal: 0 }),
    structBlock({ text: body, ordinal: 1 }),
  ], { participantNames: [teamName], competitionName: "2026 Roket Yarışması" });
  assert.ok(excluded.some((block) => block.reason === "kimlik"),
    "Yalnızca ad taşıyan blok 'kimlik' gerekçesiyle ayıklanmalıdır.");
  assert.equal(included.length, 1);
  assert.ok(!included[0].text.includes("%98"), "Takım adındaki yüzde ifadesi puanlama metnine ulaşamaz.");
  assert.ok(included[0].text.includes("anlatimkelime0"), "Özgün anlatım korunmalıdır.");
});

test("şartname alıntısı bloğun çoğunu kaplıyorsa blok bütünüyle ayıklanır", () => {
  const quote = "Rapor en fazla elli sayfa olmalı ve bütün başlıklar şablondaki sırayla yazılmalıdır";
  const { included, excluded } = classifyBlocks([
    structBlock({ text: `${quote} kuralına uyulmuştur`, ordinal: 0 }),
    structBlock({ text: paragraph("ozgunanlatim", 50), ordinal: 1 }),
  ], { sartnameQuotes: [quote] });
  assert.ok(excluded.some((block) => block.reason === "sartname-alintisi"),
    "Şartnameden aktarılan kural karşılaştırma dışı kalmalıdır.");
  assert.equal(included.length, 1, "Özgün anlatım karşılaştırmada kalır.");
  assert.ok(!included[0].text.includes("elli sayfa"));
});

test("aynı şartname alıntısı blokta iki kez geçse bile HER geçiş ayıklanır", () => {
  const quote = "Rapor en fazla elli sayfa olmalı ve bütün başlıklar şablondaki sırayla yazılmalıdır";
  const text = `${paragraph("dolgu", 30)} ${quote} ${paragraph("ara", 20)} ${quote} ${paragraph("kapanis", 20)}`;
  const { included, excluded } = classifyBlocks([
    structBlock({ text, ordinal: 0 }),
  ], { sartnameQuotes: [quote] });
  assert.equal(included.length, 1, "Özgün anlatım karşılaştırmada kalır.");
  assert.ok(!included[0].text.includes("elli sayfa"),
    "İKİNCİ geçiş de karşılaştırma metninde KALMAMALIDIR (yalnızca ilki değil).");
  assert.equal(excluded.filter((block) => block.reason === "sartname-alintisi").length, 2,
    "Her iki geçiş de 'sartname-alintisi' gerekçesiyle denetime yazılmalıdır.");
});

test("tırnaklı ve atıflı açık alıntı sökülür; kalan özgün metin karşılaştırmada kalır", () => {
  const quoted = "kompozit gövde üretiminde elyaf sarım açısı dayanımı doğrudan etkileyen en kritik üretim parametresidir";
  const text = `${paragraph("kendi", 20)} “${quoted}” [3] ${paragraph("yorum", 20)}`;
  const { included, excluded } = classifyBlocks([structBlock({ text, ordinal: 0 })]);
  assert.ok(excluded.some((block) => block.reason === "acik-alinti" && block.text.includes("elyaf sarım açısı")),
    "Açık alıntı gerekçesiyle denetimde saklanmalıdır.");
  assert.equal(included.length, 1);
  assert.ok(!included[0].text.includes("elyaf sarım açısı"), "Alıntı metni karşılaştırmaya girmez.");
});

test("resmî şablon filtresi: şablonda birebir geçen blok 'sablon' olarak ayıklanır; şablon yoksa dokunulmaz", () => {
  const templateLine = "Bu bölümde takımınızın çözüm yaklaşımını ayrıntılı olarak açıklayınız";
  const filter: TemplateFilter = {
    version: 2,
    foldedLines: templateFoldedLines([templateLine]),
    shingles: new Set<number>(),
  };
  const blocks = [
    structBlock({ text: "Bu bölümde TAKIMINIZIN çözüm yaklaşımını ayrıntılı olarak açıklayınız", ordinal: 0 }),
    structBlock({ text: paragraph("cozum", 40), ordinal: 1 }),
  ];
  const withTemplate = classifyBlocks(blocks, { templateFilter: filter });
  assert.ok(withTemplate.excluded.some((block) => block.reason === "sablon"),
    "Şablon satırı büyük/küçük harften bağımsız ayıklanmalıdır.");
  assert.equal(withTemplate.included.length, 1);
  const withoutTemplate = classifyBlocks(blocks, { templateFilter: null });
  assert.equal(withoutTemplate.included.length, 2,
    "Şablon yüklenmemişse hiçbir blok 'sablon' gerekçesiyle ayıklanmaz (çoğunluk sezgisi devrede kalır).");
});

test("parça asla iki bölümün metnini karıştırmaz; çakışma yalnızca aynı bölüm içindedir", () => {
  const first = Array.from({ length: 5 }, (_, index) =>
    structBlock({ text: paragraph(`birinci${index}`, 30), sectionTitle: "Tasarım", ordinal: index }));
  const second = Array.from({ length: 5 }, (_, index) =>
    structBlock({ text: paragraph(`ikinci${index}`, 30), sectionTitle: "Testler", ordinal: 5 + index }));
  const { chunks } = chunkStructuredBlocks([...first, ...second]);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    const hasFirst = /birinci\dkelime/.test(chunk.text);
    const hasSecond = /ikinci\dkelime/.test(chunk.text);
    assert.ok(!(hasFirst && hasSecond), "Bir parça iki bölümün metnini birden taşıyamaz (madde 4).");
    assert.ok(chunk.wordCount >= CHUNK_MIN_WORDS && chunk.wordCount <= CHUNK_SOFT_MAX_WORDS);
  }
});

test("uzun bölümde ardışık parçalar ~30 kelime çakışır", () => {
  const blocks = Array.from({ length: 10 }, (_, index) =>
    structBlock({ text: paragraph(`akis${index}`, 50), sectionTitle: "Yöntem", ordinal: index }));
  const { chunks } = chunkStructuredBlocks(blocks);
  assert.ok(chunks.length >= 2, "500 kelimelik bölüm birden çok parçaya bölünmelidir.");
  const first = chunks[0].text.split(" ");
  const second = chunks[1].text.split(" ");
  assert.equal(
    second.slice(0, CHUNK_OVERLAP_WORDS).join(" "),
    first.slice(-CHUNK_OVERLAP_WORDS).join(" "),
    "Aynı bölümün ardışık parçaları ~30 kelime çakışmalıdır.",
  );
});

test("tablo satırları atılmaz: şekil açıklamasıyla birlikte kendi 'table' parçasını oluşturur", () => {
  const { chunks } = chunkStructuredBlocks([
    structBlock({ blockType: "CAPTION", text: "Tablo 1 Deney sonuçları ve ölçüm değerlerinin karşılaştırması", sectionTitle: "Testler", ordinal: 0 }),
    structBlock({ blockType: "TABLE_ROW", text: "Deney 1 itki 450 newton süre 3.2 saniye sapma 12 metre başarı", sectionTitle: "Testler", ordinal: 1 }),
    structBlock({ blockType: "TABLE_ROW", text: "Deney 2 itki 470 newton süre 3.4 saniye sapma 9 metre başarı", sectionTitle: "Testler", ordinal: 2 }),
    structBlock({ blockType: "TABLE_ROW", text: "Deney 3 itki 455 newton süre 3.1 saniye sapma 15 metre tekrar", sectionTitle: "Testler", ordinal: 3 }),
  ]);
  assert.equal(chunks.length, 1, "Ardışık tablo satırları tek tablo parçası olmalıdır.");
  assert.equal(chunks[0].kind, "table", "Tablo içeriği 'table' türüyle karşılaştırılabilir kalır.");
  assert.ok(chunks[0].text.includes("450 newton"), "Projeye özgü tablo değerleri karşılaştırmada kalır.");
  assert.equal(chunks[0].blockStart, 0);
  assert.equal(chunks[0].blockEnd, 3);
});

test("belge başına parça tavanı: 500 parçalık belge 400'de durur; kuyruk 'tavan' gerekçesiyle denetimde", () => {
  // Her blok kendi bölümüdür (60 kelime) → blok başına tam bir parça: 500 aday.
  const blocks = Array.from({ length: 500 }, (_, index) =>
    structBlock({ text: paragraph(`bolum${index}`, 60), sectionTitle: `Bölüm ${index}`, ordinal: index }));
  const { chunks, dropped } = chunkStructuredBlocks(blocks);
  assert.equal(chunks.length, MAX_CHUNKS_PER_DOC, "Parça sayısı tavanı (400) aşamaz (madde 8 · bellek koruması).");
  const capped = dropped.filter((block) => block.reason === "tavan");
  assert.equal(capped.length, 100, "Tavanı aşan 100 bölüm ASLA sessizce atılmaz; 'tavan' gerekçesiyle denetime yazılır.");
  // Belge sırası korunur: ilk 400 bölüm parça olur, kuyruk 400. bölümden başlar.
  assert.ok(chunks[MAX_CHUNKS_PER_DOC - 1].text.includes("bolum399kelime"),
    "İlk 400 bölüm belge sırasıyla parçalanmalıdır.");
  assert.ok(capped[0].text.includes("bolum400kelime"), "Atılan kuyruk belge sırasını korumalıdır.");
  // Tavan parametreyle (route: SIMILARITY_MAX_CHUNKS) ayarlanabilir.
  const small = chunkStructuredBlocks(blocks.slice(0, 10), 4);
  assert.equal(small.chunks.length, 4);
  assert.equal(small.dropped.filter((block) => block.reason === "tavan").length, 6);
});

test("parça tavanı ortam değişkeniyle ayarlanabilir; geçersiz değer varsayılana düşer", () => {
  assert.equal(similarityMaxChunksPerDoc({}), MAX_CHUNKS_PER_DOC, "Varsayılan tavan 400 parçadır.");
  assert.equal(similarityMaxChunksPerDoc({ SIMILARITY_MAX_CHUNKS: "150" }), 150);
  assert.equal(similarityMaxChunksPerDoc({ SIMILARITY_MAX_CHUNKS: "bozuk" }), MAX_CHUNKS_PER_DOC);
  assert.equal(similarityMaxChunksPerDoc({ SIMILARITY_MAX_CHUNKS: "-5" }), MAX_CHUNKS_PER_DOC);
  // Route tavanı ortamdan okuyup chunkStructuredBlocks'a geçirir; rapor notu
  // ve denetim nesnesi kesmeyi açıkça taşır (asla sessiz kırpma yok).
  const route = readFileSync("app/lib/similarity-preparation.ts", "utf8");
  assert.match(route, /chunkStructuredBlocks\(classified\.included, similarityMaxChunksPerDoc\(\)\)/,
    "Route parça tavanını ortamdan okumalıdır.");
  assert.match(route, /truncatedBlocks = excluded\.filter\(\(block\) => block\.reason === "tavan"\)\.length/,
    "Tavan kesmesi rapor notunda yüzeye çıkarılmalıdır (asla sessiz değil).");
});

test("ayıklama gerekçe listesi types.ts kopyasıyla birebir aynıdır", () => {
  const reasons = ["sablon", "baslik", "kimlik", "kapak-icindekiler", "sartname-alintisi", "kaynakca", "acik-alinti", "cok-kisa", "tekrarlanan-altbilgi", "tavan"];
  const extract = (source: string, marker: string) => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${marker} bulunmalıdır.`);
    const body = source.slice(start, source.indexOf(";", start));
    return [...body.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]).sort();
  };
  const text = extract(readFileSync("app/lib/similarity-text.ts", "utf8"), "export type ExclusionReason");
  const types = extract(readFileSync("app/lib/types.ts", "utf8"), "export type SimilarityExclusionReason");
  assert.deepEqual(text, [...reasons].sort());
  assert.deepEqual(types, [...reasons].sort(), "types.ts kopyası similarity-text ile ayrışmamalıdır.");
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
  const preparation = readFileSync("app/lib/similarity-preparation.ts","utf8");
  assert.match(preparation,/resolveSimilarityContext\(applicationId, actor\)/);
  assert.match(preparation,/crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.doesNotMatch(preparation,/body\.pages|claimedPdfHash/);
  assert.match(preparation,/buildMinHash\(/);
  const bulk = readFileSync("app/lib/similarity-bulk.ts","utf8");
  assert.match(bulk,/findStoredSimilarityChunks/);
  const engine=readFileSync("app/lib/similarity-bulk-engine.ts","utf8");
  assert.match(engine,/j=i\+1/);
  assert.match(engine,/left\.participantId === right\.participantId/);
  const db=readFileSync("app/lib/workflow-db.ts","utf8");
  const pool=db.slice(db.indexOf("export async function listBulkSimilarityPool"));
  assert.match(pool,/a\.status = 'completed' AND d\.outcome = 'accepted'/);
  assert.match(pool,/a\.deleted_at IS NULL/);
});

test("aynı PDF sürümü için embedding ikinci kez üretilmez; yeni sürüm eski embedding kullanmaz", () => {
  const route = readFileSync("app/lib/similarity-preparation.ts", "utf8");
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

test("kriter analizi benzerlik başlatmaz; hazırlık nihai onaydan sonra yanıtı engellemeden çalışır", () => {
  const app=readFileSync("app/components/evaluation-app.tsx","utf8");
  assert.doesNotMatch(app,/runSimilarity|trackSimilarity|retrySimilarity|similarityCheck\(/);
  assert.match(app,/await evaluateReport\(/);
  assert.match(app,/"save_evaluation"/);
  const route=readFileSync("app/api/applications/[id]/route.ts","utf8");
  assert.ok(route.indexOf("await saveApplicationReview")<route.indexOf("if (await queueApprovedSimilarity"));
  assert.match(route,/after\(async/);
  assert.doesNotMatch(readFileSync("app/lib/judge-review.ts","utf8"),/similarity|benzerlik/i);
});

test("geç gelen benzerlik sonucu hakem kararlarını, başka başvuruyu ve yeni analizi EZEMEZ", () => {
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const attach = db.slice(db.indexOf("export async function attachSimilarityToEvaluation"));
  const body = attach.slice(0, attach.indexOf("\nexport "));
  assert.match(body, /findSimilarityResult\(id, current\.evaluation_pdf_hash\)/,
    "Sonuç yalnızca kaydın bağlı olduğu PDF sürümü için aranmalıdır.");
  assert.match(body, /evaluation_json = \?[\s\S]{0,200}status <> 'completed' AND evaluation_json = \?/,
    "Yazma, okunan sürümle karşılaştırmalı (CAS) olmalıdır: arada yeni analiz kaydedildiyse düşer.");
  assert.ok(!/review_json/.test(body), "Hakem kararları (review_json) bu yazmadan ETKİLENMEMELİDİR.");
  assert.match(body, /decisions_locked === 1/, "Dondurulmuş yarışmada kayıt değişmemelidir.");
  const route = readFileSync("app/api/applications/[id]/route.ts", "utf8");
  assert.match(route, /body\.action === "attach_similarity"/, "Uç, ayrı eylemi tanımalıdır.");
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

/* ------------- GÖREV 3 kaynak denetimi: yapısal yol ve şablon damgası ------------- */

test("benzerlik ucu yapısal ayrıştırmayı sunucuda yapar; taranmış PDF'te OCR ÇAĞRILMAZ", () => {
  const route=readFileSync("app/lib/similarity-preparation.ts","utf8");
  assert.match(route,/extractPdfStructure\(bytes\)/);
  assert.match(route,/instanceof PdfTextLayerError/);
  assert.match(route,/OCR uygulanmış PDF gerekiyor/);
  assert.doesNotMatch(route,/extractPdfStructureViaOcr|pdf-ocr/);
  assert.match(route,/classifyBlocks\(/);
  assert.match(route,/chunkStructuredBlocks\(/);
});

test("R2 parça nesnesi v2: kaynak ve ayıklama denetimi korunur, eski önbellek güvenle yeniden hazırlanır", () => {
  const route=readFileSync("app/lib/similarity-preparation.ts","utf8");
  assert.match(route,/v: 2,/);
  assert.match(route,/auditLabel: EXCLUSION_AUDIT_LABEL/);
  assert.match(route,/excluded: excluded\.map/);
  assert.match(route,/parsed\.v === 2/);
  assert.match(route,/if \(!cacheValid\)/);
});

/* --------------- Katman 1: sıfır shingle koruması (madde 5, senaryo 11) --------------- */

test("sıfır shingle üreten iki metin ASLA 1.0 benzer sayılmaz", () => {
  const emptyA = buildMinHash("");
  const emptyB = buildMinHash("   \n  ");
  assert.equal(emptyA.shingleCount, 0, "Boş metin sıfır shingle üretmelidir.");
  assert.equal(minHashSimilarity(emptyA.signature, emptyB.signature), 0,
    "İki boş imza 1.0 DEĞİL 0 benzerlik almalıdır (madde 5 · Katman 1).");
});

test("eski zehirli tüm-başlangıç imzası hiçbir gerçek imzayla eşleşemez", () => {
  const legacyPoisoned = Array.from({ length: 64 }, () => 0xffffffff);
  const real = buildMinHash(paragraph("gercek", 200)).signature;
  assert.equal(minHashSimilarity(legacyPoisoned, real), 0,
    "Tüm-başlangıç (boş) imza gerçek imzayla 0 benzerlik almalıdır; veri temizliği gerekmez.");
  assert.equal(minHashSimilarity(legacyPoisoned, [...legacyPoisoned]), 0,
    "İki zehirli imza birbirine 1.0 veremez.");
});

test("başlangıç değeri koruması yalnızca İKİ TARAFI boş konumları atlar", () => {
  const signature = buildMinHash(paragraph("dolu", 200)).signature;
  // Tek tarafı başlangıç değeri olan konum gerçek AYRIŞMADIR ve sayılır.
  const oneSided = [...signature];
  oneSided[0] = 0xffffffff;
  const oneSidedScore = minHashSimilarity(signature, oneSided);
  assert.ok(oneSidedScore < 1 && oneSidedScore > 0.9,
    `Tek taraflı başlangıç konumu benzerliği düşürmelidir (ölçülen ${oneSidedScore}).`);
  // İki tarafı da başlangıç değeri olan konum bilgi taşımaz ve atlanır.
  const bothSidedLeft = [...signature];
  const bothSidedRight = [...signature];
  bothSidedLeft[0] = 0xffffffff;
  bothSidedRight[0] = 0xffffffff;
  assert.equal(minHashSimilarity(bothSidedLeft, bothSidedRight), 1,
    "Kalan 63 konum birebir aynıysa benzerlik 1 olmalıdır; boş konum paydaya girmez.");
});

test("benzerlik ucu: boş normalize metin parmak izi havuzuna ve embedding'e ULAŞAMAZ", () => {
  const route=readFileSync("app/lib/similarity-preparation.ts","utf8");
  const gate=route.indexOf('state: "empty"');
  assert.ok(gate>0 && gate<route.indexOf("await embedTexts("));
  assert.match(route,/docMinHash\.tokenCount < thresholds\.minComparableWords/);
  assert.doesNotMatch(route.slice(gate,route.indexOf("await embedTexts(")),/saveSimilarityChunks\(/);
});

/* --------------- Katman 2: doğrulama kapısı (madde 5, embedding tek başına alarm üretemez) --------------- */

/** Ortogonal test embedding'i: aynı eksen → cosine 1, farklı eksen → 0. */
function axis(index: number, dims = 8): number[] {
  return Array.from({ length: dims }, (_, position) => (position === index ? 1 : 0));
}

function featuredChunk(
  index: number,
  text: string,
  embedding: number[] | null,
  features: SimilarityChunkFeatures | null = null,
  wordStart: number | null = null,
): ScoredChunk {
  return {
    index, wordCount: text.split(" ").length, pageStart: index + 1, text,
    minHash: chunkMinHash(text), embedding, template: false, features, wordStart,
  };
}

function featuredPeer(
  index: number,
  text: string,
  embedding: number[] | null,
  features: SimilarityChunkFeatures | null = null,
): PeerChunk {
  return {
    index, wordCount: text.split(" ").length, pageStart: index + 1,
    minHash: chunkMinHash(text), embedding, template: false, features,
  };
}

test("tek başına yüksek cosine EŞLEŞME DEĞİLDİR: doğrulama desteği yoksa orana giremez", () => {
  const own = [featuredChunk(0, paragraph("kendianlatim", 120), axis(0))];
  const peer = [featuredPeer(0, paragraph("esanlatim", 120), axis(0))];
  const result = approximateReportSimilarity(own, peer);
  assert.equal(result.matches.length, 0, "Desteksiz anlamsal aday elenmelidir (madde 5 · Katman 2).");
  assert.equal(result.approxPercent, 0, "Desteksiz cosine yüzdeye yansıyamaz.");
});

test("aynı özgün sayılar anlamsal eşleşmeyi doğrular (ozgun-sayilar)", () => {
  const sharedNumbers: SimilarityChunkFeatures = { rare: [], nums: ["450newton", "3.2saniye"] };
  const own = [featuredChunk(0, paragraph("kendideney", 120), axis(0), sharedNumbers)];
  const peer = [featuredPeer(0, paragraph("esdeney", 120), axis(0), sharedNumbers)];
  const result = approximateReportSimilarity(own, peer);
  assert.equal(result.matches.length, 1, "İki ortak özgün sayı eşleşmeyi doğrulamalıdır.");
  assert.ok(result.matches[0].corroboration?.includes("ozgun-sayilar"),
    "Destek sinyali 'ozgun-sayilar' olarak raporlanmalıdır.");
  assert.equal(result.matches[0].kind, "semantic");
});

test("birbirini takip eden benzer paragraflar birbirini doğrular (ardisik-paragraflar)", () => {
  const own = [
    featuredChunk(0, paragraph("kendibir", 100), axis(0)),
    featuredChunk(1, paragraph("kendiiki", 100), axis(1)),
  ];
  const peer = [
    featuredPeer(0, paragraph("esbir", 100), axis(0)),
    featuredPeer(1, paragraph("esiki", 100), axis(1)),
  ];
  const result = approximateReportSimilarity(own, peer);
  assert.equal(result.matches.length, 2, "Ardışık iki anlamsal çift birbirini doğrulamalıdır.");
  for (const match of result.matches) {
    assert.ok(match.corroboration?.includes("ardisik-paragraflar"),
      "Destek sinyali 'ardisik-paragraflar' olmalıdır.");
  }
});

test("mimari ve anlatım sırası birlikte benzeyince zincir doğrular (mimari-anlati-sirasi)", () => {
  // Ardışık OLMAYAN ama her iki raporda da aynı sırada ilerleyen üç eşleşme.
  const own = [
    featuredChunk(0, paragraph("kendia", 100), axis(0)),
    featuredChunk(2, paragraph("kendib", 100), axis(1)),
    featuredChunk(5, paragraph("kendic", 100), axis(2)),
  ];
  const peer = [
    featuredPeer(0, paragraph("esa", 100), axis(0)),
    featuredPeer(3, paragraph("esb", 100), axis(1)),
    featuredPeer(7, paragraph("esc", 100), axis(2)),
  ];
  const result = approximateReportSimilarity(own, peer);
  assert.equal(result.matches.length, 3, "Üçlü sıra zinciri bütün çiftleri doğrulamalıdır.");
  for (const match of result.matches) {
    assert.ok(match.corroboration?.includes("mimari-anlati-sirasi"),
      "Destek sinyali 'mimari-anlati-sirasi' olmalıdır.");
  }
});

test("doğrudan (MinHash) eşleşme doğrulama desteği ARAMAZ; sözlüksel örtüşme kendi kanıtıdır", () => {
  const copied = paragraph("birebir", 150);
  const result = approximateReportSimilarity(
    [featuredChunk(0, copied, null)],
    [featuredPeer(0, copied, null)],
  );
  assert.equal(result.matches.length, 1, "Doğrudan kopya desteksiz de eşleşmelidir.");
  assert.equal(result.matches[0].kind, "direct");
  assert.deepEqual(result.matches[0].corroboration, [], "Doğrudan eşleşmede destek listesi boştur.");
});

test("havuzun yarısından fazlasında görülen sayı/terim ORTAKTIR ve doğrulayamaz", () => {
  const common: SimilarityChunkFeatures = { rare: [111], nums: ["450newton", "3.2saniye"] };
  const unique: SimilarityChunkFeatures = { rare: [222], nums: ["987metre"] };
  const counts = poolFeatureCounts([
    [common, unique],
    [common], [common], [common],
  ]);
  const stripped = stripPoolCommonFeatures({ rare: [111, 222], nums: ["450newton", "987metre"] }, counts, 4);
  assert.deepEqual(stripped?.nums, ["987metre"], "Havuz-ortak sayı destek listesinden düşmelidir.");
  assert.deepEqual(stripped?.rare, [222], "Havuz-ortak terim destek listesinden düşmelidir.");
  // Süzülmüş ortak sayılar artık doğrulayamaz: yalnız ortak-teknik-ölçü paylaşan
  // raporlar (madde 12 · senaryo 6) anlamsal eşleşme üretemez.
  const verdict = corroborationOf({ ownIndex: 0, peerIndex: 0 }, 0, stripped!.nums.length - 1,
    [{ ownIndex: 0, peerIndex: 0 }], DEFAULT_SIMILARITY_THRESHOLDS.corroboration);
  assert.equal(verdict.ok, false, "Kalan tek sayı doğrulamaya yetmemelidir.");
});

test("chunkFeatures: madde numarası ve yıl özgün sayı DEĞİLDİR; ölçüler ve nadir terimler alınır", () => {
  const features = chunkFeatures(
    "3 numaralı deneyde 2024 yılında itki 450 Newton ölçüldü; süperkapasitör verimliliği %98 çıktı",
  );
  assert.ok(features.nums.includes("450newton"), "Ölçü birimiyle sayı alınmalıdır.");
  assert.ok(features.nums.some((token) => token.includes("98")), "Yüzde değeri alınmalıdır.");
  assert.ok(!features.nums.includes("3"), "0-10 arası çıplak sayı alınmaz.");
  assert.ok(!features.nums.includes("2024"), "Çıplak yıl alınmaz.");
  assert.ok(features.rare.length > 0, "Nadir/uzun teknik terimler özetlenmelidir.");
});

/* --------------- Madde 6: aralık birleşimi (çift sayım önleme) --------------- */

test("çakışan parçaların ortak kelimeleri paydada BİR KEZ sayılır", () => {
  const spans = [
    { wordStart: 0, wordCount: 220 },
    { wordStart: 190, wordCount: 220 }, // 30 kelime çakışma
  ];
  assert.equal(comparableWordUnion(spans), 410, "Birleşim 440 değil 410 kelimedir.");
  assert.equal(comparableWordUnion([{ wordStart: null, wordCount: 100 }, { wordStart: 5, wordCount: 100 }]), 200,
    "Konum bilinmiyorsa ayrık aralık varsayımı (eski aritmetik) geçerlidir.");
});

test("çakışan iki eşleşme aynı kelimeleri iki kez SAYAMAZ (payda ve pay birleşimle ölçülür)", () => {
  const copiedA = paragraph("kopyalanmisA", 220);
  const copiedB = paragraph("kopyalanmisB", 220);
  const own = [
    featuredChunk(0, copiedA, null, null, 0),
    featuredChunk(1, copiedB, null, null, 190),
  ];
  const peer = [featuredPeer(0, copiedA, null), featuredPeer(1, copiedB, null)];
  const result = approximateReportSimilarity(own, peer);
  assert.equal(result.comparableWords, 410, "Payda aralık birleşimidir.");
  assert.equal(result.matchedWords, 410, "Pay 440 (toplam) değil 410 (birleşim) olmalıdır.");
  assert.equal(result.approxPercent, 100, "Oran hiçbir zaman %100'ü aşamaz.");
});

test("kısmi eşleşmede aralık hesabı ile ayrık varsayım farkı doğru yönde çalışır", () => {
  const copied = paragraph("ortakparca", 220);
  const original = paragraph("ozgunparca", 220);
  const withSpans = approximateReportSimilarity(
    [featuredChunk(0, copied, null, null, 0), featuredChunk(1, original, null, null, 190)],
    [featuredPeer(0, copied, null)],
  );
  assert.equal(withSpans.comparableWords, 410);
  assert.equal(withSpans.approxPercent, Math.round((220 / 410) * 100), "Aralıklı oran birleşime bölünür.");
  const withoutSpans = approximateReportSimilarity(
    [featuredChunk(0, copied, null), featuredChunk(1, original, null)],
    [featuredPeer(0, copied, null)],
  );
  assert.equal(withoutSpans.comparableWords, 440, "Konumsuz eski kayıt ayrık varsayımla eski aritmetiği verir.");
  assert.equal(withoutSpans.approxPercent, 50);
});

test("aynı paragrafın tekrarları yalnız kendi kapsaması kadar sayılır; oran tavanı %100", () => {
  const repeated = paragraph("tekrarli", 200);
  const result = approximateReportSimilarity(
    [featuredChunk(0, repeated, null, null, 0), featuredChunk(1, repeated, null, null, 200)],
    [featuredPeer(0, repeated, null)],
  );
  assert.ok(result.approxPercent <= 100);
  assert.equal(result.matchedWords, 400, "Her parça kendi aralığını bir kez örter.");
});

/* --------------- Madde 6: yapılandırılabilir bantlar --------------- */

test("eşikler ortam değişkeniyle değişir; geçersiz/ters değer varsayılana döner", () => {
  const defaults = similarityThresholds({});
  assert.equal(defaults.reportReviewPercent, 20, "Varsayılan inceleme bandı %20'dir (madde 6).");
  assert.equal(defaults.reportHighPercent, 40, "Varsayılan yüksek bandı %40'tır (madde 6).");
  const overridden = similarityThresholds({
    SIMILARITY_REPORT_REVIEW_PERCENT: "25",
    SIMILARITY_REPORT_HIGH_PERCENT: "60",
    SIMILARITY_SEMANTIC_REVIEW: "0.85",
  });
  assert.equal(overridden.reportReviewPercent, 25);
  assert.equal(overridden.reportHighPercent, 60);
  assert.equal(overridden.semanticReview, 0.85);
  const invalid = similarityThresholds({
    SIMILARITY_REPORT_REVIEW_PERCENT: "abc",
    SIMILARITY_REPORT_HIGH_PERCENT: "150",
  });
  assert.equal(invalid.reportReviewPercent, 20, "Sayı olmayan değer varsayılana düşmelidir.");
  assert.equal(invalid.reportHighPercent, 40, "Aralık dışı değer varsayılana düşmelidir.");
  const reversed = similarityThresholds({
    SIMILARITY_REPORT_REVIEW_PERCENT: "50",
    SIMILARITY_REPORT_HIGH_PERCENT: "40",
  });
  assert.equal(reversed.reportReviewPercent, 20, "Ters sıralı bantlar bütünüyle varsayılana döner.");
  assert.equal(reversed.reportHighPercent, 40);
});

test("bant eşlemesi: 19 normal · 20 review · 39 review · 40 high", () => {
  const thresholds = similarityThresholds({});
  assert.equal(reportBandLevel(19, thresholds), "normal");
  assert.equal(reportBandLevel(20, thresholds), "review");
  assert.equal(reportBandLevel(39, thresholds), "review");
  assert.equal(reportBandLevel(40, thresholds), "high");
});

/* --------------- Madde 6: gösterim cümlesinden regex okuma YASAĞI (senaryo 12) --------------- */

function similarityCheckOf(overrides: Partial<PreCheck>): PreCheck {
  return {
    id: "precheck-similarity",
    kind: "similarity",
    name: "Aynı yarışma havuzunda benzerlik",
    status: "warning",
    method: "deterministic",
    detail: "",
    evidence: [],
    ...overrides,
  };
}

test("takım adındaki '%98' oranı BOZAMAZ: yapılandırılmış alan esas alınır", () => {
  const check = similarityCheckOf({
    detail: "3 raporla karşılaştırıldı. En yakın eşleşme: Takım %98 Vizyon (%12). "
      + "Bu yalnızca Hakemin incelemesi için bir işarettir; otomatik ihlal veya diskalifiye kararı verilmez.",
    similarity: { percent: 12, closestTeam: "Takım %98 Vizyon" },
  });
  const result = similarityResultOf(check);
  assert.equal(result?.percent, 12, "Oran yapılandırılmış alandan okunmalıdır; %98 sızamaz.");
  assert.equal(result?.closestTeam, "Takım %98 Vizyon", "Takım adı aynen korunur.");
});

test("yapılandırılmış alanı olmayan ESKİ kayıtta sertleştirilmiş yedek SON (%NN) kuyruğunu okur", () => {
  const legacy = similarityCheckOf({
    detail: "3 raporla karşılaştırıldı. En yakın eşleşme: Takım %98 Vizyon (%12). "
      + "Bu yalnızca Hakemin incelemesi için bir işarettir.",
  });
  const result = similarityResultOf(legacy);
  assert.equal(result?.percent, 12, "Eski kayıtta bile takım adındaki %98 değil kuyruktaki (%12) okunur.");
  assert.equal(result?.closestTeam, "Takım %98 Vizyon");
});

test("kaynak denetimi: benzerlik yüzdesi hiçbir yerde gösterim cümlesinden regex ile geri okunmaz", () => {
  const app=readFileSync("app/components/similarity-workspace.tsx","utf8");
  assert.match(app,/pair\.percent/);
  assert.doesNotMatch(app,/match\(/);
  const engine=readFileSync("app/lib/similarity-bulk-engine.ts","utf8");
  assert.match(engine,/forward\.approxPercent\+backward\.approxPercent/);
});

test("kill switch: SIMILARITY_LLM_ENABLED off/0 kapatır, tanımsız açıktır", () => {
  assert.equal(similarityLlmEnabled({}), true, "Varsayılan AÇIK olmalıdır (kullanıcı kararı).");
  assert.equal(similarityLlmEnabled({ SIMILARITY_LLM_ENABLED: "on" }), true);
  assert.equal(similarityLlmEnabled({ SIMILARITY_LLM_ENABLED: "off" }), false);
  assert.equal(similarityLlmEnabled({ SIMILARITY_LLM_ENABLED: "0" }), false);
  assert.equal(similarityLlmEnabled({ SIMILARITY_LLM_ENABLED: "OFF" }), false);
});

test("toplu AI yorumu eşik üstünde en fazla beş çiftle sınırlandırılır", () => {
  const defaults = similarityThresholds({});
  assert.equal(defaults.llmMinPercent, 85);
  assert.equal(defaults.llmTopK, 5);
  const overridden = similarityThresholds({ SIMILARITY_LLM_MIN_PERCENT: "92", SIMILARITY_LLM_TOP_K: "2" });
  assert.equal(overridden.llmMinPercent, 92);
  assert.equal(overridden.llmTopK, 2);
});

test("embedding önbellek anahtarına şablon sürümü GİRMEZ; damga değişince yalnızca satırlar yenilenir", () => {
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const find = db.slice(db.indexOf("export async function findStoredSimilarityChunks"));
  const findBody = find.slice(0, find.indexOf("\nexport "));
  assert.match(findBody, /submission_version_id = \? AND pdf_hash = \? AND pipeline_version = \?/,
    "Önbellek anahtarı sürüm + özet + boru hattıdır.");
  assert.ok(!/template_version = \?/.test(findBody),
    "Şablon sürümü önbellek anahtarına girmez: şablon değişimi yeniden embedding ÜCRETİ çıkarmaz (kullanıcı kararı).");
  assert.match(db, /addMissingColumns\(database, "similarity_chunks", SIMILARITY_CHUNK_COLUMNS\)/,
    "Yeni parça sütunları çalışma anında da eklenmelidir (PRAGMA korumalı).");
  assert.match(db, /addMissingColumns\(database, "similarity_results", SIMILARITY_RESULT_COLUMNS\)/,
    "Sonuç eskime sütunları çalışma anında da eklenmelidir.");
  const route = readFileSync("app/lib/similarity-preparation.ts", "utf8");
  assert.match(route, /templateStampChanged/, "Şablon damgası eskiyince satırlar embedding korunarak yenilenmelidir.");
  assert.match(route, /cached!\.map\(\(row\) => row\.embedding\)/,
    "Damga yenilemede kayıtlı vektörler satır satır korunmalıdır.");
});

/* --------------- Madde 7: bağımsız benzerlik kartı (kaynak denetimi) --------------- */

test("boş veya tek raporlu havuz karşılaştırma için yeterli gösterilmez", () => {
  const app=readFileSync("app/components/similarity-workspace.tsx","utf8");
  assert.match(app,/en az iki hazır rapor gerekir/);
  assert.doesNotMatch(app,/Çalıştırılmadı/);
});

test("benzerlik ayrı çalışma alanındadır; karar kartı ve teknik jargon kullanılmaz", () => {
  const app=readFileSync("app/components/evaluation-app.tsx","utf8");
  assert.doesNotMatch(app,/label: "Benzerlik taraması"|<SimilarityCard|<LegacySimilarityCard/);
  assert.match(app,/<SimilarityWorkspace/);
  const ui=readFileSync("app/components/similarity-workspace.tsx","utf8");
  assert.match(ui,/özgünlük puanı veya intihal kararı değildir/);
  assert.match(ui,/aynı veya çok yakın ifadeler/);
  assert.match(ui,/benzer anlatım/);
});

test("rapor sözleşmesi: eşleşme ayrımı ve havuz kesme işareti yapılandırılmış alanlarla taşınır", () => {
  const engine=readFileSync("app/lib/similarity-bulk-engine.ts","utf8");
  assert.match(engine,/directCount:matches\.filter\(match=>match\.kind==="direct"\)\.length/);
  assert.match(engine,/semanticCount:matches\.filter\(match=>match\.kind==="semantic"\)\.length/);
  const ui=readFileSync("app/components/similarity-workspace.tsx","utf8");
  assert.match(ui,/seçilmeyen çiftler için oran üretilmedi/);
});

test("madde 12 · durum 11: her şey ayıklansa bile denetim kaydı R2'ye yazılır, havuz zehirlenmez", () => {
  const route=readFileSync("app/lib/similarity-preparation.ts","utf8");
  const start=route.indexOf('if (!chunks.length || docMinHash.tokenCount');
  const end=route.indexOf('/* 5) Embedding',start);
  const gate=route.slice(start,end);
  assert.match(gate,/reportBucket\(\)\.put\(textStoreKey/);
  assert.match(gate,/auditLabel: EXCLUSION_AUDIT_LABEL/);
  assert.match(gate,/included: \[\]/);
  assert.match(gate,/state: "empty"/);
  assert.doesNotMatch(gate,/saveSimilarityChunks\(/);
});

/* --------------- Madde 8: eskitme, havuz sınırı ve tekrar başlatılabilirlik --------------- */

test("yeni rapor havuzdaki eski benzerlik sonuçlarını 'güncel değil' işaretler", () => {
  // Yazım BEKLENMELİDİR: Workers izolatı yanıttan sonra beklenmeyen D1
  // yazımını tamamlamayabilir; .catch bozulmayı yine de yutar (yükleme düşmez).
  const create = readFileSync("app/api/applications/route.ts", "utf8");
  assert.match(create, /await markSimilarityResultsStale\(profile\.competitionKey/,
    "Yeni başvuru havuzu eskitmeli ve yazımı BEKLEMELİDİR (madde 8).");
  const versions = readFileSync("app/api/applications/[id]/versions/route.ts", "utf8");
  assert.match(versions, /await markSimilarityResultsStale\(result\.competitionKey/,
    "Yeni rapor sürümü havuzu eskitmeli ve yazımı BEKLEMELİDİR (madde 8).");
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const stale = db.slice(db.indexOf("export async function markSimilarityResultsStale"));
  const staleBody = stale.slice(0, stale.indexOf("\nexport "));
  assert.match(staleBody, /SET is_stale = 1/, "Eskitme sonucu SİLMEZ; yalnız işaretler.");
  assert.match(staleBody, /application_id <> \?/, "Yeni gelen başvurunun kendi sonucu eskitilmez.");
});

test("parmak izi havuzu arşivlenmiş/eski sürüm/aynı takım izlerini dışarıda bırakır", () => {
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  const fingerprints = db.slice(db.indexOf("export async function saveAndListSimilarityFingerprints"));
  const body = fingerprints.slice(0, fingerprints.indexOf("\nexport "));
  assert.match(body, /a\.deleted_at IS NULL/, "Arşivlenmiş başvurunun izi havuza girmez.");
  assert.match(body, /a\.current_version_id = f\.submission_version_id/,
    "Eski PDF sürümünden kalan iz havuza girmez.");
  assert.match(body, /a\.participant_id <> \?/,
    "Aynı takımın (hesabın) başka başvurusu 'farklı takım benzerliği' sayılmaz.");
  assert.match(body, /LIMIT 500/, "Büyük havuzda iz sorgusu sınırlandırılmalıdır.");
});

test("çalışma zamanı sınırları ortamla ayarlanabilir: havuz 200 · bütçe ~15sn · parti 10", () => {
  const defaults = similarityRuntimeLimits({});
  assert.equal(defaults.poolMaxApps, 200, "Havuz üst sınırı 200 başvurudur (kullanıcı kararı).");
  assert.equal(defaults.timeBudgetMs, 15_000, "Süre bütçesi ~15 saniyedir (kullanıcı kararı).");
  assert.equal(defaults.peerBatchApps, 10);
  const overridden = similarityRuntimeLimits({
    SIMILARITY_POOL_MAX_APPS: "50",
    SIMILARITY_TIME_BUDGET_MS: "5000",
    SIMILARITY_PEER_BATCH_APPS: "4",
  });
  assert.equal(overridden.poolMaxApps, 50);
  assert.equal(overridden.timeBudgetMs, 5_000);
  assert.equal(overridden.peerBatchApps, 4);
  const invalid = similarityRuntimeLimits({ SIMILARITY_POOL_MAX_APPS: "bozuk", SIMILARITY_TIME_BUDGET_MS: "-5" });
  assert.equal(invalid.poolMaxApps, 200, "Geçersiz değer varsayılana düşmelidir.");
  assert.equal(invalid.timeBudgetMs, 15_000);
});

test("bütçe dolunca koşu kalıcılaşır ve sürdürülür; embedding maliyeti asla kaybolmaz", () => {
  const bulk=readFileSync("app/lib/similarity-bulk.ts","utf8");
  assert.match(bulk,/processed<2/);
  assert.match(bulk,/run\.data\.cursor\+\+/);
  assert.match(bulk,/await saveBulkRun/);
  assert.match(bulk,/current\.snapshot!==context\.snapshot/);
  assert.doesNotMatch(bulk,/embedTexts\(|generateContent/);
  const ui=readFileSync("app/components/similarity-workspace.tsx","utf8");
  assert.match(ui,/Taramaya devam et/);
  assert.match(ui,/bulkSimilarityAction\(selected,"continue"\)/);
});

test("koşu tablosu ve işaret izi sütunu hem migration'da hem çalışma anı şemasında var", () => {
  const migration = readFileSync("migrations/0013_similarity_flow.sql", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS similarity_runs/, "Koşu tablosu migration'da olmalıdır.");
  assert.match(migration, /ALTER TABLE similarity_chunks ADD COLUMN embedding_sketch TEXT/,
    "İşaret izi sütunu migration'da olmalıdır.");
  const db = readFileSync("app/lib/workflow-db.ts", "utf8");
  assert.match(db, /CREATE TABLE IF NOT EXISTS similarity_runs/, "Koşu tablosu çalışma anı şemasında olmalıdır.");
  assert.match(db, /\{ name: "embedding_sketch", definition: "TEXT" \}/,
    "İşaret izi sütunu SIMILARITY_CHUNK_COLUMNS listesinde olmalıdır.");
});

test("durum adlandırması: başarısız/eksik/yapılmamış karşılaştırma 'Normal' DENMEZ", () => {
  const app=readFileSync("app/components/similarity-workspace.tsx","utf8");
  assert.match(app,/Anlamsal veri eksik/);
  assert.match(app,/Karşılaştırılabilir metin yok/);
  assert.match(app,/Yeniden deneme gerekiyor/);
  assert.match(app,/Önceki oranlar gizlendi/);
  assert.doesNotMatch(app,/"Normal"|ŞÜPHELİ/);
});

test("otomatik benzerlikte üretken LLM maliyeti yoktur", () => {
  const route=readFileSync("app/api/applications/[id]/similarity/route.ts","utf8");
  assert.doesNotMatch(route,/explainSimilarityMatches|generateContent/);
  assert.match(route,/llmApiCalls:\s*0/);
});

test("yüksek benzerlikte hakem kararı AI açıklamasından bağımsız, yetkili ve gerekçeli kalır", () => {
  const bulk=readFileSync("app/lib/similarity-bulk.ts","utf8");
  const decision=bulk.slice(bulk.indexOf("export async function markBulkApplicationNegative"));
  assert.match(decision,/context\.actor\.roleCode!=="02"/);
  assert.match(decision,/pair\.percent<thresholds\.llmMinPercent/);
  assert.match(decision,/target\.assignedJudgeId!==context\.actor\.id/);
  assert.doesNotMatch(decision,/aiStatus!=="completed"/,
    "Üretken AI açıklaması arızalanırsa hakemin kanıta dayalı kararı kilitlenmemelidir.");
  assert.match(decision,/pair\.aiReview\?\.level\?\?"not_reviewed"/);
  const route=readFileSync("app/api/competitions/[id]/bulk-similarity/route.ts","utf8");
  assert.match(route,/body\.action==="mark_negative"/);
  assert.match(route,/requirePermission\(request,"final_judgement"\)/);
  assert.match(route,/body\.reason\.trim\(\)\.length>1000/);
  const db=readFileSync("app/lib/workflow-db.ts","utf8");
  const transition=db.slice(db.indexOf("export async function rejectAcceptedApplicationForSimilarity"));
  assert.match(transition,/current\.outcome !== "accepted"/);
  assert.match(transition,/current\.decisions_locked === 1/);
  assert.match(transition,/similarityDecision:/);
  assert.match(transition,/markSimilarityResultsStale/);
});
