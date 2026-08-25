import { env } from "cloudflare:workers";
import { getDatabase, recordWorkflowEvent, recordWorkflowEvents } from "./admin-db";
import { fold } from "./competitions";
import type { AdminAccount, WorkflowEventInput } from "./admin-types";
import type { AnalysisResult, JudgeReview, ProfileExport, ReportEvaluation } from "./types";
import {
  APPLICATION_STATUSES,
  type ApplicationOutcome,
  type ApplicationStatus,
  type CompetitionApplication,
  type CompetitionProfile,
  type CriteriaExtractionRun,
  type OperationsSummary,
  type ProfileReviewDecision,
  type ProfileStatus,
} from "./workflow-types";

const WORKFLOW_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS competition_profiles (
    id TEXT PRIMARY KEY,
    competition_key TEXT NOT NULL,
    competition_name TEXT NOT NULL,
    category TEXT NOT NULL,
    stage TEXT NOT NULL,
    report_type TEXT NOT NULL,
    source_document_name TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_profiles_competition
   ON competition_profiles (competition_key, status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS competition_applications (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    participant_email TEXT NOT NULL,
    competition_key TEXT NOT NULL,
    competition_name TEXT NOT NULL,
    profile_id TEXT,
    file_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    evaluation_json TEXT,
    review_json TEXT,
    judge_id TEXT,
    judge_name TEXT,
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_applications_participant
   ON competition_applications (participant_id, submitted_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_applications_queue
   ON competition_applications (status, submitted_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_applications_competition
   ON competition_applications (competition_key, submitted_at DESC)`,
  `CREATE TABLE IF NOT EXISTS application_submission_details (
    application_id TEXT PRIMARY KEY,
    applicant_full_name TEXT NOT NULL,
    team_name TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'pending',
    outcome_note TEXT NOT NULL DEFAULT '',
    decided_at TEXT,
    FOREIGN KEY (application_id) REFERENCES competition_applications(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS application_team_members (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    member_order INTEGER NOT NULL,
    full_name TEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES competition_applications(id) ON DELETE CASCADE,
    UNIQUE (application_id, member_order)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_application_team_members_application
   ON application_team_members (application_id, member_order)`,
  `CREATE TABLE IF NOT EXISTS criteria_extraction_runs (
    id TEXT PRIMARY KEY,
    source_document_name TEXT NOT NULL,
    competition_name TEXT NOT NULL,
    criteria_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'analyzed',
    profile_id TEXT,
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    analyzed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_extraction_runs_owner
   ON criteria_extraction_runs (created_by, analyzed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_extraction_runs_status
   ON criteria_extraction_runs (status, updated_at DESC)`,
];

/**
 * Hakem doğrulaması (Aşama A) için sonradan eklenen sütunlar.
 * D1'de `ADD COLUMN IF NOT EXISTS` yoktur; eksik olanlar tek tek eklenir.
 * Var olan satırlar korunur, hiçbir veri silinmez.
 */
const PROFILE_REVIEW_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "created_by_name", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "review_note", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "reviewed_by", definition: "TEXT" },
  { name: "reviewed_by_name", definition: "TEXT" },
  { name: "reviewed_at", definition: "TEXT" },
  { name: "submitted_at", definition: "TEXT" },
];

async function upgradeProfileTable(database: D1Database): Promise<void> {
  const columns = await database.prepare(`PRAGMA table_info(competition_profiles)`).all<{ name: string }>();
  const present = new Set((columns.results ?? []).map((row) => row.name));
  const missing = PROFILE_REVIEW_COLUMNS.filter((column) => !present.has(column.name));
  for (const column of missing) {
    await database.prepare(`ALTER TABLE competition_profiles ADD COLUMN ${column.name} ${column.definition}`).run();
  }
  // Eski sürümde profil yayımlanır yayımlanmaz yürürlüğe giriyordu; bu satırlar
  // zaten aktif olduğu için hakem onaylı sayılır ve süreç dışında kalmazlar.
  await database.prepare(`UPDATE competition_profiles SET status = 'approved' WHERE status = 'published'`).run();
}

let workflowSchemaPromise: Promise<void> | null = null;

async function workflowDatabase(): Promise<D1Database> {
  const database = await getDatabase();
  if (!workflowSchemaPromise) {
    workflowSchemaPromise = database.batch(WORKFLOW_SCHEMA.map((sql) => database.prepare(sql)))
      .then(() => upgradeProfileTable(database))
      .catch((error: unknown) => {
        workflowSchemaPromise = null;
        throw error;
      });
  }
  await workflowSchemaPromise;
  return database;
}

export class ReportStorageUnavailableError extends Error {
  constructor() {
    super("PDF saklama alanı şu anda kullanılamıyor.");
    this.name = "ReportStorageUnavailableError";
  }
}

export function reportBucket(): R2Bucket {
  if (!env.REPORTS) throw new ReportStorageUnavailableError();
  return env.REPORTS;
}

export function competitionKey(name: string): string {
  return fold(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 160);
}

type ProfileRow = {
  id: string;
  competition_key: string;
  competition_name: string;
  category: string;
  stage: string;
  report_type: string;
  source_document_name: string;
  profile_json: string;
  status: string;
  created_by: string;
  created_by_name: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ApplicationRow = {
  id: string;
  participant_id: string;
  participant_name: string;
  participant_email: string;
  competition_key: string;
  competition_name: string;
  profile_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  evaluation_json: string | null;
  review_json: string | null;
  judge_id: string | null;
  judge_name: string | null;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
  applicant_full_name: string | null;
  team_name: string | null;
  outcome: string | null;
  outcome_note: string | null;
  decided_at: string | null;
};

type TeamMemberRow = {
  id: string;
  application_id: string;
  full_name: string;
};

type ExtractionRow = {
  id: string;
  source_document_name: string;
  competition_name: string;
  criteria_count: number;
  status: string;
  profile_id: string | null;
  created_by: string;
  created_by_name: string;
  analyzed_at: string;
  updated_at: string;
};

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function normalizeProfileStatus(value: string): ProfileStatus {
  // 'published' eski sürümün adıydı ve o satırlar yürürlükteydi.
  if (value === "published" || value === "approved") return "approved";
  return (["draft", "judge_review_pending", "changes_requested"] as string[]).includes(value)
    ? value as ProfileStatus
    : "draft";
}

function toProfile(row: ProfileRow): CompetitionProfile {
  return {
    id: row.id,
    competitionKey: row.competition_key,
    competitionName: row.competition_name,
    category: row.category,
    stage: row.stage,
    reportType: row.report_type,
    sourceDocumentName: row.source_document_name,
    profile: JSON.parse(row.profile_json) as ProfileExport,
    status: normalizeProfileStatus(row.status),
    createdBy: row.created_by,
    createdByName: row.created_by_name || "",
    reviewedBy: row.reviewed_by,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note ?? "",
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeOutcome(value: string | null): ApplicationOutcome {
  return (["pending", "accepted", "rejected", "revision_required"] as string[]).includes(value ?? "")
    ? value as ApplicationOutcome
    : "pending";
}

function toApplication(
  row: ApplicationRow,
  members: TeamMemberRow[],
  view: "full" | "participant" | "operations",
): CompetitionApplication {
  const operations = view === "operations";
  const evaluation = parseJson<ReportEvaluation>(row.evaluation_json);
  return {
    id: row.id,
    participantId: operations ? "" : row.participant_id,
    participantName: operations ? (row.team_name || "Takım") : row.participant_name,
    participantEmail: operations ? null : row.participant_email,
    applicantFullName: operations ? "" : (row.applicant_full_name || row.participant_name),
    teamName: row.team_name || row.participant_name,
    teamMembers: operations ? [] : members.map((member) => ({ id: member.id, fullName: member.full_name })),
    competitionKey: row.competition_key,
    competitionName: row.competition_name,
    profileId: row.profile_id,
    fileName: operations ? null : row.file_name,
    mimeType: operations ? null : row.mime_type,
    sizeBytes: operations ? null : row.size_bytes,
    status: (APPLICATION_STATUSES as string[]).includes(row.status)
      ? row.status as ApplicationStatus
      : "submitted",
    evaluation: view === "full" ? evaluation : operations ? redactEvaluation(evaluation) : null,
    review: operations ? null : parseJson<JudgeReview>(row.review_json),
    judgeId: row.judge_id,
    judgeName: row.judge_name,
    outcome: normalizeOutcome(row.outcome),
    outcomeNote: row.outcome_note ?? "",
    decidedAt: row.decided_at,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function toExtractionRun(row: ExtractionRow): CriteriaExtractionRun {
  return {
    id: row.id,
    sourceDocumentName: row.source_document_name,
    competitionName: row.competition_name,
    criteriaCount: row.criteria_count,
    status: row.status === "approved" ? "approved" : "analyzed",
    profileId: row.profile_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    analyzedAt: row.analyzed_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Yarışma yöneticisinin (Rol 01) hazırladığı profili hakem incelemesine gönderir.
 *
 * Profil bu adımda YÜRÜRLÜĞE GİRMEZ. `judge_review_pending` durumunda bekler;
 * yalnızca hakem onayından sonra başvuru değerlendirmesinde kullanılabilir.
 * Aynı profil düzeltilip yeniden gönderilirse hakem notu temizlenir.
 */
export async function submitProfileForReview(profile: ProfileExport, actor: AdminAccount): Promise<CompetitionProfile> {
  const database = await workflowDatabase();
  const id = profile.profileId ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const key = competitionKey(profile.setup.competition);
  await database.prepare(
    `INSERT INTO competition_profiles
      (id, competition_key, competition_name, category, stage, report_type, source_document_name,
       profile_json, status, created_by, created_by_name, review_note, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'judge_review_pending', ?, ?, '', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       competition_key = excluded.competition_key,
       competition_name = excluded.competition_name,
       category = excluded.category,
       stage = excluded.stage,
       report_type = excluded.report_type,
       source_document_name = excluded.source_document_name,
       profile_json = excluded.profile_json,
       status = 'judge_review_pending',
       review_note = '',
       reviewed_by = NULL,
       reviewed_by_name = NULL,
       reviewed_at = NULL,
       submitted_at = excluded.submitted_at,
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    key,
    profile.setup.competition,
    profile.setup.category,
    profile.setup.stage,
    profile.setup.reportType,
    profile.sourceDocument.name,
    JSON.stringify({ ...profile, profileId: id }),
    actor.id,
    actor.fullName,
    timestamp,
    timestamp,
    timestamp,
  ).run();
  await database.prepare(
    `UPDATE criteria_extraction_runs
     SET profile_id = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM criteria_extraction_runs
       WHERE created_by = ? AND source_document_name = ?
       ORDER BY analyzed_at DESC LIMIT 1
     )`,
  ).bind(id, timestamp, actor.id, profile.sourceDocument.name).run();
  const saved = await findProfile(id);
  if (!saved) throw new Error("Profil kaydedildi ancak geri okunamadı.");
  await recordWorkflowEvent({
    subjectType: "profile",
    subjectId: id,
    event: "profile_submitted_for_review",
    actor,
    detail: `${saved.competitionName} · ${profile.criteria.length} kriter · kaynak: ${profile.sourceDocument.name}`,
  });
  return saved;
}

/**
 * Hakemin (Rol 02) ikinci aşama doğrulaması.
 * `approve` profili yürürlüğe alır; `request_changes` yarışma yöneticisine geri gönderir.
 * Hakem kriterleri düzenlemişse düzeltilmiş profil `criteria` ile birlikte gelir.
 */
export async function reviewProfile(
  id: string,
  judge: AdminAccount,
  decision: ProfileReviewDecision,
  note: string,
  editedProfile?: ProfileExport,
): Promise<CompetitionProfile | "not_found" | "not_pending"> {
  const database = await workflowDatabase();
  const current = await findProfile(id);
  if (!current) return "not_found";
  if (current.status === "approved") return "not_pending";

  const timestamp = new Date().toISOString();
  const nextStatus: ProfileStatus = decision === "approve" ? "approved" : "changes_requested";
  const nextProfile = editedProfile ? { ...editedProfile, profileId: id } : null;
  const edited = !!nextProfile
    && JSON.stringify(nextProfile.criteria) !== JSON.stringify(current.profile.criteria);

  await database.prepare(
    `UPDATE competition_profiles
     SET status = ?, review_note = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?,
         profile_json = COALESCE(?, profile_json), updated_at = ?
     WHERE id = ?`,
  ).bind(
    nextStatus,
    note.trim().slice(0, 2_000),
    judge.id,
    judge.fullName,
    timestamp,
    nextProfile ? JSON.stringify(nextProfile) : null,
    timestamp,
    id,
  ).run();

  // Onaylanan profil, ayıklama geçmişinde de onaylı olarak işaretlenir.
  if (decision === "approve") {
    await database.prepare(
      `UPDATE criteria_extraction_runs SET status = 'approved', updated_at = ? WHERE profile_id = ?`,
    ).bind(timestamp, id).run();
  }

  const events: WorkflowEventInput[] = [];
  if (edited) {
    const before = current.profile.criteria.length;
    const after = nextProfile!.criteria.length;
    events.push({
      subjectType: "profile",
      subjectId: id,
      event: "profile_criteria_edited",
      actor: judge,
      detail: before === after ? `${after} kriter gözden geçirildi` : `Kriter sayısı ${before} → ${after}`,
    });
  }
  events.push({
    subjectType: "profile",
    subjectId: id,
    event: decision === "approve" ? "profile_approved" : "profile_changes_requested",
    actor: judge,
    detail: note.trim().slice(0, 500),
  });
  await recordWorkflowEvents(events);

  const saved = await findProfile(id);
  return saved ?? "not_found";
}

/** Herhangi bir durumdaki profili okur (hakem inceleme ekranı bunu kullanır). */
export async function findProfile(id: string): Promise<CompetitionProfile | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competition_profiles WHERE id = ?`,
  ).bind(id).first<ProfileRow>();
  return row ? toProfile(row) : null;
}

/** Yalnızca hakem onaylı profil. Değerlendirme akışı yalnız bunu kullanır. */
export async function findApprovedProfile(id: string): Promise<CompetitionProfile | null> {
  const profile = await findProfile(id);
  return profile?.status === "approved" ? profile : null;
}

export async function findLatestProfileForCompetition(name: string): Promise<CompetitionProfile | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competition_profiles
     WHERE competition_key = ? AND status = 'approved'
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind(competitionKey(name)).first<ProfileRow>();
  return row ? toProfile(row) : null;
}

/**
 * Rol bazlı profil listesi.
 *   01 yalnızca kendi hazırladığı profilleri görür (kendi yarışması).
 *   02 hakem onayı bekleyen ve onayladığı profillerin tamamını görür.
 *   03 yalnızca yürürlükteki profilleri salt okunur görür.
 *   00 tümünü görür.
 */
export async function listProfiles(account?: AdminAccount): Promise<CompetitionProfile[]> {
  const database = await workflowDatabase();
  const predicates: string[] = [];
  const binds: unknown[] = [];
  if (account?.roleCode === "01") { predicates.push("created_by = ?"); binds.push(account.id); }
  if (account?.roleCode === "03") predicates.push("status = 'approved'");
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  const result = await database.prepare(
    `SELECT * FROM competition_profiles ${where} ORDER BY updated_at DESC`,
  ).bind(...binds).all<ProfileRow>();
  return (result.results ?? []).map(toProfile);
}

/** Yürürlükteki (hakem onaylı) profiller. */
export async function listApprovedProfiles(account?: AdminAccount): Promise<CompetitionProfile[]> {
  return (await listProfiles(account)).filter((profile) => profile.status === "approved");
}

export async function createApplication(input: {
  participant: AdminAccount;
  applicantFullName: string;
  teamName: string;
  teamMembers: string[];
  competitionName: string;
  profileId: string | null;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<CompetitionApplication> {
  const database = await workflowDatabase();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const statements = [database.prepare(
    `INSERT INTO competition_applications
      (id, participant_id, participant_name, participant_email, competition_key, competition_name,
       profile_id, file_key, file_name, mime_type, size_bytes, status, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
  ).bind(
    id,
    input.participant.id,
    input.participant.fullName,
    input.participant.email,
    competitionKey(input.competitionName),
    input.competitionName,
    input.profileId,
    input.fileKey,
    input.fileName,
    input.mimeType,
    input.sizeBytes,
    timestamp,
    timestamp,
  ), database.prepare(
    `INSERT INTO application_submission_details
      (application_id, applicant_full_name, team_name, outcome, outcome_note)
     VALUES (?, ?, ?, 'pending', '')`,
  ).bind(id, input.applicantFullName, input.teamName),
  ...input.teamMembers.map((fullName, index) => database.prepare(
    `INSERT INTO application_team_members (id, application_id, member_order, full_name)
     VALUES (?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), id, index, fullName))];
  await database.batch(statements);
  const saved = await findApplication(id, input.participant);
  if (!saved) throw new Error("Başvuru kaydedildi ancak geri okunamadı.");
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: id,
    event: "application_submitted",
    actor: input.participant,
    detail: `${input.teamName} · ${input.competitionName} · ${input.fileName}`,
  });
  return saved;
}

/**
 * Satır düzeyinde görünürlük.
 *   04 yalnızca kendi başvurusunu görür (backend'de zorunlu, buton gizlemek yetmez).
 *   01 yalnızca kendi hazırladığı profillerin yarışmalarını görür.
 *   00, 02 ve 03 tüm başvuruları görür; alan daraltması `applicationView` ile yapılır.
 */
function applicationVisibility(account: AdminAccount, alias = "a"): { sql: string; binds: unknown[] } {
  if (account.roleCode === "04") return { sql: `WHERE ${alias}.participant_id = ?`, binds: [account.id] };
  if (account.roleCode === "01") {
    return {
      sql: `WHERE ${alias}.competition_key IN (SELECT competition_key FROM competition_profiles WHERE created_by = ?)`,
      binds: [account.id],
    };
  }
  return { sql: "", binds: [] };
}

/**
 * Alan düzeyinde görünürlük.
 *   full        00 ve 02: kanıt metinleri dahil her şey.
 *   participant 04: kendi başvurusu; hakem onaylı geri bildirim.
 *   operations  01 ve 03: sayaç ve durum takibi. Yarışmacı PDF'i, ekip üyeleri ve
 *               kanıt metinleri kapalıdır; AI ön değerlendirmesi yalnızca özet
 *               (puan ve kriter durumu) olarak görünür.
 */
function applicationView(account: AdminAccount): "full" | "participant" | "operations" {
  if (account.roleCode === "04") return "participant";
  if (account.roleCode === "01" || account.roleCode === "03") return "operations";
  return "full";
}

/**
 * Operasyon rollerine giden AI ön değerlendirmesi: kanıt alıntıları, gerekçe
 * metinleri ve yarışmacı geri bildirimi çıkarılır. Kalan alanlar süreç takibi
 * için yeterlidir; proje içeriği sızmaz.
 */
function redactEvaluation(evaluation: ReportEvaluation | null): ReportEvaluation | null {
  if (!evaluation) return null;
  return {
    ...evaluation,
    report: { ...evaluation.report, name: "" },
    preChecks: evaluation.preChecks.map((check) => ({ ...check, detail: "", evidence: [] })),
    findings: evaluation.findings.map((finding) => ({ ...finding, rationale: "", evidence: [] })),
    feedbackDraft: { strengths: [], improvements: [], suggestions: [] },
  };
}

const APPLICATION_SELECT = `SELECT a.*, d.applicant_full_name, d.team_name,
  d.outcome, d.outcome_note, d.decided_at
  FROM competition_applications a
  LEFT JOIN application_submission_details d ON d.application_id = a.id`;

async function listTeamMembers(database: D1Database, account: AdminAccount, applicationId = ""): Promise<TeamMemberRow[]> {
  const visibility = applicationVisibility(account, "a");
  const predicates = [visibility.sql.replace(/^WHERE\s+/i, "")].filter(Boolean);
  const binds = [...visibility.binds];
  if (applicationId) { predicates.push("a.id = ?"); binds.push(applicationId); }
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  const result = await database.prepare(
    `SELECT m.id, m.application_id, m.full_name
     FROM application_team_members m
     INNER JOIN competition_applications a ON a.id = m.application_id
     ${where}
     ORDER BY m.application_id, m.member_order`,
  ).bind(...binds).all<TeamMemberRow>();
  return result.results ?? [];
}

export async function listApplications(account: AdminAccount): Promise<CompetitionApplication[]> {
  const database = await workflowDatabase();
  const visibility = applicationVisibility(account);
  const statement = database.prepare(
    `${APPLICATION_SELECT} ${visibility.sql} ORDER BY a.submitted_at DESC`,
  );
  const [result, members] = await Promise.all([
    statement.bind(...visibility.binds).all<ApplicationRow>(),
    applicationView(account) === "operations" ? Promise.resolve([]) : listTeamMembers(database, account),
  ]);
  const membersByApplication = new Map<string, TeamMemberRow[]>();
  for (const member of members) membersByApplication.set(member.application_id, [...(membersByApplication.get(member.application_id) ?? []), member]);
  return (result.results ?? []).map((row) => toApplication(row, membersByApplication.get(row.id) ?? [], applicationView(account)));
}

export async function findApplication(id: string, account: AdminAccount): Promise<CompetitionApplication | null> {
  const database = await workflowDatabase();
  const visibility = applicationVisibility(account);
  const conjunction = visibility.sql ? `${visibility.sql} AND a.id = ?` : "WHERE a.id = ?";
  const binds = visibility.sql ? [...visibility.binds, id] : [id];
  const row = await database.prepare(`${APPLICATION_SELECT} ${conjunction}`)
    .bind(...binds).first<ApplicationRow>();
  if (!row) return null;
  const members = applicationView(account) === "operations" ? [] : await listTeamMembers(database, account, id);
  return toApplication(row, members, applicationView(account));
}

export async function applicationFileKey(id: string, account: AdminAccount): Promise<string | null> {
  const database = await workflowDatabase();
  const visibility = applicationVisibility(account);
  const conjunction = visibility.sql ? `${visibility.sql} AND a.id = ?` : "WHERE a.id = ?";
  const binds = visibility.sql ? [...visibility.binds, id] : [id];
  const row = await database.prepare(`SELECT a.file_key FROM competition_applications a ${conjunction}`)
    .bind(...binds).first<{ file_key: string }>();
  return row?.file_key ?? null;
}

/**
 * AI ön değerlendirmesini başlatır (Aşama C).
 * Yalnızca HAKEM ONAYLI profil varsa çalışır; onaysız profille değerlendirme yapılmaz.
 */
export async function markApplicationAnalyzing(id: string, judge: AdminAccount): Promise<"started" | "profile_missing" | "conflict"> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT competition_name, profile_id, status FROM competition_applications WHERE id = ?`,
  ).bind(id).first<{ competition_name: string; profile_id: string | null; status: string }>();
  if (!current || !["submitted", "analysis_failed"].includes(current.status)) return "conflict";
  // profile_id başvuru anında bağlanmış olsa bile hakem onayından geçmemiş olabilir;
  // o durumda aynı yarışmanın onaylı profiline düşülür.
  const linked = current.profile_id ? await findApprovedProfile(current.profile_id) : null;
  const profile = linked ?? await findLatestProfileForCompetition(current.competition_name);
  if (!profile) return "profile_missing";
  const result = await database.prepare(
    `UPDATE competition_applications
     SET status = 'analyzing', profile_id = ?, judge_id = ?, judge_name = ?, updated_at = ?
     WHERE id = ? AND status IN ('submitted', 'analysis_failed')`,
  ).bind(profile.id, judge.id, judge.fullName, new Date().toISOString(), id).run();
  if (!result.meta.changes) return "conflict";
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: id,
    event: "ai_analysis_started",
    actor: judge,
    detail: `Onaylı profil: ${profile.competitionName}`,
  });
  return "started";
}

/**
 * AI ön değerlendirmesinin sonucunu kaydeder. Sonuç NİHAİ KARAR DEĞİLDİR;
 * başvuru hakem kuyruğuna (`awaiting_judge`) düşer.
 */
export async function saveApplicationEvaluation(
  id: string,
  judge: AdminAccount,
  evaluation: ReportEvaluation | null,
  failed = false,
): Promise<void> {
  const database = await workflowDatabase();
  await database.prepare(
    `UPDATE competition_applications
     SET status = ?, evaluation_json = ?, judge_id = ?, judge_name = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    failed ? "analysis_failed" : "awaiting_judge",
    evaluation ? JSON.stringify(evaluation) : null,
    judge.id,
    judge.fullName,
    new Date().toISOString(),
    id,
  ).run();
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: id,
    event: failed ? "ai_analysis_failed" : "ai_prescreen_completed",
    actor: judge,
    detail: failed || !evaluation
      ? "Analiz tamamlanamadı; başvuru yeniden başlatılabilir."
      : `AI önerilen ham puan: ${evaluation.proposedTotals.rawScore ?? "—"} / ${evaluation.proposedTotals.declaredTotal ?? "—"} · ${evaluation.proposedTotals.pendingCriteria} kriter hakem kararı bekliyor`,
  });
}

/**
 * Hakemin AI önerisinden saptığı kriterleri, gerekçesiyle birlikte çıkarır.
 * Denetim izi bu farkları taşır: "AI puanı: 72 → Hakem nihai puanı: 76".
 */
function scoreAdjustmentEvents(
  id: string,
  judge: AdminAccount,
  evaluation: ReportEvaluation | null,
  review: JudgeReview,
): WorkflowEventInput[] {
  if (!evaluation) return [];
  const proposals = new Map(evaluation.findings.map((finding) => [finding.criterionId, finding]));
  const events: WorkflowEventInput[] = [];
  for (const decision of review.decisions) {
    if (decision.verdict !== "adjusted") continue;
    const finding = proposals.get(decision.criterionId);
    const before = finding?.proposedScore ?? null;
    if (before === decision.finalScore) continue;
    const name = finding?.criterionName ?? decision.criterionId;
    const reason = decision.note.trim();
    events.push({
      subjectType: "application",
      subjectId: id,
      event: "judge_score_adjusted",
      actor: judge,
      detail: `${name} · AI puanı: ${before ?? "—"} → Hakem nihai puanı: ${decision.finalScore ?? "—"}`
        + (reason ? ` · Değişiklik gerekçesi: ${reason.slice(0, 400)}` : " · Gerekçe girilmedi"),
    });
  }
  return events;
}

/**
 * Hakem değerlendirmesini kaydeder (Aşama D).
 * Tamamlanmamış kayıt başvuruyu `judge_in_review` durumuna alır; nihai karar
 * yalnızca `completed` ile oluşur ve sonucu yarışmacıya açar.
 */
export async function saveApplicationReview(id: string, judge: AdminAccount, review: JudgeReview): Promise<void> {
  const database = await workflowDatabase();
  const completed = review.status === "completed";
  const timestamp = new Date().toISOString();
  const before = await database.prepare(
    `SELECT status, evaluation_json FROM competition_applications WHERE id = ?`,
  ).bind(id).first<{ status: string; evaluation_json: string | null }>();
  const evaluation = parseJson<ReportEvaluation>(before?.evaluation_json ?? null);
  await database.batch([database.prepare(
    `UPDATE competition_applications
     SET status = ?, review_json = ?, judge_id = ?, judge_name = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(
    completed ? "completed" : "judge_in_review",
    JSON.stringify(review),
    judge.id,
    judge.fullName,
    timestamp,
    completed ? timestamp : null,
    id,
  ), database.prepare(
    `INSERT INTO application_submission_details
      (application_id, applicant_full_name, team_name, outcome, outcome_note, decided_at)
     SELECT id, participant_name, participant_name, ?, ?, ?
     FROM competition_applications WHERE id = ?
     ON CONFLICT(application_id) DO UPDATE SET
       outcome = excluded.outcome,
       outcome_note = excluded.outcome_note,
       decided_at = excluded.decided_at`,
  ).bind(
    completed ? review.outcome : "pending",
    completed ? review.outcomeNote.trim().slice(0, 1_000) : "",
    completed ? timestamp : null,
    id,
  )]);

  const events: WorkflowEventInput[] = [];
  if (before?.status === "awaiting_judge") {
    events.push({ subjectType: "application", subjectId: id, event: "judge_review_started", actor: judge, detail: "" });
  }
  events.push(...scoreAdjustmentEvents(id, judge, evaluation, review));
  if (completed) {
    const outcomeLabel = review.outcome === "accepted" ? "Kabul edildi"
      : review.outcome === "rejected" ? "Reddedildi"
      : review.outcome === "revision_required" ? "Hatalar düzeltilmeli" : "Sonuç bekliyor";
    events.push({
      subjectType: "application",
      subjectId: id,
      event: "judge_decision_completed",
      actor: judge,
      detail: `${outcomeLabel}${review.outcomeNote.trim() ? ` · ${review.outcomeNote.trim().slice(0, 400)}` : ""}`,
    });
  }
  await recordWorkflowEvents(events);
}

export async function saveCriteriaExtractionRun(
  result: AnalysisResult,
  sourceDocumentName: string,
  actor: AdminAccount,
): Promise<CriteriaExtractionRun> {
  const database = await workflowDatabase();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await database.prepare(
    `INSERT INTO criteria_extraction_runs
      (id, source_document_name, competition_name, criteria_count, status, profile_id,
       created_by, created_by_name, analyzed_at, updated_at)
     VALUES (?, ?, ?, ?, 'analyzed', NULL, ?, ?, ?, ?)`,
  ).bind(
    id,
    sourceDocumentName.slice(0, 240),
    result.setup.competition.slice(0, 240),
    result.criteria.length,
    actor.id,
    actor.fullName,
    result.analyzedAt || timestamp,
    timestamp,
  ).run();
  const row = await database.prepare(`SELECT * FROM criteria_extraction_runs WHERE id = ?`)
    .bind(id).first<ExtractionRow>();
  if (!row) throw new Error("Analiz geçmişi kaydedildi ancak geri okunamadı.");
  return toExtractionRun(row);
}

export async function listCriteriaExtractionRuns(account: AdminAccount): Promise<CriteriaExtractionRun[]> {
  const database = await workflowDatabase();
  const ownOnly = account.roleCode === "01";
  const result = await database.prepare(
    `SELECT * FROM criteria_extraction_runs
     ${ownOnly ? "WHERE created_by = ?" : ""}
     ORDER BY analyzed_at DESC LIMIT 500`,
  ).bind(...(ownOnly ? [account.id] : [])).all<ExtractionRow>();
  return (result.results ?? []).map(toExtractionRun);
}

/**
 * Değerlendirme Yöneticisi (Rol 03) panosunun sayaçları.
 * Görünürlük kuralı listelemeyle aynıdır; 01 yalnızca kendi yarışmalarını sayar.
 */
export async function operationsSummary(account: AdminAccount): Promise<OperationsSummary> {
  const database = await workflowDatabase();
  const visibility = applicationVisibility(account);
  const result = await database.prepare(
    `SELECT a.status AS status, COUNT(*) AS total
     FROM competition_applications a ${visibility.sql}
     GROUP BY a.status`,
  ).bind(...visibility.binds).all<{ status: string; total: number }>();
  const counts = new Map((result.results ?? []).map((row) => [row.status, Number(row.total) || 0]));
  const at = (status: ApplicationStatus) => counts.get(status) ?? 0;
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const completed = at("completed");
  return {
    total,
    aiPending: at("submitted"),
    aiProcessing: at("analyzing"),
    aiCompleted: at("awaiting_judge") + at("judge_in_review") + completed,
    judgePending: at("awaiting_judge"),
    judgeInReview: at("judge_in_review"),
    completed,
    failed: at("analysis_failed"),
    completionRate: total ? Math.round((completed / total) * 100) : 0,
  };
}
