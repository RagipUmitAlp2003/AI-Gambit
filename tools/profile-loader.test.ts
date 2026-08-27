/**
 * Profil dışa aktarımı doğrulama testleri: 2.0 kabulü, 1.0 → 2.0 yükseltme
 * ve bozuk profil reddi. profile-loader localStorage'a yalnızca fonksiyon
 * içinde eriştiği için modül Node'da güvenle içe aktarılır.
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import { upgradeLegacyCriterion, validateProfileExport } from "../app/lib/profile-loader.ts";
import type { Criterion, SetupData } from "../app/lib/types.ts";

const setup: SetupData = {
  competition: "Roket Yarışması",
  category: "Üniversite Seviyesi",
  stage: "Kritik tasarım değerlendirmesi",
  reportType: "Kritik Tasarım Raporu",
  year: "2026",
  allowedFormats: ["PDF"],
  maxFileSizeMb: 25,
  maxFileCount: 1,
  defaultViolationAction: "jury",
  reportLanguage: "Türkçe",
};

function criterion(patch: Partial<Criterion> = {}): Criterion {
  return {
    id: "criterion-1",
    name: "Giriş bölümü",
    stage: "headings_content",
    required: true,
    description: "Raporda Giriş başlığı bulunmalı ve altında proje amacı yazılmalıdır.",
    violationOutcome: "Değerlendirmeye alınmaz.",
    sourcePage: 3,
    sourceText: "Rapor Giriş bölümü ile başlar.",
    verifiability: "PDF_DENETLENEBILIR",
    active: true,
    origin: "document",
    ...patch,
  };
}

function profile(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "2.0",
    status: "approved",
    profileId: "profile-1",
    setup,
    sourceDocument: { name: "sartname.pdf", pages: 20, analyzedAt: "2026-08-20T00:00:00.000Z" },
    criteria: [criterion()],
    ...patch,
  };
}

/** Eski (puanlı) modelden gelen kriter; `required` bilerek yazılmaz, etkiden türetilmesi test edilir. */
function legacy(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "legacy-1",
    name: "Eski kriter",
    type: "qualitative_score",
    maxScore: 10,
    weight: null,
    violationOutcome: "Puan kırılır.",
    evaluationMethod: "ai",
    sourcePage: 4,
    sourceText: "Eski alıntı.",
    aiInterpretation: "Eski yorum.",
    confidence: "high",
    active: true,
    origin: "document",
    effect: "score",
    applicability: "report",
    ...patch,
  };
}

function legacyProfile(criteria: Record<string, unknown>[]): Record<string, unknown> {
  const legacySetup: Record<string, unknown> = { ...setup };
  delete legacySetup.reportLanguage;
  return profile({ version: "1.0", setup: legacySetup, criteria, scorePlan: { declaredTotalScore: 100, groups: [] } });
}

test("2.0 profili olduğu gibi kabul edilir", () => {
  const { profile: result, error } = validateProfileExport(profile());
  assert.equal(error, "");
  assert.ok(result);
  assert.equal(result.version, "2.0");
  assert.equal(result.profileId, "profile-1");
  assert.deepEqual(result.criteria, [criterion()]);
  assert.equal(result.setup.reportLanguage, "Türkçe");
  assert.equal(result.templateProfile, undefined);
  assert.equal(result.sourceDocument.pages, 20);
});

test("1.0 yükseltme: eski tür aşamaya dönüşür", () => {
  const { profile: result, error } = validateProfileExport(legacyProfile([
    legacy({ id: "l1", type: "format_rule" }),
    legacy({ id: "l2", type: "technical_upload", applicability: "upload" }),
    legacy({ id: "l3", type: "mandatory_content" }),
    legacy({ id: "l4", type: "qualitative_score" }),
    legacy({ id: "l5", type: undefined }),
    legacy({ id: "l6", type: "format_rule", stage: "category_similarity" }),
  ]));
  assert.equal(error, "");
  assert.ok(result);
  assert.equal(result.version, "2.0");
  assert.equal(result.setup.reportLanguage, null);
  assert.deepEqual(result.criteria.map((item) => item.stage), [
    "language_template",
    "language_template",
    "headings_content",
    "criteria_evidence",
    "criteria_evidence",
    "category_similarity",
  ]);
  assert.ok(result.criteria.every((item) => !("maxScore" in item) && !("effect" in item) && !("confidence" in item)));
});

test("1.0 yükseltme: fiziksel/haricî/bilgi kapsamı ve tavsiye etkisi pasif taşınır", () => {
  const cases: Array<[Record<string, unknown>, boolean]> = [
    [{ applicability: "physical" }, false],
    [{ applicability: "external" }, false],
    [{ applicability: "informational" }, false],
    [{ effect: "advisory" }, false],
    [{ applicability: "report", effect: "score" }, true],
    [{ applicability: "upload", effect: "gate" }, true],
    [{ applicability: "report", active: false }, false],
  ];
  cases.forEach(([patch, expected], index) => {
    assert.equal(upgradeLegacyCriterion(legacy(patch), index).active, expected, JSON.stringify(patch));
  });
});

test("1.0 yükseltme: etkiye ve eleme türüne göre zorunluluk", () => {
  const cases: Array<[Record<string, unknown>, boolean]> = [
    [{ effect: "gate" }, true],
    [{ effect: "threshold" }, true],
    [{ effect: "penalty" }, true],
    [{ type: "elimination_review", effect: "score" }, true],
    [{ effect: "score" }, false],
    [{ effect: "advisory" }, false],
    // Açık boolean her zaman kazanır.
    [{ effect: "gate", required: false }, false],
    [{ effect: "score", required: true }, true],
  ];
  cases.forEach(([patch, expected], index) => {
    assert.equal(upgradeLegacyCriterion(legacy(patch), index).required, expected, JSON.stringify(patch));
  });
});

test("1.0 yükseltme: aiInterpretation açıklamaya taşınır", () => {
  assert.equal(upgradeLegacyCriterion(legacy({ description: undefined, aiInterpretation: "Yorumdan gelen açıklama" }), 0).description, "Yorumdan gelen açıklama");
  assert.equal(upgradeLegacyCriterion(legacy({ description: "Kendi açıklaması", aiInterpretation: "Yorum" }), 0).description, "Kendi açıklaması");
  assert.equal(upgradeLegacyCriterion(legacy({ description: undefined, aiInterpretation: "" }), 0).description, "Kuralın nasıl kontrol edileceğini açıklayın.");
});

test("upgradeLegacyCriterion boş kayıt için güvenli yedekler üretir", () => {
  const upgraded = upgradeLegacyCriterion({}, 4);
  assert.deepEqual(upgraded, {
    id: "criterion-5",
    name: "İsimsiz kriter 5",
    stage: "criteria_evidence",
    required: false,
    description: "Kuralın nasıl kontrol edileceğini açıklayın.",
    violationOutcome: "Belgede belirtilmemiş",
    // Kanıt yeri belirtilmemiş boş kayıt PDF denetlenebilir sayılır (madde 4).
    verifiability: "PDF_DENETLENEBILIR",
    sourcePage: null,
    sourceText: "",
    active: false,
    origin: "document",
  });
  assert.equal(upgradeLegacyCriterion({ origin: "manager", sourcePage: "7" }, 0).origin, "manager");
  assert.equal(upgradeLegacyCriterion({ sourcePage: 7 }, 0).sourcePage, 7);
});

test("bozuk profiller açık hata ile reddedilir", () => {
  const reject = (value: unknown, pattern: RegExp) => {
    const { profile: result, error } = validateProfileExport(value);
    assert.equal(result, null);
    assert.match(error, pattern);
  };
  reject(null, /profil JSON'u değil/);
  reject(profile({ version: "3.0" }), /sürümü tanınmadı/);
  reject(profile({ status: "draft" }), /sürümü tanınmadı/);
  reject(profile({ setup: undefined }), /temel ayar/);
  reject(profile({ setup: { ...setup, allowedFormats: "PDF" } }), /dosya formatları/);
  reject(profile({ setup: { ...setup, maxFileSizeMb: -1 } }), /dosya boyutu/);
  reject(profile({ setup: { ...setup, defaultViolationAction: "eleme" } }), /ihlal davranışı/);
  reject(profile({ criteria: [] }), /kriter listesi bulunamadı/);
  reject(profile({ criteria: [{ ...criterion(), stage: undefined }] }), /kriter kayıtları bozuk/);
  reject(profile({ criteria: [{ ...criterion(), stage: "score_rule" }] }), /kriter kayıtları bozuk/);
  reject(profile({ criteria: [{ ...criterion(), required: "true" }] }), /kriter kayıtları bozuk/);
  reject(profile({ criteria: [{ ...criterion(), active: "yes" }] }), /kriter kayıtları bozuk/);
  reject(profile({ sourceDocument: undefined }), /kaynak belge/);
});

test("1.0 profilinde aşama ve zorunluluk alanı aranmaz", () => {
  const { profile: result, error } = validateProfileExport(legacyProfile([legacy()]));
  assert.equal(error, "");
  assert.ok(result);
  assert.equal(result.criteria[0].stage, "criteria_evidence");
  assert.equal(result.criteria[0].required, false);
});
