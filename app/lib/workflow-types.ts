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
  | "assigned"
  | "resubmitted"
  | "analyzing"
  | "awaiting_judge"
  | "judge_in_review"
  | "completed"
  | "analysis_failed"
  | "document_reupload_requested";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "submitted",
  "assigned",
  "resubmitted",
  "analyzing",
  "awaiting_judge",
  "judge_in_review",
  "completed",
  "analysis_failed",
  "document_reupload_requested",
];

/** Başvuru durumlarının kullanıcıya gösterilen karşılıkları. */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "AI ön değerlendirmesi bekliyor",
  assigned: "Hakeme atandı · AI bekliyor",
  resubmitted: "Yeni sürüm gönderildi",
  analyzing: "AI ön değerlendirmesinde",
  awaiting_judge: "Hakem bekliyor",
  judge_in_review: "Hakem değerlendirmesinde",
  completed: "Nihai değerlendirme tamamlandı",
  analysis_failed: "AI analizi başarısız",
  document_reupload_requested: "Yeni belge istendi",
};

export type CompetitionStatus =
  | "draft_criteria"
  | "criteria_processing"
  | "criteria_review"
  | "open"
  | "applications_closed"
  | "evaluating"
  | "decisions_frozen"
  | "results_published"
  | "archived";

export const COMPETITION_STATUS_LABELS: Record<CompetitionStatus, string> = {
  draft_criteria: "Kriter taslağı",
  criteria_processing: "Kriter çıkarılıyor",
  criteria_review: "Yönetici incelemesinde",
  open: "Başvuruya açık",
  applications_closed: "Başvuru alımı kapalı",
  evaluating: "Değerlendirme sürüyor",
  decisions_frozen: "Kararlar donduruldu",
  results_published: "Sonuçlar yayımlandı",
  archived: "Arşivlendi",
};

export type CompetitionWorkflow = {
  id: string;
  competitionKey: string;
  competitionName: string;
  status: CompetitionStatus;
  currentProfileId: string | null;
  decisionsLocked: boolean;
  resultsPublishedAt: string | null;
  /**
   * Değerlendirme Yöneticisi bu yarışmayı ÖNCELİKLİ işaretledi mi?
   *
   * Başvuru yığılan veya hakem değerlendirmesi geciken yarışmalar için
   * kullanılır: hakem panelinde 🔥 rozetiyle görünür ve listenin başında
   * sıralanır. Karar değil, operasyonel bir sıralama işaretidir.
   */
  isPriority: boolean;
  /** Önceliğin gerekçesi; hakeme rozetin yanında gösterilir. */
  priorityNote: string;
  prioritySetAt: string | null;
  /**
   * Yarışma AKTİF mi?
   *
   * Pasif yarışma: yarışmacının listesinde görünmez, yeni başvuru kabul etmez
   * ve yeni değerlendirme kuyruğu üretmez. Hakem geçmiş başvuruları görmeye,
   * izin verilen karar düzeltmelerini yapmaya devam eder. Aktif/pasif, süreç
   * aşamasından (status) AYRIDIR: pasifleştirmek aşamayı geri almaz.
   */
  isActive: boolean;
  activationNote: string;
  activationChangedAt: string | null;
  activationChangedByName: string | null;
  /** Arşivlendi mi? (soft delete — kayıt silinmez, denetim izi korunur) */
  archivedAt: string | null;
  archivedByName: string | null;
  archivedReason: string;
  createdAt: string;
  updatedAt: string;
};

/** Passive is not frozen: existing reviews remain editable. Missing state fails closed. */
export function competitionReadOnly(competition: CompetitionWorkflow | null | undefined): boolean {
  return !competition || Boolean(competition.archivedAt) || competition.status === "archived"
    || competition.decisionsLocked || competition.status === "decisions_frozen"
    || competition.status === "results_published";
}

/**
 * Değişmez kriter sürümü.
 *
 * Yarışma Yöneticisi kriterleri her yayımladığında yeni bir sürüm oluşur;
 * eski sürüm ASLA değiştirilmez. Hakem analizi daima en son yayımlanan sürümü
 * kullanır, geçmiş değerlendirmeler kendi sürümüyle okunabilir kalır.
 */
export type CriteriaVersion = {
  id: string;
  criteriaProfileId: string;
  competitionKey: string;
  criteriaVersion: number;
  criteriaHash: string;
  criteriaCount: number;
  publishedAt: string;
  publishedBy: string;
  publishedByName: string;
};

export type SubmissionVersion = {
  id: string;
  applicationId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  submittedBy: string;
  submittedAt: string;
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
  approved: "Yayımlandı · aktif",
};

export type ApplicationTeamMember = {
  id: string;
  fullName: string;
  /**
   * Başvuru anında verilen demografi/eğitim görüntüsü (göç 0017). Eski
   * kayıtlarda alanlar "unspecified" (Belirtilmedi) döner. Yalnızca ham kişi
   * bilgisini görebilen görünümlerde doludur; operasyon görünümüne gitmez.
   */
  gender: string;
  educationLevel: string;
  gradeLevel: string;
  institution: string;
  city: string;
  teknofestHistory: string;
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
  /** Başvuru sahibi DIŞINDAKİ ekip üyeleri (geriye uyumlu anlam). */
  teamMembers: ApplicationTeamMember[];
  /** Başvuru sahibi dâhil takım büyüklüğü; eski kayıtlarda üye sayısı + 1. */
  teamSize: number;
  /**
   * Başvuru sahibinin kendi demografi/eğitim görüntüsü (göç 0017). Operasyon
   * görünümünde null; eski kayıtlarda alanlar "unspecified" döner.
   */
  applicantProfile: ApplicationTeamMember | null;
  /** "TEKNOFEST'i nereden duydunuz?" — başvuru başına tek değer; operasyon görünümünde "". */
  discoverySource: string;
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
  assignedJudgeId: string | null;
  assignedJudgeName: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number;
  outcome: ApplicationOutcome;
  outcomeNote: string;
  decidedAt: string | null;
  /**
   * Kaydedilmiş AI sonucunun bağlı olduğu değişmez kriter sürümü ve PDF özeti.
   * `criteriaOutdated` true ise kriterler o analizden sonra yeniden yayımlanmış
   * demektir ve ekran "Kriterler güncellendi, yeniden analiz gerekli" der.
   */
  evaluationCriteriaVersion: number | null;
  evaluationPdfHash: string | null;
  /** Yarışmanın şu anda yürürlükte olan kriter sürümü. */
  currentCriteriaVersion: number | null;
  criteriaOutdated: boolean;
  /** Hakem/yönetici tarafından aktif listeden kaldırıldı mı? (soft delete) */
  archivedAt: string | null;
  archivedByName: string | null;
  archivedReason: string;
  /**
   * Benzerlik sonucu "güncel değil" mi (GÖREV 3 · madde 8)? Havuza yeni rapor
   * geldiğinde ya da resmî şablon değiştiğinde işaretlenir; yalnızca hakem
   * görünümünde doludur. Eski istemciler alanı görmezden gelir (isteğe bağlı).
   */
  similarityStale?: boolean;
  similarityStaleReason?: string;
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

/** Süreç panolarında gösterilen özet sayaçlar (Rol 04). */
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

/**
 * Değerlendirme Yöneticisinin (04) yarışma bazlı izleme satırı.
 *
 * GİZLİLİK: yalnızca sayı ve durum taşır. Katılımcı adı, ekip üyesi, dosya adı
 * ve rapor içeriği bu tipte HİÇ bulunmaz — bu rol raporları okumaz.
 */
export type CompetitionOverview = {
  competitionId: string;
  competitionKey: string;
  competitionName: string;
  category: string;
  /** Kriterlerin çıkarıldığı şartname dosyasının adı. */
  sourceDocumentName: string;
  criteriaCount: number;
  status: CompetitionStatus;
  /** Başvuruya açık mı? (aktif + süreç durumu 'open') */
  acceptingApplications: boolean;
  /** Yarışma aktif mi? Pasif yarışma yeni başvuru ve yeni kuyruk üretmez. */
  isActive: boolean;
  isPriority: boolean;
  priorityNote: string;
  total: number;
  /** AI analizi tamamlanmış başvurular (hakem kuyruğu + karar verilmişler). */
  analysisCompleted: number;
  /** AI analizi henüz yapılmamış veya başarısız olmuş başvurular. */
  analysisPending: number;
  evaluated: number;
  accepted: number;
  rejected: number;
  revision: number;
  pending: number;
  /** Hakem atanamamış başvurular; normalde 0 olmalıdır. */
  unassigned: number;
  /** Arşivlenmiş (soft delete) başvuru sayısı. */
  archived: number;
};

export type JudgeWorkload = {
  judgeId: string;
  judgeName: string;
  active: number;
  completed: number;
  failed: number;
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

/**
 * Resmî rapor şablonunun panel/istemci görünümü (GÖREV 3 · madde 3).
 *
 * Yalnızca BENZERLİK filtresi içindir: kriter üretmez, rapor uygunluğu kararı
 * vermez; benzerlik analizinde beklenen ortak metni ayıklar. Kriter akışının
 * emekli templateProfile alanıyla (types.ts) İLGİSİZDİR.
 */
export type SimilarityTemplateInfo = {
  version: number;
  fileName: string;
  pageCount: number;
  wordCount: number;
  uploadedAt: string;
};
