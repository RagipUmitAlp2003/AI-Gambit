/** Moderatör (00) tarafından yönetilen hesap modeli ve süreç olayı veri modeli. */

export type RoleCode = "00" | "01" | "02" | "03" | "04";

export type AccountStatus = "active" | "revoked";

export type AdminAccount = {
  id: string;
  fullName: string;
  email: string;
  /**
   * Giriş için kullanılabilen kısa kullanıcı adı (isteğe bağlı).
   * Giriş formu kullanıcı adını da e-postayı da kabul eder; rol seçimi yoktur,
   * panel hesabın rolüne göre otomatik açılır.
   */
  username: string | null;
  roleCode: RoleCode;
  status: AccountStatus;
  /** Tek kullanımlık şifre henüz değiştirilmediyse true. */
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
};

export type MailStatus = "sent" | "queued" | "failed";
export type MailProvider = "resend" | "outbox";

/**
 * Gönderilen ya da gönderilmeyi bekleyen hesap bildirimi.
 * `body` alanı şifreyi asla açık tutmaz; tek kullanımlık şifre yalnızca
 * hesap oluşturma yanıtında bir kez döner.
 */
export type MailDelivery = {
  id: string;
  accountId: string | null;
  toEmail: string;
  subject: string;
  body: string;
  status: MailStatus;
  provider: MailProvider;
  error: string | null;
  createdAt: string;
};

export type CreateAccountInput = {
  fullName: string;
  email: string;
  username?: string | null;
  roleCode: RoleCode;
  /** Boş bırakılırsa sistem 8 haneli şifreyi kendisi üretir. */
  password?: string;
  createdBy?: string;
};

export type CreateAccountResult = {
  account: AdminAccount;
  /** Yalnızca bu yanıtta döner; veri tabanında açık hâli tutulmaz. */
  oneTimePassword: string;
  mail: MailDelivery;
};

/**
 * Süreç olayının bağlı olduğu kayıt türü.
 * Zaman çizelgesi sıralı belge devri değil, olay listesidir: her rol
 * kendi görevini yaptığında bir olay düşer.
 */
export type WorkflowSubject = "profile" | "application" | "competition";

/**
 * Değerlendirme sürecinin olay adları. Yeni bir adım eklendiğinde bu birlik
 * genişletilir; ekranlardaki etiketler `WORKFLOW_EVENT_LABELS` üzerinden gelir.
 */
export type WorkflowEventName =
  | "profile_drafted"
  | "profile_submitted_for_review"
  | "profile_changes_requested"
  | "profile_criteria_edited"
  | "profile_approved"
  | "application_submitted"
  | "application_assigned"
  | "application_reassigned"
  | "judge_reminder_sent"
  | "analysis_requeued"
  | "document_reupload_requested"
  | "submission_version_added"
  | "ai_analysis_started"
  | "ai_prescreen_completed"
  | "ai_analysis_failed"
  | "judge_review_started"
  | "judge_score_adjusted"
  | "judge_decision_completed"
  | "competition_stage_changed"
  | "criteria_version_published"
  | "criteria_source_locked"
  | "competition_activated"
  | "competition_deactivated"
  | "competition_archived"
  | "application_archived"
  | "application_restored";

export type WorkflowEvent = {
  id: string;
  subjectType: WorkflowSubject;
  subjectId: string;
  event: WorkflowEventName;
  actorId: string | null;
  actorName: string;
  actorRole: RoleCode | null;
  /** Kullanıcıya gösterilen kısa açıklama; puan değişikliği gerekçesi burada tutulur. */
  detail: string;
  createdAt: string;
};

export type WorkflowEventInput = {
  subjectType: WorkflowSubject;
  subjectId: string;
  event: WorkflowEventName;
  actor?: Pick<AdminAccount, "id" | "fullName" | "roleCode"> | null;
  detail?: string;
};
