import { env } from "cloudflare:workers";
import { isRoleCode } from "./admin-roles";
import type {
  AdminAccount,
  MailDelivery,
  MailProvider,
  MailStatus,
  RoleCode,
  WorkflowEvent,
  WorkflowEventInput,
  WorkflowEventName,
  WorkflowSubject,
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
  // Olay bazlı süreç zaman çizelgesi; sıralı belge devri modelinin yerini aldı.
  `CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    event TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT NOT NULL DEFAULT 'sistem',
    actor_role TEXT,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_events_subject
   ON workflow_events (subject_type, subject_id, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_events_created
   ON workflow_events (created_at DESC)`,
  // Dağıtık kaba kuvvet sayacı: eski proses içi Map izolatlar arasında
  // paylaşılmıyordu. Anahtar SHA-256(ip|kimlik) özetidir; açık IP, kullanıcı
  // adı veya e-posta SAKLANMAZ. Referans SQL: migrations/0014_auth_hardening.sql
  `CREATE TABLE IF NOT EXISTS admin_login_failures (
    key_hash TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    fail_count INTEGER NOT NULL DEFAULT 1,
    last_failed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_login_failures_last
   ON admin_login_failures (last_failed_at)`,
  // Bir kez çalışan veri düzeltmelerinin izi; aynı migration iki kez uygulanmaz.
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
];

/**
 * Rol numaralandırması göçleri.
 *
 * Ara sürümde 03 = Değerlendirme Yöneticisi, 04 = Yarışmacı kullanılmıştı.
 * Nihai model 03 = Yarışmacı, 04 = Değerlendirme Yöneticisidir. Kodlar güvenli
 * ve bir kez çalışan iki aşamalı göçle düzeltilir; hesaplar,
 * yarışmalar, kriterler ve değerlendirme kayıtları silinmez.
 *
 * Denetim izindeki `actor_role` da aynı takasla düzeltilir: kişi değişmedi,
 * yalnızca rolün kodu değişti; düzeltilmezse geçmiş kayıtlar yanlış rolü
 * gösterirdi. Referans SQL: migrations/0004_roles_v2.sql
 */
const LEGACY_ROLE_SWAP_MIGRATION = "0004_roles_v2_swap_03_04";
const FINAL_ROLE_RESTORE_MIGRATION = "0005_roles_v3_restore_03_participant_04_operations";

function roleSwapStatements(database: D1Database, table: string, column: string) {
  return [
    database.prepare(`UPDATE ${table} SET ${column} = '03__' WHERE ${column} = '03'`),
    database.prepare(`UPDATE ${table} SET ${column} = '03' WHERE ${column} = '04'`),
    database.prepare(`UPDATE ${table} SET ${column} = '04' WHERE ${column} = '03__'`),
  ];
}

async function migrationApplied(database: D1Database, name: string): Promise<boolean> {
  const applied = await database
    .prepare(`SELECT name FROM schema_migrations WHERE name = ?`)
    .bind(name)
    .first<{ name: string }>();
  return Boolean(applied);
}

async function applyRoleMigrations(database: D1Database): Promise<void> {
  // Önce önceki sürümün izi tamamlanır; daha sonra nihai rol dizilimi tek kez
  // geri yüklenir. Böylece hem eski hem de yeni kurulmuş veritabanlarında aynı
  // sonuç elde edilir ve hiçbir hesap silinmez.
  if (!await migrationApplied(database, LEGACY_ROLE_SWAP_MIGRATION)) {
    await database.batch([
      ...roleSwapStatements(database, "admin_accounts", "role_code"),
      ...roleSwapStatements(database, "admin_audit_log", "actor_role"),
      database.prepare(`INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)`)
        .bind(LEGACY_ROLE_SWAP_MIGRATION, new Date().toISOString()),
    ]);
  }
  if (await migrationApplied(database, FINAL_ROLE_RESTORE_MIGRATION)) return;
  await database.batch([
    ...roleSwapStatements(database, "admin_accounts", "role_code"),
    ...roleSwapStatements(database, "admin_audit_log", "actor_role"),
    database.prepare(`INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)`)
      .bind(FINAL_ROLE_RESTORE_MIGRATION, new Date().toISOString()),
  ]);
  console.info(`[migration] ${FINAL_ROLE_RESTORE_MIGRATION} uygulandı: 03 Yarışmacı, 04 Değerlendirme Yöneticisi.`);
}

/**
 * Yarışmacı parola bayrağı düzeltmesi (tek seferlik veri göçü).
 *
 * Yarışmacı kayıt sırasında parolasını KENDİSİ seçer; buna rağmen eski kayıt
 * akışı `must_change_password` bayrağını varsayılan 1 bırakıyordu. Gerçek
 * parola değiştirme akışı (app/api/admin/password) devreye girince bu bayrak
 * yarışmacıyı yanlış yere zorunlu değişime sokardı. Yalnızca kendi kaydını
 * açan (created_by = 'yarışmacı kaydı') 03 hesapları temizlenir; yönetici
 * eliyle geçici parolayla açılan hesaplara DOKUNULMAZ.
 * Referans SQL: migrations/0011_participant_password_flag.sql
 */
const PARTICIPANT_PASSWORD_FLAG_MIGRATION = "0011_participant_password_flag";

async function applyParticipantPasswordFlagMigration(database: D1Database): Promise<void> {
  if (await migrationApplied(database, PARTICIPANT_PASSWORD_FLAG_MIGRATION)) return;
  // Rol göçlerinden SONRA çalışmalıdır: 03 kodu nihai dizilimde Yarışmacıdır.
  await database.batch([
    database.prepare(
      `UPDATE admin_accounts SET must_change_password = 0
       WHERE role_code = '03' AND created_by = 'yarışmacı kaydı'`,
    ),
    database.prepare(`INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)`)
      .bind(PARTICIPANT_PASSWORD_FLAG_MIGRATION, new Date().toISOString()),
  ]);
}

/**
 * Kullanıcı adıyla giriş (madde 7).
 *
 * Sütun EKLEMELİ ve geriye uyumludur: var olan hesaplar e-postayla girmeye
 * devam eder, `username` boş kalır. Kısmi benzersiz dizin yalnızca dolu
 * değerleri kapsar, böylece birden çok NULL sorun çıkarmaz.
 * Referans SQL: migrations/0008_integrity_and_lifecycle.sql
 */
async function upgradeAccountTable(database: D1Database): Promise<void> {
  const info = await database.prepare(`PRAGMA table_info(admin_accounts)`).all<{ name: string }>();
  const present = new Set((info.results ?? []).map((row) => row.name));
  if (!present.has("username")) {
    await database.prepare(`ALTER TABLE admin_accounts ADD COLUMN username TEXT`).run();
  }
  await database.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_username
     ON admin_accounts (username) WHERE username IS NOT NULL`,
  ).run().catch(() => undefined);
}

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
      .then(() => upgradeAccountTable(database))
      .then(() => applyRoleMigrations(database))
      .then(() => applyParticipantPasswordFlagMigration(database))
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

/**
 * Kullanıcı adı: küçük harfe indirgenir, yalnızca harf/rakam/nokta/alt çizgi
 * ve tire kabul edilir. Boş sonuç `null` döner (kullanıcı adı isteğe bağlıdır).
 */
export function normalizeUsername(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9._-]/g, "");
  return cleaned ? cleaned.slice(0, 64) : null;
}

type AccountRow = {
  id: string;
  full_name: string;
  email: string;
  username: string | null;
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

/**
 * ROL FAIL-CLOSED: tanınmayan `role_code` HİÇBİR role çevrilmez (eski davranış
 * sessizce "01" Yarışma Yöneticisine düşürüyordu — yetki kazandıran bir
 * fail-open). Geçersiz rollü satır hesap olarak dönmez; giriş yapamaz ve
 * oturum tutamaz. Çağıranlar null durumunda denetim kaydı/sunucu logu üretir.
 */
function toAccountOrNull(row: AccountRow): AdminAccount | null {
  if (!isRoleCode(row.role_code)) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    username: row.username ?? null,
    roleCode: row.role_code as RoleCode,
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
  const accounts: AdminAccount[] = [];
  for (const row of result.results ?? []) {
    const account = toAccountOrNull(row);
    if (!account) {
      // Geçersiz rollü satır panelde gösterilmez; düzeltme veri tabanı
      // müdahalesi ister ve iz sunucu logunda kalır.
      console.error("[admin] tanınmayan role_code'lu hesap listeden gizlendi:", row.id, row.role_code);
      continue;
    }
    accounts.push(account);
  }
  return accounts;
}

export async function findAccountByEmail(email: string): Promise<AdminAccount | null> {
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT * FROM admin_accounts WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<AccountRow>();
  return row ? toAccountOrNull(row) : null;
}

export async function findAccountById(id: string): Promise<AdminAccount | null> {
  const database = await getDatabase();
  const row = await database.prepare(`SELECT * FROM admin_accounts WHERE id = ?`).bind(id).first<AccountRow>();
  return row ? toAccountOrNull(row) : null;
}

export async function insertAccount(input: {
  fullName: string;
  email: string;
  username?: string | null;
  roleCode: RoleCode;
  password: PasswordRecord;
  createdBy: string | null;
  /** Kurulum hesabının şifresi ilk girişte değiştirilmiş sayılmaz; varsayılan true. */
  mustChangePassword?: boolean;
}): Promise<AdminAccount> {
  const database = await getDatabase();
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  if (username) {
    const taken = await database.prepare(`SELECT id FROM admin_accounts WHERE username = ?`)
      .bind(username).first<{ id: string }>();
    if (taken) throw new ConflictError("Bu kullanıcı adı zaten kullanılıyor.");
  }
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
    username,
    roleCode: input.roleCode,
    status: "active",
    mustChangePassword: input.mustChangePassword !== false,
    createdAt: nowIso(),
    createdBy: input.createdBy,
    revokedAt: null,
    revokedReason: null,
  };

  try {
    await database
      .prepare(
        `INSERT INTO admin_accounts
          (id, full_name, email, username, role_code, password_hash, password_salt, password_iterations,
           must_change_password, status, created_at, created_by, revoked_at, revoked_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL)`,
      )
      .bind(
        account.id,
        account.fullName,
        account.email,
        account.username,
        account.roleCode,
        input.password.hash,
        input.password.salt,
        input.password.iterations,
        account.mustChangePassword ? 1 : 0,
        account.createdAt,
        account.createdBy,
      )
      .run();
  } catch (error) {
    // EŞZAMANLILIK: yukarıdaki ön-SELECT'ler iki eşzamanlı istekte yarışı
    // kaçırabilir; UNIQUE ihlali burada tutarlı 409'a çevrilir (belirsiz 500
    // değil) ve hesap oluşmadığı için parola çağırana dönmez.
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (/UNIQUE constraint failed:.*username/i.test(message)) {
      throw new ConflictError("Bu kullanıcı adı zaten kullanılıyor.");
    }
    if (/UNIQUE constraint failed:.*email/i.test(message)) {
      throw new ConflictError("Bu e-posta adresiyle zaten aktif bir hesap var.");
    }
    throw error;
  }

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

export async function findAccountByUsername(username: string): Promise<AdminAccount | null> {
  const database = await getDatabase();
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const row = await database.prepare(`SELECT * FROM admin_accounts WHERE username = ?`)
    .bind(normalized).first<AccountRow>();
  return row ? toAccountOrNull(row) : null;
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

/**
 * Giriş kimliğiyle hesap arar: kullanıcı adı VEYA e-posta.
 *
 * Kullanıcı rol SEÇMEZ; hesabın rolü veri tabanından okunur ve panel ona göre
 * açılır (madde 7).
 */
export async function findCredentialsByIdentifier(identifier: string): Promise<AccountCredentials | null> {
  const database = await getDatabase();
  const email = normalizeEmail(identifier);
  const username = normalizeUsername(identifier);
  const row = await database
    .prepare(`SELECT * FROM admin_accounts WHERE email = ? OR (username IS NOT NULL AND username = ?)`)
    .bind(email, username ?? "\u0000")
    .first<AccountRow>();
  if (!row) return null;
  const account = toAccountOrNull(row);
  if (!account) {
    // ROL FAIL-CLOSED: geçersiz/sentinel rollü hesap giriş yapamaz. Deneme
    // denetim izine yazılır; çağıran, bilinmeyen kullanıcıyla AYNI tekdüze
    // yoldan (sahte PBKDF2 dahil) 401 döner — rol bozukluğu dışarı sızmaz.
    await recordAudit({
      actorId: row.id,
      actorEmail: row.email,
      actorRole: row.role_code,
      action: "login_denied_invalid_role",
      targetType: "account",
      targetId: row.id,
      detail: `tanınmayan role_code ile giriş reddedildi: ${row.role_code}`,
    });
    return null;
  }
  return {
    account,
    password: { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations },
  };
}

export async function findCredentialsByEmail(email: string): Promise<AccountCredentials | null> {
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT * FROM admin_accounts WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<AccountRow>();
  if (!row) return null;
  const account = toAccountOrNull(row);
  if (!account) return null;
  return {
    account,
    password: { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations },
  };
}

/**
 * Oturumdaki hesabın parola özetini getirir (parola değiştirme akışı).
 * Rol dönüşümü fail-closed'dır: tanınmayan rollü satır kimlik DÖNDÜRMEZ.
 */
export async function findCredentialsById(id: string): Promise<AccountCredentials | null> {
  const database = await getDatabase();
  const row = await database.prepare(`SELECT * FROM admin_accounts WHERE id = ?`).bind(id).first<AccountRow>();
  if (!row) return null;
  const account = toAccountOrNull(row);
  if (!account) return null;
  return {
    account,
    password: { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations },
  };
}

/**
 * Parolayı günceller ve `must_change_password` bayrağını AYNI ifadede
 * temizler; iki ayrı yazım arasında yarıda kalmış durum oluşamaz. (Eski
 * `markPasswordChanged` yardımcısı hiçbir akışa bağlı değildi; bu tek
 * güncellemenin içinde eridi.)
 */
export async function updatePassword(id: string, record: PasswordRecord): Promise<void> {
  const database = await getDatabase();
  await database
    .prepare(
      `UPDATE admin_accounts
       SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0
       WHERE id = ?`,
    )
    .bind(record.hash, record.salt, record.iterations, id)
    .run();
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
  const accountRow = await database
    .prepare(`SELECT * FROM admin_accounts WHERE id = ?`)
    .bind(row.account_id)
    .first<AccountRow>();
  const account = accountRow ? toAccountOrNull(accountRow) : null;
  if (accountRow && !account) {
    // ROL FAIL-CLOSED: oturum sahibinin rolü tanınmıyorsa açık oturum ANINDA
    // düşürülür ve olay denetim izine yazılır; hesap hiçbir yetki kazanamaz.
    await deleteSession(tokenHash);
    await recordAudit({
      actorId: accountRow.id,
      actorEmail: accountRow.email,
      actorRole: accountRow.role_code,
      action: "session_denied_invalid_role",
      targetType: "account",
      targetId: accountRow.id,
      detail: `tanınmayan role_code ile oturum reddedildi: ${accountRow.role_code}`,
    });
    return null;
  }
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

/**
 * Parola değişiminde hesabın DİĞER bütün oturumları düşürülür; kullanıcının
 * değişimi yaptığı mevcut oturum korunur (ekrandan atılmaz). Geçici parolayla
 * açılmış eski oturumlar böylece anında geçersizleşir.
 */
export async function deleteOtherSessionsForAccount(accountId: string, keepTokenHash: string): Promise<void> {
  const database = await getDatabase();
  await database
    .prepare(`DELETE FROM admin_sessions WHERE account_id = ? AND token_hash <> ?`)
    .bind(accountId, keepTokenHash)
    .run();
}

/* ------------------------------------------------------------------------- *
 * Dağıtık kaba kuvvet sınırlaması (D1)
 *
 * Eski proses içi Map, Cloudflare izolatları arasında paylaşılmıyor ve süresi
 * dolan anahtarları temizlemiyordu. Sayaç artık D1'dedir: anahtar
 * SHA-256(ip|kimlik) özetidir (açık IP/kimlik SAKLANMAZ), pencere sürelidir
 * ve eski satırlar her yazımda fırsatçı TTL ile silinir (createSession'daki
 * süresi dolmuş oturum temizliğiyle aynı kalıp).
 * Referans SQL: migrations/0014_auth_hardening.sql
 * ------------------------------------------------------------------------- */
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_FAILURE_LIMIT = 8;

/** Pencere içindeki başarısız deneme sayısı; pencere dolmuşsa 0 sayılır. */
export async function countRecentLoginFailures(
  keyHash: string,
  windowMs: number = LOGIN_FAILURE_WINDOW_MS,
): Promise<number> {
  const database = await getDatabase();
  const row = await database
    .prepare(`SELECT fail_count, window_started_at FROM admin_login_failures WHERE key_hash = ?`)
    .bind(keyHash)
    .first<{ fail_count: number; window_started_at: string }>();
  if (!row) return 0;
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  return row.window_started_at < cutoff ? 0 : row.fail_count;
}

/** Başarısız denemeyi TEK upsert ile yazar (yarışa dayanıklı) + TTL temizliği. */
export async function recordLoginFailure(
  keyHash: string,
  windowMs: number = LOGIN_FAILURE_WINDOW_MS,
): Promise<void> {
  const database = await getDatabase();
  const now = nowIso();
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  await database
    .prepare(
      `INSERT INTO admin_login_failures (key_hash, window_started_at, fail_count, last_failed_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key_hash) DO UPDATE SET
         fail_count = CASE WHEN admin_login_failures.window_started_at < ?
           THEN 1 ELSE admin_login_failures.fail_count + 1 END,
         window_started_at = CASE WHEN admin_login_failures.window_started_at < ?
           THEN excluded.window_started_at ELSE admin_login_failures.window_started_at END,
         last_failed_at = excluded.last_failed_at`,
    )
    .bind(keyHash, now, now, cutoff, cutoff)
    .run();
  // Fırsatçı TTL: süresi çoktan geçmiş satırlar birikmesin (sınırsız büyüme yok).
  const expiry = new Date(Date.now() - windowMs * 2).toISOString();
  await database.prepare(`DELETE FROM admin_login_failures WHERE last_failed_at < ?`).bind(expiry).run();
}

/** Başarılı girişte sayaç sıfırlanır. */
export async function clearLoginFailures(keyHash: string): Promise<void> {
  const database = await getDatabase();
  await database.prepare(`DELETE FROM admin_login_failures WHERE key_hash = ?`).bind(keyHash).run();
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
  return row ? toAccountOrNull(row) : null;
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

/* ------------------------------------------------------------------------- *
 * Süreç zaman çizelgesi (olay bazlı)
 *
 * Eski tasarımdaki `document_flows` / `document_handoffs` zinciri, belgeyi
 * 01 → 02 → 03 → 04 sırasıyla devreden bir modeldi ve yeni rol mantığıyla
 * çelişiyordu. Yerini, her rolün kendi görevini yaptığında düşen olay kaydı
 * aldı. Tarihsel kayıtlar silinmez; eski tablolar yalnızca okunmaz duruma
 * gelir (bkz. migrations/0004_roles_v2.sql).
 * ------------------------------------------------------------------------- */

type WorkflowEventRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  event: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  detail: string;
  created_at: string;
};

function toWorkflowEvent(row: WorkflowEventRow): WorkflowEvent {
  return {
    id: row.id,
    subjectType: row.subject_type === "profile" ? "profile" : "application",
    subjectId: row.subject_id,
    event: row.event as WorkflowEventName,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: isRoleCode(row.actor_role) ? row.actor_role : null,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

/**
 * Süreç olayını yazar. Zaman çizelgesi bu kayıtlardan üretilir; hakemin AI
 * puanını değiştirmesi gibi manuel müdahaleler `detail` alanında gerekçesiyle
 * saklanır. Olay yazımı asla ana işlemi düşürmez.
 */
export async function recordWorkflowEvent(input: WorkflowEventInput): Promise<void> {
  try {
    const database = await getDatabase();
    await database
      .prepare(
        `INSERT INTO workflow_events (id, subject_type, subject_id, event, actor_id, actor_name, actor_role, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.subjectType,
        input.subjectId,
        input.event,
        input.actor?.id ?? null,
        input.actor?.fullName ?? "sistem",
        input.actor?.roleCode ?? null,
        (input.detail ?? "").slice(0, 1_000),
        nowIso(),
      )
      .run();
  } catch (error) {
    console.error("[timeline] olay yazılamadı", error);
  }
}

/** Birden çok olayı tek turda yazar (ör. hakem kararı + puan düzeltmeleri). */
export async function recordWorkflowEvents(inputs: WorkflowEventInput[]): Promise<void> {
  for (const input of inputs) await recordWorkflowEvent(input);
}

export async function listWorkflowEvents(
  subjectType: WorkflowSubject,
  subjectId: string,
  limit = 200,
): Promise<WorkflowEvent[]> {
  const database = await getDatabase();
  const result = await database
    .prepare(
      `SELECT * FROM workflow_events
       WHERE subject_type = ? AND subject_id = ?
       ORDER BY created_at ASC LIMIT ?`,
    )
    .bind(subjectType, subjectId, limit)
    .all<WorkflowEventRow>();
  return (result.results ?? []).map(toWorkflowEvent);
}

/** Operasyon panosunun "son hareketler" akışı. */
export async function listRecentWorkflowEvents(limit = 60): Promise<WorkflowEvent[]> {
  const database = await getDatabase();
  const result = await database
    .prepare(`SELECT * FROM workflow_events ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<WorkflowEventRow>();
  return (result.results ?? []).map(toWorkflowEvent);
}
