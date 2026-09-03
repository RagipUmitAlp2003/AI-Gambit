/**
 * DÖRT AŞAMALI ÇIKARIM REGRESYON TESTLERİ
 *
 * Şartname çıkarımı üç aşamaya (dil/şablon, başlık/içerik, kategori)
 * daraltılmıştı; ürün kararıyla dördüncü aşama (criteria_evidence) geri geldi:
 * katılımcının PDF raporundan METİNSEL veya SAYISAL olarak denetlenebilen
 * teknik tasarım kuralları. Yarışma günü performansı, saha, video, portal,
 * puan/ceza ve idari kurallar hiçbir aşamada kriter değildir.
 *
 * Buradaki testler üç katmanı birlikte kilitler:
 *   - aday seçici (selectCriteriaCandidates) teknik kuralı adaya alır,
 *   - sunucu kapısı (normalizeExtraction) yalnızca PDF'den doğrulanmış kaynak
 *     metnine bakar; modelin yazdığı ad/açıklama kapıyı açamaz,
 *   - model yanlış aşama etiketi verse de kapsam dışı kural profile girmez.
 *
 * Canlı model çağrısı YAPILMAZ. Gerçek belge kontrolleri yalnızca yapı çıkarımı
 * ve aday seçimi üzerinden çalışır; belge okunamıyorsa test atlanır.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CANDIDATE_SELECTOR_VERSION, selectCriteriaCandidates } from "../app/lib/criteria-candidates.ts";
import { DICTIONARY_VERSION } from "../app/lib/criteria-dictionary.ts";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_STAGE_IDS,
  normalizeExtraction,
} from "../app/lib/criteria-extraction.ts";
import { normalizeForSearch } from "../app/lib/turkish-text.ts";
import type { PdfStructureBlock } from "../app/lib/pdf-structure.ts";

const CELIKKUBBE = "public/samples/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf";
const IDA = "output/pdf/official/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf";

function block(
  sourceId: string,
  originalText: string,
  pageNumber = 2,
  overrides: Partial<PdfStructureBlock> = {},
): PdfStructureBlock {
  return {
    sourceId,
    pdfHash: "a".repeat(64),
    pdfVersion: "a".repeat(16),
    pageNumber,
    sectionTitle: "Sistem Gereksinimleri",
    subsectionTitle: "",
    clauseNumber: null,
    blockType: "LIST_ITEM",
    originalText,
    normalizedText: normalizeForSearch(originalText),
    approximatePosition: { top: 700, left: 60, lineStart: 1, lineEnd: 1 },
    ...overrides,
  };
}

type RawDecision = Record<string, unknown>;

/** Modelin KRITER kararı; alıntı varsayılan olarak bloğun tamamıdır. */
function decision(source: PdfStructureBlock, overrides: RawDecision = {}): RawDecision {
  return {
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Şartname kuralı",
    name: "Kural",
    stage: "criteria_evidence",
    required: true,
    description: "Kural raporda denetlenir.",
    controlType: "KANIT_KONTROLU",
    verifiability: "PDF_DENETLENEBILIR",
    sourcePage: source.pageNumber,
    sourceText: source.originalText,
    ...overrides,
  };
}

function run(blocks: PdfStructureBlock[], decisions: RawDecision[]) {
  return normalizeExtraction(
    { documentProfile: {}, decisions } as never,
    20,
    blocks,
    new Set(blocks.map((item) => item.sourceId)),
  );
}

function readPdf(path: string): ArrayBuffer | null {
  try {
    const file = readFileSync(path);
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * Sürüm ve aşama sözleşmesi
 * ------------------------------------------------------------------------- */

test("dört aşama ve sürüm etiketleri: eski üç aşamalı önbellek yeniden kullanılmaz", () => {
  assert.deepEqual([...EXTRACTION_STAGE_IDS], ["language_template", "headings_content", "category_similarity", "criteria_evidence"]);
  assert.equal(EXTRACTION_PROMPT_VERSION, "v36-four-stages-pdf-verifiable-technical");
  assert.equal(CANDIDATE_SELECTOR_VERSION, "candidate-selector-v2-technical-restored");
  // Sözlük içeriği (video çekimleri, yarışma zamanı, olumsuz gelecek zaman,
  // uçuş/atış/sürüş daraltması) değişti; sürüm de değişti ki eski önbellek
  // anahtarı (R2 + D1 cacheContext) yeniden kullanılmasın.
  assert.equal(DICTIONARY_VERSION, "sozluk-v6-four-stages-scope-gates");
});

/* ------------------------------------------------------------------------- *
 * 1–3 · language_template
 * ------------------------------------------------------------------------- */

test("1) Türkçe rapor dili kuralı aday seçilir ve language_template kriteri olur", () => {
  const source = block("SAYFA-02-BLOK-001", "Rapor Türkçe hazırlanmalıdır.");
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("LANGUAGE_TEMPLATE_TERM"));

  const result = run([source], [decision(source, {
    name: "Rapor Dili", stage: "language_template", description: "Rapor Türkçe hazırlanmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "language_template");
  assert.equal(result.criteria[0].sourceId, source.sourceId);
});

test("2) sayfa sınırı language_template kriteri olur", () => {
  const source = block("SAYFA-02-BLOK-002", "Rapor en fazla 20 sayfa olmalıdır.");
  assert.equal(selectCriteriaCandidates([source]).candidates.length, 1);
  const result = run([source], [decision(source, {
    name: "Rapor Sayfa Sınırı", stage: "language_template", description: "Rapor en fazla 20 sayfa olmalıdır.",
    sourceText: "en fazla 20 sayfa olmalıdır",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "language_template");
});

test("3) font/punto, A4 ve kenar boşluğu aynı cümleden ayrı language_template kriterleri olur", () => {
  const source = block(
    "SAYFA-02-BLOK-003",
    "Rapor A4 sayfa düzeninde, 12 punto Times New Roman yazı tipiyle ve 2,5 cm kenar boşluğuyla hazırlanmalıdır.",
  );
  assert.equal(selectCriteriaCandidates([source]).candidates.length, 1);
  const result = run([source], [
    decision(source, { name: "Sayfa Düzeni A4", stage: "language_template", description: "Rapor A4 sayfa düzeninde olmalıdır.", sourceText: "A4 sayfa düzeninde" }),
    decision(source, { name: "Yazı Tipi ve Punto", stage: "language_template", description: "12 punto Times New Roman kullanılmalıdır.", sourceText: "12 punto Times New Roman yazı tipiyle" }),
    decision(source, { name: "Kenar Boşluğu", stage: "language_template", description: "Kenar boşluğu 2,5 cm olmalıdır.", sourceText: "2,5 cm kenar boşluğuyla" }),
  ]);
  assert.deepEqual(result.criteria.map((item) => item.name), ["Sayfa Düzeni A4", "Yazı Tipi ve Punto", "Kenar Boşluğu"]);
  assert.ok(result.criteria.every((item) => item.stage === "language_template"));
  assert.equal(result.stats.duplicateCriteria, 0);
});

/* ------------------------------------------------------------------------- *
 * 4–8 · headings_content
 * ------------------------------------------------------------------------- */

test("4) çok satırlı zorunlu başlık listesinin bütün maddeleri ayrı headings_content kriteri olur", () => {
  const blocks = [
    block("SAYFA-04-BLOK-001", "Rapor aşağıdaki bölümleri içermelidir:", 4),
    block("SAYFA-04-BLOK-002", "Mekanik Tasarım", 4),
    block("SAYFA-04-BLOK-003", "Elektronik Tasarım", 4),
    block("SAYFA-04-BLOK-004", "Yazılım Mimarisi", 4),
    block("SAYFA-04-BLOK-005", "Test ve Doğrulama Sonuçları", 4),
  ];
  const selection = selectCriteriaCandidates(blocks);
  for (const item of blocks.slice(1)) {
    assert.ok(selection.candidates.some((candidate) => candidate.block.sourceId === item.sourceId), `${item.originalText} aday olmalıdır.`);
  }
  const result = run(blocks, blocks.slice(1).map((item) => decision(item, {
    name: `${item.originalText} Başlığı`, stage: "headings_content", controlType: "BIREBIR_BASLIK",
    description: `Raporda ${item.originalText} bölümü bulunmalıdır.`,
  })));
  assert.equal(result.criteria.length, 4);
  assert.ok(result.criteria.every((item) => item.stage === "headings_content"));
  assert.equal(new Set(result.criteria.map((item) => item.name)).size, 4);
});

test("5) içindekiler tablosundaki satır zorunlu başlık sanılmaz", () => {
  const blocks = [
    block("SAYFA-02-BLOK-001", "İÇİNDEKİLER", 2, { blockType: "HEADING" }),
    block("SAYFA-02-MADDE-1", "1. Giriş 3", 2, { blockType: "NUMBERED_CLAUSE", clauseNumber: "1" }),
    block("SAYFA-02-MADDE-2", "2. Mekanik Tasarım 5", 2, { blockType: "NUMBERED_CLAUSE", clauseNumber: "2" }),
  ];
  const result = run(blocks, [decision(blocks[2], {
    name: "Mekanik Tasarım Başlığı", stage: "headings_content", controlType: "BIREBIR_BASLIK",
    description: "Raporda Mekanik Tasarım bölümü bulunmalıdır.",
  })]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 1);
});

test("6) şartnamenin kendi bölüm başlığı rapor başlığı sanılmaz", () => {
  const source = block("SAYFA-03-MADDE-3-1", "3.1 Teknik Yeterlilik Raporu", 3, { blockType: "NUMBERED_CLAUSE", clauseNumber: "3.1" });
  // Aday seçilir (modele gider); kapsam kararını sunucu kapısı verir.
  assert.equal(selectCriteriaCandidates([source]).candidates.length, 1);
  const result = run([source], [decision(source, {
    name: "Teknik Yeterlilik Raporu Başlığı", stage: "headings_content", controlType: "BIREBIR_BASLIK",
    description: "Raporda Teknik Yeterlilik Raporu başlığı bulunmalıdır.",
  })]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 1);
});

test("7) tavsiye edilen doküman/içerik kriter yapılmaz", () => {
  const source = block("SAYFA-05-BLOK-001", "Takımların raporda bir risk analizi tablosu sunması tavsiye edilir.", 5);
  const result = run([source], [
    decision(source, { name: "Risk Analizi Tablosu", stage: "headings_content", controlType: "ICERIK_VARLIGI", required: false, description: "Raporda risk analizi tablosu bulunmalıdır." }),
    decision(source, { name: "Risk Analizi Kanıtı", stage: "criteria_evidence", required: false, description: "Risk analizi tablosu raporda gösterilmelidir." }),
  ]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 2);
});

test("8) \"Motor seçimi raporda açıklanmalıdır\" headings_content kriteri olur", () => {
  const source = block("SAYFA-06-BLOK-001", "Motor seçimi ve güç hesabı raporda açıklanmalıdır.", 6);
  // Aday seçimi bağlayıcı kiple yapılır; aşama kararı (rapor içeriği) LLM'e ve
  // sunucunun headings_content kapısına (rapor bağlamı + istenen içerik) aittir.
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("OBLIGATION_TERM"));
  const result = run([source], [decision(source, {
    name: "Motor Seçimi Açıklaması", stage: "headings_content", controlType: "ICERIK_VARLIGI",
    description: "Motor seçimi ve güç hesabı raporda açıklanmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "headings_content");
  assert.equal(result.criteria[0].controlType, "ICERIK_VARLIGI");
});

/* ------------------------------------------------------------------------- *
 * 9–12 · criteria_evidence ve mutlak sınırlar
 * ------------------------------------------------------------------------- */

test("9) \"Motor gücü en fazla 5 kW olmalıdır\" aday seçilir ve criteria_evidence KRITER olarak kalır", () => {
  const source = block("SAYFA-07-BLOK-001", "Motor gücü en fazla 5 kW olmalıdır.", 7);
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1, "Teknik limit adaya alınmalıdır.");
  for (const signal of ["TECHNICAL_TERM", "NUMBER_UNIT_PATTERN", "MIN_MAX_PATTERN", "OBLIGATION_TERM"]) {
    assert.ok(selection.candidates[0].signals.includes(signal as never), `${signal} sinyali bulunmalıdır.`);
  }
  const result = run([source], [decision(source, {
    name: "Motor Gücü Sınırı", description: "Motor gücü en fazla 5 kW olmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "criteria_evidence");
  assert.equal(result.criteria[0].controlType, "KANIT_KONTROLU");
  assert.equal(result.criteria[0].verifiability, "PDF_DENETLENEBILIR");
  assert.equal(result.criteria[0].required, true);
  assert.equal(result.stats.excludedCandidates, 0);
});

test("10) \"Araç 50 kg'dan ağır olmamalıdır\" criteria_evidence KRITER olur; kontrol türü KANIT_KONTROLU'na çözülür", () => {
  const source = block("SAYFA-07-BLOK-002", "Araç 50 kg'dan ağır olmamalıdır.", 7);
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("PROHIBITION_TERM"));
  // Model aşamayla uyumsuz kontrol türü yazsa bile criteria_evidence KANIT_KONTROLU'dur.
  const result = run([source], [decision(source, {
    name: "Araç Ağırlık Sınırı", description: "Araç 50 kg'dan ağır olmamalıdır.", controlType: "ICERIK_VARLIGI",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "criteria_evidence");
  assert.equal(result.criteria[0].controlType, "KANIT_KONTROLU");
});

test("11) yarışma günü / parkur kuralı model KRITER dese de KAPSAM_DISI kalır", () => {
  const blocks = [
    block("SAYFA-08-BLOK-001", "Takım yarışma günü parkuru üç dakikada tamamlamalıdır.", 8),
    block("SAYFA-08-BLOK-002", "Araç parkurda en az 2 m/s hızla ilerlemelidir.", 8),
  ];
  // Aday seçimi bu ifadeleri silmez; kapsam kararı sunucu kapısındadır.
  assert.equal(selectCriteriaCandidates(blocks).candidates.length, 2);
  const result = run(blocks, [
    decision(blocks[0], { name: "Parkur Süresi", description: "Parkur üç dakikada tamamlanmalıdır." }),
    decision(blocks[1], { name: "Parkur Hızı", description: "Araç parkurda en az 2 m/s hızla ilerlemelidir." }),
  ]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 2);
  assert.ok(result.warnings.some((warning) => warning.includes("katılımcı PDF'inden değerlendirilemediği")));
});

test("12) video ve portal kuralı hiçbir aşamada kriter olmaz", () => {
  const source = block("SAYFA-09-BLOK-001", "Tanıtım videosu en fazla 2 dakika olmalı ve KYS portalına yüklenmelidir.", 9);
  const result = run([source], [
    decision(source, { name: "Video Süresi", description: "Tanıtım videosu en fazla 2 dakika olmalıdır." }),
    decision(source, { name: "Video Teslimi", stage: "language_template", description: "Video KYS portalına yüklenmelidir." }),
  ]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 2);
});

/* ------------------------------------------------------------------------- *
 * 13–14 · category_similarity
 * ------------------------------------------------------------------------- */

test("13) somut yarışma kapsamı category_similarity kriteri olur", () => {
  const source = block("SAYFA-01-BLOK-004", "Yarışma kapsamı, tarımda otonom yabancı ot tespiti çözümlerine yönelik projelerle sınırlıdır.", 1);
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].signals.includes("CATEGORY_TERM"));
  const result = run([source], [decision(source, {
    name: "Yarışma Konu Kapsamı", stage: "category_similarity", controlType: "ANLAMSAL_UYGUNLUK", required: false,
    description: "Proje tarımda otonom yabancı ot tespitine yönelik olmalıdır.",
  })]);
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].stage, "category_similarity");
  assert.equal(result.criteria[0].controlType, "ANLAMSAL_UYGUNLUK");
});

test("14) tanıtım ve tarihçe metni kategori kriteri olmaz", () => {
  const source = block("SAYFA-01-BLOK-002", "TEKNOFEST 2018'den bu yana her yıl düzenlenen, Türkiye'nin en büyük teknoloji festivalidir.", 1);
  assert.equal(selectCriteriaCandidates([source]).candidates.length, 0);
  const result = run([source], [decision(source, {
    name: "TEKNOFEST Tanıtımı", stage: "category_similarity", controlType: "ANLAMSAL_UYGUNLUK", required: false,
    description: "Proje TEKNOFEST kapsamında olmalıdır.",
  })]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 1);
});

/* ------------------------------------------------------------------------- *
 * 15 · LLM aşama etiketini yanlış verirse
 * ------------------------------------------------------------------------- */

test("15) yanlış aşama etiketi sızdırmaz: teknik limit headings_content/language_template kapısından, parkur kuralı criteria_evidence kapısından geçemez", () => {
  const limit = block("SAYFA-07-BLOK-003", "Motor gücü en fazla 5 kW olmalıdır.", 7);
  const parkur = block("SAYFA-08-BLOK-003", "Takım yarışma günü parkuru üç dakikada tamamlamalıdır.", 8);
  const design = block("SAYFA-08-BLOK-004", "Sistem 1080p kamera akışını gerçek zamanlı işleyebilmelidir.", 8);
  const result = run([limit, parkur, design], [
    decision(limit, { name: "Motor Gücü Başlığı", stage: "headings_content", controlType: "ICERIK_VARLIGI", description: "Motor gücü en fazla 5 kW olmalıdır." }),
    decision(limit, { name: "Motor Gücü Biçimi", stage: "language_template", description: "Motor gücü en fazla 5 kW olmalıdır." }),
    decision(parkur, { name: "Parkur Süresi", stage: "criteria_evidence", description: "Parkur üç dakikada tamamlanmalıdır." }),
    decision(design, { name: "Görüntü İşleme Biçimi", stage: "language_template", description: "1080p akış gerçek zamanlı işlenmelidir." }),
    decision(design, { name: "Görüntü İşleme Yeteneği", stage: "criteria_evidence", description: "Sistem 1080p kamera akışını gerçek zamanlı işlemelidir." }),
  ]);
  assert.deepEqual(result.criteria.map((item) => [item.name, item.stage]), [["Görüntü İşleme Yeteneği", "criteria_evidence"]]);
  assert.equal(result.stats.excludedCandidates, 4);
});

/* ------------------------------------------------------------------------- *
 * Ek kapılar: bilinmeyen aşama, denetlenebilirlik, idari kurallar, olumsuzlama
 * ------------------------------------------------------------------------- */

test("bilinmeyen aşama ve PDF dışı denetlenebilirlik criteria_evidence'a düşmez; eski criteria dizisi geriye uyumlu kalır", () => {
  const source = block("SAYFA-07-BLOK-004", "Motor gücü en fazla 5 kW olmalıdır.", 7);
  const modern = run([source], [
    decision(source, { name: "Bilinmeyen Aşama", stage: "teknik_kural", description: "Motor gücü en fazla 5 kW olmalıdır." }),
    decision(source, { name: "Harici Kanıt", verifiability: "HARICI_KANIT_GEREKLI", description: "Motor gücü en fazla 5 kW olmalıdır." }),
    decision(source, { name: "Hakem Kararı", verifiability: "HAKEM_KONTROLU_GEREKLI", description: "Motor gücü en fazla 5 kW olmalıdır." }),
  ]);
  assert.equal(modern.criteria.length, 0);
  assert.equal(modern.stats.excludedCandidates, 3);

  // Eski (criteria dizisi) akış: aşaması bilinmeyen kayıt geriye uyumlu varsayılanla yüklenir.
  const legacy = normalizeExtraction({ criteria: [{
    name: "Eski Teknik Kural", stage: "bilinmeyen", required: true,
    description: "Motor gücü en fazla 5 kW olmalıdır.", sourcePage: 1, sourceText: "Motor gücü en fazla 5 kW olmalıdır.",
  }] } as never, 3);
  assert.equal(legacy.criteria.length, 1);
  assert.equal(legacy.criteria[0].stage, "criteria_evidence");
  assert.equal(legacy.criteria[0].controlType, "KANIT_KONTROLU");
});

test("idari kurallar ve puan/ceza criteria_evidence olarak sızmaz", () => {
  const blocks = [
    block("SAYFA-03-BLOK-001", "Takım en az üç üyeden oluşmalıdır.", 3),
    block("SAYFA-03-BLOK-002", "Her takımın bir akademik danışmanı bulunmalıdır.", 3),
    block("SAYFA-03-BLOK-003", "Takım üyeleri 18 yaşından büyük olmalıdır.", 3),
    block("SAYFA-03-BLOK-004", "Başvuru işlemi KYS üzerinden son başvuru tarihine kadar tamamlanmalıdır.", 3),
    block("SAYFA-03-BLOK-005", "60 puanın altında kalan takım elenir.", 3),
    block("SAYFA-03-BLOK-006", "Sınır ihlali durumunda 10 ceza puanı uygulanır.", 3),
  ];
  const result = run(blocks, blocks.map((item, index) => decision(item, { name: `İdari Kural ${index + 1}`, description: item.originalText })));
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, blocks.length);
});

test("bağlayıcı sinyal hem blok metninde hem doğrulanmış alıntıda aranır: olumsuzlanmış zorunluluk ve betimleyici cümle kriter olmaz", () => {
  const negated = block("SAYFA-09-BLOK-002", "Yedek batarya bulundurulması zorunlu değildir.", 9);
  const paragraph = block(
    "SAYFA-09-BLOK-003",
    "Yarışmacı takımlar tasarladıkları hedef algılama sistemini kullanarak hedefleri tespit edeceklerdir. Tespit edilen hedeflerin imha edilmesi gerekmektedir.",
    9,
  );
  const result = run([negated, paragraph], [
    // Alıntı olumsuzlamayı dışarıda bırakıyor; blok metni onu görür.
    decision(negated, { name: "Yedek Batarya", description: "Yedek batarya bulundurulmalıdır.", sourceText: "Yedek batarya bulundurulması zorunlu" }),
    // Paragrafın bağlayıcı cümlesi, alıntılanan betimleyici cümleye zorunluluk ödünç veremez.
    decision(paragraph, {
      name: "Hedef Algılama Sistemi", description: "Hedef algılama sistemi tasarlanmalıdır.",
      sourceText: "Yarışmacı takımlar tasarladıkları hedef algılama sistemini kullanarak hedefleri tespit edeceklerdir.",
    }),
  ]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 2);
});

test("criteria_evidence kapısı modelin adına/açıklamasına değil kaynak metnine bakar", () => {
  const descriptive = block("SAYFA-09-BLOK-004", "Sistem hedef tespiti için bir kamera kullanır.", 9);
  // Model ad ve açıklamada "en az 1080p zorunludur" uydursa da kaynakta bağlayıcı kural yoktur.
  const result = run([descriptive], [decision(descriptive, {
    name: "Kamera Çözünürlüğü En Az 1080p Zorunludur",
    description: "Kamera çözünürlüğü en az 1080p olmalıdır; bu zorunludur.",
  })]);
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 1);
});

/* ------------------------------------------------------------------------- *
 * Kapsam sızıntıları ve teknik geri çağırma (doğrulayıcı bulguları)
 *
 * Her cümle modelin KRITER / criteria_evidence / PDF_DENETLENEBILIR kararı ve
 * bloğun tamamı alıntısıyla verilir; sızmaması gerekenler 0 kriter üretir.
 * ------------------------------------------------------------------------- */

/** Her cümleyi ayrı blok + KRITER kararı olarak kapıdan geçirir. */
function gateEach(sentences: readonly string[], overrides: RawDecision = {}, page = 20) {
  const blocks = sentences.map((item, index) => block(`SAYFA-${page}-BLOK-${String(index + 1).padStart(3, "0")}`, item, page));
  return run(blocks, blocks.map((item, index) => decision(item, { name: `Kural ${index + 1}`, description: item.originalText, ...overrides })));
}

/** Giriş bloğu + aday bloğu (aynı sayfa); yalnızca aday için karar verilir. */
function gateWithNeighbour(intro: string, sentence: string, overrides: RawDecision = {}) {
  const blocks = [block("SAYFA-21-BLOK-001", intro, 21), block("SAYFA-21-BLOK-002", sentence, 21)];
  return run(blocks, [decision(blocks[1], { name: "Kural", description: sentence, ...overrides })]);
}

test("video çekimleri (videoda / videosunda / videonun) hiçbir aşamada kriter olmaz; görüntü işleme yeteneği kalır", () => {
  const leaks = gateEach([
    "• Videonun çözünürlüğü en az 720p, toplam süresi ise en az 2 dakika, en fazla 5 dakika olmalıdır.",
    "Yetenekler yukarıda belirtildiği sıra ile eksiksiz gösterilmelidir. Videonun ilgili kısmında kaç numaralı yeteneğin gösterildiği belirtilmelidir.",
    "Videoda aracın tüm fonksiyonları gösterilmelidir.",
    "Görev videosunda aracın kalkışı ve inişi kesintisiz gösterilmelidir.",
    "Videonun süresi 5 dakikayı aşmamalıdır.",
  ]);
  assert.equal(leaks.criteria.length, 0);
  assert.equal(leaks.stats.excludedCandidates, 5);
  // Alt alıntı da kurtaramaz: kapı bloğun kendi metnine bakar.
  const sub = block("SAYFA-20-BLOK-009", "• Videonun çözünürlüğü en az 720p, toplam süresi ise en az 2 dakika, en fazla 5 dakika olmalıdır.", 20);
  assert.equal(run([sub], [decision(sub, { sourceText: "toplam süresi ise en az 2 dakika, en fazla 5 dakika olmalıdır" })]).criteria.length, 0);
  const design = gateEach(["Sistem 1080p kamera akışını gerçek zamanlı işleyebilmelidir."], { name: "Video İşleme Yeteneği" });
  assert.equal(design.criteria.length, 1);
});

test("yarışma zamanı sözcükleri (boyunca / anında / yarışmada / başladıktan, müsabaka, görev sırasında, isabet, canlı test, etap, kalkış-iniş noktası, yarışma alanına) sızmaz", () => {
  const leaks = gateEach([
    "Yarışma başladıktan sonra bakım gerektiren bir durum oluştuğunda takım liderinin talebi üzerine yarışma süresi durdurulabilir. 3 aşama için kullanılacak toplam bakım süresi 10 dakikadır.",
    "Yarışma boyunca araçta yakıt ikmali yapılamaz.",
    "Yarışma anında araç en az 3 hedefi vurmalıdır.",
    "Yarışmada araç en az 3 hedefi vurmalıdır.",
    "Müsabaka sırasında araca müdahale edilemez.",
    "Görev sırasında batarya değişimine izin verilmez.",
    "Görev başarı oranı en az %80 olmalıdır.",
    "Sistem hedeflere en az %70 isabet oranıyla ateş etmelidir.",
    "Sistem canlı testte en az 3 hedefi vurmalıdır.",
    "Canlı ölçümde aracın hızı en az 5 m/s olmalıdır.",
    "Final etabında araç en az 3 tur atmalıdır.",
    "Etap süresi 15 dakikayı geçemez.",
    "Görev uçuşunda araç en az 30 m irtifaya çıkmalıdır.",
    "Araç kalkış noktasından iniş noktasına en fazla 5 dakikada ulaşmalıdır.",
    "Yarışma alanına giriş 08:00'de yapılmalıdır.",
    "Yarışma sonrasında araçlar yarışma alanından 24 saat içinde alınmalıdır.",
    "Yarışma bitiminde pit alanı temiz bırakılmalıdır.",
    "Yarışma başlamadan önce yarışmacı takımlara sistemlerinin montajı ve diğer hazırlıklarını tamamlamaları için 30 dakika süre verilecektir.",
  ]);
  assert.equal(leaks.criteria.length, 0);
  assert.equal(leaks.stats.excludedCandidates, 18);
  // "Yarışma ortamında yer alacak sistemin boyutu" bir tasarım limitidir ve kalır.
  const kept = gateEach(["• Yarışma ortamında yer alacak Hava Savunma Sistemi'nin her boyutu (E x B x D) 100cm' den küçük olacaktır."], { name: "Boyut Sınırı" });
  assert.equal(kept.criteria.length, 1);
});

test("kişi/öğrenci sayısı, üye değişikliği, pasaport, e-posta, danışman sayısı ve başvuru sistemi idari kural olarak elenir", () => {
  const leaks = gateEach([
    "• Takımlaren az 3 en fazla 15kişiden oluşmalıdır. (Bu sayıya danışman dahil değildir.)",
    "Her takımda en fazla 10 öğrenci bulunabilir.",
    "Takımlar en fazla 10 kişiden oluşabilir.",
    "Takımlar en az 2 kişiden oluşmalıdır.",
    "Bir kişi yalnızca bir takımda yer alabilir.",
    "Takım üyeleri yarışma süresince değiştirilemez.",
    "Yabancı uyruklu katılımcılar pasaport fotokopisi sunmalıdır.",
    "Her takım için en fazla 2 danışman kaydedilebilir.",
    "Takımlar e-posta adreslerini güncel tutmak zorundadır.",
    "Sorular yalnızca yarışma e-posta adresi üzerinden iletilmelidir.",
    "Takım iletişim bilgilerindeki değişiklikler 3 gün içinde bildirilmelidir.",
    "Rapor teknofest.org adresindeki başvuru sistemine yüklenmelidir.",
  ]);
  assert.equal(leaks.criteria.length, 0);
  assert.equal(leaks.stats.excludedCandidates, 12);
});

test("hakem/jüri/kurul talimatı, sunum süresi ve slaytı, brifing kuralları sızmaz; 'hakem heyetinin değerlendirmesi' geçen acil durdurma kuralı kalır", () => {
  const leaks = gateEach([
    "Takımlar hakem talimatlarına uymak zorundadır.",
    "Hakemlerin talimatlarına uyulmalıdır.",
    "Jürinin belirlediği saatte sistem çalışır durumda olmalıdır.",
    "Danışma Kurulu gerekli gördüğünde şartnamede değişiklik yapabilir.",
    "Sunum en fazla 10 dakika sürmelidir.",
    "Sunum 10 dakikayı geçmemelidir.",
    "Brifingde takım kaptanı hazır bulunmalıdır.",
    "Teknik sunumda jüri sorularına cevap verilmelidir.",
    "Takımlar yarışma günü raporlarını jüriye 10 dakikalık sunumla sunmalıdır.",
    "Sunum dosyası en fazla 20 slayt olmalıdır.",
  ]);
  assert.equal(leaks.criteria.length, 0);
  assert.equal(leaks.stats.excludedCandidates, 10);
  // "kurulum" teknik sözcüktür ("kurul" değildir); "hakem heyetinin
  // değerlendirmesi" karar/talimat değildir.
  const installation = gateEach(["Sistem kurulum talimatları raporda belirtilmelidir."], { stage: "headings_content", controlType: "ICERIK_VARLIGI" });
  assert.equal(installation.criteria.length, 1, "Kurulum talimatı rapor içeriği olarak kalmalıdır.");
  const emergency = gateEach(["Araçta acil durumda sistemi durduran bir buton bulunmalı; hakem heyetinin değerlendirmesi sonrasında onarım yapılabilir."]);
  assert.equal(emergency.criteria.length, 1);
});

test("'raporda belirtilen' ortacı rapor isteği sayılmaz ve saha kuralını kurtarmaz; 'raporda belgelenmelidir' rapor isteğidir", () => {
  const leaks = gateEach([
    "Yarışma günü parkurda gösterilecek performans, raporda belirtilen tasarım değerleriyle tutarlı olmalıdır.",
    "Araç yarışma günü, raporda belirtilen azami hızla parkuru tamamlamalıdır.",
  ]);
  assert.equal(leaks.criteria.length, 0);
  const kept = gateEach(["Uçuş testi sonuçları raporda belgelenmelidir."], { name: "Uçuş Testi Belgesi" });
  assert.equal(kept.criteria.length, 1, "Raporda belgelenmesi zorunlu test kalmalıdır.");
});

test("yanlış aşama etiketi bağlam penceresiyle de sızmaz: komşu sayfa/bölüm/amaç cümlesi kapsam dışı ya da teknik kuralı başka aşamaya taşımaz", () => {
  const pageRule = "Rapor en fazla 20 sayfa olmalıdır.";
  for (const sentence of [
    "Uçuş süresi en az 10 dakika olmalıdır.",
    "Takımlar en fazla 10 kişiden oluşabilir.",
    "Sunum en fazla 10 dakika sürmelidir.",
    "Motor gücü en fazla 5 kW olmalıdır.",
  ]) {
    assert.equal(gateWithNeighbour(pageRule, sentence, { stage: "language_template" }).criteria.length, 0, `language_template: ${sentence}`);
  }
  const headingList = "Rapor aşağıdaki bölümleri içermelidir:";
  for (const sentence of [
    "Görev başarı oranı en az %80 olmalıdır.",
    "Uçuş süresi en az 10 dakika olmalıdır.",
    "Videonun süresi 5 dakikayı aşmamalıdır.",
    "Takımlar en fazla 10 kişiden oluşabilir.",
    "Motor gücü en fazla 5 kW olmalıdır.",
  ]) {
    assert.equal(gateWithNeighbour(headingList, sentence, { stage: "headings_content", controlType: "ICERIK_VARLIGI" }).criteria.length, 0, `headings_content: ${sentence}`);
  }
  const scopeIntro = "Yarışmanın amacı ve kapsamı aşağıda verilmiştir.";
  for (const sentence of [
    "Görev başarı oranı en az %80 olmalıdır.",
    "Sistem hedeflere en az %70 isabet oranıyla ateş etmelidir.",
    "Uçuş süresi en az 10 dakika olmalıdır.",
    "Takımlar en fazla 10 kişiden oluşabilir.",
  ]) {
    assert.equal(gateWithNeighbour(scopeIntro, sentence, { stage: "category_similarity", controlType: "ANLAMSAL_UYGUNLUK", required: false }).criteria.length, 0, `category_similarity: ${sentence}`);
  }
  // Zorunlu başlık listesindeki etiketler kural değil addır: fiziksel ya da
  // idari sözcük taşısa da (Uçuş Testleri, Takım Organizasyonu) kalır; rapor
  // içeriği isteyen takım bilgisi kuralı da rapor içeriğidir.
  for (const label of ["Uçuş Testleri", "Takım Organizasyonu", "Takım üyelerinin görev dağılımı raporda belirtilmelidir."]) {
    const result = gateWithNeighbour(headingList, label, { stage: "headings_content", controlType: "ICERIK_VARLIGI", description: `Raporda ${label} bölümü bulunmalıdır.` });
    assert.equal(result.criteria.length, 1, `headings_content kalmalı: ${label}`);
  }
});

test("liste girişi video/parkur ise alt maddeler teknik kriter olmaz; iki nokta ile bitmeyen komşu meşru limiti dışlayamaz", () => {
  assert.equal(gateWithNeighbour("Görev videosunda aşağıdakiler yer almalıdır:", "Araç en az 30 saniye havada kalmalıdır.").criteria.length, 0);
  assert.equal(gateWithNeighbour("Görev videosu aşağıdaki sahneleri içermelidir:", "Aracın kalkışı ve inişi kesintisiz çekilmelidir.").criteria.length, 0);
  assert.equal(gateWithNeighbour("Parkur aşağıdaki bölümlerden oluşur:", "Araç en az 2 m/s hızla ilerlemelidir.").criteria.length, 0);
  assert.equal(gateWithNeighbour("Parkur uzunluğu 200 m'dir.", "Motor gücü en fazla 5 kW olmalıdır.").criteria.length, 1);
  assert.equal(gateWithNeighbour("Aşağıdaki tasarım sınırlarına uyulmalıdır:", "Motor gücü en fazla 5 kW olmalıdır.").criteria.length, 1);
});

test("USB/poster/Excel/ayrı belge teslimi ve ıslak imzalı belge sızmaz", () => {
  const leaks = gateEach([
    "Kaynak kodlar USB bellek ile teslim edilmelidir.",
    "Proje posteri A1 boyutunda basılı olarak teslim edilmelidir.",
    "Kaynak kod deposunun bağlantısı ayrı bir belge olarak gönderilmelidir.",
    "Malzeme listesi Excel dosyası olarak ayrıca teslim edilmelidir.",
    "Araç yarışma alanına kendi taşıma kutusunda getirilmelidir.",
    "Islak imzalı taahhütname rapor ekinde sunulmalıdır.",
  ]);
  assert.equal(leaks.criteria.length, 0);
  assert.equal(leaks.stats.excludedCandidates, 6);
});

test("-mayacak/-meyecek ve 'X olacaktır' tasarım kuralları aday seçilir ve criteria_evidence olarak kalır; betimleyici 'olacaktır' aday olmaz", () => {
  const rules = [
    "Hücresel bağlantı(4G&LTE vb.) sağlayan modemler kullanılamayacaktır.",
    "Aracın ana gövdesi üzerinde keskin noktalar bulunmayacak ve yuvarlatılacaktır.",
    "YKİ'lerde görüntü işleme, sensör işleme ya da otonomi kabiliyeti olmayacaktır.",
    "Haberleşme modüllerinin frekans kanalı seçilebilir olacaktır.",
    "Bataryaların bulunduğu bölüm sızdırmaz olacaktır.",
    "Araçta uzak güç kesme fonksiyonu olacaktır.",
    "İDA ve YKİ arasında kablosuz bağlantı sağlanmış olacaktır.",
  ];
  const blocks = rules.map((item, index) => block(`SAYFA-22-BLOK-${String(index + 1).padStart(3, "0")}`, item, 22));
  const selection = selectCriteriaCandidates(blocks);
  assert.equal(selection.candidates.length, rules.length, "Her tasarım kuralı aday olmalıdır.");
  assert.ok(selection.candidates.slice(0, 3).every((item) => item.signals.includes("PROHIBITION_TERM")));
  assert.ok(selection.candidates.slice(3).every((item) => item.signals.includes("OBLIGATION_TERM")));
  const result = run(blocks, blocks.map((item, index) => decision(item, { name: `Tasarım Kuralı ${index + 1}`, description: item.originalText })));
  assert.equal(result.criteria.length, rules.length);
  // Genel "olacaktır" bağlayıcı sayılmaz: betimleme aday olmaz.
  const descriptive = [
    block("SAYFA-23-BLOK-001", "Hedefler durağan olacaktır.", 23),
    block("SAYFA-23-BLOK-002", "Dost hedef mavi, düşman hedef kırmızı renkli olacaktır.", 23),
  ];
  assert.equal(selectCriteriaCandidates(descriptive).candidates.length, 0);
});

test("uçuş/atış/sürüş teknik ad olarak tasarım kuralını dışlamaz; deneme/test/sırasında bağlamı dışlar", () => {
  const kept = gateEach([
    "• İHA, uçuşu devre dışı bırakmasını sağlayacak uzaktan kumanda sistemine sahip olmalıdır.",
    "Uçuş kontrolcüsü açık kaynak olmalıdır.",
    "Sürüş sistemi elektrikli olmalıdır.",
    "Atış mekanizması yay tahrikli olmalıdır.",
  ]);
  assert.equal(kept.criteria.length, 4);
  const leaks = gateEach([
    "Uçuş denemesi sırasında araç 30 m irtifaya çıkmalıdır.",
    "Uçuş sırasında telemetri bağlantısı kesilmemelidir.",
    "Uçuş testinde araç en az 10 dakika havada kalmalıdır.",
    "Atış sırasında sistem hedefi 5 saniye içinde vurmalıdır.",
  ]);
  assert.equal(leaks.criteria.length, 0);
});

test("organizatörün alanda sağladığı altyapı, yarışma öncesi deneme süresi ve parkur bileşeni sayı satırı teknik kriter olmaz; tasarım sınırı tablosu satırı kalır", () => {
  const leaks = gateEach([
    "• Alan içerisinde 220 VAC enerji tedarik edilecektir. Yarışmacı ekibin sisteminin EMI gereklerini kendisinin sağlaması beklenir.",
    "Yarışma alanından ayrı bir konumda yer kontrol istasyonu masasının konumlandığı kapalı alan olacaktır. Alan içerisinde 220 VAC enerji tedarik edilecektir.",
    "• Yarışma öncesinde her ekibe hareket ve imha çözümlerini denemek için kısa bir süre verilecektir. Bu sürede ilgili ayarlamaları yapmaları beklenecektir.",
  ]);
  assert.equal(leaks.criteria.length, 0);

  const course = [
    block("SAYFA-24-BLOK-001", "Parkur kenar dubaları:", 24),
    block("SAYFA-24-BLOK-002", "• Armut tip", 24),
    block("SAYFA-24-BLOK-003", "• Çap: 30 cm", 24),
    block("SAYFA-24-BLOK-004", "• Yükseklik: 950 mm", 24),
  ];
  const courseResult = run(course, [
    decision(course[2], { name: "Duba Çapı", description: "Çap 30 cm olmalıdır." }),
    decision(course[3], { name: "Duba Yüksekliği", description: "Yükseklik 950 mm olmalıdır." }),
  ]);
  assert.equal(courseResult.criteria.length, 0);

  const delivery = [
    block("SAYFA-25-BLOK-001", "Veriler 3 dosya olacak şekilde teslim edilecektir.", 25),
    block("SAYFA-25-BLOK-002", "▪ Dosya 3: Lokal harita/cost map/engel haritası", 25),
    block("SAYFA-25-BLOK-003", "• En Az 1 Hz", 25),
  ];
  assert.equal(run(delivery, [decision(delivery[2], { name: "Harita Frekansı", description: "En az 1 Hz olmalıdır." })]).criteria.length, 0);

  const limits = [
    block("SAYFA-26-BLOK-001", "Aracın boyut sınırları aşağıdaki gibidir:", 26),
    block("SAYFA-26-BLOK-002", "• Genişlik: en fazla 100 cm", 26),
    block("SAYFA-26-BLOK-003", "• Ağırlık: en fazla 15 kg", 26),
  ];
  const limitResult = run(limits, [
    decision(limits[1], { name: "Genişlik Sınırı", description: "Genişlik en fazla 100 cm olmalıdır." }),
    decision(limits[2], { name: "Ağırlık Sınırı", description: "Ağırlık en fazla 15 kg olmalıdır." }),
  ]);
  assert.equal(limitResult.criteria.length, 2, "Tasarım sınırı tablosu satırları kalmalıdır.");
});

/* ------------------------------------------------------------------------- *
 * Gerçek belgeler (deterministik; LLM yok)
 * ------------------------------------------------------------------------- */

test("Çelikkubbe: boyut (100cm) ve patlayıcı yasağı blokları aday seçilir; video, takım sayısı, yarışma süresi ve alan altyapısı kapıdan geçmez", async (context) => {
  const bytes = readPdf(CELIKKUBBE);
  if (!bytes) { context.skip(`${CELIKKUBBE} bulunamadı`); return; }
  const { extractPdfStructure } = await import("../app/lib/pdf-structure.ts");
  const structure = await extractPdfStructure(bytes);
  const selection = selectCriteriaCandidates(structure.blocks);
  const candidateIds = new Set(selection.candidates.map((item) => item.block.sourceId));
  const find = (pattern: RegExp) => structure.blocks.find((item) => pattern.test(item.originalText));

  const size = structure.blocks.find((item) => item.originalText.includes("100cm"));
  assert.ok(size, "Boyut kuralı bloğu bulunmalıdır.");
  assert.ok(candidateIds.has(size!.sourceId), "Boyut kuralı aday olmalıdır.");

  const explosive = structure.blocks.find((item) => /patlayıcı/i.test(item.originalText) && /yasak/i.test(item.originalText));
  assert.ok(explosive, "Patlayıcı yasağı bloğu bulunmalıdır.");
  assert.ok(candidateIds.has(explosive!.sourceId), "Patlayıcı yasağı aday olmalıdır.");

  const cable = find(/kablolar yırtılma ve elektrik kaçaklarına/);
  const emergency = find(/acil durdurma butonu \(basmalı/);
  const video = find(/Videonun çözünürlüğü/);
  const videoOrder = find(/Videonun ilgili kısmında/);
  const teamSize = find(/15\s?kişiden oluşmalıdır/);
  const maintenance = find(/Yarışma başladıktan sonra bakım/);
  const venuePower = find(/Alan içerisinde 220 VAC/);
  for (const [label, item] of Object.entries({ cable, emergency, video, videoOrder, teamSize, maintenance, venuePower })) {
    assert.ok(item, `${label} bloğu bulunmalıdır.`);
  }
  const ids = new Set([...candidateIds, cable!.sourceId, emergency!.sourceId, video!.sourceId, videoOrder!.sourceId, teamSize!.sourceId, maintenance!.sourceId, venuePower!.sourceId]);

  // Teknik kural adayı olarak sunucu kapısından da geçer; PDF dışı olanlar geçmez.
  const result = normalizeExtraction({ documentProfile: {}, decisions: [
    decision(size!, { name: "Sistem Boyut Sınırı", description: "Sistemin her boyutu 100 cm'den küçük olmalıdır.", sourceText: "100cm" }),
    decision(explosive!, { name: "Patlayıcı Yasağı", description: "Hedef imha çözümü olarak patlayıcı kullanılamaz.", sourceText: "patlayıcı kullanmaları yasaktır" }),
    decision(cable!, { name: "Kablo İzolasyonu", description: "Kablolar elektrik kaçağına karşı izole edilmelidir." }),
    decision(emergency!, { name: "Acil Durdurma Butonu", description: "Sistemde acil durdurma butonu bulunmalıdır.", sourceText: "acil durdurma butonu (basmalı, çevirmeli, manyetik) olması zorunludur" }),
    decision(video!, { name: "Video Çözünürlüğü", description: "Video en az 720p olmalıdır." }),
    decision(videoOrder!, { name: "Video Yetenek Sırası", description: "Yetenekler videoda sırayla gösterilmelidir." }),
    decision(teamSize!, { name: "Takım Büyüklüğü", description: "Takım 3-15 kişiden oluşmalıdır." }),
    decision(maintenance!, { name: "Bakım Süresi", description: "Toplam bakım süresi 10 dakikadır.", sourceText: "Yarışma başladıktan sonra bakım gerektiren bir durum oluştuğunda takım liderinin talebi üzerine yarışma süresi durdurulabilir." }),
    decision(venuePower!, { name: "EMI Gerekleri", description: "Sistem EMI gereklerini sağlamalıdır." }),
  ] } as never, structure.pageCount, structure.blocks, ids);
  // Çıktı sayfa sırasına göre dizilir; ad kümesi karşılaştırılır.
  assert.deepEqual(
    result.criteria.map((item) => item.name).sort(),
    ["Acil Durdurma Butonu", "Kablo İzolasyonu", "Patlayıcı Yasağı", "Sistem Boyut Sınırı"],
  );
  assert.ok(result.criteria.every((item) => item.stage === "criteria_evidence"));
  assert.equal(result.stats.excludedCandidates, 5);
});

test("İDA: teknik terim ve sayı-birim taşıyan aday seçilir; -mayacak kuralları aday olur ve kalır; parkur dubası ve veri teslim satırları kapıdan geçmez", async (context) => {
  const bytes = readPdf(IDA);
  if (!bytes) { context.skip(`${IDA} bulunamadı`); return; }
  const { extractPdfStructure } = await import("../app/lib/pdf-structure.ts");
  const structure = await extractPdfStructure(bytes);
  const selection = selectCriteriaCandidates(structure.blocks);
  const technical = selection.candidates.filter((item) => item.signals.includes("TECHNICAL_TERM") && item.signals.includes("NUMBER_UNIT_PATTERN"));
  assert.ok(technical.length >= 1, "Teknik terim + sayı-birim adayı bulunmalıdır.");
  const candidateIds = new Set(selection.candidates.map((item) => item.block.sourceId));
  const find = (pattern: RegExp) => structure.blocks.find((item) => pattern.test(item.originalText));

  const modem = find(/modemler kullanılamayacaktır/);
  const sharpEdges = find(/keskin noktalar bulunmayacak/);
  const flightKill = find(/uçuşu devre dışı bırakmasını sağlayacak/);
  const sealed = find(/Bataryaların bulunduğu bölüm sızdırmaz olacaktır/);
  for (const [label, item] of Object.entries({ modem, sharpEdges, flightKill, sealed })) {
    assert.ok(item, `${label} bloğu bulunmalıdır.`);
    assert.ok(candidateIds.has(item!.sourceId), `${label} aday olmalıdır.`);
  }
  const buoyRows = structure.blocks.filter((item) => /^•?\s*(?:Çap:\s*30 cm|Yükseklik:\s*950 mm)\s*$/.test(item.originalText.trim()));
  const rateRows = structure.blocks.filter((item) => /^•?\s*En az 1 Hz\s*$/i.test(item.originalText.trim()));
  assert.ok(buoyRows.length >= 2, "Duba ölçü satırları bulunmalıdır.");
  assert.ok(rateRows.length >= 1, "Veri teslim frekansı satırı bulunmalıdır.");
  const outside = [...buoyRows, ...rateRows];
  const ids = new Set([...candidateIds, ...outside.map((item) => item.sourceId)]);

  const result = normalizeExtraction({ documentProfile: {}, decisions: [
    decision(modem!, { name: "Hücresel Modem Yasağı", description: "Hücresel bağlantı sağlayan modem kullanılamaz.", sourceText: "sağlayan modemler kullanılamayacaktır." }),
    decision(sharpEdges!, { name: "Gövde Keskin Nokta Yasağı", description: "Ana gövdede keskin nokta bulunmamalıdır.", sourceText: "keskin noktalar bulunmayacak" }),
    decision(flightKill!, { name: "Uçuşu Durduran Kumanda", description: "İHA uçuşu devre dışı bırakan uzaktan kumandaya sahip olmalıdır.", sourceText: "uçuşu devre dışı bırakmasını sağlayacak uzaktan kumanda sistemine sahip olmalıdır." }),
    decision(sealed!, { name: "Batarya Bölmesi Sızdırmazlığı", description: "Batarya bölmesi sızdırmaz olmalıdır.", sourceText: "Bataryaların bulunduğu bölüm sızdırmaz olacaktır." }),
    ...outside.map((item, index) => decision(item, { name: `Saha Satırı ${index + 1}`, description: item.originalText })),
  ] } as never, structure.pageCount, structure.blocks, ids);
  assert.deepEqual(
    result.criteria.map((item) => item.name).sort(),
    ["Batarya Bölmesi Sızdırmazlığı", "Gövde Keskin Nokta Yasağı", "Hücresel Modem Yasağı", "Uçuşu Durduran Kumanda"],
  );
  assert.equal(result.stats.excludedCandidates, outside.length);
});
