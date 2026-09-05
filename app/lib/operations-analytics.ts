import { effectiveVerdictOf } from "./judge-review";
import {
  DISCOVERY_SOURCE_LABELS,
  EDUCATION_STATUS_LABELS,
  GENDER_LABELS,
  TEKNOFEST_HISTORY_LABELS,
} from "./participant-profile";
import { CHECK_STAGES, type JudgeReview, type ReportEvaluation } from "./types";
import type {
  AcquisitionBreakdownRow,
  AnalyticsBreakdownRow,
  AnalyticsOption,
  JudgeAlignmentRow,
  OperationsAnalytics,
  OperationsAnalyticsFilters,
} from "./workflow-types";

export const ANALYTICS_MINIMUM_RATE_SAMPLE = 3;

export type AnalyticsProfileFact = {
  educationStatus: string;
  educationGrade: string;
  institutionName: string;
  city: string;
  gender: string | null;
  discoverySource: string;
  teknofestHistory: string;
};

export type AnalyticsApplicationFact = AnalyticsProfileFact & {
  participantId: string;
  competitionKey: string;
  competitionName: string;
  year: string;
  stage: string;
  outcome: "pending" | "accepted" | "rejected" | "revision_required";
  teamSize: number;
  judgeId: string;
  judgeName: string;
  review: JudgeReview | null;
  evaluation: ReportEvaluation | null;
};

export type AnalyticsRegistrationFact = AnalyticsProfileFact & { participantId: string };

const OUTCOME_LABELS: Record<string, string> = {
  pending: "Karar bekliyor",
  accepted: "Onaylandı",
  rejected: "Reddedildi",
  revision_required: "Düzeltme istendi",
};

function percent(numerator: number, denominator: number): number | null {
  return denominator ? Math.round((numerator / denominator) * 100) : null;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator >= ANALYTICS_MINIMUM_RATE_SAMPLE ? percent(numerator, denominator) : null;
}

export function teamSizeBucket(size: number): string {
  if (size <= 1) return "1";
  if (size <= 3) return "2-3";
  if (size <= 5) return "4-5";
  return "6+";
}

function profileMatches(profile: AnalyticsProfileFact, filters: OperationsAnalyticsFilters): boolean {
  return (!filters.educationStatus || profile.educationStatus === filters.educationStatus)
    && (!filters.institutionName || profile.institutionName === filters.institutionName)
    && (!filters.city || profile.city === filters.city)
    && (!filters.gender || (profile.gender ?? "belirtilmedi") === filters.gender)
    && (!filters.discoverySource || profile.discoverySource === filters.discoverySource)
    && (!filters.teknofestHistory || profile.teknofestHistory === filters.teknofestHistory);
}

function applicationMatches(fact: AnalyticsApplicationFact, filters: OperationsAnalyticsFilters): boolean {
  return profileMatches(fact, filters)
    && (!filters.competitionKey || fact.competitionKey === filters.competitionKey)
    && (!filters.year || fact.year === filters.year)
    && (!filters.stage || fact.stage === filters.stage)
    && (!filters.outcome || fact.outcome === filters.outcome)
    && (!filters.teamSize || teamSizeBucket(fact.teamSize) === filters.teamSize);
}

function stats(key: string, label: string, facts: AnalyticsApplicationFact[]): AnalyticsBreakdownRow {
  const completed = facts.filter((item) => item.outcome !== "pending");
  const accepted = completed.filter((item) => item.outcome === "accepted").length;
  return {
    key,
    label,
    total: facts.length,
    completed: completed.length,
    accepted,
    rejected: completed.filter((item) => item.outcome === "rejected").length,
    revision: completed.filter((item) => item.outcome === "revision_required").length,
    successRate: rate(accepted, completed.length),
  };
}

function groupStats(
  facts: AnalyticsApplicationFact[],
  keyOf: (fact: AnalyticsApplicationFact) => string,
  labelOf: (key: string) => string,
): AnalyticsBreakdownRow[] {
  const groups = new Map<string, AnalyticsApplicationFact[]>();
  for (const fact of facts) {
    const key = keyOf(fact) || "belirtilmedi";
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  return [...groups.entries()]
    .map(([key, values]) => stats(key, labelOf(key), values))
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, "tr"));
}

function optionRows(
  facts: AnalyticsApplicationFact[],
  keyOf: (fact: AnalyticsApplicationFact) => string,
  labelOf: (key: string) => string,
): AnalyticsOption[] {
  return groupStats(facts, keyOf, labelOf).map((item) => ({ value: item.key, label: item.label, count: item.total }));
}

type AlignmentItem = {
  judgeId: string;
  judgeName: string;
  stage: string;
  criterionName: string;
  approved: boolean;
  rejected: boolean;
  finalMatches: boolean;
  sameResultRewritten: boolean;
  aiVerdict: "UYGUN" | "OLUMSUZ";
  finalVerdict: "UYGUN" | "OLUMSUZ";
};

function alignmentRow(key: string, label: string, items: AlignmentItem[]): JudgeAlignmentRow {
  const approved = items.filter((item) => item.approved).length;
  const matches = items.filter((item) => item.finalMatches).length;
  return {
    key,
    label,
    decisions: items.length,
    findingsApproved: approved,
    findingsRejected: items.filter((item) => item.rejected).length,
    findingReuseRate: percent(approved, items.length),
    finalVerdictMatches: matches,
    finalVerdictAgreementRate: percent(matches, items.length),
    sameResultRewritten: items.filter((item) => item.sameResultRewritten).length,
  };
}

function alignmentGroups(items: AlignmentItem[], keyOf: (item: AlignmentItem) => string, labelOf: (key: string) => string) {
  const groups = new Map<string, AlignmentItem[]>();
  for (const item of items) {
    const key = keyOf(item) || "belirtilmedi";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([key, values]) => alignmentRow(key, labelOf(key), values))
    .sort((left, right) => right.decisions - left.decisions || left.label.localeCompare(right.label, "tr"));
}

const label = {
  education: (key: string) => EDUCATION_STATUS_LABELS[key as keyof typeof EDUCATION_STATUS_LABELS] ?? "Belirtilmedi",
  gender: (key: string) => GENDER_LABELS[key as keyof typeof GENDER_LABELS] ?? "Belirtilmedi",
  discovery: (key: string) => DISCOVERY_SOURCE_LABELS[key as keyof typeof DISCOVERY_SOURCE_LABELS] ?? "Belirtilmedi",
  history: (key: string) => TEKNOFEST_HISTORY_LABELS[key as keyof typeof TEKNOFEST_HISTORY_LABELS] ?? "Belirtilmedi",
  outcome: (key: string) => OUTCOME_LABELS[key] ?? key,
  team: (key: string) => key === "1" ? "Bireysel" : `${key} kişi`,
  stage: (key: string) => CHECK_STAGES.find((stage) => stage.id === key)?.shortTitle ?? (key || "Belirtilmedi"),
};

export function buildOperationsAnalytics(
  allApplications: AnalyticsApplicationFact[],
  allRegistrations: AnalyticsRegistrationFact[],
  filters: OperationsAnalyticsFilters = {},
): OperationsAnalytics {
  const applications = allApplications.filter((item) => applicationMatches(item, filters));
  const registrations = allRegistrations.filter((item) => profileMatches(item, filters));
  const completed = applications.filter((item) => item.outcome !== "pending");
  const accepted = completed.filter((item) => item.outcome === "accepted").length;

  const registrationIdsBySource = new Map<string, Set<string>>();
  for (const item of registrations) {
    const key = item.discoverySource || "belirtilmedi";
    const ids = registrationIdsBySource.get(key) ?? new Set<string>();
    ids.add(item.participantId);
    registrationIdsBySource.set(key, ids);
  }
  const acquisitionKeys = new Set([
    ...applications.map((item) => item.discoverySource || "belirtilmedi"),
    ...registrations.map((item) => item.discoverySource || "belirtilmedi"),
  ]);
  const acquisition = [...acquisitionKeys]
    .map((key) => stats(key, label.discovery(key), applications.filter((item) => item.discoverySource === key)))
    .map<AcquisitionBreakdownRow>((row) => {
      const applicantIds = new Set(applications.filter((item) => item.discoverySource === row.key).map((item) => item.participantId));
      const registrationCount = registrationIdsBySource.get(row.key)?.size ?? 0;
      return {
        ...row,
        registrations: registrationCount,
        applicants: applicantIds.size,
        applicationConversionRate: rate(applicantIds.size, registrationCount),
      };
    })
    .sort((left, right) => right.registrations - left.registrations || right.total - left.total || left.label.localeCompare(right.label, "tr"));

  const alignmentItems: AlignmentItem[] = [];
  for (const fact of applications) {
    if (fact.review?.status !== "completed" || !fact.review.criterionDecisions?.length) continue;
    const stageByCriterion = new Map((fact.evaluation?.findings ?? []).map((finding) => [finding.criterionId, finding.stage]));
    for (const decision of fact.review.criterionDecisions) {
      const finalVerdict = effectiveVerdictOf(decision);
      if (!finalVerdict) continue;
      alignmentItems.push({
        judgeId: fact.judgeId || "belirtilmedi",
        judgeName: fact.judgeName || "Hakem belirtilmedi",
        stage: stageByCriterion.get(decision.criterionId) ?? "belirtilmedi",
        criterionName: decision.criterionName || decision.criterionId,
        approved: decision.judgeVerdict === "approved",
        rejected: decision.judgeVerdict === "rejected",
        finalMatches: finalVerdict === decision.aiVerdict,
        sameResultRewritten: decision.judgeVerdict === "rejected" && finalVerdict === decision.aiVerdict,
        aiVerdict: decision.aiVerdict,
        finalVerdict,
      });
    }
  }
  const overrideCounts = new Map<string, number>();
  for (const item of alignmentItems.filter((entry) => entry.rejected)) {
    overrideCounts.set(item.criterionName, (overrideCounts.get(item.criterionName) ?? 0) + 1);
  }

  const insights: string[] = [];
  if (completed.length < ANALYTICS_MINIMUM_RATE_SAMPLE) {
    insights.push(`Başarı ilişkisi için en az ${ANALYTICS_MINIMUM_RATE_SAMPLE} tamamlanmış karar gerekir; mevcut örneklem ${completed.length}.`);
  } else {
    const sourceLeader = acquisition.filter((item) => item.successRate !== null).sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0];
    if (sourceLeader) insights.push(`${sourceLeader.label}, ${sourceLeader.completed} tamamlanmış başvuruda %${sourceLeader.successRate} onay oranıyla öne çıkıyor.`);
    const historyRows = groupStats(applications, (item) => item.teknofestHistory, label.history).filter((item) => item.successRate !== null);
    if (historyRows.length >= 2) {
      const best = [...historyRows].sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0];
      insights.push(`${best.label} grubunda onay oranı %${best.successRate}; bu ilişki nedensellik değil, incelenmesi gereken bir örüntüdür.`);
    }
  }
  if (alignmentItems.length) {
    const overall = alignmentRow("overall", "Tüm hakemler", alignmentItems);
    insights.push(`Hakemler ${overall.decisions} AI bulgusunun %${overall.findingReuseRate ?? 0}'ini olduğu gibi kullandı; nihai kriter sonucu uyumu %${overall.finalVerdictAgreementRate ?? 0}.`);
  } else {
    insights.push("AI–hakem uyumu için tamamlanmış kriter kararları henüz bulunmuyor.");
  }

  const overallAlignment = alignmentRow("overall", "Tüm hakemler", alignmentItems);
  return {
    generatedAt: new Date().toISOString(),
    minimumRateSample: ANALYTICS_MINIMUM_RATE_SAMPLE,
    filters,
    options: {
      competitions: optionRows(allApplications, (item) => item.competitionKey, (key) => allApplications.find((item) => item.competitionKey === key)?.competitionName ?? key),
      years: optionRows(allApplications, (item) => item.year, (key) => key),
      stages: optionRows(allApplications, (item) => item.stage, label.stage),
      outcomes: optionRows(allApplications, (item) => item.outcome, label.outcome),
      educationStatuses: optionRows(allApplications, (item) => item.educationStatus, label.education),
      institutions: optionRows(allApplications, (item) => item.institutionName, (key) => key || "Belirtilmedi"),
      cities: optionRows(allApplications, (item) => item.city, (key) => key || "Belirtilmedi"),
      genders: optionRows(allApplications, (item) => item.gender ?? "belirtilmedi", label.gender),
      discoverySources: [...new Set([
        ...allApplications.map((item) => item.discoverySource || "belirtilmedi"),
        ...allRegistrations.map((item) => item.discoverySource || "belirtilmedi"),
      ])].map((key) => ({
        value: key,
        label: label.discovery(key),
        count: allRegistrations.filter((item) => item.discoverySource === key).length,
      })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "tr")),
      teknofestHistories: optionRows(allApplications, (item) => item.teknofestHistory, label.history),
      teamSizes: optionRows(allApplications, (item) => teamSizeBucket(item.teamSize), label.team),
    },
    sample: {
      registrations: new Set(registrations.map((item) => item.participantId)).size,
      applications: applications.length,
      completed: completed.length,
      pending: applications.length - completed.length,
      accepted,
      rejected: completed.filter((item) => item.outcome === "rejected").length,
      revision: completed.filter((item) => item.outcome === "revision_required").length,
      successRate: rate(accepted, completed.length),
    },
    dimensions: {
      acquisition,
      education: groupStats(applications, (item) => item.educationStatus, label.education),
      institutions: groupStats(applications, (item) => item.institutionName, (key) => key || "Belirtilmedi"),
      cities: groupStats(applications, (item) => item.city, (key) => key || "Belirtilmedi"),
      genders: groupStats(applications, (item) => item.gender ?? "belirtilmedi", label.gender),
      teknofestHistory: groupStats(applications, (item) => item.teknofestHistory, label.history),
      teamSizes: groupStats(applications, (item) => teamSizeBucket(item.teamSize), label.team),
    },
    aiJudge: {
      overall: overallAlignment,
      byJudge: alignmentGroups(alignmentItems, (item) => item.judgeId, (key) => alignmentItems.find((item) => item.judgeId === key)?.judgeName ?? key),
      byStage: alignmentGroups(alignmentItems, (item) => item.stage, label.stage),
      matrix: {
        aiUygunJudgeUygun: alignmentItems.filter((item) => item.aiVerdict === "UYGUN" && item.finalVerdict === "UYGUN").length,
        aiUygunJudgeOlumsuz: alignmentItems.filter((item) => item.aiVerdict === "UYGUN" && item.finalVerdict === "OLUMSUZ").length,
        aiOlumsuzJudgeUygun: alignmentItems.filter((item) => item.aiVerdict === "OLUMSUZ" && item.finalVerdict === "UYGUN").length,
        aiOlumsuzJudgeOlumsuz: alignmentItems.filter((item) => item.aiVerdict === "OLUMSUZ" && item.finalVerdict === "OLUMSUZ").length,
      },
      topOverrides: [...overrideCounts.entries()]
        .map(([criterionName, count]) => ({ criterionName, count }))
        .sort((left, right) => right.count - left.count || left.criterionName.localeCompare(right.criterionName, "tr"))
        .slice(0, 8),
    },
    insights,
  };
}
