/** Rol atayıcı (00) tarafından yönetilen hesap ve belge akışı veri modeli. */

export type RoleCode = "00" | "01" | "02" | "03" | "04";

/** Belgeyi ilk üreten kişi hiçbir role bağlı olmayabilir. */
export type FlowActorRole = RoleCode | "author";

export type AccountStatus = "active" | "revoked";

export type AdminAccount = {
  id: string;
  fullName: string;
  email: string;
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

export type Handoff = {
  id: string;
  /** Zincirdeki sıra; 1'den başlar. */
  order: number;
  fromRole: FlowActorRole;
  fromName: string;
  toRole: RoleCode;
  toName: string;
  note: string;
  handedAt: string;
};

export type FlowStatus = "in_progress" | "completed";

export type DocumentFlow = {
  id: string;
  competition: string;
  title: string;
  /** Belgeyi oluşturan kişi. */
  authorName: string;
  /** Belgenin özeti: PDF özellikleri ve yapılan işler. */
  summary: string;
  status: FlowStatus;
  /** 04'ün ne yaptığı. */
  finalNote: string;
  /** 04 sonrası en son güncel belgenin adı veya bağlantısı. */
  finalDocument: string;
  finalUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  handoffs: Handoff[];
};

export type HandoffInput = {
  /** Var olan bir devir kaydını işaretler; güncellemede yok sayılır (geçmiş değişmez). */
  id?: string;
  fromRole: FlowActorRole;
  fromName: string;
  toRole: RoleCode;
  toName: string;
  note?: string;
  handedAt?: string;
};

export type DocumentFlowInput = {
  competition: string;
  title?: string;
  authorName: string;
  summary: string;
  status?: FlowStatus;
  finalNote?: string;
  finalDocument?: string;
  handoffs?: HandoffInput[];
};
