/**
 * Şartname → dört aşamalı kriter çıkarımı: normalizasyon testleri.
 *
 * Ağ yok. Modelden dönmüş gibi ham JSON verilir; doğrulama, tekrar
 * birleştirme, sayfa sınırı, aşama/sayfa sıralaması ve uyarı metinleri
 * denetlenir. Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CRITERIA,
  normalizeCriteria,
  normalizeDocumentSetup,
  normalizeExtraction,
  type RawCriterion,
} from "../app/lib/criteria-extraction.ts";
import { CHECK_STAGE_IDS } from "../app/lib/types.ts";

function raw(patch: Partial<RawCriterion> = {}): RawCriterion {
  return {
    name: "Rapor dili Türkçe",
    stage: "language_template",
    required: true,
    description: "Rapor Türkçe yazılmalıdır; başka dilde yazılan rapor değerlendirmeye alınmaz.",
    violationOutcome: "Değerlendirmeye alınmaz.",
    sourcePage: 2,
    sourceText: "Raporlar Türkçe hazırlanmalıdır.",
    ...patch,
  };
}

test("aynı ad ve aynı sayfa tekrarları tek kritere iner", () => {
  const { criteria, warnings } = normalizeCriteria([raw(), raw({ sourceText: "Rapor Türkçe yazılır." })], 5);
  assert.equal(criteria.length, 1);
  assert.ok(warnings.some((warning) => warning.includes("1 tekrar eden kriter birleştirildi")));
});

test("aynı adlı ve aynı alıntılı tekrar birleşir; farklı adlı kriterler aynı alıntıyı paylaşabilir", () => {
  // Aynı ad + aynı alıntı, farklı sayfa: tekrar.
  const sameName = normalizeCriteria([raw(), raw({ sourcePage: 3 })], 5);
  assert.equal(sameName.criteria.length, 1);
  assert.equal(sameName.criteria[0].name, "Rapor dili Türkçe");

  // Farklı ad, aynı alıntı ve aynı aşama: şartname tek cümlede birden çok
  // başlık/kural listeleyebilir; her biri ayrı kriter olarak kalır.
  const headingSentence = "Rapor şu bölümleri içermelidir: Özet, Giriş, Yöntem, Sonuç.";
  const shared = normalizeCriteria(
    ["Özet", "Giriş", "Yöntem", "Sonuç"].map((name) => raw({ name, stage: "headings_content", sourceText: headingSentence, sourcePage: 4 })),
    5,
  );
  assert.equal(shared.criteria.length, 4);
  assert.equal(shared.warnings.length, 0);

  const otherStage = normalizeCriteria([raw(), raw({ stage: "headings_content" })], 5);
  assert.equal(otherStage.criteria.length, 2);
});

test("PDF sınırı dışındaki kaynak sayfası null olur ve uyarı yazılır", () => {
  const { criteria, warnings } = normalizeCriteria([
    raw({ sourcePage: 12 }),
    raw({ name: "Kapak sayfası", sourcePage: 0, sourceText: "Kapak sayfası bulunmalıdır." }),
    raw({ name: "Punto", sourcePage: "3", sourceText: "Metin 12 punto yazılmalıdır." }),
    raw({ name: "Kenar boşluğu", sourcePage: 3.4, sourceText: "Kenar boşlukları 2,5 cm olmalıdır." }),
  ], 5);
  assert.equal(criteria.length, 4);
  assert.deepEqual(criteria.map((criterion) => criterion.sourcePage), [null, null, null, 3]);
  assert.match(warnings[0], /^3 kriterin kaynak sayfası PDF sınırları dışında/);
});

test("tanınmayan aşama criteria_evidence'a düşer", () => {
  const { criteria } = normalizeCriteria([
    raw({ stage: "score_rule" }),
    raw({ name: "Aşamasız kural", stage: undefined, sourceText: "Motor gücü 500 W'ı aşamaz." }),
  ], 5);
  assert.deepEqual(criteria.map((criterion) => criterion.stage), ["criteria_evidence", "criteria_evidence"]);
});

test("required yalnızca gerçek boolean true iken zorunludur", () => {
  const inputs: unknown[] = [true, "true", 1, undefined, false];
  const { criteria } = normalizeCriteria(
    inputs.map((required, index) => raw({ name: `Kural ${index}`, required, sourceText: `Kural ${index} alıntısı` })),
    5,
  );
  assert.deepEqual(criteria.map((criterion) => criterion.required), [true, false, false, false, false]);
});

test("aşama sırası, sayfa sırası ve kararlı kimlikler", () => {
  const { criteria } = normalizeExtraction({
    criteria: [
      raw({ name: "A", stage: "criteria_evidence", sourcePage: 3, sourceText: "a metni" }),
      raw({ name: "B", stage: "language_template", sourcePage: 5, sourceText: "b metni" }),
      raw({ name: "C", stage: "headings_content", sourcePage: 1, sourceText: "c metni" }),
      raw({ name: "D", stage: "language_template", sourcePage: 2, sourceText: "d metni" }),
      raw({ name: "E", stage: "criteria_evidence", sourcePage: 99, sourceText: "e metni" }),
      raw({ name: "F", stage: "category_similarity", sourcePage: 4, sourceText: "f metni" }),
    ],
  }, 10);
  assert.deepEqual(criteria.map((criterion) => criterion.name), ["D", "B", "C", "F", "A", "E"]);
  assert.deepEqual(criteria.map((criterion) => criterion.id), ["criterion-1", "criterion-2", "criterion-3", "criterion-4", "criterion-5", "criterion-6"]);
  assert.equal(criteria.at(-1)?.sourcePage, null);
  const stageIndexes = criteria.map((criterion) => CHECK_STAGE_IDS.indexOf(criterion.stage));
  assert.deepEqual(stageIndexes, [...stageIndexes].sort((left, right) => left - right));
});

test("boş ad veya boş alıntı taşıyan kriter düşer", () => {
  const { criteria, warnings } = normalizeCriteria([
    raw({ name: "" }),
    raw({ sourceText: "   " }),
    raw({ name: "Geçerli kural", sourceText: "Geçerli alıntı." }),
  ], 5);
  assert.equal(criteria.length, 1);
  assert.equal(criteria[0].name, "Geçerli kural");
  assert.match(warnings[0], /^2 kriter ad veya kaynak alıntısı boş/);
});

test("varsayılan açıklama ve ihlal sonucu; boşluk temizliği; köken ve aktiflik", () => {
  const { criteria } = normalizeCriteria([
    raw({ name: "  Çok   boşluklu   ad ", description: undefined, violationOutcome: "" }),
  ], 5);
  const [criterion] = criteria;
  assert.equal(criterion.name, "Çok boşluklu ad");
  assert.equal(criterion.description, "Kuralın nasıl kontrol edileceğini açıklayın.");
  assert.equal(criterion.violationOutcome, "Belgede belirtilmemiş");
  assert.equal(criterion.active, true);
  assert.equal(criterion.origin, "document");
  assert.equal(criterion.id, "criterion-1");
});

test("kapsam dışı maddeler sayılır ve uyarıya dönüşür", () => {
  const result = normalizeExtraction({
    criteria: [raw()],
    excludedRules: [
      { name: "Parkur puanı", reason: "fiziksel aşama", sourcePage: 14 },
      { name: "Ceza puanı", reason: "puanlama", sourcePage: 18 },
      { name: "Hakem onayı", reason: "haricî onay", sourcePage: 13 },
    ],
  }, 20);
  assert.equal(result.excludedRuleCount, 3);
  assert.ok(result.warnings.some((warning) => warning.startsWith("3 madde")));
  assert.equal(result.criteria.length, 1);
});

test("belge profili: rapor dili, dosya biçimleri ve sayısal sınırlar temizlenir", () => {
  const setup = normalizeDocumentSetup({
    reportLanguage: "  Türkçe ",
    allowedFormats: [".pdf", "docx", "PDF", "", 5],
    maxFileSizeMb: "25",
    maxFileCount: 1.5,
    defaultViolationAction: "eleme",
  });
  assert.equal(setup.reportLanguage, "Türkçe");
  assert.deepEqual(setup.allowedFormats, ["PDF", "DOCX"]);
  assert.equal(setup.maxFileSizeMb, 25);
  assert.equal(setup.maxFileCount, 0);
  assert.equal(setup.defaultViolationAction, "unspecified");
  assert.equal(setup.competition, "Belgede belirtilmemiş");

  assert.equal(normalizeDocumentSetup(undefined).reportLanguage, null);
  assert.equal(normalizeDocumentSetup({ reportLanguage: null }).reportLanguage, null);
});

test("MAX_CRITERIA üstü kesilir ve uyarı yazılır", () => {
  const many = Array.from({ length: MAX_CRITERIA + 5 }, (_, index) => raw({
    name: `Kural ${index + 1}`,
    sourceText: `Kural ${index + 1} için özgün alıntı.`,
    sourcePage: (index % 5) + 1,
  }));
  const { criteria, warnings } = normalizeCriteria(many, 5);
  assert.equal(criteria.length, MAX_CRITERIA);
  assert.ok(warnings.some((warning) => /^5 kriter/.test(warning) && warning.includes("sınır aşıldığı")));
});

test("boş liste ve liste olmayan girdi uyarıları", () => {
  const empty = normalizeExtraction({ criteria: [] }, 3);
  assert.deepEqual(empty.criteria, []);
  assert.ok(empty.warnings.includes("Belgede PDF aşamasında kontrol edilebilecek kural bulunamadı."));

  const missing = normalizeCriteria(undefined, 3);
  assert.deepEqual(missing.criteria, []);
  assert.deepEqual(missing.warnings, ["Model kriter listesi döndürmedi."]);

  const nothing = normalizeExtraction({}, 3);
  assert.ok(nothing.warnings.includes("Model kriter listesi döndürmedi."));
  assert.ok(nothing.warnings.includes("Belgede PDF aşamasında kontrol edilebilecek kural bulunamadı."));
});

test("şablon profili normalize edilir", () => {
  const { templateProfile } = normalizeExtraction({
    criteria: [raw()],
    templateProfile: { provided: true, name: "sablon.pdf", pages: "4", requiredHeadings: ["Giriş", 3, " Yöntem "], notes: [] },
  }, 5);
  assert.equal(templateProfile.provided, true);
  assert.equal(templateProfile.pages, 4);
  assert.deepEqual(templateProfile.requiredHeadings, ["Giriş", "Yöntem"]);

  const absent = normalizeExtraction({ criteria: [raw()] }, 5).templateProfile;
  assert.equal(absent.provided, false);
  assert.deepEqual(absent.requiredHeadings, []);
});
