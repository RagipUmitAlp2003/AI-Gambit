import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  UNSELECTED_REVIEW_TEXT_LIMIT,
  selectCriteriaCandidates,
  summarizeUnselectedBlocks,
} from "../app/lib/criteria-candidates.ts";
import { MAX_CRITERIA, normalizeExtraction } from "../app/lib/criteria-extraction.ts";
import { findNumberPatterns, scanText } from "../app/lib/criteria-dictionary.ts";
import { buildStructureFromOcrPages, type PdfStructureBlock } from "../app/lib/pdf-structure.ts";
import { normalizeForSearch, normalizeUnicode } from "../app/lib/turkish-text.ts";

function block(sourceId: string, originalText: string, pageNumber = 2): PdfStructureBlock {
  return {
    sourceId,
    pdfHash: "a".repeat(64),
    pdfVersion: "a".repeat(16),
    pageNumber,
    sectionTitle: "Rapor Kuralları",
    subsectionTitle: "Yazım Biçimi",
    clauseNumber: "3.2",
    blockType: "NUMBERED_CLAUSE",
    originalText,
    normalizedText: normalizeForSearch(originalText),
    approximatePosition: { top: 700, left: 60, lineStart: 1, lineEnd: 1 },
  };
}

test("Türkçe normalizasyonu arama görünümünü düzeltir, özgün alıntıyı değiştirmez", () => {
  const original = "Rapor Türkçe hazır-\nlanmalıdır ve %80 başarı beklenir.";
  const unicode = normalizeUnicode(original);
  assert.match(unicode, /Türkçe/);
  assert.match(normalizeForSearch(unicode), /turkce/);
  assert.equal(original.includes("hazır-\nlanmalıdır"), true);
});

test("merkezî sözlük bağlayıcı, olumsuz ve sayı-birim ifadelerini ayrı kaydeder", () => {
  const positive = scanText("Rapor en fazla 10 sayfa olmalıdır.");
  assert.ok(positive.some((match) => match.entryId === "limit.en-fazla"));
  assert.ok(findNumberPatterns(normalizeForSearch("Rapor en fazla 10 sayfa olmalıdır.")).some((match) => match.kind === "sayfa_adet"));
  const negative = scanText("Bu bölümün hazırlanması zorunlu değildir.");
  assert.ok(negative.some((match) => match.negated));
  assert.ok(scanText("Mimari raporda açıklanacaktır.").some((match) => match.entryId === "obligation.baglayici-gelecek-zaman"));
  assert.ok(scanText("Güvenlik bölümünün raporda yer alması gerekmektedir.").some((match) => match.entryId === "obligation.isim-fiil-gerek"));
  assert.equal(selectCriteriaCandidates([block("SAYFA-01-MADDE-1", "Tasarım yaklaşımı açıklanır.")]).candidates.length, 0);
});

test("aday seçimi fiziksel ve haricî ifadeleri silmez, LLM kapsam kararına taşır", () => {
  // Aday seçimi kapsam kararı değildir: bağlayıcı kip taşıyan fiziksel/saha
  // kuralı da aday olur; sinyalleri (PHYSICAL_STAGE_TERM) modele ve sunucu
  // kapılarına taşınır, kapsam kararı orada verilir.
  const blocks = [
    block("SAYFA-02-MADDE-3-2", "Takım yarışma günü parkur görevini tamamlamalıdır."),
    block("SAYFA-03-MADDE-4-1", "Test sonuçları raporda tablo halinde sunulmalıdır.", 3),
  ];
  const selected = selectCriteriaCandidates(blocks);
  assert.equal(selected.candidates.length, 2);
  assert.equal(selected.unselected.length, 0);
  assert.equal(selected.candidates[0].block.sourceId, "SAYFA-02-MADDE-3-2");
  assert.ok(selected.candidates[0].signals.includes("PHYSICAL_STAGE_TERM"));
  assert.equal(selected.candidates[1].block.sourceId, "SAYFA-03-MADDE-4-1");
  assert.ok(selected.candidates[1].signals.includes("HEADING_CONTENT_TERM"));
});

test("modern LLM sonucu yalnızca mevcut kaynak ve birebir alıntıyla kriter olur", () => {
  const source = block("SAYFA-08-MADDE-3-2", "Ön tasarım raporu Türkçe hazırlanmalı ve en fazla 10 sayfa olmalıdır.", 8);
  const raw = {
    decisions: [
      {
        sourceId: source.sourceId,
        result: "KRITER",
        classificationReason: "Rapor biçim kuralıdır.",
        name: "Rapor Sayfa Sınırı",
        stage: "language_template",
        required: true,
        description: "Rapor en fazla 10 sayfa olmalıdır.",
        controlType: "KANIT_KONTROLU",
        sourcePage: 8,
        sourceText: "en fazla 10 sayfa olmalıdır",
      },
      {
        sourceId: "UYDURMA",
        result: "KRITER",
        classificationReason: "Uydurma.",
        name: "Uydurma",
        stage: "criteria_evidence",
        required: true,
        description: "Uydurma kriter.",
        controlType: "KANIT_KONTROLU",
        sourcePage: 4,
        sourceText: "uydurma alıntı",
      },
    ],
  };
  const result = normalizeExtraction(raw, 8, [source], new Set([source.sourceId]));
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].sourcePage, 8);
  assert.equal(result.criteria[0].sourceId, source.sourceId);
  assert.equal(result.criteria[0].violationOutcome, undefined);
  assert.equal(result.stats.rejectedSources, 1);
  // Tutarlı sayfa bildiren temel senaryoda düzeltme sayacı sıfır kalır.
  assert.equal(result.stats.correctedPages, 0);
});

test("tek kaynak bloğundaki bağımsız kurallar ayrı kriterler olarak korunur", () => {
  const source = block(
    "SAYFA-08-MADDE-3-3",
    "Ön tasarım raporu Türkçe hazırlanmalı ve en fazla 10 sayfa olmalıdır.",
    8,
  );
  const shared = {
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Rapor biçim kuralıdır.",
    stage: "language_template",
    required: true,
    controlType: "KANIT_KONTROLU",
    sourcePage: 8,
  };
  const result = normalizeExtraction({ decisions: [
    {
      ...shared,
      name: "Rapor Dili",
      description: "Rapor Türkçe hazırlanmalıdır.",
      sourceText: "Türkçe hazırlanmalı",
    },
    {
      ...shared,
      name: "Rapor Sayfa Sınırı",
      description: "Rapor en fazla 10 sayfa olmalıdır.",
      sourceText: "en fazla 10 sayfa olmalıdır",
    },
  ] }, 8, [source], new Set([source.sourceId]));

  assert.equal(result.criteria.length, 2);
  assert.equal(result.stats.unansweredCandidates, 0);
  assert.notEqual(result.criteria[0].id, result.criteria[1].id);
});

test("kapsam dışı ve cevapsız adaylar ölçülür; her aday kriter olmak zorunda değildir", () => {
  const first = block("SAYFA-01-MADDE-1-1", "Tanıtım videosu portala yüklenmelidir.", 1);
  const second = block("SAYFA-02-MADDE-2-1", "Rapor Türkçe hazırlanmalıdır.", 2);
  const result = normalizeExtraction({ decisions: [{
    sourceId: first.sourceId,
    result: "KAPSAM_DISI",
    classificationReason: "PDF dışı video yüklemesidir.",
    name: "",
    stage: "criteria_evidence",
    required: false,
    description: "",
    controlType: "KANIT_KONTROLU",
    sourcePage: 1,
    sourceText: "",
  }] }, 2, [first, second], new Set([first.sourceId, second.sourceId]));
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.excludedCandidates, 1);
  assert.equal(result.stats.unansweredCandidates, 1);
  // Sınır aşımı olmayan yolda kesinti sayacı sıfırdır.
  assert.equal(result.stats.droppedCriteria, 0);
});

test("sayfa uyuşmazlığı doğrulanmış kriteri düşürmez; sunucu doğrulamalı sayfa yazılır", () => {
  const source = block("SAYFA-08-MADDE-3-2", "Ön tasarım raporu Türkçe hazırlanmalı ve en fazla 10 sayfa olmalıdır.", 8);
  const result = normalizeExtraction({ decisions: [{
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Rapor biçim kuralıdır.",
    name: "Rapor Sayfa Sınırı",
    stage: "language_template",
    required: true,
    description: "Rapor en fazla 10 sayfa olmalıdır.",
    controlType: "KANIT_KONTROLU",
    // Model sayfayı bir kaydırdı; alıntı yine de bloğun özgün metninde birebir doğrulanıyor.
    sourcePage: 9,
    sourceText: "en fazla 10 sayfa olmalıdır",
  }] }, 9, [source], new Set([source.sourceId]));
  assert.equal(result.criteria.length, 1);
  assert.equal(result.criteria[0].sourcePage, 8);
  assert.equal(result.stats.rejectedSources, 0);
  assert.equal(result.stats.correctedPages, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("sunucu doğrulamalı sayfa kullanıldı")));
});

test("sayfası eksik ya da dizge dönen ama alıntısı doğrulanan karar kurtarılır", () => {
  const source = block("SAYFA-08-MADDE-3-2", "Ön tasarım raporu Türkçe hazırlanmalı ve en fazla 10 sayfa olmalıdır.", 8);
  const shared = {
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Rapor biçim kuralıdır.",
    stage: "language_template",
    required: true,
    controlType: "KANIT_KONTROLU",
  };
  const result = normalizeExtraction({ decisions: [
    { ...shared, name: "Rapor Dili", description: "Rapor Türkçe hazırlanmalıdır.", sourcePage: undefined, sourceText: "Türkçe hazırlanmalı" },
    { ...shared, name: "Rapor Sayfa Sınırı", description: "Rapor en fazla 10 sayfa olmalıdır.", sourcePage: "8", sourceText: "en fazla 10 sayfa olmalıdır" },
  ] }, 8, [source], new Set([source.sourceId]));
  assert.equal(result.criteria.length, 2);
  assert.ok(result.criteria.every((criterion) => criterion.sourcePage === 8));
  assert.equal(result.stats.rejectedSources, 0);
  assert.equal(result.stats.correctedPages, 2);
});

test("alıntı doğrulanmazsa sayfa doğru olsa da karar reddedilir", () => {
  const source = block("SAYFA-08-MADDE-3-2", "Ön tasarım raporu Türkçe hazırlanmalı ve en fazla 10 sayfa olmalıdır.", 8);
  const result = normalizeExtraction({ decisions: [{
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Rapor biçim kuralıdır.",
    name: "Rapor Sayfa Sınırı",
    stage: "language_template",
    required: true,
    description: "Rapor en fazla 30 sayfa olmalıdır.",
    controlType: "KANIT_KONTROLU",
    sourcePage: 8,
    sourceText: "en fazla 30 sayfa olmalıdır",
  }] }, 8, [source], new Set([source.sourceId]));
  assert.equal(result.criteria.length, 0);
  assert.equal(result.stats.rejectedSources, 1);
  assert.equal(result.stats.correctedPages, 0);
});

test("sayfası uyuşmayan tekrar kararı kaynaklarını birleştirir ve düzeltme sayacına yazılır", () => {
  const first = block("SAYFA-02-MADDE-2-1", "Rapor Türkçe hazırlanmalıdır.", 2);
  const second = block("SAYFA-09-MADDE-7-3", "Bütün raporlar Türkçe hazırlanmalıdır.", 9);
  const shared = {
    result: "KRITER",
    classificationReason: "Rapor dil kuralıdır.",
    name: "Rapor Dili",
    stage: "language_template",
    required: true,
    description: "Rapor Türkçe hazırlanmalıdır.",
    controlType: "KANIT_KONTROLU",
  };
  const result = normalizeExtraction({ decisions: [
    { ...shared, sourceId: first.sourceId, sourcePage: 2, sourceText: "Türkçe hazırlanmalıdır" },
    // İkinci blok 9. sayfada; model 2 dedi ama alıntı ikinci blokta birebir doğrulanıyor.
    { ...shared, sourceId: second.sourceId, sourcePage: 2, sourceText: "raporlar Türkçe hazırlanmalıdır" },
  ] }, 9, [first, second], new Set([first.sourceId, second.sourceId]));
  assert.equal(result.criteria.length, 1);
  assert.deepEqual(result.criteria[0].sourceIds, [first.sourceId, second.sourceId]);
  assert.equal(result.stats.duplicateCriteria, 1);
  // Düzeltme sayımı tekrar birleştirmesinden ÖNCE yapılır: birleşen karar da sayılır.
  assert.equal(result.stats.correctedPages, 1);
});

test("MAX_CRITERIA üstü aday kararı kesilir; kalan kararlar cevapsız sayılmaz ve uyarı yazılır", () => {
  const blocks = Array.from({ length: MAX_CRITERIA + 4 }, (_, index) => block(
    `SAYFA-01-MADDE-${index + 1}`,
    `Kural ${index + 1} rapor içinde belgelenmelidir.`,
    1,
  ));
  const decision = (index: number) => ({
    sourceId: blocks[index].sourceId,
    result: "KRITER",
    classificationReason: "Rapor kanıt kuralıdır.",
    name: `Kural ${index + 1}`,
    stage: "criteria_evidence",
    required: true,
    description: `Kural ${index + 1} raporda belgelenmelidir.`,
    controlType: "KANIT_KONTROLU",
    sourcePage: 1,
    sourceText: `Kural ${index + 1} rapor içinde belgelenmelidir.`,
  });
  const decisions: unknown[] = Array.from({ length: MAX_CRITERIA + 2 }, (_, index) => decision(index));
  // Sınır aşıldıktan SONRA gelen kapsam dışı ve tekrar kararları da işlenmelidir.
  decisions.push({
    ...decision(MAX_CRITERIA + 2),
    result: "KAPSAM_DISI",
    classificationReason: "Saha günü ölçümüdür.",
    name: "",
    description: "",
    sourceText: "",
  });
  decisions.push({
    ...decision(0),
    sourceId: blocks[MAX_CRITERIA + 3].sourceId,
    sourceText: "rapor içinde belgelenmelidir",
  });
  const result = normalizeExtraction({ decisions }, 1, blocks, new Set(blocks.map((item) => item.sourceId)));
  assert.equal(result.criteria.length, MAX_CRITERIA);
  assert.equal(result.stats.classifiedCriteria, MAX_CRITERIA);
  assert.equal(result.stats.droppedCriteria, 2);
  assert.equal(result.stats.unansweredCandidates, 0);
  assert.equal(result.stats.excludedCandidates, 1);
  assert.equal(result.stats.duplicateCriteria, 1);
  assert.equal(result.stats.correctedPages, 0);
  const firstCriterion = result.criteria.find((criterion) => criterion.name === "Kural 1");
  assert.ok(firstCriterion?.sourceIds?.includes(blocks[MAX_CRITERIA + 3].sourceId));
  assert.equal(result.warnings.filter((warning) => /^2 kriter sınır aşıldığı için alınmadı/.test(warning)).length, 1);
  assert.ok(!result.warnings.some((warning) => warning.includes("cevapsız bırakıldı")));
});

test("OCR kaynaklı bloklar normalizasyon ve alıntı doğrulamasından aynen geçer", () => {
  // OCR yapısı, metin katmanıyla aynı sözleşmeyi taşır: kaynak kimliği ve
  // birebir alıntı doğrulaması OCR metni üzerinde de aynen çalışır.
  const structure = buildStructureFromOcrPages([
    {
      pageNumber: 8,
      blocks: [{ blockType: "NUMBERED_CLAUSE", text: "3.2 Ön tasarım raporu Türkçe hazırlanmalı ve en fazla 10 sayfa olmalıdır." }],
    },
  ], "d".repeat(64), 8);
  const source = structure.blocks[0];
  assert.equal(source.extraction, "ocr");
  assert.equal(source.sourceId, "SAYFA-08-MADDE-3-2");
  const shared = {
    sourceId: source.sourceId,
    result: "KRITER",
    classificationReason: "Rapor biçim kuralıdır.",
    stage: "language_template",
    required: true,
    controlType: "KANIT_KONTROLU",
    sourcePage: 8,
  };
  const accepted = normalizeExtraction({ decisions: [{
    ...shared,
    name: "Rapor Sayfa Sınırı",
    description: "Rapor en fazla 10 sayfa olmalıdır.",
    sourceText: "en fazla 10 sayfa olmalıdır",
  }] }, 8, structure.blocks, new Set([source.sourceId]));
  assert.equal(accepted.criteria.length, 1);
  assert.equal(accepted.criteria[0].sourceId, source.sourceId);
  assert.equal(accepted.criteria[0].sourcePage, 8);

  // OCR metninde geçmeyen alıntı, OCR yolunda da reddedilir.
  const rejected = normalizeExtraction({ decisions: [{
    ...shared,
    name: "Uydurma Alıntı",
    description: "Uydurma kural.",
    sourceText: "bu metin kaynak blokta geçmiyor",
  }] }, 8, structure.blocks, new Set([source.sourceId]));
  assert.equal(rejected.criteria.length, 0);
  assert.equal(rejected.stats.rejectedSources, 1);
});

test("sayı ile başlayan düz cümle madde sinyali almaz ve seçilmezse korunur", () => {
  // pdf-structure v2: "2024" gibi yıl başlangıçları artık clauseNumber üretmez.
  // Bu blok aday seçilmez ama Spec §8 gereği denetim kaydında aynen korunur.
  const paragraph: PdfStructureBlock = {
    ...block("SAYFA-02-BLOK-004", "2024 yılı için katılım şartları belirtilmiştir."),
    clauseNumber: null,
    blockType: "PARAGRAPH",
  };
  const selection = selectCriteriaCandidates([paragraph]);
  assert.equal(selection.candidates.length, 0);
  assert.equal(selection.unselected.length, 1);
  assert.equal(selection.unselected[0].status, "OTOMATIK_TARAMADA_ADAY_SECILMEDI");
  assert.ok(
    !selection.unselected[0].signals.includes("NUMBERED_REQUIREMENT"),
    "madde numarası olmayan düz cümle NUMBERED_REQUIREMENT sinyali almamalıdır",
  );
});

test("sözlük dışı kural sessizce kaybolmaz: seçilmeyen blok durumuyla inceleme özetine girer", () => {
  // "Tasarım yaklaşımı açıklanır." sözlük dışıdır ve aday seçilmez (yukarıdaki
  // sözlük testi kanıtlar); Spec §8 gereği yönetici özetinde yine de görünür.
  const source = block("SAYFA-02-MADDE-3-2", "Tasarım yaklaşımı açıklanır.");
  const selection = selectCriteriaCandidates([source]);
  assert.equal(selection.candidates.length, 0);
  assert.equal(selection.unselected.length, 1);
  assert.equal(selection.unselected[0].status, "OTOMATIK_TARAMADA_ADAY_SECILMEDI");
  const review = summarizeUnselectedBlocks(selection.unselected);
  assert.equal(review.totalCount, 1);
  assert.equal(review.listedCount, 1);
  assert.equal(review.omittedCount, 0);
  assert.equal(review.blocks[0].sourceId, source.sourceId);
  assert.equal(review.blocks[0].page, source.pageNumber);
  assert.equal(review.blocks[0].sectionTitle, source.sectionTitle);
  assert.equal(review.blocks[0].blockType, source.blockType);
  assert.equal(review.blocks[0].text, source.originalText);
  assert.equal(review.blocks[0].textTruncated, false);
  assert.ok(review.blocks[0].reason.length > 0);
  assert.equal(review.blocks[0].reason, selection.unselected[0].selectionReason);
});

test("inceleme özeti uzun metni açıkça işaretleyerek kısaltır", () => {
  const longText = "Tasarım yaklaşımı açıklanır. ".repeat(25).trim();
  assert.ok(longText.length > UNSELECTED_REVIEW_TEXT_LIMIT);
  const selection = selectCriteriaCandidates([block("SAYFA-02-BLOK-001", longText)]);
  assert.equal(selection.unselected.length, 1);
  const item = summarizeUnselectedBlocks(selection.unselected).blocks[0];
  assert.equal(item.text.length, UNSELECTED_REVIEW_TEXT_LIMIT);
  assert.equal(item.text, longText.slice(0, UNSELECTED_REVIEW_TEXT_LIMIT));
  assert.equal(item.textTruncated, true);
});

test("blok tavanı sessiz değildir: listelenmeyenler açıkça sayılır ve sıra korunur", () => {
  const selection = selectCriteriaCandidates([
    block("SAYFA-02-BLOK-001", "Tasarım yaklaşımı açıklanır."),
    block("SAYFA-02-BLOK-002", "Tasarım yaklaşımı açıklanır."),
    block("SAYFA-02-BLOK-003", "Tasarım yaklaşımı açıklanır."),
  ]);
  assert.equal(selection.unselected.length, 3);
  const review = summarizeUnselectedBlocks(selection.unselected, 2);
  assert.equal(review.totalCount, 3);
  assert.equal(review.listedCount, 2);
  assert.equal(review.omittedCount, 1);
  // Belge sırası korunur: ilk iki blok listelenir, üçüncüsü sayıyla bildirilir.
  assert.deepEqual(review.blocks.map((item) => item.sourceId), ["SAYFA-02-BLOK-001", "SAYFA-02-BLOK-002"]);
});

test("özet sinyal filtresi uygulamaz: hiç sinyali olmayan blok da listelenir", () => {
  // Sözlük dışı ifadeyle yazılmış kural tam da sinyalsiz olduğu için
  // seçilmemiştir; özet sinyale göre süzseydi aynı körlük geri gelirdi.
  const paragraph: PdfStructureBlock = {
    ...block("SAYFA-02-BLOK-004", "Tasarım yaklaşımı açıklanır."),
    clauseNumber: null,
    blockType: "PARAGRAPH",
  };
  const selection = selectCriteriaCandidates([paragraph]);
  assert.equal(selection.unselected.length, 1);
  assert.equal(selection.unselected[0].signals.length, 0);
  assert.equal(selection.unselected[0].dictionaryMatches.length, 0);
  const review = summarizeUnselectedBlocks(selection.unselected);
  assert.equal(review.totalCount, 1);
  assert.equal(review.blocks[0].sourceId, paragraph.sourceId);
});

test("profil sahipliği R2 yazımından önce doğrulanır ve yükleme sürümlü anahtar kullanır", () => {
  const source = readFileSync("app/api/profiles/route.ts", "utf8");
  assert.ok(source.indexOf("await findProfile(requestedId)") < source.indexOf("reportBucket().put(uploadedKey"));
  assert.match(source, /profiles\/\$\{profileId\}\/\$\{crypto\.randomUUID\(\)\}-/);
});

test("taslak anahtarları kapsamlandırılır ve eski çalışma taslağı bir kez taşınır", () => {
  const source = readFileSync("app/lib/draft-store.ts", "utf8");
  assert.match(source, /draft-v3:/);
  assert.match(source, /safeScope\(scope\)/);
  assert.match(source, /PREVIOUS_SNAPSHOT_KEY/);
});
