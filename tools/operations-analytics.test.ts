import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationsAnalytics, type AnalyticsApplicationFact, type AnalyticsRegistrationFact } from "../app/lib/operations-analytics";
import { validateParticipantProfileInput } from "../app/lib/participant-profile";

const profile = {
  educationStatus: "lisans",
  educationGrade: "3. sınıf",
  institutionName: "İstanbul Teknik Üniversitesi",
  city: "İstanbul",
  gender: "kadin",
  discoverySource: "instagram",
  teknofestHistory: "ilk",
};

function application(overrides: Partial<AnalyticsApplicationFact> = {}): AnalyticsApplicationFact {
  return {
    ...profile,
    participantId: "p1",
    competitionKey: "deniz-araci",
    competitionName: "İnsansız Deniz Aracı",
    year: "2026",
    stage: "KTR",
    outcome: "accepted",
    teamSize: 3,
    judgeId: "j1",
    judgeName: "Hakem 1",
    evaluation: {
      findings: [{ criterionId: "c1", stage: "criteria_evidence" }],
    } as never,
    review: {
      status: "completed",
      criterionDecisions: [{
        criterionId: "c1",
        criterionName: "Motor sınırı",
        aiVerdict: "OLUMSUZ",
        judgeVerdict: "rejected",
        judgeResult: "OLUMSUZ",
      }],
    } as never,
    ...overrides,
  };
}

test("katılım profili eğitim durumuna uygun sınıf ister", () => {
  const valid = validateParticipantProfileInput(profile);
  assert.equal(valid.ok, true);
  const invalid = validateParticipantProfileInput({ ...profile, educationStatus: "lise", educationGrade: "3. sınıf" });
  assert.equal(invalid.ok, false);
});

test("başarı oranı yalnızca tamamlanmış nihai kararları kullanır", () => {
  const applications = [
    application({ participantId: "p1", outcome: "accepted" }),
    application({ participantId: "p2", outcome: "accepted" }),
    application({ participantId: "p3", outcome: "rejected" }),
    application({ participantId: "p4", outcome: "pending" }),
  ];
  const registrations = applications.map(({ participantId }) => ({ participantId, ...profile })) as AnalyticsRegistrationFact[];
  const result = buildOperationsAnalytics(applications, registrations);
  assert.equal(result.sample.completed, 3);
  assert.equal(result.sample.pending, 1);
  assert.equal(result.sample.successRate, 67);
});

test("AI bulgusu kullanımı ile nihai sonuç uyumunu birbirinden ayırır", () => {
  const first = application({ participantId: "p1" });
  const second = application({
    participantId: "p2",
    review: {
      status: "completed",
      criterionDecisions: [{ criterionId: "c1", criterionName: "Motor sınırı", aiVerdict: "OLUMSUZ", judgeVerdict: "approved", judgeResult: null }],
    } as never,
  });
  const result = buildOperationsAnalytics([first, second], []);
  assert.equal(result.aiJudge.overall.findingReuseRate, 50);
  assert.equal(result.aiJudge.overall.finalVerdictAgreementRate, 100);
  assert.equal(result.aiJudge.overall.sameResultRewritten, 1);
});

test("dinamik filtre bütün grafiklerde aynı başvuru kümesini kullanır", () => {
  const result = buildOperationsAnalytics([
    application({ participantId: "p1", city: "İstanbul" }),
    application({ participantId: "p2", city: "Ankara" }),
  ], [], { city: "Ankara" });
  assert.equal(result.sample.applications, 1);
  assert.equal(result.dimensions.cities[0]?.key, "Ankara");
});
