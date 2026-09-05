/**
 * Katılım ve karar analitiği — saf hesap katmanı testleri.
 *
 *   - Eski başvurular "Belirtilmedi" değerleriyle çalışır.
 *   - Bekleyen başvurular başarı oranının paydasına girmez; düzeltme ayrı sayılır.
 *   - Üçten az tamamlanmış kararda oran üretilmez ("Örneklem yetersiz").
 *   - Dinamik filtre bütün kırılımlarda AYNI veri kümesini kullanır.
 *   - Kurum kırılımında katılımcı kişi bazlı, başvuru başvuru başına bir kez.
 *   - Duyuru kaynağı üye sayısıyla çoğaltılmaz.
 *   - AI bulgusu kullanımı ile nihai sonuç uyumu birbirinden ayrıdır.
 *   - Filtre allowlist'i bilinmeyen anahtar/değeri reddeder.
 *   - Çıktı kişi adı, e-posta veya gerekçe taşımaz; hakemler anonimdir.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGREEMENT_DISCLAIMER,
  INSUFFICIENT_SAMPLE_NOTE,
  MIN_DECIDED_FOR_RATE,
  applyAnalyticsFilters,
  buildAgreementSummary,
  buildParticipationAnalytics,
  knownFilterValues,
  parseAnalyticsFilters,
  teamSizeBucketOf,
  type AnalyticsApplicationRecord,
  type AnalyticsCriterionDecision,
  type AnalyticsMember,
} from "../app/lib/participation-analytics.ts";
import { UNSPECIFIED, UNSPECIFIED_LABEL } from "../app/lib/team-profile.ts";

function member(patch: Partial<AnalyticsMember> = {}): AnalyticsMember {
  return {
    isApplicant: false, gender: "female", educationLevel: "bachelor", gradeLevel: "2",
    institution: "ODTÜ", city: "Ankara", teknofestHistory: "first", ...patch,
  };
}

function record(patch: Partial<AnalyticsApplicationRecord> & { id: string }): AnalyticsApplicationRecord {
  const members = patch.members ?? [member({ isApplicant: true })];
  return {
    competitionKey: "roket", competitionName: "Roket Yarışması", submittedAt: "2026-05-01T10:00:00.000Z",
    status: "completed", outcome: "accepted", teamSize: members.length, discoverySource: "instagram",
    criterionDecisions: [], ...patch, members,
  };
}

function decision(patch: Partial<AnalyticsCriterionDecision> = {}): AnalyticsCriterionDecision {
  return {
    criterionId: "c1", criterionName: "Kaynak gösterimi", stage: "language_template",
    aiVerdict: "UYGUN", judgeVerdict: "approved", judgeResult: null, judgeKey: "judge-a", ...patch,
  };
}

const LEGACY = record({
  id: "legacy",
  members: [member({
    isApplicant: true, gender: UNSPECIFIED, educationLevel: UNSPECIFIED, gradeLevel: UNSPECIFIED,
    institution: UNSPECIFIED, city: UNSPECIFIED, teknofestHistory: UNSPECIFIED,
  })],
  discoverySource: UNSPECIFIED,
  status: "awaiting_judge",
  outcome: "pending",
});

test("eski başvurular Belirtilmedi değerleriyle çalışır ve sayılır", () => {
  const analytics = buildParticipationAnalytics([LEGACY], {});
  assert.equal(analytics.totals.applications, 1);
  assert.equal(analytics.totals.participants, 1, "Eski başvuruda başvuru sahibi örtük olarak sayılır.");
  for (const key of ["gender", "education", "grade", "institution", "city", "history", "source"] as const) {
    const row = analytics.breakdowns[key].find((item) => item.key === UNSPECIFIED);
    assert.ok(row, `${key} kırılımında Belirtilmedi satırı olmalı.`);
    assert.equal(row.label, UNSPECIFIED_LABEL);
  }
  assert.equal(analytics.breakdowns.teamSize[0].key, "1");
  assert.equal(analytics.totals.approvalRate, null);
});

test("bekleyen başvurular başarı oranının paydasına girmez; düzeltme ayrı gösterilir", () => {
  const records = [
    record({ id: "a", outcome: "accepted" }),
    record({ id: "b", outcome: "accepted" }),
    record({ id: "c", outcome: "rejected" }),
    record({ id: "d", outcome: "revision_required" }),
    record({ id: "e", status: "awaiting_judge", outcome: "pending" }),
    record({ id: "f", status: "judge_in_review", outcome: "pending" }),
    // Taslak sonuç "kabul" yazsa bile karar tamamlanmadıysa bekleyendir.
    record({ id: "g", status: "judge_in_review", outcome: "accepted" }),
  ];
  const { totals } = buildParticipationAnalytics(records, {});
  assert.equal(totals.applications, 7);
  assert.equal(totals.pending, 3);
  assert.equal(totals.decided, 4, "Karar = onay + ret + düzeltme.");
  assert.equal(totals.accepted, 2);
  assert.equal(totals.rejected, 1);
  assert.equal(totals.revision, 1);
  assert.equal(totals.approvalRate, 50, "2 onay / 4 tamamlanmış karar; bekleyen 3 başvuru paydada değil.");
});

test("küçük örneklemde başarı oranı gösterilmez", () => {
  const two = buildParticipationAnalytics([record({ id: "a" }), record({ id: "b" })], {});
  assert.equal(two.totals.decided, 2);
  assert.equal(two.totals.approvalRate, null);
  assert.equal(two.totals.sampleNote, INSUFFICIENT_SAMPLE_NOTE);
  const three = buildParticipationAnalytics([record({ id: "a" }), record({ id: "b" }), record({ id: "c", outcome: "rejected" })], {});
  assert.equal(three.totals.approvalRate, 67);
  assert.equal(three.totals.sampleNote, "");
  assert.equal(MIN_DECIDED_FOR_RATE, 3);
  // Kırılım satırlarında da aynı kural: 2 kararlı grup oran almaz.
  const rows = three.breakdowns.city;
  assert.ok(rows.every((row) => row.decided < 3 ? row.approvalRate === null : row.approvalRate !== null));
  // Uyum ölçümleri de küçük örneklemde oran üretmez.
  const agreement = buildAgreementSummary(applyAnalyticsFilters([record({ id: "x", criterionDecisions: [decision(), decision({ criterionId: "c2" })] })], {}));
  assert.equal(agreement.usageRate, null);
  assert.equal(agreement.sampleNote, INSUFFICIENT_SAMPLE_NOTE);
});

test("dinamik filtre bütün kırılımlarda aynı veri kümesini kullanır", () => {
  const records = [
    record({ id: "ank-1", members: [member({ isApplicant: true, city: "Ankara" }), member({ city: "Ankara", gender: "male" })] }),
    record({ id: "ank-2", members: [member({ isApplicant: true, city: "Ankara", educationLevel: "master", gradeLevel: "thesis" })], discoverySource: "youtube" }),
    record({ id: "ist-1", competitionKey: "iha", competitionName: "İHA", members: [member({ isApplicant: true, city: "İstanbul" })] }),
    record({ id: "izm-1", members: [member({ isApplicant: true, city: "İzmir" })], submittedAt: "2025-04-01T00:00:00.000Z" }),
  ];
  const filtered = buildParticipationAnalytics(records, { city: "Ankara", year: "2026" });
  const sum = (rows: Array<{ applications: number }>) => rows.reduce((total, row) => total + row.applications, 0);
  assert.equal(filtered.totals.applications, 2);
  assert.equal(filtered.totals.participants, 3, "Ankara üyeleri: 2 + 1.");
  // Başvuru bazlı kırılımların toplamı = filtrelenmiş başvuru sayısı.
  assert.equal(sum(filtered.breakdowns.teamSize), 2);
  assert.equal(sum(filtered.breakdowns.source), 2);
  // Kişi bazlı kırılımların katılımcı toplamı = filtrelenmiş üye sayısı.
  for (const key of ["gender", "education", "grade", "institution", "city", "history"] as const) {
    const participants = filtered.breakdowns[key].reduce((total, row) => total + (row.participants ?? 0), 0);
    assert.equal(participants, 3, `${key} kırılımı aynı veri kümesini kullanmalı.`);
  }
  assert.deepEqual(filtered.breakdowns.city.map((row) => row.key), ["Ankara"], "Filtre dışı şehir hiçbir kırılımda görünmez.");
  assert.ok(filtered.breakdowns.source.some((row) => row.key === "youtube"));
  // Aynı filtre uygulanmadan üretilen küme farklıdır: filtre gerçekten etkilidir.
  const all = buildParticipationAnalytics(records, {});
  assert.equal(all.totals.applications, 4);
  assert.deepEqual(all.options.years, ["2026", "2025"]);
  assert.equal(all.options.competitions.length, 2);
  // Kişi bazlı filtre: eşleşen üyesi olmayan başvuru düşer; eşleşen üyeler kalır.
  const men = buildParticipationAnalytics(records, { gender: "male" });
  assert.equal(men.totals.applications, 1);
  assert.equal(men.totals.participants, 1);
});

test("kurum kırılımı: katılımcı kişi bazlı, başvuru başvuru başına bir kez", () => {
  const records = [
    record({ id: "a", members: [member({ isApplicant: true, institution: "ODTÜ" }), member({ institution: "ODTÜ" }), member({ institution: "ODTÜ" })] }),
    record({ id: "b", members: [member({ isApplicant: true, institution: "ODTÜ" }), member({ institution: "İTÜ" })], outcome: "rejected" }),
  ];
  const { breakdowns } = buildParticipationAnalytics(records, {});
  const odtu = breakdowns.institution.find((row) => row.key === "ODTÜ");
  const itu = breakdowns.institution.find((row) => row.key === "İTÜ");
  assert.ok(odtu && itu);
  assert.equal(odtu.participants, 4, "Kişi bazlı: 3 + 1.");
  assert.equal(odtu.applications, 2, "Başvuru bazlı: aynı başvurudaki üç kişi bir başvuru sayılır.");
  assert.equal(odtu.accepted, 1);
  assert.equal(odtu.rejected, 1);
  assert.equal(itu.participants, 1);
  assert.equal(itu.applications, 1);
});

test("duyuru kaynağı kişi sayısıyla çoğaltılmaz", () => {
  const records = [
    record({ id: "a", members: [member({ isApplicant: true }), member(), member(), member(), member()], discoverySource: "instagram" }),
    record({ id: "b", members: [member({ isApplicant: true })], discoverySource: "instagram" }),
    record({ id: "c", members: [member({ isApplicant: true }), member()], discoverySource: "tiktok" }),
  ];
  const { breakdowns, totals, notes } = buildParticipationAnalytics(records, {});
  const instagram = breakdowns.source.find((row) => row.key === "instagram");
  assert.ok(instagram);
  assert.equal(instagram.applications, 2, "6 kişi değil, 2 başvuru.");
  assert.equal(instagram.participants, null, "Kaynak kırılımı katılımcı sayısı taşımaz.");
  assert.equal(breakdowns.source.reduce((sum, row) => sum + row.applications, 0), totals.applications);
  assert.ok(notes.some((note) => /Instagram 2 başvuruyla/.test(note)), "Yönetim notu başvuru sayısını söylemeli.");
  assert.ok(notes.every((note) => !/daha başarılı öğrenci|sebep|neden oldu/.test(note)), "Sebep-sonuç iddiası üretilmemeli.");
  assert.deepEqual(breakdowns.teamSize.map((row) => [row.key, row.applications]), [["1", 1], ["2", 1], ["4-5", 1]]);
  assert.equal(teamSizeBucketOf(7), "6+");
});

test("AI bulgusu kullanımı ile nihai sonuç uyumu ayrılır", () => {
  const decisions: AnalyticsCriterionDecision[] = [
    // Onay: olduğu gibi kullanıldı, sonuç aynı.
    decision({ criterionId: "c1", aiVerdict: "UYGUN" }),
    decision({ criterionId: "c2", aiVerdict: "OLUMSUZ", stage: "criteria_evidence" }),
    // Ret ama nihai sonuç AI ile aynı (açıklama değişti).
    decision({ criterionId: "c3", aiVerdict: "UYGUN", judgeVerdict: "rejected", judgeResult: "UYGUN", stage: "headings_content" }),
    // Ret ve sonuç değişti.
    decision({ criterionId: "c4", aiVerdict: "UYGUN", judgeVerdict: "rejected", judgeResult: "OLUMSUZ", criterionName: "Başlık kontrolü", stage: "headings_content" }),
    decision({ criterionId: "c5", aiVerdict: "OLUMSUZ", judgeVerdict: "rejected", judgeResult: "UYGUN", criterionName: "Başlık kontrolü", judgeKey: "judge-b", stage: "headings_content" }),
  ];
  const dataset = applyAnalyticsFilters([record({ id: "a", criterionDecisions: decisions })], {});
  const summary = buildAgreementSummary(dataset);
  assert.equal(summary.total, 5);
  assert.equal(summary.approved, 2);
  assert.equal(summary.rejected, 3);
  assert.equal(summary.rejectedSameOutcome, 1);
  assert.equal(summary.usageRate, 40, "Olduğu gibi kullanma: 2/5.");
  assert.equal(summary.outcomeAgreementRate, 60, "Nihai sonuç uyumu: (2 + 1)/5.");
  assert.notEqual(summary.usageRate, summary.outcomeAgreementRate, "İki metrik ayrı raporlanmalı.");
  assert.deepEqual(summary.matrix, { uygunUygun: 2, uygunOlumsuz: 1, olumsuzUygun: 1, olumsuzOlumsuz: 1 });
  assert.deepEqual(summary.byJudge.map((row) => row.label), ["Hakem 1", "Hakem 2"], "Hakemler anonim etiket alır.");
  assert.ok(!JSON.stringify(summary).includes("judge-a"), "Hakem kimliği çıktıya sızmamalı.");
  assert.equal(summary.byStage.find((row) => row.key === "headings_content")?.total, 3);
  assert.equal(summary.mostReevaluated[0].criterionName, "Başlık kontrolü");
  assert.equal(summary.mostReevaluated[0].rejected, 2);
  assert.equal(summary.disclaimer, AGREEMENT_DISCLAIMER);
  assert.match(AGREEMENT_DISCLAIMER, /AI doğruluk puanı veya hakem performans notu değildir/);
  // Tamamlanmamış inceleme kaydı taşımaz: bekleyen başvuru uyum sayacına girmez.
  const pendingOnly = buildAgreementSummary(applyAnalyticsFilters([record({ id: "p", status: "judge_in_review", outcome: "pending" })], {}));
  assert.equal(pendingOnly.total, 0);
});

test("filtre allowlist'i bilinmeyen anahtar ve değeri reddeder", () => {
  const records = [record({ id: "a" }), record({ id: "b", competitionKey: "iha", competitionName: "İHA" })];
  const known = knownFilterValues(records);
  const ok = parseAnalyticsFilters(Object.entries({ competition: "iha", year: "2026", stage: "completed", outcome: "accepted", education: "bachelor", grade: "2", institution: "ODTÜ", city: "Ankara", gender: "female", history: "first", teamSize: "4-5", source: "instagram" }), known);
  assert.deepEqual(ok.invalid, []);
  assert.equal(Object.keys(ok.filters).length, 12);

  const bad = parseAnalyticsFilters(Object.entries({ participantName: "Ada", city: "Atlantis", stage: "DROP TABLE", year: "20x6", competition: "yok" }), known);
  assert.deepEqual([...bad.invalid].sort(), ["city", "competition", "participantName", "stage", "year"].sort());
  assert.deepEqual(bad.filters, {});
  // Boş değer "filtre yok" demektir; hata değildir.
  assert.deepEqual(parseAnalyticsFilters([["city", ""]], known), { filters: {}, invalid: [] });
});

test("analitik çıktısı kişi adı, e-posta, PDF metni veya gerekçe alanı taşımaz", () => {
  const analytics = buildParticipationAnalytics([record({ id: "a", criterionDecisions: [decision(), decision({ criterionId: "c2" }), decision({ criterionId: "c3" })] })], {});
  const serialized = JSON.stringify(analytics);
  for (const forbidden of ["fullName", "participantName", "participantEmail", "email", "rationale", "rejectionReason", "evidenceQuote", "outcomeNote", "overallNote", "fileName", "judgeKey", "judgeName"]) {
    assert.ok(!serialized.includes(`"${forbidden}"`), `Analitik yanıtı '${forbidden}' alanı taşımamalı.`);
  }
});
