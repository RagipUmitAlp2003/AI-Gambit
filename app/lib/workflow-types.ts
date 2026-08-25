import type { JudgeReview, ProfileExport, ReportEvaluation } from "./types";
import type { RoleCode } from "./admin-types";

/**
 * Başvurunun yaşam döngüsü.
 *
 *   submitted        Yarışmacı gönderdi; AI ön değerlendirmesi bekliyor.
 *   analyzing        AI ön değerlendirmesi çalışıyor.
 *   awaiting_judge   AI tamamlandı; hakem kuyruğunda bekliyor.
 *   judge_in_review  Hakem nihai değerlendirmeyi açtı, henüz bitirmedi.
 *   completed        Hakem nihai kararı verdi.
 *   analysis_failed  AI analizi hata verdi; yeniden başlatılabilir.
 *
 * AI hiçbir durumda nihai karar üretmez; `completed` yalnızca hakem kararıyla oluşur.
 */
export type ApplicationStatus =
  | "submitted"
  | "analyzing"
  | "awaiting_judge"
  | "judge_in_review"
  | "completed"
  | "analysis_failed";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "submitted",
  "analyzing",
  "awaiting_judge",
  "judge_in_review",
  "completed",
  "analysis_failed",
];

/** Başvuru durumlarının kullanıcıya gösterilen karşılıkları. */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "AI ön değerlendirmesi bekliyor",
  analyzing: "AI ön değerlendirmesinde",
  awaiting_judge: "Hakem bekliyor",
  judge_in_review: "Hakem değerlendirmesinde",
  completed: "Nihai değerlendirme tamamlandı",
  analysis_failed: "AI analizi başarısız",
};

export type ApplicationOutcome = "pending" | "accepted" | "rejected" | "revision_required";

/**
 * Değerlendirme profilinin yaşam döngüsü (Aşama A).
 *
 *   draft                 Yarışma yöneticisinde, henüz gönderilmedi.
 *   judge_review_pending  Hakem ikinci aşama doğrulamasını bekliyor.
 *   changes_requested     Hakem düzeltme için yarışma yöneticisine geri gönderdi.
 *   approved              Hakem onayladı; değerlendirme için aktif.
 *
 * Yalnızca `approved` profiller başvuru değerlendirmesinde kullanılabilir.
 */
export type ProfileStatus = "draft" | "judge_review_pending" | "changes_requested" | "approved";

export const PROFILE_STATUS_LABELS: Record<ProfileStatus, string> = {
  draft: "Taslak",
  judge_review_pending: "Hakem onayı bekliyor",
  changes_requested: "Düzeltme istendi",
  approved: "Hakem onaylı · aktif",
};

export type ApplicationTeamMember = {
  id: string;
  fullName: string;
};

/** Yarışmanın değerlendirme profili; hakem onayından sonra aktifleşir. */
export type CompetitionProfile = {
  id: string;
  competitionKey: string;
  competitionName: string;
  category: string;
  stage: string;
  reportType: string;
  sourceDocumentName: string;
  profile: ProfileExport;
  status: ProfileStatus;
  /** Profili hazırlayan yarışma yöneticisi (Rol 01). */
  createdBy: string;
  createdByName: string;
  /** İkinci aşama doğrulamayı yapan hakem (Rol 02). */
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** Hakemin onay veya düzeltme gerekçesi. */
  reviewNote: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompetitionApplication = {
  id: string;
  participantId: string;
  participantName: string;
  participantEmail: string | null;
  applicantFullName: string;
  teamName: string;
  teamMembers: ApplicationTeamMember[];
  competitionKey: string;
  competitionName: string;
  profileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: ApplicationStatus;
  /** AI ön değerlendirmesi — öneri niteliğindedir, nihai karar değildir. */
  evaluation: ReportEvaluation | null;
  review: JudgeReview | null;
  judgeId: string | null;
  judgeName: string | null;
  outcome: ApplicationOutcome;
  outcomeNote: string;
  decidedAt: string | null;
  submittedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CriteriaExtractionRun = {
  id: string;
  sourceDocumentName: string;
  competitionName: string;
  criteriaCount: number;
  status: "analyzed" | "approved";
  profileId: string | null;
  createdBy: string;
  createdByName: string;
  analyzedAt: string;
  updatedAt: string;
};

/** Hakemin profil doğrulamasında verebileceği karar. */
export type ProfileReviewDecision = "approve" | "request_changes";

/** Süreç panolarında gösterilen özet sayaçlar (Rol 03). */
export type OperationsSummary = {
  total: number;
  aiPending: number;
  aiProcessing: number;
  aiCompleted: number;
  judgePending: number;
  judgeInReview: number;
  completed: number;
  failed: number;
  completionRate: number;
};

export type TimelineEntry = {
  id: string;
  event: string;
  label: string;
  actorName: string;
  actorRole: RoleCode | null;
  detail: string;
  createdAt: string;
};
