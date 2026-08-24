import { env } from "cloudflare:workers";
import { isFlowActorRole, isRoleCode } from "./admin-roles";
import type {
  AdminAccount,
  DocumentFlow,
  DocumentFlowInput,
  FlowActorRole,
  Handoff,
  HandoffInput,
  MailDelivery,
  MailProvider,
  MailStatus,
  RoleCode,
} from "./admin-types";
import type { PasswordRecord } from "./password";

/**
 * Yönetici sistemi veri tabanı katmanı (Cloudflare D1).
 * Şema her izolat içinde bir kez, "varsa dokunma" biçiminde kurulur;
 * ayrı bir migration çalıştırıcısına ihtiyaç duyulmaz.
 * Referans SQL: migrations/0001_admin.sql
 */

/**
 * İstemciye giden mesaj kasıtlı olarak kısadır; bağlama adı, veri tabanı
 * kimliği veya yapılandırma yolu gibi iç ayrıntılar yalnızca sunucu logunda
 * kalır (bkz. `app/lib/admin-guard.ts` içindeki handleError).
 */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Yönetici veri tabanı şu anda kullanılamıyor.");
    this.name = "DatabaseUnavailableError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admin_accounts (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role_code TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    created_by TEXT,
    revoked_at TEXT,
    revoked_reason TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_accounts_role ON admin_accounts (role_code, status)`,
  `CREATE TABLE IF NOT EXISTS admin_mail_outbox (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_mail_created ON admin_mail_outbox (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS document_flows (
    id TEXT PRIMARY KEY,
    competition TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    final_note TEXT NOT NULL DEFAULT '',
    final_document TEXT NOT NULL DEFAULT '',
    final_updated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_document_flows_competition ON document_flows (competition, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS document_handoffs (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    from_role TEXT NOT NULL,
    from_name TEXT NOT NULL,
    to_role TEXT NOT NULL,
    to_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    handed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_document_handoffs_flow ON document_handoffs (flow_id, step_order)`,
  // Oturumlar: yalnızca jeton özeti saklanır, ham jeton hiçbir yerde tutulmaz.
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_sessions_account ON admin_sessions (account_id)`,
  // Denetim izi: parola, jeton veya anahtar yazılmaz.
  `CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_email TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC)`,
];

let schemaPromise: Promise<void> | null = null;

/** Bağlama yoksa null döner; çağıranlar açık hata mesajı üretebilsin diye. */
export function databaseBinding(): D1Database | null {
  return env.DB ?? null;
}

export async function getDatabase(): Promise<D1Database> {
  const database = databaseBinding();
  if (!database) throw new DatabaseUnavailableError();
  if (!schemaPromise) {
    schemaPromise = database
      .batch(SCHEMA.map((statement) => database.prepare(statement)))
      .then(() => undefined)
      .catch((error: unknown) => {
        // Sonraki istek yeniden denesin; kalıcı hata bırakma.
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
  return database;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

type AccountRow = {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  must_change_password: number;
  status: string;
  created_at: string;
  created_by: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

function toAccount(row: AccountRow): AdminAccount {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    roleCode: (isRoleCode(row.role_code) ? row.role_code : "01") as RoleCode,
    status: row.status === "revoked" ? "revoked" : "active",
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

export async function listAccounts(): Promise<AdminAccount[]> {
  const database = await getDatabase();
  const result = await database
    .prepare(
      `SELECT * FROM admin_accounts
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, role_code ASC, created_at DESC`,
    )
    .all<AccountRow>();
  return (result.results ?? []).map(toAccount);
}

export async function findAccountByEmail(email: string): Promise<AdminAccount | null> {
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT * FROM admin_accounts WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<AccountRow>();
  return row ? toAccount(row) : null;
}

export async function findAccountById(id: string): Promise<AdminAccount | null> {
  const database = await getDatabase();
  const row = await database.prepare(`SELECT * FROM admin_accounts WHERE id = ?`).bind(id).first<AccountRow>();
  return row ? toAccount(row) : null;
}

export async function insertAccount(input: {
  fullName: string;
  email: string;
  roleCode: RoleCode;
  password: PasswordRecord;
  createdBy: string | null;
}): Promise<AdminAccount> {
  const database = await getDatabase();
  const email = normalizeEmail(input.email);
  const existing = await database
    .prepare(`SELECT id, status FROM admin_accounts WHERE email = ?`)
    .bind(email)
    .first<{ id: string; status: string }>();
  if (existing) {
    throw new ConflictError(
      existing.status === "revoked"
        ? "Bu e-posta adresine ait pasif bir hesap var. Önce kaydı kalıcı olarak silin ya da rolünü yeniden atayın."
        : "Bu e-posta adresiyle zaten aktif bir hesap var.",
    );
  }

  const account: AdminAccount = {
    id: crypto.randomUUID(),
    fullName: input.fullName.trim(),
    email,
    roleCode: input.roleCode,
    status: "active",
    mustChangePassword: true,
    createdAt: nowIso(),
    createdBy: input.createdBy,
    revokedAt: null,
    revokedReason: null,
  };

  await database
    .prepare(
      `INSERT INTO admin_accounts
        (id, full_name, email, role_code, password_hash, password_salt, password_iterations,
         must_change_password, status, created_at, created_by, revoked_at, revoked_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, NULL, NULL)`,
    )
    .bind(
      account.id,
      account.fullName,
      account.email,
      account.roleCode,
      input.password.hash,
      input.password.salt,
      input.password.iterations,
      account.createdAt,
      account.createdBy,
    )
    .run();

  return account;
}

/**
 * Yazma işlemlerinin sonucu. "Son aktif 00" koruması tek bir SQL ifadesinin
 * WHERE koşulunda değerlendirilir; iki yönetici aynı anda işlem yapsa bile
 * sistem sıfır aktif moderatörle kalamaz.
 */
export type MutationResult =
  | { ok: true; account: AdminAccount }
  | { ok: false; reason: "not_found" | "last_moderator" };

/** Aktif 00 sayısının 1'den fazla olmasını şart koşan ortak alt sorgu. */
const OTHER_ACTIVE_MODERATOR_EXISTS =
  `(SELECT COUNT(*) FROM admin_accounts WHERE role_code = '00' AND status = 'active') > 1`;

export async function updateAccountRole(id: string, roleCode: RoleCode): Promise<MutationResult> {
  const database = await getDatabase();
  const result = await database
    .prepare(
      `UPDATE admin_accounts SET role_code = ?
       WHERE id = ? AND status = 'active'
         AND (role_code <> '00' OR ? = '00' OR ${OTHER_ACTIVE_MODERATOR_EXISTS})`,
    )
    .bind(roleCode, id, roleCode)
    .run();
  if (result.meta.changes) {
    const account = await findAccountById(id);
    return account ? { ok: true, account } : { ok: false, reason: "not_found" };
  }
  const existing = await findAccountById(id);
  if (!existing) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "last_moderator" };
}

/** Rol kaldırma: kayıt izlenebilirlik için korunur, hesap pasife alınır. */
export async function revokeAccount(id: string, reason: string): Promise<MutationResult> {
  const database = await getDatabase();
  const result = await database
    .prepare(
      `UPDATE admin_accounts SET status = 'revoked', revoked_at = ?, revoked_reason = ?
       WHERE id = ? AND status = 'active'
         AND (role_code <> '00' OR ${OTHER_ACTIVE_MODERATOR_EXISTS})`,
    )
    .bind(nowIso(), reason, id)
    .run();
  if (result.meta.changes) {
    // Pasife alınan hesabın açık oturumları anında geçersiz kılınır.
    await deleteSessionsForAccount(id);
    const account = await findAccountById(id);
    return account ? { ok: true, account } : { ok: false, reason: "not_found" };
  }
  const existing = await findAccountById(id);
  if (!existing) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "last_moderator" };
}

export async function restoreAccount(id: string, roleCode: RoleCode): Promise<MutationResult> {
  const database = await getDatabase();
  const result = await database
    .prepare(
      `UPDATE admin_accounts SET status = 'active', role_code = ?, revoked_at = NULL, revoked_reason = NULL
       WHERE id = ? AND status = 'revoked'`,
    )
    .bind(roleCode, id)
    .run();
  if (!result.meta.changes) return { ok: false, reason: "not_found" };
  const account = await findAccountById(id);
  return account ? { ok: true, account } : { ok: false, reason: "not_found" };
}

/** Kalıcı silme; aynı e-postayla yeni hesap açılabilmesi için gerekir. */
export async function deleteAccount(id: string): Promise<MutationResult> {
  const database = await getDatabase();
  const existing = await findAccountById(id);
  if (!existing) return { ok: false, reason: "not_found" };

  const result = await database
    .prepare(
      `DELETE FROM admin_accounts
       WHERE id = ?
         AND (status <> 'active' OR role_code <> '00' OR ${OTHER_ACTIVE_MODERATOR_EXISTS})`,
    )
    .bind(id)
    .run();
  if (!result.meta.changes) return { ok: false, reason: "last_moderator" };
  await deleteSessionsForAccount(id);
  return { ok: true, account: existing };
}

export async function countActiveModerators(): Promise<number> {
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT COUNT(*) AS total FROM admin_accounts WHERE role_code = '00' AND status = 'active'`)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function countAccounts(): Promise<number> {
  const database = await getDatabase();
  const row = await database.prepare(`SELECT COUNT(*) AS total FROM admin_accounts`).first<{ total: number }>();
  return row?.total ?? 0;
}

/** Parola doğrulaması için hesap + özet alanları. Yalnızca giriş akışında kullanılır. */
export type AccountCredentials = { account: AdminAccount; password: PasswordRecord };

export async function findCredentialsByEmail(email: string): Promise<AccountCredentials | null> {
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT * FROM admin_accounts WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<AccountRow>();
  if (!row) return null;
  return {
    account: toAccount(row),
    password: { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations },
  };
}

export async function markPasswordChanged(id: string): Promise<void> {
  const database = await getDatabase();
  await database.prepare(`UPDATE admin_accounts SET must_change_password = 0 WHERE id = ?`).bind(id).run();
}

type SessionRow = { token_hash: string; account_id: string; created_at: string; expires_at: string };

export async function createSession(input: {
  tokenHash: string;
  accountId: string;
  expiresAt: string;
  userAgent: string | null;
}): Promise<void> {
  const database = await getDatabase();
  await database
    .prepare(
      `INSERT INTO admin_sessions (token_hash, account_id, created_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(input.tokenHash, input.accountId, nowIso(), input.expiresAt, input.userAgent)
    .run();
  // Süresi dolmuş kayıtlar birikmesin.
  await database.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).bind(nowIso()).run();
}

/** Süresi dolmuş oturum bulunursa kaydı silinir ve null döner. */
export async function findSessionAccount(tokenHash: string): Promise<AdminAccount | null> {
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT * FROM admin_sessions WHERE token_hash = ?`)
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await deleteSession(tokenHash);
    return null;
  }
  const account = await findAccountById(row.account_id);
  // Hesap silinmiş veya pasife alınmışsa oturum da geçersizdir.
  if (!account || account.status !== "active") {
    await deleteSession(tokenHash);
    return null;
  }
  return account;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  const database = await getDatabase();
  await database.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).bind(tokenHash).run();
}

export async function deleteSessionsForAccount(accountId: string): Promise<void> {
  const database = await getDatabase();
  await database.prepare(`DELETE FROM admin_sessions WHERE account_id = ?`).bind(accountId).run();
}

export type AuditEntry = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string;
  createdAt: string;
};

/**
 * Denetim kaydı. `detail` alanına parola, jeton veya anahtar yazılmaz;
 * çağıranlar yalnızca işlem özetini geçirir.
 */
export async function recordAudit(input: {
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: string;
}): Promise<void> {
  try {
    const database = await getDatabase();
    await database
      .prepare(
        `INSERT INTO admin_audit_log
          (id, actor_id, actor_email, actor_role, action, target_type, target_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.actorId,
        input.actorEmail,
        input.actorRole,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        (input.detail ?? "").slice(0, 600),
        nowIso(),
      )
      .run();
  } catch (error) {
    // Denetim yazımı asıl işlemi düşürmemeli; sunucu logunda kalır.
    console.error("[audit] kayıt yazılamadı", error);
  }
}

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  const database = await getDatabase();
  const result = await database
    .prepare(`SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<{
      id: string;
      actor_id: string | null;
      actor_email: string | null;
      actor_role: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      detail: string;
      created_at: string;
    }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

/** Devir hedefinin sistemde kayıtlı ve aktif olduğunu doğrular. */
export async function findActiveAccountByRoleAndName(roleCode: RoleCode, fullName: string): Promise<AdminAccount | null> {
  const database = await getDatabase();
  const row = await database
    .prepare(
      `SELECT * FROM admin_accounts
       WHERE role_code = ? AND status = 'active' AND lower(trim(full_name)) = lower(trim(?))`,
    )
    .bind(roleCode, fullName)
    .first<AccountRow>();
  return row ? toAccount(row) : null;
}

type MailRow = {
  id: string;
  account_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  provider: string;
  error: string | null;
  created_at: string;
};

function toMail(row: MailRow): MailDelivery {
  return {
    id: row.id,
    accountId: row.account_id,
    toEmail: row.to_email,
    subject: row.subject,
    body: row.body,
    status: row.status as MailStatus,
    provider: row.provider as MailProvider,
    error: row.error,
    createdAt: row.created_at,
  };
}

export async function recordMail(input: {
  accountId: string | null;
  toEmail: string;
  subject: string;
  /** Şifresi maskelenmiş gövde; açık şifre veri tabanına yazılmaz. */
  body: string;
  status: MailStatus;
  provider: MailProvider;
  error: string | null;
}): Promise<MailDelivery> {
  const database = await getDatabase();
  const delivery: MailDelivery = { id: crypto.randomUUID(), createdAt: nowIso(), ...input };
  await database
    .prepare(
      `INSERT INTO admin_mail_outbox (id, account_id, to_email, subject, body, status, provider, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      delivery.id,
      delivery.accountId,
      delivery.toEmail,
      delivery.subject,
      delivery.body,
      delivery.status,
      delivery.provider,
      delivery.error,
      delivery.createdAt,
    )
    .run();
  return delivery;
}

export async function listMail(limit = 30): Promise<MailDelivery[]> {
  const database = await getDatabase();
  const result = await database
    .prepare(`SELECT * FROM admin_mail_outbox ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<MailRow>();
  return (result.results ?? []).map(toMail);
}

type FlowRow = {
  id: string;
  competition: string;
  title: string;
  author_name: string;
  summary: string;
  status: string;
  final_note: string;
  final_document: string;
  final_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

type HandoffRow = {
  id: string;
  flow_id: string;
  step_order: number;
  from_role: string;
  from_name: string;
  to_role: string;
  to_name: string;
  note: string;
  handed_at: string;
};

function toHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    order: row.step_order,
    fromRole: (isFlowActorRole(row.from_role) ? row.from_role : "author") as FlowActorRole,
    fromName: row.from_name,
    toRole: (isRoleCode(row.to_role) ? row.to_role : "01") as RoleCode,
    toName: row.to_name,
    note: row.note,
    handedAt: row.handed_at,
  };
}

function toFlow(row: FlowRow, handoffs: Handoff[]): DocumentFlow {
  return {
    id: row.id,
    competition: row.competition,
    title: row.title,
    authorName: row.author_name,
    summary: row.summary,
    status: row.status === "completed" ? "completed" : "in_progress",
    finalNote: row.final_note,
    finalDocument: row.final_document,
    finalUpdatedAt: row.final_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    handoffs,
  };
}

export async function listFlows(): Promise<DocumentFlow[]> {
  const database = await getDatabase();
  const [flowResult, handoffResult] = await database.batch<FlowRow | HandoffRow>([
    database.prepare(`SELECT * FROM document_flows ORDER BY competition ASC, created_at DESC`),
    database.prepare(`SELECT * FROM document_handoffs ORDER BY flow_id ASC, step_order ASC`),
  ]);

  const grouped = new Map<string, Handoff[]>();
  for (const row of (handoffResult.results ?? []) as HandoffRow[]) {
    const list = grouped.get(row.flow_id) ?? [];
    list.push(toHandoff(row));
    grouped.set(row.flow_id, list);
  }

  return ((flowResult.results ?? []) as FlowRow[]).map((row) => toFlow(row, grouped.get(row.id) ?? []));
}

export async function findFlow(id: string): Promise<DocumentFlow | null> {
  const database = await getDatabase();
  const row = await database.prepare(`SELECT * FROM document_flows WHERE id = ?`).bind(id).first<FlowRow>();
  if (!row) return null;
  const handoffs = await database
    .prepare(`SELECT * FROM document_handoffs WHERE flow_id = ? ORDER BY step_order ASC`)
    .bind(id)
    .all<HandoffRow>();
  return toFlow(row, (handoffs.results ?? []).map(toHandoff));
}

function handoffStatements(
  database: D1Database,
  flowId: string,
  handoffs: HandoffInput[],
  startOrder: number,
) {
  return handoffs.map((handoff, index) =>
    database
      .prepare(
        `INSERT INTO document_handoffs (id, flow_id, step_order, from_role, from_name, to_role, to_name, note, handed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        flowId,
        startOrder + index,
        handoff.fromRole,
        handoff.fromName.trim(),
        handoff.toRole,
        handoff.toName.trim(),
        (handoff.note ?? "").trim(),
        handoff.handedAt || nowIso(),
      ),
  );
}

export async function insertFlow(input: DocumentFlowInput): Promise<DocumentFlow> {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const finalDocument = (input.finalDocument ?? "").trim();

  await database.batch([
    database
      .prepare(
        `INSERT INTO document_flows
          (id, competition, title, author_name, summary, status, final_note, final_document, final_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.competition.trim(),
        (input.title ?? "").trim(),
        input.authorName.trim(),
        input.summary.trim(),
        input.status ?? "in_progress",
        (input.finalNote ?? "").trim(),
        finalDocument,
        finalDocument ? timestamp : null,
        timestamp,
        timestamp,
      ),
    ...handoffStatements(database, id, input.handoffs ?? [], 1),
  ]);

  const flow = await findFlow(id);
  if (!flow) throw new Error("Belge akışı kaydedildi ancak geri okunamadı.");
  return flow;
}

/**
 * Belge künyesini günceller ve YALNIZCA yeni devirleri ekler.
 * Kayıtlı devir geçmişi değiştirilemez veya silinemez; `input.handoffs`
 * içindeki kimliği olan satırlar yok sayılır.
 */
export async function updateFlow(id: string, input: DocumentFlowInput): Promise<DocumentFlow | null> {
  const database = await getDatabase();
  const current = await database
    .prepare(`SELECT final_document, final_updated_at FROM document_flows WHERE id = ?`)
    .bind(id)
    .first<{ final_document: string; final_updated_at: string | null }>();
  if (!current) return null;

  const orderRow = await database
    .prepare(`SELECT COALESCE(MAX(step_order), 0) AS last FROM document_handoffs WHERE flow_id = ?`)
    .bind(id)
    .first<{ last: number }>();
  const appended = (input.handoffs ?? []).filter((handoff) => !handoff.id);

  const timestamp = nowIso();
  const finalDocument = (input.finalDocument ?? "").trim();
  // Nihai belge değişmediyse "son güncelleme" damgası korunur.
  const finalUpdatedAt = !finalDocument
    ? null
    : finalDocument === current.final_document
      ? (current.final_updated_at ?? timestamp)
      : timestamp;

  await database.batch([
    database
      .prepare(
        `UPDATE document_flows
         SET competition = ?, title = ?, author_name = ?, summary = ?, status = ?,
             final_note = ?, final_document = ?, final_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.competition.trim(),
        (input.title ?? "").trim(),
        input.authorName.trim(),
        input.summary.trim(),
        input.status ?? "in_progress",
        (input.finalNote ?? "").trim(),
        finalDocument,
        finalUpdatedAt,
        timestamp,
        id,
      ),
    ...handoffStatements(database, id, appended, (orderRow?.last ?? 0) + 1),
  ]);

  return findFlow(id);
}

export async function deleteFlow(id: string): Promise<boolean> {
  const database = await getDatabase();
  const [, flowResult] = await database.batch([
    database.prepare(`DELETE FROM document_handoffs WHERE flow_id = ?`).bind(id),
    database.prepare(`DELETE FROM document_flows WHERE id = ?`).bind(id),
  ]);
  return Boolean(flowResult.meta.changes);
}
