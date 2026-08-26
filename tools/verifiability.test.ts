/**
 * PDF DIŞI KANIT (Problem 4 · madde 4)
 *
 * Şartname analizinde video, saha teslimi veya kurul kararı gerektiren kurallar
 * da kriter olarak çıkabilir. Katılımcı rapor analizi YALNIZCA PDF üzerinde
 * çalıştığı için "PDF'de video yok" bir ihlal DEĞİLDİR. Bu testler o kuralın
 * bütün katmanlarda korunduğunu doğrular:
 *
 *   1. Çıkarım normalizasyonu kriterin kanıt yerini kaydeder.
 *   2. Model alanı boş bıraksa bile metinden dar bir işaret taraması yapılır.
 *   3. Eski (1.0/erken 2.0) profiller okunurken makul bir değere yükseltilir.
 *   4. DEGERLENDIRILEMEDI sayaçlarda hata sayılmaz, aşamayı kötüleştirmez ve
 *      yarışmacı geri bildirimine "eksik" olarak yazılmaz.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCriteria, resolveVerifiability } from "../app/lib/criteria-extraction.ts";
import { upgradeLegacyCriterion } from "../app/lib/profile-loader.ts";
import {
  capStageVerdict,
  feedbackOf,
  isOutsidePdfFinding,
  summarizeFindings,
  worstVerdict,
} from "../app/lib/report-prechecks.ts";
import type { CriterionFinding } from "../app/lib/types.ts";

function rawCriterion(patch: Record<string, unknown> = {}) {
  return {
    name: "Kural",
    stage: "criteria_evidence",
    required: true,
    description: "Raporda gösterilmelidir.",
    violationOutcome: "Belgede belirtilmemiş",
    sourcePage: 3,
    sourceText: "Belgeden alıntı cümlesi.",
    verifiability: "PDF_DENETLENEBILIR",
    ...patch,
  };
}

test("çıkarım normalizasyonu kriterin kanıt yerini korur", () => {
  const result = normalizeCriteria([
    rawCriterion({ name: "Yapısal analiz", verifiability: "PDF_DENETLENEBILIR" }),
    rawCriterion({ name: "Tanıtım videosu", sourceText: "Takımlar tanıtım videosu yükler.", verifiability: "HARICI_KANIT_GEREKLI" }),
    rawCriterion({ name: "Kurul onayı", sourceText: "Kurul kararıyla belirlenir.", verifiability: "HAKEM_KONTROLU_GEREKLI" }),
  ], 10);
  assert.equal(result.criteria.length, 3);
  assert.deepEqual(
    result.criteria.map((item) => item.verifiability),
    ["PDF_DENETLENEBILIR", "HARICI_KANIT_GEREKLI", "HAKEM_KONTROLU_GEREKLI"],
  );
});

test("model alanı boş bıraktığında video kuralı harici kanıt sayılır", () => {
  // Alan hiç gelmezse (eski önbellek kaydı veya şemaya uymayan çıktı) metinden
  // dar bir işaret taraması yapılır. Amaç uydurma ihlali baştan engellemektir.
  assert.equal(
    resolveVerifiability(undefined, "Tanıtım videosu", "Takım bir tanıtım videosu yüklemelidir.", ""),
    "HARICI_KANIT_GEREKLI",
  );
  assert.equal(
    resolveVerifiability(undefined, "Nihai değerlendirme", "", "Sonuç kurul kararı ile belirlenir."),
    "HAKEM_KONTROLU_GEREKLI",
  );
  // Şüphe yoksa PDF denetlenebilir kalır; kararı yine hakem verir.
  assert.equal(
    resolveVerifiability(undefined, "Sayfa sınırı", "Rapor en fazla 25 sayfadır.", ""),
    "PDF_DENETLENEBILIR",
  );
  // Model alanı doldurduysa sezgisel tarama devreye GİRMEZ.
  assert.equal(
    resolveVerifiability({ verifiability: "PDF_DENETLENEBILIR" }, "Video", "video yüklenmelidir", ""),
    "PDF_DENETLENEBILIR",
  );
});

test("eski profil kriteri makul bir kanıt yerine yükseltilir", () => {
  // Eski modelde PDF aşaması dışı sayılan madde harici kanıt olarak taşınır:
  // rapor analizinde "PDF'de yok" diye ihlal üretmesin.
  const external = upgradeLegacyCriterion({ id: "c1", name: "Saha testi", applicability: "field", active: true }, 0);
  assert.equal(external.verifiability, "HARICI_KANIT_GEREKLI");

  const informational = upgradeLegacyCriterion({ id: "c2", name: "Bilgi notu", applicability: "informational", active: true }, 1);
  assert.equal(informational.verifiability, "HAKEM_KONTROLU_GEREKLI");

  const report = upgradeLegacyCriterion({ id: "c3", name: "Giriş bölümü", applicability: "report", active: true }, 2);
  assert.equal(report.verifiability, "PDF_DENETLENEBILIR");

  // Alan zaten varsa olduğu gibi korunur.
  const explicit = upgradeLegacyCriterion(
    { id: "c4", name: "Video", applicability: "report", active: true, verifiability: "HARICI_KANIT_GEREKLI" },
    3,
  );
  assert.equal(explicit.verifiability, "HARICI_KANIT_GEREKLI");
});

function finding(patch: Partial<CriterionFinding> = {}): CriterionFinding {
  return {
    criterionId: "criterion-1",
    criterionName: "Kural",
    stage: "criteria_evidence",
    required: true,
    verifiability: "PDF_DENETLENEBILIR",
    verdict: "BASARILI",
    rationale: "Karşılandı.",
    evidence: [],
    evidenceMissing: false,
    ...patch,
  };
}

test("PDF dışı kanıt kuralı hata sayılmaz ve aşamayı kötüleştirmez", () => {
  const outside = finding({
    criterionId: "criterion-2",
    criterionName: "Tanıtım videosu",
    verifiability: "HARICI_KANIT_GEREKLI",
    verdict: "DEGERLENDIRILEMEDI",
  });
  assert.ok(isOutsidePdfFinding(outside));

  // Sıralamada BAŞARILI'nın bile altındadır: genel durumu belirleyemez.
  assert.equal(worstVerdict(["DEGERLENDIRILEMEDI"]), "BASARILI");
  assert.equal(worstVerdict(["BASARILI", "DEGERLENDIRILEMEDI"]), "BASARILI");
  assert.equal(worstVerdict(["DEGERLENDIRILEMEDI", "REVIZYON"]), "REVIZYON");

  const summary = summarizeFindings([finding(), outside]);
  assert.equal(summary.total, 2);
  assert.equal(summary.basarili, 1);
  assert.equal(summary.revizyon, 0);
  assert.equal(summary.kritikHata, 0, "PDF dışı kural kritik hata sayacına girmemelidir.");
  assert.equal(summary.disiKanit, 1);
  assert.equal(summary.overall, "BASARILI");
});

test("yalnızca PDF dışı zorunlu kuralı olan aşama kritik hataya düşemez", () => {
  // Zorunlu ama kanıtı raporun dışında olan kural, aşamayı KRİTİK HATA yapamaz.
  const outsideRequired = finding({
    criterionId: "criterion-3",
    required: true,
    verifiability: "HARICI_KANIT_GEREKLI",
    verdict: "DEGERLENDIRILEMEDI",
  });
  assert.equal(
    capStageVerdict("criteria_evidence", "KRITIK_HATA", [outsideRequired]),
    "REVIZYON",
  );
  // PDF'den denetlenebilir zorunlu kural varsa kritik hata korunur.
  assert.equal(
    capStageVerdict("criteria_evidence", "KRITIK_HATA", [finding({ verdict: "KRITIK_HATA" })]),
    "KRITIK_HATA",
  );
});

test("PDF dışı kural yarışmacı geri bildirimine eksik olarak yazılmaz", () => {
  const feedback = feedbackOf([
    finding({ criterionId: "a", criterionName: "Sayfa sınırı", verdict: "BASARILI" }),
    finding({ criterionId: "b", criterionName: "Yapısal analiz", verdict: "KRITIK_HATA", rationale: "Bulunamadı." }),
    finding({
      criterionId: "c",
      criterionName: "Tanıtım videosu",
      verifiability: "HARICI_KANIT_GEREKLI",
      verdict: "DEGERLENDIRILEMEDI",
      rationale: "PDF üzerinden değerlendirilemez.",
    }),
  ]);
  assert.ok(feedback.improvements.some((line) => line.includes("Yapısal analiz")));
  assert.ok(
    !feedback.improvements.some((line) => line.includes("Tanıtım videosu")),
    "PDF dışı kanıt gerektiren kural yarışmacıya eksik olarak bildirilmemelidir.",
  );
  assert.ok(!feedback.suggestions.some((line) => line.includes("Tanıtım videosu")));
});
