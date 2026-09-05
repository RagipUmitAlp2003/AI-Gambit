import { CHECK_STAGES, type CheckStage } from "./types";
import type { ApplicationOutcome, ApplicationStatus } from "./workflow-types";
import {
  DISCOVERY_SOURCE_OPTIONS,
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  GRADE_OPTIONS_BY_EDUCATION,
  TEKNOFEST_HISTORY_OPTIONS,
  UNSPECIFIED,
  UNSPECIFIED_LABEL,
  gradeLabel,
  isEducationLevel,
  labelOf,
} from "./team-profile";

/**
 * Katılım ve karar analitiği — SAF, ortamdan bağımsız hesap katmanı.
 *
 * Girdi: başvuru başına bir kayıt (kişi adı, e-posta, PDF metni, hakem
 * gerekçesi TAŞIMAZ). Çıktı: yalnızca toplulaştırılmış sayaçlar ve oranlar.
 *
 * Kurallar:
 *   - Kişi bazlı boyutlarda (cinsiyet, eğitim, sınıf, kurum, şehir, TEKNOFEST
 *     geçmişi) her takım üyesi bir katılımcıdır; başvurunun sonucu üyelerine
 *     uygulanır ama aynı başvuru bir boyut değeri için BİR KEZ sayılır.
 *   - Duyuru kaynağı ve takım büyüklüğü BAŞVURU bazlıdır; üye sayısıyla
 *     çoğaltılmaz.
 *   - Başarı (onay) oranının paydası yalnızca KARARI TAMAMLANMIŞ başvurulardır;
 *     bekleyenler paydaya girmez, düzeltme istenenler ayrı gösterilir.
 *   - MIN_DECIDED_FOR_RATE'ten az kararı olan grupta oran ÜRETİLMEZ
 *     ("Örneklem yetersiz"): küçük gruplarda kişi belirlenebilir hâle gelmesin.
 *   - Yönetim notları deterministiktir; LLM çağrısı yoktur; korelasyon anlatır,
 *     sebep-sonuç iddia etmez.
 */

export const MIN_DECIDED_FOR_RATE = 3;
export const INSUFFICIENT_SAMPLE_NOTE = "Örneklem yetersiz";

export type AnalyticsMember = {
  isApplicant: boolean;
  gender: string;
  educationLevel: string;
  gradeLevel: string;
  institution: string;
  city: string;
  teknofestHistory: string;
};

export type AnalyticsCriterionDecision = {
  criterionId: string;
  criterionName: string;
  stage: CheckStage | string;
  aiVerdict: "UYGUN" | "OLUMSUZ";
  judgeVerdict: "approved" | "rejected";
  judgeResult: "UYGUN" | "OLUMSUZ" | null;
  /** Hakemin opak kimliği; çıktıya "Hakem N" etiketiyle dönüştürülür. */
  judgeKey: string;
};

export type AnalyticsApplicationRecord = {
  id: string;
  competitionKey: string;
  competitionName: string;
  submittedAt: string;
  status: ApplicationStatus;
  outcome: ApplicationOutcome;
  /** Başvuru sahibi dâhil. */
  teamSize: number;
  discoverySource: string;
  /** Başvuru sahibi dâhil bütün üyeler. */
  members: AnalyticsMember[];
  /** Yalnızca tamamlanmış hakem incelemesindeki, kesinleşmiş kriter kararları. */
  criterionDecisions: AnalyticsCriterionDecision[];
};

/* ------------------------------------------------------------------------- *
 * Filtreler — sunucuda allowlist ile doğrulanır
 * ------------------------------------------------------------------------- */

export const ANALYTICS_FILTER_KEYS = [
  "competition", "year", "stage", "outcome", "education", "grade", "institution",
  "city", "gender", "history", "teamSize", "source",
] as const;
export type AnalyticsFilterKey = typeof ANALYTICS_FILTER_KEYS[number];
export type AnalyticsFilters = Partial<Record<AnalyticsFilterKey, string>>;

/** Rapor/değerlendirme aşaması: başvuru durumlarının üç kovası. */
export type PipelineStage = "ai_pending" | "judge_pending" | "completed";
export const PIPELINE_STAGE_OPTIONS: ReadonlyArray<{ value: PipelineStage; label: string }> = [
  { value: "ai_pending", label: "AI ön değerlendirmesi bekliyor / sürüyor" },
  { value: "judge_pending", label: "Hakem değerlendirmesinde" },
  { value: "completed", label: "Karar tamamlandı" },
];

export function pipelineStageOf(status: ApplicationStatus): PipelineStage {
  if (status === "completed") return "completed";
  if (status === "awaiting_judge" || status === "judge_in_review") return "judge_pending";
  return "ai_pending";
}

export const OUTCOME_FILTER_OPTIONS: ReadonlyArray<{ value: ApplicationOutcome; label: string }> = [
  { value: "pending", label: "Bekliyor" },
  { value: "accepted", label: "Onaylandı" },
  { value: "rejected", label: "Reddedildi" },
  { value: "revision_required", label: "Düzeltme istendi" },
];

export type TeamSizeBucket = "1" | "2" | "3" | "4-5" | "6+";
export const TEAM_SIZE_BUCKETS: ReadonlyArray<{ value: TeamSizeBucket; label: string }> = [
  { value: "1", label: "1 kişi (bireysel)" },
  { value: "2", label: "2 kişi" },
  { value: "3", label: "3 kişi" },
  { value: "4-5", label: "4–5 kişi" },
  { value: "6+", label: "6 ve üzeri" },
];

export function teamSizeBucketOf(size: number): TeamSizeBucket {
  if (size <= 1) return "1";
  if (size === 2) return "2";
  if (size === 3) return "3";
  if (size <= 5) return "4-5";
  return "6+";
}

/** Tüm sınıf/eğitim aşaması değerleri (eğitim durumundan bağımsız birleşik allowlist). */
const ALL_GRADE_VALUES = new Set<string>(
  Object.values(GRADE_OPTIONS_BY_EDUCATION).flatMap((options) => options.map((option) => option.value)),
);

export type KnownFilterValues = {
  competitionKeys: Set<string>;
  institutions: Set<string>;
  cities: Set<string>;
};

export function knownFilterValues(records: AnalyticsApplicationRecord[]): KnownFilterValues {
  const known: KnownFilterValues = { competitionKeys: new Set(), institutions: new Set(), cities: new Set() };
  for (const record of records) {
    known.competitionKeys.add(record.competitionKey);
    for (const member of record.members) {
      known.institutions.add(member.institution);
      known.cities.add(member.city);
    }
  }
  return known;
}

export type ParsedFilters = { filters: AnalyticsFilters; invalid: string[] };

/**
 * Sorgu parametrelerini allowlist ile doğrular. Bilinmeyen anahtar veya
 * listede olmayan değer `invalid` listesine düşer; uç bu durumda 400 döner.
 * Boş değer "filtre yok" demektir.
 */
export function parseAnalyticsFilters(entries: Iterable<[string, string]>, known: KnownFilterValues): ParsedFilters {
  const filters: AnalyticsFilters = {};
  const invalid: string[] = [];
  const oneOf = (values: readonly string[]) => (value: string) => values.includes(value);
  const validators: Record<AnalyticsFilterKey, (value: string) => boolean> = {
    competition: (value) => known.competitionKeys.has(value),
    year: (value) => /^\d{4}$/.test(value),
    stage: oneOf(PIPELINE_STAGE_OPTIONS.map((option) => option.value)),
    outcome: oneOf(OUTCOME_FILTER_OPTIONS.map((option) => option.value)),
    education: (value) => value === UNSPECIFIED || isEducationLevel(value),
    grade: (value) => value === UNSPECIFIED || ALL_GRADE_VALUES.has(value),
    institution: (value) => known.institutions.has(value),
    city: (value) => known.cities.has(value),
    gender: (value) => value === UNSPECIFIED || GENDER_OPTIONS.some((option) => option.value === value),
    history: (value) => value === UNSPECIFIED || TEKNOFEST_HISTORY_OPTIONS.some((option) => option.value === value),
    teamSize: oneOf(TEAM_SIZE_BUCKETS.map((option) => option.value)),
    source: (value) => value === UNSPECIFIED || DISCOVERY_SOURCE_OPTIONS.some((option) => option.value === value),
  };
  for (const [rawKey, rawValue] of entries) {
    const value = String(rawValue ?? "").trim();
    if (!(ANALYTICS_FILTER_KEYS as readonly string[]).includes(rawKey)) { invalid.push(rawKey); continue; }
    const key = rawKey as AnalyticsFilterKey;
    if (!value) continue;
    if (value.length > 200 || !validators[key](value)) { invalid.push(key); continue; }
    filters[key] = value;
  }
  return { filters, invalid };
}

/* ------------------------------------------------------------------------- *
 * Filtre uygulama — her grafik ve tablo AYNI veri kümesini kullanır
 * ------------------------------------------------------------------------- */

export type DatasetMember = AnalyticsMember & { applicationId: string };

export type AnalyticsDataset = {
  applications: AnalyticsApplicationRecord[];
  /** Kalan başvuruların, kişi bazlı filtrelerle eşleşen üyeleri. */
  members: DatasetMember[];
};

function memberMatches(member: AnalyticsMember, filters: AnalyticsFilters): boolean {
  if (filters.education && member.educationLevel !== filters.education) return false;
  if (filters.grade && member.gradeLevel !== filters.grade) return false;
  if (filters.institution && member.institution !== filters.institution) return false;
  if (filters.city && member.city !== filters.city) return false;
  if (filters.gender && member.gender !== filters.gender) return false;
  if (filters.history && member.teknofestHistory !== filters.history) return false;
  return true;
}

function applicationMatches(record: AnalyticsApplicationRecord, filters: AnalyticsFilters): boolean {
  if (filters.competition && record.competitionKey !== filters.competition) return false;
  if (filters.year && record.submittedAt.slice(0, 4) !== filters.year) return false;
  if (filters.stage && pipelineStageOf(record.status) !== filters.stage) return false;
  if (filters.outcome && record.outcome !== filters.outcome) return false;
  if (filters.teamSize && teamSizeBucketOf(record.teamSize) !== filters.teamSize) return false;
  if (filters.source && record.discoverySource !== filters.source) return false;
  return true;
}

/**
 * Başvuru bazlı filtreler başvuruları eler; kişi bazlı filtreler üyeleri
 * eler ve en az bir eşleşen üyesi olmayan başvuruyu düşürür. Sonuç tek bir
 * veri kümesidir; bütün sayaçlar buradan türetilir.
 */
export function applyAnalyticsFilters(records: AnalyticsApplicationRecord[], filters: AnalyticsFilters): AnalyticsDataset {
  const applications: AnalyticsApplicationRecord[] = [];
  const members: DatasetMember[] = [];
  for (const record of records) {
    if (!applicationMatches(record, filters)) continue;
    const matching = record.members.filter((member) => memberMatches(member, filters));
    if (!matching.length) continue;
    applications.push(record);
    for (const member of matching) members.push({ ...member, applicationId: record.id });
  }
  return { applications, members };
}

/* ------------------------------------------------------------------------- *
 * Sayaçlar
 * ------------------------------------------------------------------------- */

export type OutcomeCounts = {
  applications: number;
  decided: number;
  pending: number;
  accepted: number;
  rejected: number;
  revision: number;
  /** accepted / decided · decided < MIN_DECIDED_FOR_RATE ise null. */
  approvalRate: number | null;
  sampleNote: string;
};

function outcomeCounts(applications: AnalyticsApplicationRecord[]): OutcomeCounts {
  let accepted = 0; let rejected = 0; let revision = 0; let pending = 0;
  for (const application of applications) {
    if (application.status !== "completed" || application.outcome === "pending") { pending += 1; continue; }
    if (application.outcome === "accepted") accepted += 1;
    else if (application.outcome === "rejected") rejected += 1;
    else revision += 1;
  }
  const decided = accepted + rejected + revision;
  const approvalRate = decided >= MIN_DECIDED_FOR_RATE ? Math.round((accepted / decided) * 100) : null;
  return {
    applications: applications.length,
    decided,
    pending,
    accepted,
    rejected,
    revision,
    approvalRate,
    sampleNote: approvalRate === null ? INSUFFICIENT_SAMPLE_NOTE : "",
  };
}

export type BreakdownRow = OutcomeCounts & {
  key: string;
  label: string;
  /** Kişi bazlı boyutlarda katılımcı sayısı; başvuru bazlı boyutlarda null. */
  participants: number | null;
};

export type BreakdownKey =
  | "gender" | "education" | "grade" | "institution" | "city" | "history" | "teamSize" | "source";

function labelForDimension(key: BreakdownKey, value: string, member?: AnalyticsMember): string {
  switch (key) {
    case "gender": return labelOf(GENDER_OPTIONS, value);
    case "education": return labelOf(EDUCATION_OPTIONS, value);
    case "grade": return member ? gradeLabel(member.educationLevel, value) : (value === UNSPECIFIED ? UNSPECIFIED_LABEL : value);
    case "history": return labelOf(TEKNOFEST_HISTORY_OPTIONS, value);
    case "source": return labelOf(DISCOVERY_SOURCE_OPTIONS, value);
    case "teamSize": return TEAM_SIZE_BUCKETS.find((bucket) => bucket.value === value)?.label ?? value;
    default: return value === UNSPECIFIED ? UNSPECIFIED_LABEL : value;
  }
}

const MEMBER_FIELD: Record<Exclude<BreakdownKey, "teamSize" | "source">, keyof AnalyticsMember> = {
  gender: "gender",
  education: "educationLevel",
  grade: "gradeLevel",
  institution: "institution",
  city: "city",
  history: "teknofestHistory",
};

/**
 * Kişi bazlı kırılım: katılımcı sayısı KİŞİ bazlı, başvuru ve sonuç sayıları
 * ise değeri taşıyan her başvuru için BİR kez sayılır (aynı başvuruda aynı
 * kurumdan üç kişi varsa kurum 3 katılımcı, 1 başvuru alır).
 */
function personBreakdown(dataset: AnalyticsDataset, key: Exclude<BreakdownKey, "teamSize" | "source">): BreakdownRow[] {
  const field = MEMBER_FIELD[key];
  const byId = new Map(dataset.applications.map((application) => [application.id, application]));
  const groups = new Map<string, { participants: number; applications: Map<string, AnalyticsApplicationRecord>; sample: AnalyticsMember }>();
  for (const member of dataset.members) {
    const value = String(member[field] ?? "") || UNSPECIFIED;
    // Sınıf değeri eğitim durumuna göre etiketlenir; aynı "1" hem ön lisans hem
    // lisans olabilir. Kırılım anahtarı bu yüzden eğitimle nitelenir.
    const groupKey = key === "grade" && value !== UNSPECIFIED ? `${member.educationLevel}:${value}` : value;
    const group = groups.get(groupKey) ?? { participants: 0, applications: new Map(), sample: member };
    group.participants += 1;
    const application = byId.get(member.applicationId);
    if (application) group.applications.set(application.id, application);
    groups.set(groupKey, group);
  }
  return [...groups.entries()]
    .map(([groupKey, group]) => {
      const value = key === "grade" && groupKey.includes(":") ? groupKey.slice(groupKey.indexOf(":") + 1) : groupKey;
      const baseLabel = labelForDimension(key, value, group.sample);
      const label = key === "grade" && groupKey.includes(":")
        ? `${labelOf(EDUCATION_OPTIONS, group.sample.educationLevel)} · ${baseLabel}`
        : baseLabel;
      return { key: groupKey, label, participants: group.participants, ...outcomeCounts([...group.applications.values()]) };
    })
    .sort((left, right) => right.applications - left.applications || right.participants! - left.participants! || left.label.localeCompare(right.label, "tr"));
}

/** Başvuru bazlı kırılım: üye sayısıyla ÇOĞALTILMAZ. */
function applicationBreakdown(dataset: AnalyticsDataset, key: "teamSize" | "source"): BreakdownRow[] {
  const groups = new Map<string, AnalyticsApplicationRecord[]>();
  for (const application of dataset.applications) {
    const value = key === "teamSize" ? teamSizeBucketOf(application.teamSize) : (application.discoverySource || UNSPECIFIED);
    groups.set(value, [...(groups.get(value) ?? []), application]);
  }
  const order = key === "teamSize"
    ? TEAM_SIZE_BUCKETS.map((bucket) => bucket.value as string)
    : [...DISCOVERY_SOURCE_OPTIONS.map((option) => option.value as string), UNSPECIFIED];
  return [...groups.entries()]
    .map(([value, applications]) => ({ key: value, label: labelForDimension(key, value), participants: null, ...outcomeCounts(applications) }))
    .sort((left, right) => key === "teamSize"
      ? order.indexOf(left.key) - order.indexOf(right.key)
      : right.applications - left.applications || order.indexOf(left.key) - order.indexOf(right.key));
}

export type ParticipationTotals = OutcomeCounts & {
  participants: number;
  averageTeamSize: number | null;
};

function totalsOf(dataset: AnalyticsDataset): ParticipationTotals {
  const counts = outcomeCounts(dataset.applications);
  const sizes = dataset.applications.map((application) => application.teamSize);
  const averageTeamSize = sizes.length ? Math.round((sizes.reduce((sum, size) => sum + size, 0) / sizes.length) * 10) / 10 : null;
  return { ...counts, participants: dataset.members.length, averageTeamSize };
}

/* ------------------------------------------------------------------------- *
 * Yönetim notları — deterministik, korelasyon dili
 * ------------------------------------------------------------------------- */

function percentOf(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function joinTurkish(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ve ${items[items.length - 1]}`;
}

export function managementNotes(
  totals: ParticipationTotals,
  breakdowns: Record<BreakdownKey, BreakdownRow[]>,
): string[] {
  const notes: string[] = [];
  if (!totals.applications) return ["Seçili filtrelerle eşleşen başvuru yok."];

  const sources = breakdowns.source.filter((row) => row.key !== UNSPECIFIED);
  if (sources.length) {
    const top = sources[0];
    notes.push(`${top.label} ${top.applications} başvuruyla en yüksek başvuru hacmine sahip kanal.`);
  }

  const first = breakdowns.history.find((row) => row.key === "first");
  const returning = breakdowns.history.filter((row) => row.key !== "first" && row.key !== UNSPECIFIED);
  if (first && returning.length) {
    const returningDecided = returning.reduce((sum, row) => sum + row.decided, 0);
    const returningAccepted = returning.reduce((sum, row) => sum + row.accepted, 0);
    if (first.approvalRate !== null && returningDecided >= MIN_DECIDED_FOR_RATE) {
      notes.push(
        `İlk kez katılan üyelerin bulunduğu başvurularda onay oranı %${first.approvalRate}, `
        + `daha önce katılmış üyelerin bulunduğu başvurularda %${percentOf(returningAccepted, returningDecided)} `
        + "(tamamlanmış kararlar içinde; bu bir korelasyondur, neden-sonuç ilişkisi göstermez).",
      );
    }
  }

  const midSize = breakdowns.teamSize.find((row) => row.key === "4-5");
  if (midSize) {
    notes.push(`4–5 kişilik takımlar toplam başvuruların %${percentOf(midSize.applications, totals.applications)}'ini oluşturuyor.`);
  }

  const cities = breakdowns.city.filter((row) => row.key !== UNSPECIFIED).slice(0, 3);
  if (cities.length) notes.push(`En fazla başvuru ${joinTurkish(cities.map((row) => row.label))} kaynaklı üyelerden geldi.`);

  const unspecifiedEducation = breakdowns.education.find((row) => row.key === UNSPECIFIED);
  if (unspecifiedEducation && totals.participants) {
    const share = percentOf(unspecifiedEducation.participants ?? 0, totals.participants);
    if (share >= 20) {
      notes.push(`Katılımcıların %${share}'inde eğitim bilgisi bulunmuyor (bu alanlar toplanmadan önce yapılan eski başvurular); oranlar bu eksikliği dikkate alınarak okunmalıdır.`);
    }
  }

  if (totals.approvalRate === null) {
    notes.push(`Seçili küme içinde tamamlanmış karar sayısı ${totals.decided}; başarı oranı için en az ${MIN_DECIDED_FOR_RATE} tamamlanmış karar gerekir.`);
  }
  return notes;
}

/* ------------------------------------------------------------------------- *
 * AI–hakem uyumu
 * ------------------------------------------------------------------------- */

export const AGREEMENT_DISCLAIMER =
  "Bu ölçümler AI doğruluk puanı veya hakem performans notu değildir. AI bulgularının insan "
  + "değerlendirmesinde nasıl kullanıldığını gösterir. Gerçek hakemler arası tutarlılık için aynı "
  + "başvuruların bağımsız birden fazla hakem tarafından değerlendirilmesi gerekir.";

export type AgreementCounts = {
  total: number;
  /** AI bulgusu olduğu gibi onaylanan kriterler. */
  approved: number;
  /** AI bulgusu reddedilen kriterler. */
  rejected: number;
  /** Bulgu reddedildiği hâlde nihai sonucu AI ile aynı kalan kriterler. */
  rejectedSameOutcome: number;
  /** approved / total · total < MIN_DECIDED_FOR_RATE ise null. */
  usageRate: number | null;
  /** (approved + rejectedSameOutcome) / total · küçük örneklemde null. */
  outcomeAgreementRate: number | null;
  sampleNote: string;
};

export type AgreementSummary = AgreementCounts & {
  matrix: {
    /** AI Uygun → Hakem Uygun */
    uygunUygun: number;
    /** AI Uygun → Hakem Olumsuz */
    uygunOlumsuz: number;
    /** AI Olumsuz → Hakem Uygun */
    olumsuzUygun: number;
    /** AI Olumsuz → Hakem Olumsuz */
    olumsuzOlumsuz: number;
  };
  byJudge: Array<AgreementCounts & { label: string }>;
  byStage: Array<AgreementCounts & { key: string; label: string }>;
  mostReevaluated: Array<{ criterionName: string; rejected: number; total: number }>;
  disclaimer: string;
};

/** Nihai kriter sonucu: onayda AI sonucu, redde hakemin yazdığı sonuç. */
export function finalVerdictOf(decision: AnalyticsCriterionDecision): "UYGUN" | "OLUMSUZ" | null {
  return decision.judgeVerdict === "approved" ? decision.aiVerdict : decision.judgeResult;
}

function agreementCounts(decisions: AnalyticsCriterionDecision[]): AgreementCounts {
  let approved = 0; let rejected = 0; let rejectedSameOutcome = 0;
  for (const decision of decisions) {
    if (decision.judgeVerdict === "approved") { approved += 1; continue; }
    rejected += 1;
    if (finalVerdictOf(decision) === decision.aiVerdict) rejectedSameOutcome += 1;
  }
  const total = decisions.length;
  const enough = total >= MIN_DECIDED_FOR_RATE;
  return {
    total,
    approved,
    rejected,
    rejectedSameOutcome,
    usageRate: enough ? Math.round((approved / total) * 100) : null,
    outcomeAgreementRate: enough ? Math.round(((approved + rejectedSameOutcome) / total) * 100) : null,
    sampleNote: enough ? "" : INSUFFICIENT_SAMPLE_NOTE,
  };
}

export function buildAgreementSummary(dataset: AnalyticsDataset): AgreementSummary {
  const decisions = dataset.applications.flatMap((application) => application.criterionDecisions);
  const matrix = { uygunUygun: 0, uygunOlumsuz: 0, olumsuzUygun: 0, olumsuzOlumsuz: 0 };
  for (const decision of decisions) {
    const final = finalVerdictOf(decision);
    if (!final) continue;
    if (decision.aiVerdict === "UYGUN") { if (final === "UYGUN") matrix.uygunUygun += 1; else matrix.uygunOlumsuz += 1; }
    else if (final === "UYGUN") matrix.olumsuzUygun += 1;
    else matrix.olumsuzOlumsuz += 1;
  }

  // Hakem kimliği çıktıya GİRMEZ: kararlı sıralı "Hakem N" etiketi kullanılır.
  const judgeKeys = [...new Set(decisions.map((decision) => decision.judgeKey))].sort();
  const byJudge = judgeKeys.map((judgeKey, index) => ({
    label: `Hakem ${index + 1}`,
    ...agreementCounts(decisions.filter((decision) => decision.judgeKey === judgeKey)),
  }));

  const stageKeys = [...CHECK_STAGES.map((stage) => stage.id as string), "unknown"];
  const byStage = stageKeys
    .map((key) => {
      const stage = CHECK_STAGES.find((item) => item.id === key);
      return {
        key,
        label: stage ? `${stage.order}. ${stage.title}` : "Aşaması bilinmeyen (eski analiz)",
        ...agreementCounts(decisions.filter((decision) => decision.stage === key)),
      };
    })
    .filter((row) => row.total > 0);

  const byCriterion = new Map<string, { rejected: number; total: number }>();
  for (const decision of decisions) {
    const entry = byCriterion.get(decision.criterionName) ?? { rejected: 0, total: 0 };
    entry.total += 1;
    if (decision.judgeVerdict === "rejected") entry.rejected += 1;
    byCriterion.set(decision.criterionName, entry);
  }
  const mostReevaluated = [...byCriterion.entries()]
    .filter(([, entry]) => entry.rejected > 0)
    .map(([criterionName, entry]) => ({ criterionName, ...entry }))
    .sort((left, right) => right.rejected - left.rejected || right.total - left.total || left.criterionName.localeCompare(right.criterionName, "tr"))
    .slice(0, 10);

  return { ...agreementCounts(decisions), matrix, byJudge, byStage, mostReevaluated, disclaimer: AGREEMENT_DISCLAIMER };
}

/* ------------------------------------------------------------------------- *
 * Bütün rapor
 * ------------------------------------------------------------------------- */

export type AnalyticsOptions = {
  competitions: Array<{ key: string; name: string }>;
  years: string[];
  institutions: string[];
  cities: string[];
};

export type ParticipationAnalytics = {
  filters: AnalyticsFilters;
  options: AnalyticsOptions;
  totals: ParticipationTotals;
  breakdowns: Record<BreakdownKey, BreakdownRow[]>;
  notes: string[];
  agreement: AgreementSummary;
  minDecidedForRate: number;
};

function optionsOf(records: AnalyticsApplicationRecord[]): AnalyticsOptions {
  const competitions = new Map<string, string>();
  const years = new Set<string>();
  const institutions = new Set<string>();
  const cities = new Set<string>();
  for (const record of records) {
    competitions.set(record.competitionKey, record.competitionName);
    years.add(record.submittedAt.slice(0, 4));
    for (const member of record.members) {
      if (member.institution !== UNSPECIFIED) institutions.add(member.institution);
      if (member.city !== UNSPECIFIED) cities.add(member.city);
    }
  }
  const collator = new Intl.Collator("tr");
  return {
    competitions: [...competitions.entries()].map(([key, name]) => ({ key, name })).sort((left, right) => collator.compare(left.name, right.name)),
    years: [...years].sort().reverse(),
    institutions: [...institutions].sort(collator.compare),
    cities: [...cities].sort(collator.compare),
  };
}

export function buildParticipationAnalytics(records: AnalyticsApplicationRecord[], filters: AnalyticsFilters): ParticipationAnalytics {
  const dataset = applyAnalyticsFilters(records, filters);
  const breakdowns: Record<BreakdownKey, BreakdownRow[]> = {
    gender: personBreakdown(dataset, "gender"),
    education: personBreakdown(dataset, "education"),
    grade: personBreakdown(dataset, "grade"),
    institution: personBreakdown(dataset, "institution"),
    city: personBreakdown(dataset, "city"),
    history: personBreakdown(dataset, "history"),
    teamSize: applicationBreakdown(dataset, "teamSize"),
    source: applicationBreakdown(dataset, "source"),
  };
  const totals = totalsOf(dataset);
  return {
    filters,
    options: optionsOf(records),
    totals,
    breakdowns,
    notes: managementNotes(totals, breakdowns),
    agreement: buildAgreementSummary(dataset),
    minDecidedForRate: MIN_DECIDED_FOR_RATE,
  };
}
