import { env } from "cloudflare:workers";
import { getDatabase } from "./admin-db";
import { fold } from "./competitions";
import type { AdminAccount } from "./admin-types";
import type { AnalysisResult, JudgeReview, ProfileExport, ReportEvaluation } from "./types";
import type {
  ApplicationOutcome,
  ApplicationStatus,
  CompetitionApplication,
  CriteriaExtractionRun,
  PublishedProfile,
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
    status TEXT NOT NULL DEFAULT 'published',
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

let workflowSchemaPromise: Promise<void> | null = null;

async function workflowDatabase(): Promise<D1Database> {
  const database = await getDatabase();
  if (!workflowSchemaPromise) {
    workflowSchemaPromise = database.batch(WORKFLOW_SCHEMA.map((sql) => database.prepare(sql)))
      .then(() => undefined)
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
  created_by: string;
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

function toProfile(row: ProfileRow): PublishedProfile {
  return {
    id: row.id,
    competitionKey: row.competition_key,
    competitionName: row.competition_name,
    category: row.category,
    stage: row.stage,
    reportType: row.report_type,
    sourceDocumentName: row.source_document_name,
    profile: JSON.parse(row.profile_json) as ProfileExport,
    createdBy: row.created_by,
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
  view: "full" | "participant" | "summary",
): CompetitionApplication {
  const review = view === "summary" ? null : parseJson<JudgeReview>(row.review_json);
  return {
    id: row.id,
    participantId: view === "summary" ? "" : row.participant_id,
    participantName: view === "summary" ? (row.team_name || "Takım") : row.participant_name,
    participantEmail: view === "summary" ? null : row.participant_email,
    applicantFullName: view === "summary" ? "" : (row.applicant_full_name || row.participant_name),
    teamName: row.team_name || row.participant_name,
    teamMembers: view === "summary" ? [] : members.map((member) => ({ id: member.id, fullName: member.full_name })),
    competitionKey: row.competition_key,
    competitionName: row.competition_name,
    profileId: row.profile_id,
    fileName: view === "summary" ? null : row.file_name,
    mimeType: view === "summary" ? null : row.mime_type,
    sizeBytes: view === "summary" ? null : row.size_bytes,
    status: (["submitted", "analyzing", "awaiting_judge", "completed", "analysis_failed"].includes(row.status)
      ? row.status
      : "submitted") as ApplicationStatus,
    evaluation: view === "full" ? parseJson<ReportEvaluation>(row.evaluation_json) : null,
    review,
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

export async function savePublishedProfile(profile: ProfileExport, actor: AdminAccount): Promise<PublishedProfile> {
  const database = await workflowDatabase();
  const id = profile.profileId ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const key = competitionKey(profile.setup.competition);
  await database.prepare(
    `INSERT INTO competition_profiles
      (id, competition_key, competition_name, category, stage, report_type, source_document_name,
       profile_json, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       competition_key = excluded.competition_key,
       competition_name = excluded.competition_name,
       category = excluded.category,
       stage = excluded.stage,
       report_type = excluded.report_type,
       source_document_name = excluded.source_document_name,
       profile_json = excluded.profile_json,
       status = 'published',
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
    timestamp,
    timestamp,
  ).run();
  await database.prepare(
    `UPDATE criteria_extraction_runs
     SET status = 'approved', profile_id = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM criteria_extraction_runs
       WHERE created_by = ? AND source_document_name = ?
       ORDER BY analyzed_at DESC LIMIT 1
     )`,
  ).bind(id, timestamp, actor.id, profile.sourceDocument.name).run();
  const saved = await findPublishedProfile(id);
  if (!saved) throw new Error("Onaylı profil kaydedildi ancak geri okunamadı.");
  return saved;
}

export async function findPublishedProfile(id: string): Promise<PublishedProfile | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competition_profiles WHERE id = ? AND status = 'published'`,
  ).bind(id).first<ProfileRow>();
  return row ? toProfile(row) : null;
}

export async function findLatestProfileForCompetition(name: string): Promise<PublishedProfile | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competition_profiles
     WHERE competition_key = ? AND status = 'published'
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind(competitionKey(name)).first<ProfileRow>();
  return row ? toProfile(row) : null;
}

export async function listPublishedProfiles(account?: AdminAccount): Promise<PublishedProfile[]> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT * FROM competition_profiles
     WHERE status = 'published' ${account?.roleCode === "01" ? "AND created_by = ?" : ""}
     ORDER BY updated_at DESC`,
  ).bind(...(account?.roleCode === "01" ? [account.id] : [])).all<ProfileRow>();
  return (result.results ?? []).map(toProfile);
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
  return saved;
}

function applicationVisibility(account: AdminAccount, alias = "a"): { sql: string; binds: unknown[] } {
  return account.roleCode === "03"
    ? { sql: `WHERE ${alias}.participant_id = ?`, binds: [account.id] }
    : { sql: "", binds: [] };
}

function applicationView(account: AdminAccount): "full" | "participant" | "summary" {
  if (account.roleCode === "03") return "participant";
  if (account.roleCode === "04") return "summary";
  return "full";
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
    account.roleCode === "04" ? Promise.resolve([]) : listTeamMembers(database, account),
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
  const members = account.roleCode === "04" ? [] : await listTeamMembers(database, account, id);
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

export async function markApplicationAnalyzing(id: string, judge: AdminAccount): Promise<"started" | "profile_missing" | "conflict"> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT competition_name, profile_id, status FROM competition_applications WHERE id = ?`,
  ).bind(id).first<{ competition_name: string; profile_id: string | null; status: string }>();
  if (!current || !["submitted", "analysis_failed"].includes(current.status)) return "conflict";
  const profile = current.profile_id ? await findPublishedProfile(current.profile_id) : await findLatestProfileForCompetition(current.competition_name);
  if (!profile) return "profile_missing";
  const result = await database.prepare(
    `UPDATE competition_applications
     SET status = 'analyzing', profile_id = ?, judge_id = ?, judge_name = ?, updated_at = ?
     WHERE id = ? AND status IN ('submitted', 'analysis_failed')`,
  ).bind(profile.id, judge.id, judge.fullName, new Date().toISOString(), id).run();
  return result.meta.changes ? "started" : "conflict";
}

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
}

export async function saveApplicationReview(id: string, judge: AdminAccount, review: JudgeReview): Promise<void> {
  const database = await workflowDatabase();
  const completed = review.status === "completed";
  const timestamp = new Date().toISOString();
  await database.batch([database.prepare(
    `UPDATE competition_applications
     SET status = ?, review_json = ?, judge_id = ?, judge_name = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(
    completed ? "completed" : "awaiting_judge",
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
