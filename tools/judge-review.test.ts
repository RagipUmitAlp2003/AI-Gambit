/**
 * NİHAİ HAKEM AKIŞI — AI BULGUSU DOĞRULAMA birim testleri.
 *
 * Onayla/Ret, katılımcının kriter sonucunu DEĞİL, AI bulgusunun kabulünü
 * ifade eder:
 *   - Onayla → kesin sonuç AI sonucudur (AI OLUMSUZ dediyse OLUMSUZ kalır).
 *   - Ret → AI bulgusu kesin sonuç olarak KULLANILAMAZ; hakem aynı kriter için
 *     kendi sonucunu (UYGUN/OLUMSUZ) + kaynağını + gerekçesini girer.
 *   - Kesin sonuç: onaylandıysa aiVerdict, reddedildiyse judgeResult.
 *   - Sayaçlar ve katılımcı geri bildirimi yalnızca KESİNLEŞMİŞ sonuçlardan.
 *   - Kararlar başlangıçta KARAR BEKLİYOR'dur; AI otomatik onaylanmış sayılmaz.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJudgeFeedback,
  criterionDecisionError,
  defaultOutcomeNote,
  effectiveVerdictOf,
  emptyCriterionDecisions,
  judgeDecisionCounts,
  restoreCriterionDecisions,
  validateCriterionDecisions,
  visibleFindingsOf,
} from "../app/lib/judge-review.ts";
import { aiVerdictOf, type CriterionFinding, type JudgeCriterionDecision, type ReportEvaluation } from "../app/lib/types.ts";

function finding(patch: Partial<CriterionFinding> = {}): CriterionFinding {
  return {
    criterionId: "Z-01",
    criterionName: "Yapısal analiz",
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

function decided(patch: Partial<JudgeCriterionDecision> = {}): JudgeCriterionDecision {
  return {
    criterionId: "Z-01",
    criterionName: "Yapısal analiz",
    aiVerdict: "UYGUN",
    judgeVerdict: "pending",
    judgeResult: null,
    rejectionReason: "",
    evidenceMode: null,
    evidencePage: null,
    evidenceSection: "",
    evidenceQuote: "",
    missingContent: "",
    decidedBy: null,
    decidedAt: null,
    ...patch,
  };
}

test("AI kural durumu iki durumlu bulguya indirgenir", () => {
  assert.equal(aiVerdictOf("BASARILI"), "UYGUN");
  assert.equal(aiVerdictOf("REVIZYON"), "OLUMSUZ");
  assert.equal(aiVerdictOf("KRITIK_HATA"), "OLUMSUZ");
});

test("eski kayıtlardaki PDF dışı bulgular görünür listeye alınmaz", () => {
  const evaluation = {
    findings: [
      finding({ criterionId: "a" }),
      finding({ criterionId: "video", verdict: "DEGERLENDIRILEMEDI", verifiability: "HARICI_KANIT_GEREKLI" }),
    ],
  } as Pick<ReportEvaluation, "findings">;
  const visible = visibleFindingsOf(evaluation);
  assert.equal(visible.length, 1, "DEGERLENDIRILEMEDI bulgu hakem listesine girmemelidir.");
  assert.equal(visible[0].criterionId, "a");
});

test("hakem kararları başlangıçta KARAR BEKLİYOR'dur; AI otomatik onaylanmaz", () => {
  const decisions = emptyCriterionDecisions([
    finding({ criterionId: "a", verdict: "BASARILI" }),
    finding({ criterionId: "b", verdict: "KRITIK_HATA" }),
  ]);
  assert.ok(decisions.every((decision) => decision.judgeVerdict === "pending"),
    "AI bulgusu hakem tarafından otomatik onaylanmış sayılmamalıdır.");
  assert.ok(decisions.every((decision) => effectiveVerdictOf(decision) === null),
    "Kesinleşmiş sonuç, hakem karar vermeden OLUŞMAMALIDIR.");
  // AI bulgusu bilgi olarak taşınır ama kesin sonuç DEĞİLDİR.
  assert.equal(decisions[0].aiVerdict, "UYGUN");
  assert.equal(decisions[1].aiVerdict, "OLUMSUZ");
});

test("Onayla = AI bulgusu kabul: AI OLUMSUZ dediyse kesin sonuç OLUMSUZ olur", () => {
  const approvedNegative = decided({ aiVerdict: "OLUMSUZ", judgeVerdict: "approved" });
  assert.equal(effectiveVerdictOf(approvedNegative), "OLUMSUZ",
    "Onay, AI'nin OLUMSUZ sonucunu kesinleştirir; olumluya ÇEVİRMEZ.");
  const approvedPositive = decided({ aiVerdict: "UYGUN", judgeVerdict: "approved" });
  assert.equal(effectiveVerdictOf(approvedPositive), "UYGUN");
});

test("Ret = AI bulgusu reddedildi: kesin sonuç HAKEMİN yazdığı sonuçtur", () => {
  // AI OLUMSUZ dedi; hakem bulguyu reddedip kendi değerlendirmesiyle UYGUN yazdı.
  const overturned = decided({
    aiVerdict: "OLUMSUZ", judgeVerdict: "rejected", judgeResult: "UYGUN",
    rejectionReason: "AI yanlış bölüme bakmış; gereksinim s. 9'da karşılanıyor.",
    evidenceMode: "PDF_KONUMU", evidencePage: 9, evidenceQuote: "Yapısal analiz sonuçları Tablo 4'te verilmiştir.",
  });
  assert.equal(effectiveVerdictOf(overturned), "UYGUN",
    "Reddedilen AI bulgusu kesin sonuç olarak KULLANILAMAZ; hakem sonucu geçer.");
  // AI UYGUN dedi; hakem bulguyu reddedip OLUMSUZ yazdı.
  const negated = decided({
    aiVerdict: "UYGUN", judgeVerdict: "rejected", judgeResult: "OLUMSUZ",
    rejectionReason: "Azami 100 cm sınırı aşılmış.",
    evidenceMode: "PDF_KONUMU", evidencePage: 6, evidenceQuote: "Sistem boyutu 104 cm olarak belirlenmiştir.",
  });
  assert.equal(effectiveVerdictOf(negated), "OLUMSUZ");
});

test("sayaçlar yalnızca KESİNLEŞMİŞ sonuçları sayar", () => {
  const decisions = [
    decided({ criterionId: "a", aiVerdict: "UYGUN", judgeVerdict: "approved" }),                    // kesin: UYGUN
    decided({ criterionId: "b", aiVerdict: "OLUMSUZ", judgeVerdict: "approved" }),                  // kesin: OLUMSUZ
    decided({
      criterionId: "c", aiVerdict: "OLUMSUZ", judgeVerdict: "rejected", judgeResult: "UYGUN",       // kesin: UYGUN
      rejectionReason: "x", evidenceMode: "PDF_KONUMU", evidencePage: 2, evidenceQuote: "alıntı",
    }),
    decided({ criterionId: "d", aiVerdict: "UYGUN", judgeVerdict: "pending" }),                     // bekliyor
  ];
  const counts = judgeDecisionCounts(decisions);
  assert.deepEqual(counts, { uygun: 2, olumsuz: 1, pending: 1, total: 4, findingsApproved: 2, findingsRejected: 1 });
});

test("onay ek açıklama istemez; bulgu reddi hakemin kendi sonucunu ve gerekçesini ister", () => {
  assert.equal(criterionDecisionError(decided({ judgeVerdict: "approved" })), "");
  assert.match(criterionDecisionError(decided({ judgeVerdict: "rejected" })), /kendi sonucu .* zorunludur/);
  assert.match(
    criterionDecisionError(decided({ judgeVerdict: "rejected", judgeResult: "OLUMSUZ" })),
    /hakem gerekçesi zorunludur/,
  );
});

test("PDF konumlu hakem değerlendirmesi sayfa ve doğrudan alıntı ister", () => {
  const base = {
    judgeVerdict: "rejected" as const, judgeResult: "OLUMSUZ" as const,
    rejectionReason: "Sınır aşılmış.", evidenceMode: "PDF_KONUMU" as const,
  };
  assert.match(criterionDecisionError(decided({ ...base })), /sayfa numarası zorunludur/);
  assert.match(criterionDecisionError(decided({ ...base, evidencePage: 6 })), /doğrudan alıntı zorunludur/);
  assert.equal(criterionDecisionError(decided({ ...base, evidencePage: 6, evidenceQuote: "Alıntı." })), "");
});

test("raporda bulunamadı kararı sahte sayfa istemez; aranan bölüm zorunludur", () => {
  const base = {
    judgeVerdict: "rejected" as const, judgeResult: "OLUMSUZ" as const,
    rejectionReason: "Bölüm yok.", evidenceMode: "RAPORDA_BULUNAMADI" as const,
  };
  assert.match(criterionDecisionError(decided({ ...base })), /aranan bölüm\/başlık adı zorunludur/);
  // Sayfa ve alıntı OLMADAN geçerli: olmayan içerik için sahte konum istenmez.
  assert.equal(criterionDecisionError(decided({ ...base, missingContent: "Yapısal analiz bölümü" })), "");
});

test("bütün kriterler kesinleşmeden genel karar verilemez", () => {
  const findings = [finding({ criterionId: "a" }), finding({ criterionId: "b" })];
  const partial = [
    decided({ criterionId: "a", judgeVerdict: "approved" }),
    decided({ criterionId: "b", judgeVerdict: "pending" }),
  ];
  assert.match(validateCriterionDecisions(findings, partial, true), /karar bekliyor/);
  assert.equal(validateCriterionDecisions(findings, partial, false), "", "Taslak kayıtta eksik karar serbesttir.");
  const complete = [
    decided({ criterionId: "a", judgeVerdict: "approved" }),
    decided({ criterionId: "b", judgeVerdict: "approved" }),
  ];
  assert.equal(validateCriterionDecisions(findings, complete, true), "");
});

test("analizde bulunmayan kritere veya mükerrer karara izin verilmez (kriter kapsam bağı)", () => {
  const findings = [finding({ criterionId: "a" })];
  assert.match(
    validateCriterionDecisions(findings, [decided({ criterionId: "baska-kriter", judgeVerdict: "approved" })], false),
    /güncel AI analizinde bulunmayan/,
  );
  assert.match(
    validateCriterionDecisions(findings, [
      decided({ criterionId: "a", judgeVerdict: "approved" }),
      decided({ criterionId: "a", judgeVerdict: "approved" }),
    ], false),
    /birden fazla karar/,
  );
});

test("geri yükleme bozuk kayıtları KARAR BEKLİYOR'a döndürür ve AI sonucunu tazeler", () => {
  const findings = [finding({ criterionId: "a", verdict: "KRITIK_HATA" })];
  const restored = restoreCriterionDecisions(findings, [
    decided({ criterionId: "a", judgeVerdict: "rejected", judgeResult: "UYGUN", aiVerdict: "UYGUN",
      rejectionReason: "x", evidenceMode: "PDF_KONUMU", evidencePage: 3, evidenceQuote: "q" }),
    decided({ criterionId: "silinmis-kriter", judgeVerdict: "approved" }),
  ]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].judgeVerdict, "rejected");
  assert.equal(restored[0].judgeResult, "UYGUN");
  // AI sonucu saklı kayıttan değil GÜNCEL bulgudan okunur; kayıt AI'ı değiştiremez.
  assert.equal(restored[0].aiVerdict, "OLUMSUZ");
});

test("katılımcı geri bildirimi kesinleşmiş sonuçlardan üretilir; öneri listesi yoktur", () => {
  const findings = [
    finding({ criterionId: "a", criterionName: "Rapor dili", verdict: "BASARILI" }),
    finding({
      criterionId: "b", criterionName: "Boyut sınırı", verdict: "KRITIK_HATA",
      rationale: "Azami 100 cm aşılmış.",
      evidence: [{ page: 6, paragraph: null, section: "3.1 Mekanik", text: "Sistem boyutu 104 cm olarak belirlenmiştir." }],
    }),
    finding({ criterionId: "c", criterionName: "Test planı", verdict: "BASARILI" }),
  ];
  const decisions = [
    // AI UYGUN + bulgu onaylandı → güçlü yön.
    decided({ criterionId: "a", criterionName: "Rapor dili", aiVerdict: "UYGUN", judgeVerdict: "approved" }),
    // AI OLUMSUZ + bulgu onaylandı → gelişime açık yön, AI'nin gerekçesi/alıntısıyla.
    decided({ criterionId: "b", criterionName: "Boyut sınırı", aiVerdict: "OLUMSUZ", judgeVerdict: "approved" }),
    // AI UYGUN + bulgu reddedildi + hakem OLUMSUZ → hakemin gerekçesiyle.
    decided({
      criterionId: "c", criterionName: "Test planı", aiVerdict: "UYGUN", judgeVerdict: "rejected",
      judgeResult: "OLUMSUZ", rejectionReason: "Test planı yalnızca başlık; içerik yok.",
      evidenceMode: "RAPORDA_BULUNAMADI", missingContent: "Test planı içeriği",
    }),
  ];
  const feedback = buildJudgeFeedback(findings, decisions);
  assert.deepEqual(feedback.strengths, ["✓ Rapor dili"]);
  assert.equal(feedback.improvements.length, 2);
  assert.match(feedback.improvements[0], /Boyut sınırı/);
  assert.match(feedback.improvements[0], /Azami 100 cm aşılmış/);
  assert.match(feedback.improvements[0], /rapor s\. 6/);
  assert.match(feedback.improvements[1], /Test planı/);
  assert.match(feedback.improvements[1], /Raporda bulunamadı: Test planı içeriği/);
  assert.deepEqual(feedback.suggestions, [], "Gelişim Önerileri üretilmemelidir.");
});

test("nihai RET açıklaması deterministik şablondan gelir (AI çağrısı yok)", () => {
  const findings = [
    finding({ criterionId: "a", criterionName: "Rapor dili" }),
    finding({ criterionId: "b", criterionName: "Boyut sınırı", verdict: "KRITIK_HATA", rationale: "Azami 100 cm aşılmış." }),
  ];
  const decisions = [
    decided({ criterionId: "a", criterionName: "Rapor dili", judgeVerdict: "approved" }),
    decided({ criterionId: "b", criterionName: "Boyut sınırı", aiVerdict: "OLUMSUZ", judgeVerdict: "approved" }),
  ];
  const note = defaultOutcomeNote("rejected", findings, decisions);
  assert.match(note, /Rapor reddedildi/);
  assert.match(note, /Boyut sınırı/);
  assert.match(note, /Azami 100 cm aşılmış/);
  // Aynı girdi her zaman aynı çıktıyı üretir (deterministik).
  assert.equal(note, defaultOutcomeNote("rejected", findings, decisions));
  assert.match(defaultOutcomeNote("accepted", findings, decisions), /onaylandı/);
});
