import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectCriteriaCandidates } from "../app/lib/criteria-candidates.ts";
import { normalizeExtraction } from "../app/lib/criteria-extraction.ts";
import { findNumberPatterns, scanText } from "../app/lib/criteria-dictionary.ts";
import type { PdfStructureBlock } from "../app/lib/pdf-structure.ts";
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

test("aday seçimi teknik/fiziksel kuralları dışarıda bırakır, rapor içeriğini taşır", () => {
  const blocks = [
    block("SAYFA-02-MADDE-3-2", "Takım yarışma günü parkur görevini tamamlamalıdır."),
    block("SAYFA-03-MADDE-4-1", "Test sonuçları raporda tablo halinde sunulmalıdır.", 3),
  ];
  const selected = selectCriteriaCandidates(blocks);
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.candidates[0].block.sourceId, "SAYFA-03-MADDE-4-1");
  assert.ok(selected.candidates[0].signals.includes("HEADING_CONTENT_TERM"));
  assert.equal(selected.unselected[0].block.sourceId, "SAYFA-02-MADDE-3-2");
  assert.ok(selected.unselected[0].signals.includes("PHYSICAL_STAGE_TERM"));
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
