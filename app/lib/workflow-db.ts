import { env } from "cloudflare:workers";
import { ConflictError, getDatabase, recordAudit, recordWorkflowEvent, recordWorkflowEvents } from "./admin-db";
import { COMPETITIONS, fold, type CompetitionEntry } from "./competitions";
import type { AdminAccount, WorkflowEventInput } from "./admin-types";
import { canUpdateProfile } from "./authorization";
import { criteriaContentHash, criteriaHash } from "./criteria-hash";
import { applySourceLock, buildSourceLockIndex, type SourceLockIndex } from "./source-lock";
import { validateProfileExport } from "./profile-loader";
import { findingRejectionAuditLine, judgeDecisionCounts, validateCriterionDecisions, visibleFindingsOf } from "./judge-review";
import {
  buildOperationsAnalytics,
  type AnalyticsApplicationFact,
  type AnalyticsRegistrationFact,
} from "./operations-analytics";
// Ağır PDF ayrıştırıcısı bu modülün içinde DEĞİL; `readReportTextLayer` PDF.js'i
// yalnızca gerçekten çağrıldığında dinamik olarak yükler.
import { quoteFoundOnPage, readReportTextLayer, type ReportTextLayer } from "./report-text-layer";
import {
  RULE_VERDICT_LABELS,
  aiVerdictOf,
  type AnalysisResult,
  type Criterion,
  type JudgeCriterionDecision,
  type JudgeReview,
  type ProfileExport,
  type ReportEvaluation,
  type RuleVerdict,
  type SimilarityReport,
} from "./types";
import type { SimilarityFingerprint } from "./similarity-engine";
import type { SimilarityChunkFeatures } from "./similarity-corroboration";
import {
  APPLICATION_STATUSES,
  type ApplicationOutcome,
  type ApplicationStatus,
  type CompetitionApplication,
  type CompetitionProfile,
  type CompetitionStatus,
  type CompetitionWorkflow,
  type CriteriaExtractionRun,
  type CriteriaVersion,
  type OperationsSummary,
  type OperationsAnalytics,
  type OperationsAnalyticsFilters,
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
  `CREATE TABLE IF NOT EXISTS application_participant_snapshots (
    application_id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL,
    education_status TEXT NOT NULL DEFAULT 'belirtilmedi',
    education_grade TEXT NOT NULL DEFAULT '',
    institution_name TEXT NOT NULL DEFAULT 'Belirtilmedi',
    city TEXT NOT NULL DEFAULT 'Belirtilmedi',
    gender TEXT,
    discovery_source TEXT NOT NULL DEFAULT 'belirtilmedi',
    teknofest_history TEXT NOT NULL DEFAULT 'belirtilmedi',
    team_size INTEGER NOT NULL DEFAULT 1,
    captured_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_application_snapshots_dimensions
   ON application_participant_snapshots
   (education_status, city, discovery_source, teknofest_history, team_size)`,
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
  `CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    competition_key TEXT NOT NULL UNIQUE,
    competition_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft_criteria',
    current_profile_id TEXT,
    decisions_locked INTEGER NOT NULL DEFAULT 0,
    results_published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_competitions_status ON competitions (status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS criteria (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    applicability TEXT NOT NULL,
    effect TEXT NOT NULL,
    max_score REAL,
    active INTEGER NOT NULL DEFAULT 0,
    source_page INTEGER,
    source_text TEXT NOT NULL,
    criterion_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(profile_id, position)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_criteria_profile ON criteria (profile_id, active, position)`,
  `CREATE TABLE IF NOT EXISTS submission_versions (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    file_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    submitted_by TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    UNIQUE(application_id, version_number)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_submission_versions_application ON submission_versions (application_id, version_number DESC)`,
  `CREATE TABLE IF NOT EXISTS evaluation_results (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    submission_version_id TEXT,
    profile_id TEXT,
    status TEXT NOT NULL,
    ai_raw_analysis TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_evaluation_results_application ON evaluation_results (application_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS submission_fingerprints (
    application_id TEXT PRIMARY KEY,
    submission_version_id TEXT,
    competition_key TEXT NOT NULL,
    participant_label TEXT NOT NULL,
    fingerprint_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_submission_fingerprints_scope ON submission_fingerprints (competition_key, updated_at DESC)`,
  // Benzerlik parçaları: ham metin D1'e YAZILMAZ; kimlik, konum, özet, MinHash
  // ve embedding vektörü tutulur. Parça metinleri özel R2 nesnesindedir.
  // Embedding önbelleği bu tablodur: aynı PDF sürümü + model + boru hattı
  // sürümü için embedding YALNIZCA BİR KEZ üretilir (madde 9.7).
  `CREATE TABLE IF NOT EXISTS similarity_chunks (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    submission_version_id TEXT NOT NULL,
    competition_key TEXT NOT NULL,
    pdf_hash TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    page_start INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    word_count INTEGER NOT NULL,
    text_hash TEXT NOT NULL,
    min_hash_json TEXT NOT NULL,
    embedding_json TEXT,
    embedding_model TEXT,
    embedding_dim INTEGER,
    pipeline_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (submission_version_id, pipeline_version, chunk_index)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_similarity_chunks_scope
   ON similarity_chunks (competition_key, application_id, submission_version_id)`,
  // Rapor düzeyi benzerlik sonucu: PDF sürümüne ve boru hattına bağlanır.
  // "AI analizini sil" bu satırı kaldırır; embedding önbelleği (chunks) kalır.
  `CREATE TABLE IF NOT EXISTS similarity_results (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    submission_version_id TEXT,
    pdf_hash TEXT NOT NULL,
    competition_key TEXT NOT NULL,
    minhash_version TEXT NOT NULL DEFAULT 'minhash-v1',
    embedding_model TEXT,
    embedding_dim INTEGER,
    pipeline_version TEXT NOT NULL,
    status TEXT NOT NULL,
    approx_percent INTEGER,
    closest_application_id TEXT,
    closest_label TEXT,
    report_json TEXT NOT NULL,
    analyzed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_similarity_results_application
   ON similarity_results (application_id, analyzed_at DESC)`,
  // Yarım kalan benzerlik koşusu (madde 8): büyük havuz partilere bölünür,
  // süre bütçesi dolunca ilerleme buraya yazılır ve istemci koşuyu sürdürür.
  // Ödenen embedding maliyeti CPU sınırı nedeniyle ASLA kaybolmaz: parçalar
  // ve vektörler koşudan ÖNCE kalıcıdır (migrations/0013_similarity_flow.sql).
  `CREATE TABLE IF NOT EXISTS similarity_runs (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL UNIQUE,
    pdf_hash TEXT NOT NULL,
    competition_key TEXT NOT NULL,
    pipeline_version TEXT NOT NULL,
    cursor_application_id TEXT NOT NULL DEFAULT '',
    processed_peers INTEGER NOT NULL DEFAULT 0,
    total_peers INTEGER NOT NULL DEFAULT 0,
    pool_truncated INTEGER NOT NULL DEFAULT 0,
    best_json TEXT NOT NULL DEFAULT 'null',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Resmî rapor şablonu deposu (GÖREV 3 · madde 3): YALNIZCA benzerlik
  // filtresi içindir; kriter üretmez ve rapor uygunluğu kararı vermez. Eski
  // sürümler SİLİNMEZ (is_current = 0): "benzerlik puanına katılmayan
  // ortak/şablon içeriği" denetim için okunur kalır. PDF ve metin/shingle
  // nesnesi R2'dedir (file_key / text_key); D1 yalnızca meta veriyi tutar.
  `CREATE TABLE IF NOT EXISTS similarity_templates (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    competition_key TEXT NOT NULL,
    version INTEGER NOT NULL,
    pdf_hash TEXT NOT NULL,
    file_key TEXT NOT NULL,
    text_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    word_count INTEGER NOT NULL,
    shingle_count INTEGER NOT NULL,
    pipeline_version TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (competition_key, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_similarity_templates_current
   ON similarity_templates (competition_key, is_current, version DESC)`,
  `CREATE TABLE IF NOT EXISTS criteria_analysis_cache (
    cache_key TEXT PRIMARY KEY,
    document_hash TEXT NOT NULL,
    source_document_name TEXT NOT NULL,
    model TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    raw_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_cache_recency
   ON criteria_analysis_cache (last_used_at DESC)`,
  `CREATE TABLE IF NOT EXISTS application_assignments (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    judge_id TEXT NOT NULL,
    judge_name TEXT NOT NULL,
    assigned_by TEXT NOT NULL,
    assigned_by_name TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    assigned_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_assignments_application ON application_assignments (application_id, active, assigned_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_assignments_judge ON application_assignments (judge_id, active, assigned_at DESC)`,
  // Değişmez kriter sürümleri: her yayımlama yeni bir satır açar, eski satır
  // ASLA güncellenmez. Hakem analizi her zaman EN SON sürümü kullanır; geçmiş
  // değerlendirmeler kendi sürümüyle denetlenebilir kalır.
  `CREATE TABLE IF NOT EXISTS criteria_profile_versions (
    id TEXT PRIMARY KEY,
    criteria_profile_id TEXT NOT NULL,
    competition_key TEXT NOT NULL,
    criteria_version INTEGER NOT NULL,
    criteria_hash TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    criteria_count INTEGER NOT NULL DEFAULT 0,
    published_at TEXT NOT NULL,
    published_by TEXT NOT NULL,
    published_by_name TEXT NOT NULL DEFAULT '',
    UNIQUE (competition_key, criteria_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_criteria_versions_competition
   ON criteria_profile_versions (competition_key, criteria_version DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_criteria_versions_profile
   ON criteria_profile_versions (criteria_profile_id, criteria_version ASC)`,
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

/**
 * Yarışma önceliği (Problem 4 · Değerlendirme Yöneticisi aksiyonu).
 * Eklemeli ve geriye uyumlu; bkz. migrations/0006_competition_priority.sql.
 */
const COMPETITION_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "is_priority", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "priority_note", definition: "TEXT" },
  { name: "priority_set_at", definition: "TEXT" },
  // Aktif/pasif anahtarı süreç durumundan AYRIDIR: pasifleştirme yarışmanın
  // aşamasını değiştirmez, yalnızca yeni başvuru ve yeni kuyruk üretimini
  // durdurur. Yeniden aktifleştirildiğinde aşama olduğu gibi geri döner.
  { name: "is_active", definition: "INTEGER NOT NULL DEFAULT 1" },
  { name: "activation_note", definition: "TEXT" },
  { name: "activation_changed_at", definition: "TEXT" },
  { name: "activation_changed_by", definition: "TEXT" },
  { name: "activation_changed_by_name", definition: "TEXT" },
  // Arşivleme = soft delete. Satır silinmez; denetlenebilirlik korunur.
  { name: "deleted_at", definition: "TEXT" },
  { name: "deleted_by", definition: "TEXT" },
  { name: "deleted_by_name", definition: "TEXT" },
  { name: "deleted_reason", definition: "TEXT" },
];

const APPLICATION_WORKFLOW_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "assigned_judge_id", definition: "TEXT" },
  { name: "assigned_judge_name", definition: "TEXT" },
  { name: "current_version_id", definition: "TEXT" },
  // Kaydedilen AI sonucunun bağlı olduğu değişmez bağlam. Kriterler yeniden
  // yayımlanınca sürüm eskir ve ekran "yeniden analiz gerekli" uyarısı verir.
  { name: "evaluation_criteria_version", definition: "INTEGER" },
  { name: "evaluation_criteria_hash", definition: "TEXT" },
  { name: "evaluation_pdf_hash", definition: "TEXT" },
  { name: "evaluation_version_id", definition: "TEXT" },
  // Hakemin aktif iş listesinden kaldırması: fiziksel silme değil arşivleme.
  { name: "deleted_at", definition: "TEXT" },
  { name: "deleted_by", definition: "TEXT" },
  { name: "deleted_by_name", definition: "TEXT" },
  { name: "deleted_reason", definition: "TEXT" },
];

const EVALUATION_RESULT_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "criteria_version", definition: "INTEGER" },
  { name: "criteria_hash", definition: "TEXT" },
  { name: "pdf_hash", definition: "TEXT" },
];

/**
 * Rapor sürümünün bütünlük alanları (göç 0010).
 *   pdf_hash    yüklenen belgenin SHA-256 özeti; analiz bu özete bağlanır.
 *   byte_length R2'ye yazıldığı doğrulanan nesne uzunluğu; boş/yarım nesne
 *               yazılmasını sürüm kesinleşmeden yakalar.
 */
const SUBMISSION_VERSION_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "pdf_hash", definition: "TEXT" },
  { name: "byte_length", definition: "INTEGER" },
];

const CRITERIA_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "verifiability", definition: "TEXT NOT NULL DEFAULT 'PDF_DENETLENEBILIR'" },
];

/**
 * Benzerlik v3 parça meta verisi (GÖREV 3 · madde 3-4; migrations/0010_similarity_v3.sql).
 *
 * `template_version` YALNIZCA denetim damgasıdır: embedding önbellek anahtarına
 * GİRMEZ — şablon değişimi ücretli embedding çağrısını tekrarlatmaz, yalnızca
 * benzerlik SONUÇLARINI "güncel değil" işaretler (kullanıcı kararı).
 */
const SIMILARITY_CHUNK_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "template_version", definition: "INTEGER" },
  { name: "block_start", definition: "INTEGER" },
  { name: "block_end", definition: "INTEGER" },
  { name: "chunk_kind", definition: "TEXT NOT NULL DEFAULT 'text'" },
  { name: "is_template", definition: "INTEGER NOT NULL DEFAULT 0" },
  // Benzerlik motoru (madde 5-6; migrations/0012_similarity_engine.sql):
  // kelime akışı konumu (çift sayım önleyen aralık hesabı) + doğrulama
  // özellikleri (embedding tek başına alarm üretemez). Eski satırlarda NULL
  // kalırlar; okuma tarafı NULL'a dayanıklıdır.
  { name: "word_start", definition: "INTEGER" },
  { name: "feature_json", definition: "TEXT" },
  // 64 bitlik işaret izi (madde 8; migrations/0013_similarity_flow.sql):
  // pahalı kosinüs yalnızca iz uzaklığı eşiği geçen adaylara uygulanır. İz,
  // kayıtlı vektörden ÜCRETSİZ üretilir; eski satırlarda NULL kalabilir.
  { name: "embedding_sketch", definition: "TEXT" },
];

const SIMILARITY_RESULT_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "template_version", definition: "INTEGER" },
  { name: "is_stale", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "stale_reason", definition: "TEXT" },
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

async function upgradeApplicationTable(database: D1Database): Promise<void> {
  const columns = await database.prepare(`PRAGMA table_info(competition_applications)`).all<{ name: string }>();
  const present = new Set((columns.results ?? []).map((row) => row.name));
  for (const column of APPLICATION_WORKFLOW_COLUMNS.filter((item) => !present.has(item.name))) {
    await database.prepare(`ALTER TABLE competition_applications ADD COLUMN ${column.name} ${column.definition}`).run();
  }
}

/** Eksik sütunları tek tek ekler; D1'de `ADD COLUMN IF NOT EXISTS` yoktur. */
async function addMissingColumns(
  database: D1Database,
  table: string,
  columns: Array<{ name: string; definition: string }>,
): Promise<void> {
  const info = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const present = new Set((info.results ?? []).map((row) => row.name));
  for (const column of columns.filter((item) => !present.has(item.name))) {
    await database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`).run();
  }
}

async function upgradeCompetitionTable(database: D1Database): Promise<void> {
  const columns = await database.prepare(`PRAGMA table_info(competitions)`).all<{ name: string }>();
  const present = new Set((columns.results ?? []).map((row) => row.name));
  for (const column of COMPETITION_COLUMNS.filter((item) => !present.has(item.name))) {
    await database.prepare(`ALTER TABLE competitions ADD COLUMN ${column.name} ${column.definition}`).run();
  }
  await database.prepare(
    `CREATE INDEX IF NOT EXISTS idx_competitions_priority ON competitions (is_priority DESC, updated_at DESC)`,
  ).run().catch(() => undefined);
  await database.prepare(
    `CREATE INDEX IF NOT EXISTS idx_competitions_active ON competitions (is_active, status, updated_at DESC)`,
  ).run().catch(() => undefined);
}

let workflowSchemaPromise: Promise<void> | null = null;

export async function workflowDatabase(): Promise<D1Database> {
  const database = await getDatabase();
  if (!workflowSchemaPromise) {
    workflowSchemaPromise = database.batch(WORKFLOW_SCHEMA.map((sql) => database.prepare(sql)))
      .then(async () => {
        await upgradeProfileTable(database);
        await upgradeApplicationTable(database);
        await upgradeCompetitionTable(database);
        await addMissingColumns(database, "evaluation_results", EVALUATION_RESULT_COLUMNS);
        await addMissingColumns(database, "criteria", CRITERIA_COLUMNS);
        await addMissingColumns(database, "similarity_chunks", SIMILARITY_CHUNK_COLUMNS);
        await addMissingColumns(database, "similarity_results", SIMILARITY_RESULT_COLUMNS);
        await addMissingColumns(database, "submission_versions", SUBMISSION_VERSION_COLUMNS);
        /*
         * ÇİFT BAŞVURU KORUMASI (madde 9): aynı katılımcının aynı yarışmada
         * arşivlenmemiş tek aktif başvurusu olur. Dizin oluşturulamıyorsa
         * (eski kurulumda mükerrer satır varsa) sistem çalışmaya devam eder;
         * korumayı bu durumda `createApplication` içindeki kontrol sağlar.
         */
        await database.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_participant_competition
             ON competition_applications (participant_id, competition_key)
             WHERE deleted_at IS NULL`,
        ).run().catch((indexError) =>
          console.error("[workflow] çift başvuru dizini oluşturulamadı; mükerrer aktif başvuru olabilir", indexError));
      })
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

/**
 * Katılımcı PDF'ini R2'ye YAZAR VE YAZILDIĞINI DOĞRULAR.
 *
 * NEDEN: `file.stream()` ile yazıldığında R2 içerik uzunluğunu bilemiyor ve
 * yükleme sessizce düşerek boş/yarım bir nesne bırakabiliyordu; veri tabanı
 * ise sürümü "geçerli" olarak işaretliyordu. Sonuç: hakem PDF'i açamıyor,
 * analiz "PDF bulunamadı" veriyordu.
 *
 * Bu yüzden:
 *   1. Baytlar önce belleğe alınır (boyut sınırı zaten uçlarda uygulanır) ve
 *      `Blob` olarak yazılır — içerik uzunluğu bilinir.
 *   2. Yazımdan sonra nesnenin varlığı ve uzunluğu R2'den OKUNARAK doğrulanır.
 *   3. Doğrulama başarısızsa yarım nesne silinir ve hata fırlatılır; veri
 *      tabanı bu sürüme HİÇ geçmez.
 *
 * `pdfHash` çağırana döner: aynı baytlardan ölçülür, ikinci bir okuma yapılmaz.
 */
export async function storeReportPdf(input: {
  key: string;
  bytes: ArrayBuffer;
  customMetadata: Record<string, string>;
}): Promise<{ pdfHash: string; byteLength: number }> {
  const bucket = reportBucket();
  const byteLength = input.bytes.byteLength;
  if (byteLength <= 0) throw new ConflictError("Yüklenen PDF boş; saklama alanına yazılmadı.");
  await bucket.put(input.key, new Blob([input.bytes], { type: "application/pdf" }), {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: input.customMetadata,
  });
  const written = await bucket.head(input.key);
  if (!written || written.size !== byteLength) {
    await bucket.delete(input.key).catch(() => undefined);
    throw new ConflictError(
      `PDF saklama alanına eksiksiz yazılamadı (beklenen ${byteLength} bayt, yazılan ${written?.size ?? 0}). `
      + "Sürüm güncellenmedi; lütfen yeniden deneyin.",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", input.bytes);
  const pdfHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { pdfHash, byteLength };
}

export function reportBucket(): R2Bucket {
  if (!env.REPORTS) throw new ReportStorageUnavailableError();
  return env.REPORTS;
}

export function competitionKey(name: string, year = "", stage = ""): string {
  return [name, year, stage]
    .map((value) => fold(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean).join("--").slice(0, 220);
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
  assigned_judge_id: string | null;
  assigned_judge_name: string | null;
  current_version_id: string | null;
  current_version_number: number | null;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
  applicant_full_name: string | null;
  team_name: string | null;
  outcome: string | null;
  outcome_note: string | null;
  decided_at: string | null;
  competition_status: string | null;
  competition_is_active: number | null;
  evaluation_criteria_version: number | null;
  evaluation_criteria_hash: string | null;
  evaluation_pdf_hash: string | null;
  current_criteria_version: number | null;
  deleted_at: string | null;
  deleted_by_name: string | null;
  deleted_reason: string | null;
  similarity_is_stale: number | null;
  similarity_stale_reason: string | null;
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

type CompetitionRow = {
  id: string;
  competition_key: string;
  competition_name: string;
  status: string;
  current_profile_id: string | null;
  decisions_locked: number;
  results_published_at: string | null;
  is_priority: number | null;
  priority_note: string | null;
  priority_set_at: string | null;
  is_active: number | null;
  activation_note: string | null;
  activation_changed_at: string | null;
  activation_changed_by_name: string | null;
  deleted_at: string | null;
  deleted_by_name: string | null;
  deleted_reason: string | null;
  created_at: string;
  updated_at: string;
};

const COMPETITION_STATUSES: CompetitionStatus[] = [
  "draft_criteria", "criteria_processing", "criteria_review", "open",
  "applications_closed", "evaluating", "decisions_frozen", "results_published", "archived",
];

function toCompetition(row: CompetitionRow): CompetitionWorkflow {
  return {
    id: row.id,
    competitionKey: row.competition_key,
    competitionName: row.competition_name,
    status: COMPETITION_STATUSES.includes(row.status as CompetitionStatus) ? row.status as CompetitionStatus : "draft_criteria",
    currentProfileId: row.current_profile_id,
    decisionsLocked: row.decisions_locked === 1,
    resultsPublishedAt: row.results_published_at,
    // Eski satırlarda sütun bulunmayabilir; yokluk "öncelikli değil" demektir.
    isPriority: row.is_priority === 1,
    priorityNote: row.priority_note ?? "",
    prioritySetAt: row.priority_set_at ?? null,
    // Sütun eski satırlarda bulunmayabilir; yokluk AKTİF demektir (geriye uyum).
    isActive: row.is_active === null || row.is_active === undefined ? true : row.is_active === 1,
    activationNote: row.activation_note ?? "",
    activationChangedAt: row.activation_changed_at ?? null,
    activationChangedByName: row.activation_changed_by_name ?? null,
    archivedAt: row.deleted_at ?? null,
    archivedByName: row.deleted_by_name ?? null,
    archivedReason: row.deleted_reason ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

/**
 * Saklı profil JSON'unu okur ve eski (1.0, puanlı) kayıtları dört aşamalı 2.0
 * şekline yükseltir. Böylece GET /api/profiles her zaman güncel sözleşmeyi
 * döndürür; istemci deterministik kontrolleri doğru alanlarla çalıştırır.
 * Doğrulanamayan kayıt ham hâliyle döner (ekran açıkça bozuk kaydı gösterir).
 */
function upgradeStoredProfile(json: string, rowId: string): ProfileExport {
  const parsed = JSON.parse(json) as ProfileExport;
  const { profile } = validateProfileExport(parsed);
  return profile ? { ...profile, profileId: profile.profileId ?? rowId } : parsed;
}

/**
 * Kriter satırı kimliği profil VE sıra ile nitelenir.
 *
 * `criteria.id` genel bir birincil anahtardır; analiz çıktısı ise her belgede
 * aynı "criterion-1..N" kimliklerini üretir. Yalnızca profil ile nitelemek,
 * aynı profilde yanlışlıkla tekrarlanan bir kriter kimliği geldiğinde UNIQUE
 * ihlaline ve "İşlem tamamlanamadı" hatasına yol açıyordu. Kriterin kendi
 * kimliği `criterion_json` içinde olduğu gibi korunur; bulgu eşleştirmesi
 * orayı kullanır.
 */
function criterionRowId(profileId: string, position: number, criterionId: string): string {
  return `${profileId}:${position}:${criterionId || "kriter"}`;
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
    profile: upgradeStoredProfile(row.profile_json, row.id),
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
  /*
   * KARAR GÖRÜNÜRLÜĞÜ (madde 9)
   *
   * Eskiden ONAY sonucu yarışmacıya, yarışmanın sonuçları yayımlanana kadar
   * kapalıydı; RED ve REVİZYON ise anında görünüyordu. Sonuç: hakem onayladığı
   * hâlde yarışmacı panelinde hiçbir şey görünmüyor, sistem bozuk sanılıyordu.
   *
   * Artık ONAY, RED ve REVİZYON AYNI kaynaktan ve AYNI anda görünür: hakem
   * kararı kesinleştirdiği (`review.status === "completed"`) anda. Tamamlanmamış
   * hakem taslağı yarışmacıya hâlâ gösterilmez.
   */
  const storedReview = parseJson<JudgeReview>(row.review_json);
  const reviewCompleted = storedReview?.status === "completed";
  const participantResultHidden = view === "participant" && !reviewCompleted;
  /*
   * KATILIMCI GÖRÜNÜMÜ (madde 6): yarışmacıya yalnızca hakemin kesinleştirdiği
   * sonuç ve geri bildirim gider. AI'nin İLK sonucunu taşıyan kriter kararları
   * (aiVerdict), hakemin iç notu ve eski karar listesi katılımcıya AÇILMAZ.
   */
  const participantReview: JudgeReview | null = storedReview && !participantResultHidden
    ? { ...storedReview, decisions: [], criterionDecisions: [], overallNote: "" }
    : null;
  const storedEvaluation = parseJson<ReportEvaluation>(row.evaluation_json);
  // Eski (puanlı, 1.0) AI sonucu dört aşamalı ekranda incelenemez; başvuru
  // "analiz başarısız" gibi sunulur ki hakem yeniden analiz edebilsin veya
  // Değerlendirme Yöneticisi yeniden sıraya alabilsin.
  const legacyEvaluation = isLegacyEvaluation(storedEvaluation);
  const evaluation = legacyEvaluation ? null : storedEvaluation;
  const storedStatus: ApplicationStatus = (APPLICATION_STATUSES as string[]).includes(row.status)
    ? row.status as ApplicationStatus
    : "submitted";
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
    status: legacyEvaluation && ["awaiting_judge", "judge_in_review"].includes(storedStatus) ? "analysis_failed" : storedStatus,
    evaluation: view === "full" ? evaluation : operations ? redactEvaluation(evaluation) : null,
    review: operations || participantResultHidden
      ? null
      : view === "participant" ? participantReview : storedReview,
    judgeId: row.judge_id,
    judgeName: row.judge_name,
    assignedJudgeId: row.assigned_judge_id,
    assignedJudgeName: row.assigned_judge_name,
    currentVersionId: row.current_version_id,
    currentVersionNumber: Number(row.current_version_number) || 1,
    outcome: participantResultHidden ? "pending" : normalizeOutcome(row.outcome),
    // Sonuç açıklaması ret gerekçelerini ve katılımcı PDF'inden alıntıları
    // taşıyabilir; operasyon rolleri (01/04) rapor içeriği GÖRMEZ (madde 9.10).
    outcomeNote: participantResultHidden || operations ? "" : (row.outcome_note ?? ""),
    decidedAt: participantResultHidden ? null : row.decided_at,
    evaluationCriteriaVersion: row.evaluation_criteria_version ?? null,
    evaluationPdfHash: view === "full" ? (row.evaluation_pdf_hash ?? null) : null,
    currentCriteriaVersion: row.current_criteria_version ?? null,
    // Kriterler bu analizden SONRA yeniden yayımlandıysa sonuç eskimiştir.
    // Sürümü hiç kaydedilmemiş (eski) bir sonuç da güncel sayılmaz: hangi
    // kriter setiyle üretildiği kanıtlanamaz.
    criteriaOutdated: Boolean(evaluation) && Boolean(row.current_criteria_version)
      && (row.evaluation_criteria_version === null
        || row.evaluation_criteria_version === undefined
        || Number(row.evaluation_criteria_version) < Number(row.current_criteria_version)),
    archivedAt: row.deleted_at ?? null,
    archivedByName: operations || view === "full" ? (row.deleted_by_name ?? null) : null,
    archivedReason: operations || view === "full" ? (row.deleted_reason ?? "") : "",
    // "Güncel değil" işareti (madde 8): havuza yeni rapor geldiğinde ya da
    // resmî şablon değiştiğinde hakem kartında bant gösterilir. Yalnızca
    // hakem görünümüne taşınır; katılımcı benzerlik ayrıntısı görmez.
    similarityStale: view === "full" && Number(row.similarity_is_stale) === 1,
    similarityStaleReason: view === "full" && Number(row.similarity_is_stale) === 1
      ? (row.similarity_stale_reason ?? "") : "",
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
 * Yarışma yöneticisinin hazırladığı kriter profilini doğrudan yayımlar.
 * Hakem kriter oluşturma ya da profil onaylama akışına katılmaz; yayımlanmış
 * profil katılımcı raporunda kullanılabilecek tek kaynaktır.
 */
/**
 * Başka bir yöneticinin profilini güncelleme denemesi.
 * Uçlar bunu 403'e çevirir (bkz. app/api/profiles/route.ts).
 */
export class ProfileOwnershipError extends Error {
  constructor() {
    super("Bu kriter profilini yalnızca onu hazırlayan Yarışma Yöneticisi güncelleyebilir.");
    this.name = "ProfileOwnershipError";
  }
}

/* ------------------------------------------------------------------------- *
 * Değişmez kriter sürümleri (Problem 4 · madde 2 ve 12)
 *
 * Yarışma Yöneticisi kriterleri her yayımladığında `criteria_profile_versions`
 * tablosuna YENİ bir satır yazılır; var olan satır asla güncellenmez. Böylece:
 *
 *   - Hakem analizi her zaman EN SON yayımlanan sürümü kullanır.
 *   - Geçmiş değerlendirmeler kendi sürümüyle denetlenebilir kalır; yeni
 *     kriterlerle sessizce değişmez.
 *   - Kaynak sayfa ve kaynak alıntı İLK sürümde kilitlenir; sonraki
 *     yayımlarda istemci ne gönderirse göndersin sunucu ilk değeri geri koyar.
 * ------------------------------------------------------------------------- */

/** Kriter seti özeti saf modüle taşındı (birim testlenebilirlik); dışa aktarım korunur. */
export { criteriaHash } from "./criteria-hash";

type CriteriaVersionRow = {
  id: string;
  criteria_profile_id: string;
  competition_key: string;
  criteria_version: number;
  criteria_hash: string;
  criteria_count: number;
  published_at: string;
  published_by: string;
  published_by_name: string;
};

function toCriteriaVersion(row: CriteriaVersionRow): CriteriaVersion {
  return {
    id: row.id,
    criteriaProfileId: row.criteria_profile_id,
    competitionKey: row.competition_key,
    criteriaVersion: Number(row.criteria_version) || 1,
    criteriaHash: row.criteria_hash,
    criteriaCount: Number(row.criteria_count) || 0,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    publishedByName: row.published_by_name ?? "",
  };
}

/** Bir yarışmanın SON yayımlanan kriter sürümü (kriterler dahil). */
export async function findLatestCriteriaVersion(
  competitionKey: string,
): Promise<{ version: CriteriaVersion; criteria: Criterion[] } | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM criteria_profile_versions
     WHERE competition_key = ? ORDER BY criteria_version DESC LIMIT 1`,
  ).bind(competitionKey).first<CriteriaVersionRow & { criteria_json: string }>();
  if (!row) return null;
  const criteria = parseJson<Criterion[]>(row.criteria_json);
  if (!Array.isArray(criteria) || !criteria.length) return null;
  return { version: toCriteriaVersion(row), criteria };
}

/** Yalnızca sürüm numaraları; kriter gövdesi okunmadan tazelik karşılaştırması için. */
export async function latestCriteriaVersionNumbers(): Promise<Map<string, number>> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT competition_key, MAX(criteria_version) AS criteria_version
     FROM criteria_profile_versions GROUP BY competition_key`,
  ).all<{ competition_key: string; criteria_version: number }>();
  return new Map((result.results ?? []).map((row) => [row.competition_key, Number(row.criteria_version) || 0]));
}

/** Bu profilin bütün sürümleri, eskiden yeniye. Denetim ekranları kullanır. */
export async function listCriteriaVersions(profileId: string): Promise<CriteriaVersion[]> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT id, criteria_profile_id, competition_key, criteria_version, criteria_hash,
            criteria_count, published_at, published_by, published_by_name
     FROM criteria_profile_versions WHERE criteria_profile_id = ?
     ORDER BY criteria_version ASC`,
  ).bind(profileId).all<CriteriaVersionRow>();
  return (result.results ?? []).map(toCriteriaVersion);
}

/**
 * Kaynak sayfa / kaynak alıntı kilidi (madde 12).
 *
 * Bir kriterin kaynağı İLK yayımlandığı sürümde sabitlenir. Sonraki
 * yayımlarda istemci bu alanları değiştirse bile — arayüzde salt okunur
 * olmalarına rağmen isteği elle düzenleyerek — sunucu ilk değeri geri koyar.
 *
 * Eşleştirme kimlik şemasına BAĞIMLI DEĞİLDİR: kriter önce id, sonra
 * sourceId, en son alıntı anahtarıyla bulunur (bkz. app/lib/source-lock.ts).
 * Böylece kimlik biçimi değişse de (konumsal `criterion-N` → içerik türevi
 * kararlı kimlik) eski sürümlerin kilidi geçerli kalır. Kaynak yanlışsa çözüm
 * elle düzeltmek değil, "Yeniden analiz et" ya da kriteri silip yeni kriter
 * oluşturmaktır.
 */
async function sourceLockFor(profileId: string): Promise<SourceLockIndex> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT criteria_json FROM criteria_profile_versions
     WHERE criteria_profile_id = ? ORDER BY criteria_version ASC`,
  ).bind(profileId).all<{ criteria_json: string }>();
  const versions: Criterion[][] = [];
  for (const row of result.results ?? []) {
    const list = parseJson<Criterion[]>(row.criteria_json);
    if (Array.isArray(list)) versions.push(list);
  }
  return buildSourceLockIndex(versions);
}

/**
 * Kriter setini yeni bir sürüm olarak kaydeder.
 * İçerik değişmediyse (aynı özet) yeni sürüm AÇILMAZ; mevcut sürüm döner.
 */
async function publishCriteriaVersion(input: {
  profileId: string;
  competitionKey: string;
  criteria: Criterion[];
  actor: AdminAccount;
  timestamp: string;
}): Promise<{ version: CriteriaVersion; created: boolean }> {
  const database = await workflowDatabase();
  const hash = await criteriaHash(input.criteria);
  const latest = await database.prepare(
    `SELECT * FROM criteria_profile_versions
     WHERE competition_key = ? ORDER BY criteria_version DESC LIMIT 1`,
  ).bind(input.competitionKey).first<CriteriaVersionRow & { criteria_json: string }>();
  if (latest && latest.criteria_profile_id === input.profileId) {
    if (latest.criteria_hash === hash) return { version: toCriteriaVersion(latest), created: false };
    /*
     * GERİYE UYUMLULUK — içerik kimliği KANONİK özetle karşılaştırılır:
     *   - eead40e öncesi satırlar ESKİ formülle (violationOutcome'lu) yazıldı;
     *   - daha eski satırlar controlType alanı olmadan saklandı ve profil
     *     yükleyicisi artık her kriterde aşama varsayılanını dolduruyor;
     * bu yüzden ham özetler değişmemiş içerikte bile eşleşmeyebilir. İki taraf
     * da `criteriaContentHash` ile (yok olan controlType == aşama varsayılanı)
     * özetlenir; eşitse içerik değişmemiştir ve yeni sürüm AÇILMAZ — sahte
     * sürüm, bağlı değerlendirmeleri 409'a düşürürdü. Yeni satır her zaman
     * ham YENİ formül özetiyle (hash) yazılır.
     */
    const stored = parseJson<Criterion[]>(latest.criteria_json);
    if (Array.isArray(stored) && stored.length
      && (await criteriaContentHash(stored)) === (await criteriaContentHash(input.criteria))) {
      return { version: toCriteriaVersion(latest), created: false };
    }
  }
  const nextNumber = (Number(latest?.criteria_version) || 0) + 1;
  const id = crypto.randomUUID();
  await database.prepare(
    `INSERT INTO criteria_profile_versions
      (id, criteria_profile_id, competition_key, criteria_version, criteria_hash,
       criteria_json, criteria_count, published_at, published_by, published_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.profileId, input.competitionKey, nextNumber, hash,
    JSON.stringify(input.criteria), input.criteria.length,
    input.timestamp, input.actor.id, input.actor.fullName,
  ).run();
  const row = await database.prepare(`SELECT * FROM criteria_profile_versions WHERE id = ?`)
    .bind(id).first<CriteriaVersionRow>();
  if (!row) throw new Error("Kriter sürümü kaydedildi ancak geri okunamadı.");
  return { version: toCriteriaVersion(row), created: true };
}

export type PublishedProfileResult = {
  profile: CompetitionProfile;
  /** Bu yayımda oluşan (veya değişmediği için korunan) kriter sürümü. */
  criteriaVersion: CriteriaVersion;
  /** Yeni bir sürüm mü açıldı, yoksa içerik aynı olduğu için mevcut sürüm mü korundu? */
  versionCreated: boolean;
  /**
   * Kaynak sayfa/alıntısı değiştirilmeye çalışılıp sunucu tarafından geri
   * alınan kriterlerin adları (madde 12). Boş değilse arayüz uyarı gösterir.
   */
  sourceLockReverted: string[];
  /**
   * Önceki sürümlerde kaynak kilidi altındayken bu yayımda hiçbir gelen
   * kriterle eşleşmeyen belge kaynaklı kriterlerin adları. Kriter silinmiş ya
   * da kaynağı tanınmayacak kadar değiştirilmiş olabilir; sessizce düşmez,
   * denetim izine olay yazılır.
   */
  sourceLockOrphaned: string[];
};

export async function submitProfileForReview(profile: ProfileExport, actor: AdminAccount): Promise<PublishedProfileResult> {
  const database = await workflowDatabase();
  const id = profile.profileId ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();
  // SAHİPLİK: `profileId` istemciden gelir ve aşağıdaki INSERT ... ON CONFLICT(id)
  // varolan satırı günceller. Kontrol olmadan bir yönetici, başka bir yöneticinin
  // profil kimliğini gövdeye yazarak onun yayımlanmış kriter setini değiştirebilirdi.
  // Yeni kayıt (satır yok) serbesttir; varolan kaydı yalnızca sahibi güncelleyebilir.
  const existing = await database.prepare(
    `SELECT created_by FROM competition_profiles WHERE id = ?`,
  ).bind(id).first<{ created_by: string | null }>();
  if (!canUpdateProfile(actor.id, existing?.created_by)) throw new ProfileOwnershipError();
  // KAYNAK KİLİDİ (madde 12): kaynak sayfa ve alıntı ilk yayımda sabitlenir.
  // İstemci isteği elle değiştirse bile sunucu ilk değeri geri koyar.
  const lock = await sourceLockFor(id);
  const locked = applySourceLock(profile.criteria, lock);
  const criteria = locked.criteria;
  profile = { ...profile, profileId: id, criteria };
  // Aynı yarışmanın farklı yıl ve aşamalarındaki raporlar birbirine karışmaz.
  const key = competitionKey(profile.setup.competition, profile.setup.year, profile.setup.stage);
  await database.prepare(
    `INSERT INTO competition_profiles
      (id, competition_key, competition_name, category, stage, report_type, source_document_name,
       profile_json, status, created_by, created_by_name, review_note, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, '', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       competition_key = excluded.competition_key,
       competition_name = excluded.competition_name,
       category = excluded.category,
       stage = excluded.stage,
       report_type = excluded.report_type,
       source_document_name = excluded.source_document_name,
       profile_json = excluded.profile_json,
       status = 'approved',
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
    `INSERT INTO competitions
      (id, competition_key, competition_name, status, current_profile_id, decisions_locked,
       results_published_at, created_at, updated_at)
     VALUES (?, ?, ?, 'open', ?, 0, NULL, ?, ?)
     ON CONFLICT(competition_key) DO UPDATE SET
       competition_name = excluded.competition_name,
       status = CASE
         WHEN competitions.status IN ('draft_criteria', 'criteria_processing', 'criteria_review') THEN 'open'
         ELSE competitions.status
       END,
       current_profile_id = excluded.current_profile_id,
       updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), key, profile.setup.competition, id, timestamp, timestamp).run();
  await database.prepare(`DELETE FROM criteria WHERE profile_id = ?`).bind(id).run();
  if (criteria.length) {
    await database.batch(criteria.map((criterion, position) => database.prepare(
      `INSERT INTO criteria
        (id, profile_id, position, name, applicability, effect, max_score, active,
         source_page, source_text, verifiability, criterion_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      criterionRowId(id, position, criterion.id),
      id,
      position,
      criterion.name,
      // Dört aşamalı modelde kapsam her zaman PDF (rapor) aşamasıdır; aşama kimliği
      // applicability sütununda, zorunluluk effect sütununda tutulur. Puan yoktur.
      criterion.stage,
      criterion.required ? "required" : "other",
      null,
      criterion.active ? 1 : 0,
      criterion.sourcePage,
      criterion.sourceText,
      criterion.verifiability,
      JSON.stringify(criterion),
      timestamp,
    )));
  }
  // Değişmez sürüm: eski satır güncellenmez, yeni satır açılır (madde 2).
  const published = await publishCriteriaVersion({
    profileId: id, competitionKey: key, criteria, actor, timestamp,
  });
  await database.prepare(
    `UPDATE criteria_extraction_runs
     SET profile_id = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM criteria_extraction_runs
       WHERE created_by = ? AND source_document_name = ?
       ORDER BY analyzed_at DESC LIMIT 1
     )`,
  ).bind(id, timestamp, actor.id, profile.sourceDocument.name).run();
  await database.prepare(
    `UPDATE criteria_extraction_runs SET status = 'approved', updated_at = ? WHERE profile_id = ?`,
  ).bind(timestamp, id).run();
  const saved = await findProfile(id);
  if (!saved) throw new Error("Profil kaydedildi ancak geri okunamadı.");
  await recordWorkflowEvent({
    subjectType: "profile",
    subjectId: id,
    event: "profile_approved",
    actor,
    detail: `${saved.competitionName} · ${criteria.length} kriter · sürüm v${published.version.criteriaVersion}`
      + ` · özet ${published.version.criteriaHash.slice(0, 12)} · kaynak: ${profile.sourceDocument.name}`,
  });
  if (locked.reverted.length) {
    await recordWorkflowEvent({
      subjectType: "profile",
      subjectId: id,
      event: "criteria_source_locked",
      actor,
      detail: `${locked.reverted.length} kriterin kaynak sayfası/alıntısı değiştirilmek istendi ve ilk yayımdaki `
        + `değere geri alındı: ${locked.reverted.slice(0, 5).join(", ")}`,
    }).catch((eventError) => console.error("[workflow] kaynak kilidi olayı kaydedilemedi", eventError));
  }
  if (locked.orphaned.length) {
    // Yansız ifade: silme meşru olabilir (yeniden analiz farklı alıntı seçmiş
    // olabilir); olay kurcalama suçlaması değil, izlenebilirlik sinyalidir.
    await recordWorkflowEvent({
      subjectType: "profile",
      subjectId: id,
      event: "criteria_source_lock_unmatched",
      actor,
      detail: `${locked.orphaned.length} kriter önceki sürümlerde kaynak kilidi altındayken bu yayımda hiçbir `
        + `kriterle eşleşmedi (kriter silinmiş ya da kaynağı tanınmayacak kadar değiştirilmiş olabilir): `
        + `${locked.orphaned.slice(0, 5).join(", ")}`
        + `${locked.orphaned.length > 5 ? ` ve ${locked.orphaned.length - 5} kriter daha` : ""}`,
    }).catch((eventError) => console.error("[workflow] kaynak kilidi yetim olayı kaydedilemedi", eventError));
  }
  return {
    profile: saved,
    criteriaVersion: published.version,
    versionCreated: published.created,
    sourceLockReverted: locked.reverted,
    sourceLockOrphaned: locked.orphaned,
  };
}

/**
 * Eski kayıtlarla geriye uyumluluk için bırakılan profil inceleme yordamı.
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

/** Herhangi bir durumdaki profili okur. */
export async function findProfile(id: string): Promise<CompetitionProfile | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competition_profiles WHERE id = ?`,
  ).bind(id).first<ProfileRow>();
  return row ? toProfile(row) : null;
}

/** Yalnızca Yarışma Yöneticisi tarafından yayımlanmış profil. */
export async function findApprovedProfile(id: string): Promise<CompetitionProfile | null> {
  const profile = await findProfile(id);
  return profile?.status === "approved" ? profile : null;
}

export async function findLatestProfileForCompetition(name: string): Promise<CompetitionProfile | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competition_profiles
     WHERE competition_name = ? AND status = 'approved'
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind(name).first<ProfileRow>();
  return row ? toProfile(row) : null;
}

/**
 * Yarışma ANAHTARINA göre en güncel onaylı profil.
 *
 * Ada göre arama aynı adlı iki yarışmayı karıştırabilir; elde kesin bir
 * `competition_key` varsa (ör. başvuru satırının kendi anahtarı) bu kullanılır.
 */
export async function findLatestProfileForCompetitionKey(key: string): Promise<CompetitionProfile | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competition_profiles
     WHERE competition_key = ? AND status = 'approved'
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind(key).first<ProfileRow>();
  return row ? toProfile(row) : null;
}

/**
 * Ada göre yarışma kaydı.
 *
 * DİKKAT — neden basit bir "en son güncellenen" sorgusu DEĞİL:
 * Aynı şartname iki kez analiz edildiğinde, modelin çıkardığı yıl/aşama biraz
 * farklı olursa `competitionKey` de farklı olur ve AYNI ADLA ikinci bir satır
 * açılır (bkz. saveCriteriaExtractionRun). Bu satırın profili yoktur ve
 * `criteria_review` durumundadır. Yalnızca `updated_at` ile sıralayan eski
 * sorgu bu boş satırı seçiyor, yayımlanmış ve başvuruya AÇIK olan satırı
 * gölgeliyordu: yarışmacı yarışmayı listede görüyor ama başvurusu
 * "yayımlanmış kriter profili yok" diye reddediliyordu.
 *
 * Sıralama bu yüzden KULLANILABİLİRLİĞE göredir: önce yayımlanmış profili
 * olanlar, sonra başvuruya açık olanlar, en son güncellik.
 */
export async function findCompetitionWorkflow(name: string): Promise<CompetitionWorkflow | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competitions
     WHERE competition_name = ?
     ORDER BY (deleted_at IS NULL) DESC,
              (current_profile_id IS NOT NULL) DESC,
              (status = 'open' AND is_active = 1) DESC,
              updated_at DESC
     LIMIT 1`,
  ).bind(name).first<CompetitionRow>();
  return row ? toCompetition(row) : null;
}

/**
 * Kararlı kimlikle TEK yarışma satırı.
 *
 * Aynı adla birden çok satır bulunabildiği için başvuru akışı ada değil bu
 * kimliğe bağlanır; kabul kararı ve kriter profili aynı satırdan çözülür.
 */
export async function findCompetitionWorkflowById(id: string): Promise<CompetitionWorkflow | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM competitions WHERE id = ?`,
  ).bind(id).first<CompetitionRow>();
  return row ? toCompetition(row) : null;
}

export async function listCompetitionWorkflows(): Promise<CompetitionWorkflow[]> {
  const database = await workflowDatabase();
  // Öncelikli yarışmalar başta: hakem listesi de bu sırayı kullanır.
  const result = await database.prepare(
    `SELECT * FROM competitions ORDER BY is_priority DESC, updated_at DESC`,
  ).all<CompetitionRow>();
  return (result.results ?? []).map(toCompetition);
}

/**
 * Role göre yarışma listesi.
 *   01 yalnızca KENDİ profilini yayımladığı yarışmaları görür ve yönetir.
 *   02 ve 04 yayımlanmış profili olan yarışmaları görür (02 öncelik rozeti için).
 *   Diğer roller boş liste alır.
 */
export async function listCompetitionsFor(account: AdminAccount): Promise<CompetitionWorkflow[]> {
  const database = await workflowDatabase();
  if (account.roleCode === "01") {
    const result = await database.prepare(
      `SELECT * FROM competitions
       WHERE competition_key IN (SELECT competition_key FROM competition_profiles WHERE created_by = ?)
       ORDER BY is_priority DESC, updated_at DESC`,
    ).bind(account.id).all<CompetitionRow>();
    return (result.results ?? []).map(toCompetition);
  }
  // Hakem arşivlenmiş yarışmayı aktif listesinde görmez; Değerlendirme
  // Yöneticisi denetim için hepsini görür (bkz. madde 11).
  if (account.roleCode === "02") {
    const result = await database.prepare(
      `SELECT * FROM competitions WHERE deleted_at IS NULL ORDER BY is_priority DESC, updated_at DESC`,
    ).all<CompetitionRow>();
    return (result.results ?? []).map(toCompetition);
  }
  if (account.roleCode === "04") return listCompetitionWorkflows();
  return [];
}

/* ------------------------------------------------------------------------- *
 * Yarışmayı aktif / pasif yapma (madde 6)
 *
 * Aktif/pasif, süreç aşamasından (status) BAĞIMSIZ bir anahtardır:
 *   Aktif   yarışmacıya görünür, yeni başvuru kabul eder, akış normal işler.
 *   Pasif   yarışmacının listesinde görünmez, yeni başvuru kabul etmez ve yeni
 *           değerlendirme kuyruğu üretmez. Hakem GEÇMİŞ başvuruları görmeye ve
 *           izin verilen karar düzeltmelerini yapmaya devam eder.
 *
 * Pasifleştirme hiçbir kaydı silmez ve aşamayı geri almaz; yeniden
 * aktifleştirildiğinde yarışma bıraktığı yerden devam eder.
 * ------------------------------------------------------------------------- */
export async function setCompetitionActive(
  competitionId: string,
  active: boolean,
  note: string,
  actor: AdminAccount,
): Promise<CompetitionWorkflow | "not_found" | "archived"> {
  const database = await workflowDatabase();
  const current = await database.prepare(`SELECT * FROM competitions WHERE id = ?`)
    .bind(competitionId).first<CompetitionRow>();
  if (!current) return "not_found";
  if (current.deleted_at) return "archived";
  const timestamp = new Date().toISOString();
  const trimmed = note.trim().slice(0, 300);
  await database.prepare(
    `UPDATE competitions
     SET is_active = ?, activation_note = ?, activation_changed_at = ?,
         activation_changed_by = ?, activation_changed_by_name = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(active ? 1 : 0, trimmed, timestamp, actor.id, actor.fullName, timestamp, competitionId).run();
  const row = await database.prepare(`SELECT * FROM competitions WHERE id = ?`)
    .bind(competitionId).first<CompetitionRow>();
  if (!row) return "not_found";
  const saved = toCompetition(row);
  await recordWorkflowEvent({
    subjectType: "competition",
    subjectId: competitionId,
    event: active ? "competition_activated" : "competition_deactivated",
    actor,
    detail: `${saved.competitionName}${trimmed ? ` · ${trimmed}` : ""}`,
  }).catch((eventError) => console.error("[workflow] aktiflik olayı kaydedilemedi", eventError));
  return saved;
}

/**
 * Yarışmayı arşivler (soft delete). Satır SİLİNMEZ: kim, ne zaman, hangi
 * gerekçeyle arşivlediği kayıtta kalır ve Değerlendirme Yöneticisi görür.
 */
export async function archiveCompetition(
  competitionId: string,
  archived: boolean,
  reason: string,
  actor: AdminAccount,
): Promise<CompetitionWorkflow | "not_found"> {
  const database = await workflowDatabase();
  const timestamp = new Date().toISOString();
  const trimmed = reason.trim().slice(0, 400);
  const result = await database.prepare(
    `UPDATE competitions
     SET deleted_at = ?, deleted_by = ?, deleted_by_name = ?, deleted_reason = ?,
         is_active = CASE WHEN ? = 1 THEN 0 ELSE is_active END,
         updated_at = ?
     WHERE id = ?`,
  ).bind(
    archived ? timestamp : null, archived ? actor.id : null,
    archived ? actor.fullName : null, archived ? trimmed : null,
    archived ? 1 : 0, timestamp, competitionId,
  ).run();
  if (!result.meta.changes) return "not_found";
  const row = await database.prepare(`SELECT * FROM competitions WHERE id = ?`)
    .bind(competitionId).first<CompetitionRow>();
  if (!row) return "not_found";
  const saved = toCompetition(row);
  await recordWorkflowEvent({
    subjectType: "competition",
    subjectId: competitionId,
    event: archived ? "competition_archived" : "competition_activated",
    actor,
    detail: `${saved.competitionName}${trimmed ? ` · gerekçe: ${trimmed}` : ""}`,
  }).catch((eventError) => console.error("[workflow] arşivleme olayı kaydedilemedi", eventError));
  return saved;
}

/**
 * Başvuruyu hakemin aktif iş listesinden kaldırır (soft delete / arşivleme).
 *
 * FİZİKSEL SİLME YOKTUR: kayıt, PDF ve bütün değerlendirme geçmişi yerinde
 * kalır. Yalnızca `deleted_at`, `deleted_by` ve gerekçe işaretlenir; işlem
 * denetim izine ve süreç zaman çizelgesine yazılır (madde 11).
 */
export type ArchiveApplicationResult = "archived" | CompetitionApplication | "not_found" | "forbidden";

export async function archiveApplication(
  applicationId: string,
  archived: boolean,
  reason: string,
  actor: AdminAccount,
): Promise<ArchiveApplicationResult> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT assigned_judge_id, deleted_at FROM competition_applications WHERE id = ?`,
  ).bind(applicationId).first<{ assigned_judge_id: string | null; deleted_at: string | null }>();
  if (!current) return "not_found";
  // Hakem yalnızca KENDİSİNE atanmış dosyayı kaldırabilir.
  if (actor.roleCode === "02" && current.assigned_judge_id !== actor.id) return "forbidden";
  const timestamp = new Date().toISOString();
  const trimmed = reason.trim().slice(0, 400);
  await database.prepare(
    `UPDATE competition_applications
     SET deleted_at = ?, deleted_by = ?, deleted_by_name = ?, deleted_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    archived ? timestamp : null, archived ? actor.id : null,
    archived ? actor.fullName : null, archived ? trimmed : null,
    timestamp, applicationId,
  ).run();
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: applicationId,
    event: archived ? "application_archived" : "application_restored",
    actor,
    detail: trimmed || (archived ? "Gerekçe girilmedi" : "Aktif listeye geri alındı"),
  }).catch((eventError) => console.error("[workflow] arşivleme olayı kaydedilemedi", eventError));
  // Arşivlenen satır hakemin görünürlük filtresinden çıkar; geri okumaya
  // çalışmak "bulunamadı" üretirdi. Kaldırma işlemi başarılıdır.
  if (archived) return "archived";
  return await findApplication(applicationId, actor) ?? "not_found";
}

/** Bu yarışmanın kriter profilini yayımlayan yönetici mi? */
export async function ownsCompetition(competitionId: string, account: AdminAccount): Promise<boolean> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT 1 AS ok FROM competitions c
     WHERE c.id = ?
       AND EXISTS (SELECT 1 FROM competition_profiles p
                   WHERE p.competition_key = c.competition_key AND p.created_by = ?)`,
  ).bind(competitionId, account.id).first<{ ok: number }>();
  return Boolean(row);
}

/**
 * Yarışmaya ÖNCELİKLİ işareti koyar veya kaldırır (Rol 04).
 *
 * Yalnızca sıralama/görünürlük işaretidir: yarışmanın süreç durumunu, kriter
 * setini veya hiçbir kararı değiştirmez. Hakem panelinde 🔥 rozeti olarak
 * görünür ve liste başında sıralanır.
 */
export async function setCompetitionPriority(
  competitionId: string,
  priority: boolean,
  note: string,
  actor: AdminAccount,
): Promise<CompetitionWorkflow | "not_found"> {
  const database = await workflowDatabase();
  const timestamp = new Date().toISOString();
  const trimmed = note.trim().slice(0, 300);
  const result = await database.prepare(
    `UPDATE competitions
     SET is_priority = ?, priority_note = ?, priority_set_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(priority ? 1 : 0, priority ? trimmed : "", priority ? timestamp : null, timestamp, competitionId).run();
  if (!result.meta.changes) return "not_found";
  const row = await database.prepare(`SELECT * FROM competitions WHERE id = ?`).bind(competitionId).first<CompetitionRow>();
  if (!row) return "not_found";
  const saved = toCompetition(row);
  await recordWorkflowEvent({
    subjectType: "competition",
    subjectId: competitionId,
    event: "competition_stage_changed",
    actor,
    detail: priority
      ? `${saved.competitionName} · ÖNCELİKLİ işaretlendi${trimmed ? ` · ${trimmed}` : ""}`
      : `${saved.competitionName} · öncelik kaldırıldı`,
  }).catch((eventError) => console.error("[workflow] öncelik olayı kaydedilemedi", eventError));
  return saved;
}

/**
 * Bu adla başvuru alınabilir mi?
 *
 * Aynı adla birden çok satır olabildiği için (yukarıdaki nota bakın) tek bir
 * satıra değil, "bu adla başvuruya AÇIK ve profili olan bir satır var mı"
 * sorusuna bakılır. Seçim listesini üreten `listOpenCompetitions` ile aynı
 * ölçüt; ikisi ayrışırsa yarışmacı listede görüp başvuramaz.
 *
 * NOT: Başvuru POST'u artık bu fonksiyonu KULLANMAZ; kabul kararını ve profili
 * kararlı yarışma kimliğiyle TEK satırdan çözer (aynı adlı yarışmalar
 * karışmasın diye). Fonksiyon diğer/eski çağıranlar için yerinde durur.
 */
export async function competitionAcceptsApplications(name: string): Promise<boolean> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT 1 AS ok FROM competitions
     WHERE competition_name = ? AND status = 'open' AND current_profile_id IS NOT NULL
       AND is_active = 1 AND deleted_at IS NULL
     LIMIT 1`,
  ).bind(name).first<{ ok: number }>();
  return Boolean(row);
}

/**
 * Şu anda başvuruya açık yarışmalar.
 *
 * Yayımlanmış profilin yarışma adı ŞARTNAMEDEN çıkarılır ve kodda sabit duran
 * `COMPETITIONS` havuzunda bulunmayabilir (ör. "TEKNOFEST Havacılık, Uzay ve
 * Teknoloji Festivali"). Yarışmacının seçim listesi bu yüzden sabit havuzdan
 * değil yayımlanmış profillerden beslenir — aksi hâlde yönetici "yayımlandı"
 * bildirimi alırken yarışmacı aynı yarışmayı listede hiç göremiyordu.
 *
 * `field` yalnızca gösterim etiketidir: profilin kategorisi, yoksa aşama,
 * o da yoksa kayıtlı havuzdaki alan adı.
 */
export async function listOpenCompetitions(): Promise<CompetitionEntry[]> {
  const database = await workflowDatabase();
  // İkincil sıralama (updated_at DESC) belirlenimcidir: aynı adla birden çok
  // açık satır varsa ad başına HER ZAMAN aynı (en güncel) satırın kimliği döner.
  const result = await database.prepare(
    `SELECT c.id, c.competition_name, p.category, p.stage
     FROM competitions c
     LEFT JOIN competition_profiles p ON p.id = c.current_profile_id
     WHERE c.status = 'open' AND c.current_profile_id IS NOT NULL
       AND c.is_active = 1 AND c.deleted_at IS NULL
     ORDER BY c.competition_name, c.updated_at DESC`,
  ).all<{ id: string; competition_name: string; category: string | null; stage: string | null }>();
  const seen = new Set<string>();
  const entries: CompetitionEntry[] = [];
  for (const row of result.results ?? []) {
    if (seen.has(row.competition_name)) continue;
    seen.add(row.competition_name);
    const registered = COMPETITIONS.find((item) => item.name === row.competition_name);
    entries.push({
      // Kararlı yarışma kimliği: başvuru bu kimlikle gönderilir ki aynı adlı
      // iki yarışmada başvuru yanlış/pasif kayda düşmesin.
      id: row.id,
      name: row.competition_name,
      field: (row.category ?? "").trim() || (row.stage ?? "").trim() || registered?.field || "Başvuruya açık",
    });
  }
  return entries;
}

export type CompetitionStageResult = CompetitionWorkflow | "not_found" | "invalid_transition" | "unresolved";

const COMPETITION_TRANSITIONS: Record<CompetitionStatus, CompetitionStatus[]> = {
  draft_criteria: ["criteria_processing"],
  criteria_processing: ["criteria_review"],
  criteria_review: ["open"],
  open: ["applications_closed"],
  // Yarışma Yöneticisi yanlışlıkla kapattığı başvuruyu yeniden açabilmeli;
  // değerlendirme başlamadan önce bu geri dönüş kayıpsızdır.
  applications_closed: ["evaluating", "open"],
  evaluating: ["decisions_frozen"],
  decisions_frozen: ["results_published", "evaluating"],
  results_published: ["archived"],
  archived: [],
};

export async function changeCompetitionStage(
  competitionId: string,
  nextStatus: CompetitionStatus,
  actor: AdminAccount,
  reason: string,
  force = false,
): Promise<CompetitionStageResult> {
  const database = await workflowDatabase();
  const row = await database.prepare(`SELECT * FROM competitions WHERE id = ?`).bind(competitionId).first<CompetitionRow>();
  if (!row) return "not_found";
  const current = toCompetition(row);
  // `force` istemciden gelen bir bayraktır ve yalnızca Admin (00) için yetkiye
  // dönüşürdü. Admin artık yarışma aşaması ucuna erişmediği için bugün hiçbir
  // rol barajı atlayamaz; bayrak, ileride açık bir "acil durum" yetkisi
  // tanımlanırsa yetki matrisine bağlanmak üzere korunur.
  const adminForce = force && actor.roleCode === "00";
  if (!COMPETITION_TRANSITIONS[current.status].includes(nextStatus) && !adminForce) return "invalid_transition";
  if (nextStatus === "decisions_frozen" && !adminForce) {
    const unresolved = await database.prepare(
      `SELECT COUNT(*) AS total FROM competition_applications
       WHERE competition_key = ? AND status <> 'completed'`,
    ).bind(current.competitionKey).first<{ total: number }>();
    if ((unresolved?.total ?? 0) > 0) return "unresolved";
  }
  const timestamp = new Date().toISOString();
  await database.prepare(
    `UPDATE competitions SET status = ?, decisions_locked = ?, results_published_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    nextStatus,
    nextStatus === "decisions_frozen" || nextStatus === "results_published" || nextStatus === "archived" ? 1 : 0,
    nextStatus === "results_published" ? timestamp : current.resultsPublishedAt,
    timestamp,
    competitionId,
  ).run();
  await recordWorkflowEvent({
    subjectType: "competition", subjectId: competitionId, event: "competition_stage_changed", actor,
    detail: `${current.status} → ${nextStatus}${reason.trim() ? ` · ${reason.trim().slice(0, 400)}` : ""}`,
  });
  const saved = await database.prepare(`SELECT * FROM competitions WHERE id = ?`).bind(competitionId).first<CompetitionRow>();
  return saved ? toCompetition(saved) : "not_found";
}

/**
 * Rol bazlı profil listesi.
 *   01 yalnızca kendi hazırladığı profilleri görür (kendi yarışması).
 *   02 yayımlanmış profilleri değerlendirme amacıyla görür.
 *   04 yürürlükteki profilleri operasyon amacıyla salt okunur görür.
 *   00 tümünü görür.
 */
export async function listProfiles(account?: AdminAccount): Promise<CompetitionProfile[]> {
  const database = await workflowDatabase();
  const predicates: string[] = [];
  const binds: unknown[] = [];
  if (account?.roleCode === "01") { predicates.push("created_by = ?"); binds.push(account.id); }
  if (account?.roleCode === "04" || account?.roleCode === "02") predicates.push("status = 'approved'");
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

/**
 * Yeni başvuruya sistem tarafından hakem atar (ilk atama).
 *
 * NEDEN: hakem yalnızca kendisine ATANMIŞ dosyaları görür ve dosyayı kendi
 * üzerine alamaz. Atama yapılmadığı sürece yarışmacının raporu hiçbir hakem
 * panelinde görünmüyor, süreç sessizce duruyordu. Atamayı SİSTEM yapar:
 *
 *   - Hakem hâlâ kendi dosyasını seçemez (güvenlik kuralı korunur).
 *   - Değerlendirme Yöneticisi (04) gerektiğinde başka hakeme aktarabilir.
 *   - Aktif hakem yoksa başvuru atanmamış kalır; 04 panosu bunu sayar ve
 *     kırmızı "Hakem atanmadı" etiketiyle gösterir.
 *
 * Dağıtım en az yüklü hakeme yapılır: tamamlanmamış dosya sayısı en düşük olan,
 * eşitlikte en eski hesap. Eşitlik bozucu kimlik sırasıdır; böylece eşzamanlı
 * iki başvuru aynı hakeme yığılmaz.
 *
 * Hata durumunda BAŞVURU DÜŞMEZ: atama yapılamazsa başvuru "submitted" kalır.
 */
async function autoAssignJudge(
  applicationId: string,
  competitionKey: string,
  timestamp: string,
): Promise<{ id: string; name: string; openFiles: number; scoped: boolean } | null> {
  const database = await workflowDatabase();
  /*
   * Seçim ölçütü, sırayla:
   *   1. AÇIK dosya sayısı EN AZ olan aktif hakem (tamamlanmamış ve
   *      arşivlenmemiş). Bu, birincil ölçüttür: aynı yarışmanın ardışık
   *      başvuruları tek hakeme YIĞILMAZ, en müsait hakeme dağıtılır.
   *   2. Eşit yükte, bu yarışmada daha önce dosya almış hakem tercih edilir
   *      (kriterlere hâkim hakem işi daha hızlı bitirir) — yalnızca EŞİTLİK
   *      BOZUCUDUR, yük sırasının önüne geçemez.
   *   3. Kalan eşitlikte en eski hesap, sonra kimlik sırası — deterministik ve
   *      adil: aynı yük altında sıra her zaman aynı hakeme gider, kura atılmaz.
   */
  const candidate = await database.prepare(
    `SELECT j.id, j.full_name,
            (SELECT COUNT(*) FROM competition_applications a
              WHERE a.assigned_judge_id = j.id AND a.status <> 'completed' AND a.deleted_at IS NULL) AS open_files,
            (SELECT COUNT(*) FROM competition_applications a
              WHERE a.assigned_judge_id = j.id AND a.competition_key = ?) AS competition_files
     FROM admin_accounts j
     WHERE j.role_code = '02' AND j.status = 'active'
     ORDER BY open_files ASC, (competition_files > 0) DESC, j.created_at ASC, j.id ASC
     LIMIT 1`,
  ).bind(competitionKey).first<{ id: string; full_name: string; open_files: number; competition_files: number }>();
  if (!candidate) return null;
  const row = candidate;

  // Koşul WHERE'de tutulur: başka bir işlem bu arada atama yaptıysa üzerine
  // yazılmaz. Yeniden gönderilmiş ama hâlâ hakemsiz kalmış başvurular da
  // otomatik dağıtım kapsamındadır; arşivlenmiş başvuru atanmaz.
  const updated = await database.prepare(
    `UPDATE competition_applications
     SET assigned_judge_id = ?, assigned_judge_name = ?, status = 'assigned', updated_at = ?
     WHERE id = ? AND assigned_judge_id IS NULL AND status IN ('submitted', 'resubmitted')
       AND deleted_at IS NULL`,
  ).bind(row.id, row.full_name, timestamp, applicationId).run();
  if (!updated.meta.changes) return null;

  // Atama satırı ve önceki atamanın kapatılması tek turda yazılır: aynı
  // başvuru iki hakeme birden "aktif" görünemez.
  await database.batch([
    database.prepare(`UPDATE application_assignments SET active = 0 WHERE application_id = ? AND active = 1`).bind(applicationId),
    database.prepare(
      `INSERT INTO application_assignments
        (id, application_id, judge_id, judge_name, assigned_by, assigned_by_name, reason, active, assigned_at)
       VALUES (?, ?, ?, ?, 'system', ?, ?, 1, ?)`,
    ).bind(
      crypto.randomUUID(), applicationId, row.id, row.full_name, "sistem",
      candidate.competition_files > 0
        ? `Bu yarışmada görevli, en az yüklü hakeme otomatik atandı (açık dosya: ${row.open_files}).`
        : `En az açık dosyası bulunan hakeme otomatik atandı (açık dosya: ${row.open_files}).`,
      timestamp,
    ),
  ]);
  return {
    id: row.id,
    name: row.full_name,
    openFiles: Number(row.open_files) || 0,
    scoped: Number(candidate.competition_files) > 0,
  };
}

/**
 * Bekleyen (hakemsiz) başvuruları otomatik dağıtır (madde: otomatik yeniden deneme).
 *
 * Aktif hakem bulunmadığında başvuru atanmamış kalır ve Değerlendirme
 * Yöneticisi panosunda görünür; elle hakem SEÇİLEMEZ. Yeni bir aktif Hakem
 * hesabı açıldığında veya sistem yeniden denediğinde (operasyon panosu her
 * yüklendiğinde) bu işlev bekleyenleri en az yüklü hakemlere dağıtır.
 * Kullanıcıdan hakem seçmesi İSTENMEZ; işlem tamamen sistem içindedir.
 */
export async function assignPendingApplications(): Promise<number> {
  const database = await workflowDatabase();
  // Pasif veya arşivlenmiş yarışmanın başvuruları yeni değerlendirme kuyruğu
  // ÜRETMEZ (madde 8): dağıtım yalnızca aktif yarışmalar için yapılır.
  const pending = await database.prepare(
    `SELECT a.id, a.competition_key FROM competition_applications a
     INNER JOIN competitions c ON c.competition_key = a.competition_key
     WHERE a.assigned_judge_id IS NULL AND a.status IN ('submitted', 'resubmitted') AND a.deleted_at IS NULL
       AND c.deleted_at IS NULL AND c.is_active = 1
     ORDER BY a.submitted_at ASC LIMIT 100`,
  ).all<{ id: string; competition_key: string }>();
  let assignedCount = 0;
  for (const row of pending.results ?? []) {
    try {
      const timestamp = new Date().toISOString();
      const assignment = await autoAssignJudge(row.id, row.competition_key, timestamp);
      if (!assignment) continue;
      assignedCount += 1;
      const detail = `${assignment.name} · bekleyen başvuru sistem tarafından otomatik dağıtıldı`
        + ` · açık dosya: ${assignment.openFiles}${assignment.scoped ? " · bu yarışmada görevli" : ""}`;
      await recordWorkflowEvent({
        subjectType: "application", subjectId: row.id, event: "application_assigned", actor: null, detail,
      }).catch((eventError) => console.error("[workflow] bekleyen atama olayı kaydedilemedi", eventError));
      await recordAudit({
        actorId: null, actorEmail: null, actorRole: null,
        action: "application_auto_assigned", targetType: "competition_application", targetId: row.id, detail,
      }).catch((auditError) => console.error("[audit] bekleyen otomatik atama", auditError));
    } catch (assignError) {
      // Tek başvurunun ataması düşerse kalanlar denenmeye devam eder.
      console.error("[workflow] bekleyen başvuru ataması yapılamadı", assignError);
    }
  }
  return assignedCount;
}

export type CreateApplicationResult = CompetitionApplication | "duplicate";

export type JudgeReassignment = {
  applicationId: string;
  /** Yeni hakem atanabildiyse künyesi; aktif hakem yoksa null (kuyruğa alındı). */
  judgeId: string | null;
  judgeName: string | null;
  detail: string;
};

/**
 * PASİFLEŞTİRİLEN HAKEMİN AÇIK DOSYALARINI GÜVENLE DEVREDER (madde 10).
 *
 * Bir hakem hesabı pasife alındığında (veya kalıcı silindiğinde) ona atanmış
 * TAMAMLANMAMIŞ başvurular eskiden `assigned_judge_id` alanında o hesapta
 * kalıyordu: hakem giriş yapamadığı için dosya hiç açılmıyor, otomatik dağıtım
 * ise yalnızca `assigned_judge_id IS NULL` satırlara baktığı için dosyayı hiç
 * görmüyordu. Başvuru kalıcı olarak takılı kalıyordu.
 *
 * Bu işlev:
 *   - Yalnızca TAMAMLANMAMIŞ ve arşivlenmemiş dosyaları serbest bırakır;
 *     tamamlanmış değerlendirmelerin tarihsel hakem bilgisi (judge_id,
 *     judge_name, application_assignments geçmişi) DEĞİŞMEZ.
 *   - Serbest bırakmayı koşullu UPDATE ile yapar: `assigned_judge_id` hâlâ
 *     pasif hakemde ise değişir. Eşzamanlı bir işlem dosyayı çoktan başka
 *     hakeme aldıysa üzerine YAZILMAZ, yani iki hakeme birden atanamaz.
 *   - Ardından mevcut otomatik dağıtımı çağırır: en az yüklü aktif hakeme
 *     gider. Aktif hakem yoksa dosya atanmamış (kuyrukta) kalır ve yeni bir
 *     hakem açıldığında `assignPendingApplications` dağıtır.
 *   - Her değişikliği süreç zaman çizelgesine yazar; denetim kaydı çağıranda.
 */
export async function reassignApplicationsFromJudge(
  judgeId: string,
  reason: string,
): Promise<JudgeReassignment[]> {
  const database = await workflowDatabase();
  const open = await database.prepare(
    `SELECT id, competition_key FROM competition_applications
     WHERE assigned_judge_id = ? AND status <> 'completed' AND deleted_at IS NULL
     ORDER BY submitted_at ASC LIMIT 200`,
  ).bind(judgeId).all<{ id: string; competition_key: string }>();
  const moved: JudgeReassignment[] = [];
  for (const row of open.results ?? []) {
    const timestamp = new Date().toISOString();
    /*
     * Serbest bırakma: durum da dağıtıma UYGUN hâle getirilir. `autoAssignJudge`
     * yalnızca 'submitted'/'resubmitted' satırları atar; 'assigned',
     * 'analyzing' veya 'awaiting_judge' durumunda takılmış bir dosya aksi
     * hâlde yeniden dağıtılamazdı. Kaydedilmiş AI analizi ve kriter kararları
     * SİLİNMEZ; yalnızca dosyanın sahibi değişir.
     */
    const released = await database.prepare(
      `UPDATE competition_applications
       SET assigned_judge_id = NULL, assigned_judge_name = NULL, status = 'resubmitted', updated_at = ?
       WHERE id = ? AND assigned_judge_id = ? AND status <> 'completed' AND deleted_at IS NULL`,
    ).bind(timestamp, row.id, judgeId).run();
    // Eşzamanlı bir işlem dosyayı bu arada devraldıysa dokunulmaz.
    if (!released.meta.changes) continue;
    await database.prepare(`UPDATE application_assignments SET active = 0 WHERE application_id = ? AND active = 1`)
      .bind(row.id).run().catch(() => undefined);

    let assignment: Awaited<ReturnType<typeof autoAssignJudge>> = null;
    try {
      assignment = await autoAssignJudge(row.id, row.competition_key, timestamp);
    } catch (assignError) {
      console.error("[workflow] pasif hakemin dosyası yeniden atanamadı", assignError);
    }
    const detail = assignment
      ? `Önceki hakem pasife alındı (${reason || "gerekçe yazılmadı"}); dosya ${assignment.name} hakemine`
        + ` sistem tarafından devredildi · açık dosya: ${assignment.openFiles}`
      : `Önceki hakem pasife alındı (${reason || "gerekçe yazılmadı"}); aktif hakem bulunmadığı için`
        + " dosya yeniden atama kuyruğuna alındı. Yeni bir Hakem hesabı açıldığında sistem otomatik dağıtır.";
    await recordWorkflowEvent({
      subjectType: "application",
      subjectId: row.id,
      event: assignment ? "application_assigned" : "application_reassignment_queued",
      actor: null,
      detail,
    }).catch((eventError) => console.error("[workflow] devir olayı kaydedilemedi", eventError));
    moved.push({
      applicationId: row.id,
      judgeId: assignment?.id ?? null,
      judgeName: assignment?.name ?? null,
      detail,
    });
  }
  return moved;
}

export async function createApplication(input: {
  participant: AdminAccount;
  applicantFullName: string;
  teamName: string;
  teamMembers: string[];
  competitionName: string;
  competitionKey: string;
  profileId: string | null;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Yüklenen PDF'in SHA-256 özeti; sürüm satırına yazılır (göç 0010). */
  pdfHash: string | null;
}): Promise<CreateApplicationResult> {
  const database = await workflowDatabase();
  /*
   * ÇİFT BAŞVURU (madde 9): aynı katılımcı aynı yarışmaya ikinci bir aktif
   * başvuru açamaz. Asıl koruma `idx_applications_participant_competition`
   * benzersiz dizinidir; bu okuma yalnızca kullanıcıya anlaşılır bir mesaj
   * dönebilmek içindir. Dizin eşzamanlı ikinci isteği de reddeder, bu yüzden
   * INSERT hatası da "duplicate" olarak yorumlanır.
   */
  const existing = await database.prepare(
    `SELECT id FROM competition_applications
     WHERE participant_id = ? AND competition_key = ? AND deleted_at IS NULL LIMIT 1`,
  ).bind(input.participant.id, input.competitionKey).first<{ id: string }>();
  if (existing) return "duplicate";
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const participantProfile = await database.prepare(
    `SELECT education_status, education_grade, institution_name, city, gender,
            discovery_source, teknofest_history
     FROM participant_profiles WHERE account_id = ?`,
  ).bind(input.participant.id).first<{
    education_status: string;
    education_grade: string;
    institution_name: string;
    city: string;
    gender: string | null;
    discovery_source: string;
    teknofest_history: string;
  }>();
  // Başvuru sahibi dahil, yinelenen adlar tek kişi sayılır. Bu yalnızca
  // analitik takım büyüklüğüdür; kayıtlı ekip üyesi listesini değiştirmez.
  const teamSize = new Set(
    [input.applicantFullName, ...input.teamMembers]
      .map((name) => fold(name.trim()))
      .filter(Boolean),
  ).size || 1;
  const statements = [database.prepare(
    `INSERT INTO competition_applications
      (id, participant_id, participant_name, participant_email, competition_key, competition_name,
       profile_id, file_key, file_name, mime_type, size_bytes, status, current_version_id,
       submitted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
  ).bind(
    id,
    input.participant.id,
    input.participant.fullName,
    input.participant.email,
    input.competitionKey,
    input.competitionName,
    input.profileId,
    input.fileKey,
    input.fileName,
    input.mimeType,
    input.sizeBytes,
    versionId,
    timestamp,
    timestamp,
  ), database.prepare(
    `INSERT INTO application_submission_details
      (application_id, applicant_full_name, team_name, outcome, outcome_note)
     VALUES (?, ?, ?, 'pending', '')`,
  ).bind(id, input.applicantFullName, input.teamName), database.prepare(
    `INSERT INTO application_participant_snapshots
      (application_id, participant_id, education_status, education_grade, institution_name,
       city, gender, discovery_source, teknofest_history, team_size, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.participant.id,
    participantProfile?.education_status ?? "belirtilmedi",
    participantProfile?.education_grade ?? "",
    participantProfile?.institution_name ?? "Belirtilmedi",
    participantProfile?.city ?? "Belirtilmedi",
    participantProfile?.gender ?? null,
    participantProfile?.discovery_source ?? "belirtilmedi",
    participantProfile?.teknofest_history ?? "belirtilmedi",
    teamSize,
    timestamp,
  ), database.prepare(
    `INSERT INTO submission_versions
      (id, application_id, version_number, file_key, file_name, mime_type, size_bytes,
       pdf_hash, byte_length, submitted_by, submitted_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    versionId, id, input.fileKey, input.fileName, input.mimeType, input.sizeBytes,
    input.pdfHash, input.sizeBytes, input.participant.id, timestamp,
  ),
  ...input.teamMembers.map((fullName, index) => database.prepare(
    `INSERT INTO application_team_members (id, application_id, member_order, full_name)
     VALUES (?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), id, index, fullName))];
  try {
    await database.batch(statements);
  } catch (insertError) {
    // Benzersiz dizin eşzamanlı ikinci isteği burada reddeder (çift tıklama).
    const message = insertError instanceof Error ? insertError.message : String(insertError);
    if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
    throw insertError;
  }
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: id,
    event: "application_submitted",
    actor: input.participant,
    detail: `${input.teamName} · ${input.competitionName} · ${input.fileName}`,
  });

  // Atama başvurudan SONRA yapılır: başarısız olursa başvuru kaydı bozulmaz,
  // yalnızca atanmamış kalır ve 04 panosunda bekleyen olarak görünür.
  let assignment: Awaited<ReturnType<typeof autoAssignJudge>> = null;
  try {
    assignment = await autoAssignJudge(id, input.competitionKey, timestamp);
  } catch (assignError) {
    console.error("[workflow] otomatik hakem ataması yapılamadı", assignError);
  }
  if (assignment) {
    const detail = `${assignment.name} · başvuru alındığında sistem tarafından otomatik atandı`
      + ` · açık dosya: ${assignment.openFiles}${assignment.scoped ? " · bu yarışmada görevli" : ""}`;
    await recordWorkflowEvent({
      subjectType: "application",
      subjectId: id,
      event: "application_assigned",
      actor: null,
      detail,
    }).catch((eventError) => console.error("[workflow] atama olayı kaydedilemedi", eventError));
    // Atama denetim iznine de yazılır: kim/ne zaman/neden sorusunun cevabı
    // yalnızca süreç zaman çizelgesinde değil, denetim izinde de bulunur.
    await recordAudit({
      actorId: null,
      actorEmail: null,
      actorRole: null,
      action: "application_auto_assigned",
      targetType: "competition_application",
      targetId: id,
      detail,
    }).catch((auditError) => console.error("[audit] otomatik atama", auditError));
  }

  const saved = await findApplication(id, input.participant);
  if (!saved) throw new Error("Başvuru kaydedildi ancak geri okunamadı.");
  return saved;
}

/**
 * Satır düzeyinde görünürlük.
 *   03 yalnızca kendi başvurusunu görür (backend'de zorunlu, buton gizlemek yetmez).
 *   01 yalnızca kendi hazırladığı profillerin yarışmalarını görür.
 *   00 ve 02 yetkileri kapsamındaki başvuruları tam görür; 04 yalnızca operasyon görünümünü alır.
 */
function applicationVisibility(account: AdminAccount, alias = "a"): { sql: string; binds: unknown[] } {
  if (account.roleCode === "03") return { sql: `WHERE ${alias}.participant_id = ?`, binds: [account.id] };
  // Hakem arşivlediği (aktif listeden kaldırdığı) dosyayı görmez; kayıt
  // silinmediği için Değerlendirme Yöneticisi denetim amacıyla görmeye devam eder.
  if (account.roleCode === "02") {
    return { sql: `WHERE ${alias}.assigned_judge_id = ? AND ${alias}.deleted_at IS NULL`, binds: [account.id] };
  }
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
 *   participant 03: kendi başvurusu; hakem onaylı geri bildirim.
 *   operations  01 ve 04: sayaç ve durum takibi. Yarışmacı PDF'i, ekip üyeleri ve
 *               kanıt metinleri kapalıdır; AI ön değerlendirmesi yalnızca özet
 *               (puan ve kriter durumu) olarak görünür.
 */
function applicationView(account: AdminAccount): "full" | "participant" | "operations" {
  if (account.roleCode === "03") return "participant";
  if (account.roleCode === "01" || account.roleCode === "04") return "operations";
  return "full";
}

/**
 * Operasyon rollerine giden AI ön değerlendirmesi: kanıt alıntıları, gerekçe
 * metinleri ve yarışmacı geri bildirimi çıkarılır. Kalan alanlar süreç takibi
 * için yeterlidir; proje içeriği sızmaz.
 */
/** Dört aşamalı (2.0) sözleşmeye uymayan saklı AI sonucu. */
function isLegacyEvaluation(evaluation: ReportEvaluation | null): boolean {
  return !!evaluation && (
    evaluation.version !== "2.0"
    || !Array.isArray(evaluation.findings)
    || !Array.isArray(evaluation.stages)
    || !evaluation.summary
  );
}

function redactEvaluation(evaluation: ReportEvaluation | null): ReportEvaluation | null {
  if (!evaluation) return null;
  return {
    ...evaluation,
    report: { ...evaluation.report, name: "" },
    preChecks: (evaluation.preChecks ?? []).map((check) => ({ ...check, detail: "", evidence: [] })),
    // Aşama özetleri, başlık tablosu, alıntılar ve benzerlik ayrıntısı (en yakın
    // takım) proje içeriği taşır; yalnızca durum ve sayaçlar kalır.
    stages: (evaluation.stages ?? []).map((stage) => ({
      ...stage,
      summary: "",
      evidence: [],
      headings: [],
      // 04 yalnızca benzerlik kontrolünün DURUMUNU görür; yüzde, en yakın
      // takım ve ayrıntı metni bu role gitmez (madde 9.10).
      similarity: stage.similarity
        ? { ...stage.similarity, detail: "", closestTeam: null, percent: null }
        : stage.similarity ?? null,
    })),
    findings: (evaluation.findings ?? []).map((finding) => ({ ...finding, rationale: "", evidence: [] })),
    feedbackDraft: { strengths: [], improvements: [], suggestions: [] },
    /*
     * Değerlendirme Yöneticisi yalnızca benzerlik kontrolünün TAMAMLANIP
     * tamamlanmadığını ve inceleme işareti bulunup bulunmadığını görür;
     * başka takımın adı, alıntısı veya oranı bu role hiç gönderilmez (madde 9.10).
     */
    similarityReport: evaluation.similarityReport
      ? {
        ...evaluation.similarityReport,
        approxPercent: null,
        closestLabel: null,
        note: evaluation.similarityReport.level === "none"
          ? "Benzerlik kontrolü: karşılaştırılacak başka güncel başvuru yoktu."
          : `Benzerlik kontrolü tamamlandı${["review", "high"].includes(evaluation.similarityReport.level) ? "; inceleme işareti var" : "; inceleme işareti yok"}.`,
        matches: [],
      }
      : evaluation.similarityReport ?? null,
    analysisWarnings: [],
  };
}

const APPLICATION_SELECT = `SELECT a.*, d.applicant_full_name, d.team_name,
  d.outcome, d.outcome_note, d.decided_at,
  c.status AS competition_status,
  c.is_active AS competition_is_active,
  (SELECT MAX(v.version_number) FROM submission_versions v WHERE v.application_id = a.id) AS current_version_number,
  (SELECT MAX(cv.criteria_version) FROM criteria_profile_versions cv
    WHERE cv.competition_key = a.competition_key) AS current_criteria_version,
  (SELECT r.is_stale FROM similarity_results r WHERE r.application_id = a.id
    ORDER BY r.analyzed_at DESC LIMIT 1) AS similarity_is_stale,
  (SELECT r.stale_reason FROM similarity_results r WHERE r.application_id = a.id
    ORDER BY r.analyzed_at DESC LIMIT 1) AS similarity_stale_reason
  FROM competition_applications a
  LEFT JOIN application_submission_details d ON d.application_id = a.id
  LEFT JOIN competitions c ON c.competition_key = a.competition_key`;

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
  const row = await database.prepare(
    `SELECT COALESCE(v.file_key, a.file_key) AS file_key
     FROM competition_applications a
     LEFT JOIN submission_versions v ON v.id = a.current_version_id
     ${conjunction}`,
  ).bind(...binds).first<{ file_key: string }>();
  return row?.file_key ?? null;
}

/*
 * MANUEL HAKEM ATAMA KALDIRILDI.
 *
 * `assignApplication` (elle ilk atama / yeniden atama) bilinçli olarak
 * silindi: hakem ataması YALNIZCA sistem tarafından yapılır
 * (`autoAssignJudge` + `assignPendingApplications`). Değerlendirme Yöneticisi
 * hakem seçemez; API'deki `assign_judge` eylemi kapatıldı ve yetki matrisi
 * bu izni artık tanımlamaz.
 */

export type CoordinationAction = "remind_judge" | "requeue_analysis" | "request_document";

export async function coordinateApplication(
  id: string,
  action: CoordinationAction,
  actor: AdminAccount,
  note: string,
): Promise<CompetitionApplication | "not_found" | "invalid_state"> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT status, assigned_judge_id, assigned_judge_name, evaluation_json FROM competition_applications WHERE id = ?`,
  ).bind(id).first<{ status: string; assigned_judge_id: string | null; assigned_judge_name: string | null; evaluation_json: string | null }>();
  if (!current) return "not_found";
  // Eski (puanlı) AI sonucu taşıyan başvurular da yeniden sıraya alınabilir.
  const legacy = isLegacyEvaluation(parseJson<ReportEvaluation>(current.evaluation_json));
  const detail = note.trim().slice(0, 500);
  if (action === "remind_judge") {
    if (!current.assigned_judge_id) return "invalid_state";
    await recordWorkflowEvent({
      subjectType: "application", subjectId: id, event: "judge_reminder_sent", actor,
      detail: `${current.assigned_judge_name ?? "Atanmış hakem"}${detail ? ` · ${detail}` : ""}`,
    });
  } else if (action === "requeue_analysis") {
    const legacyStuck = ["awaiting_judge", "judge_in_review"].includes(current.status) && legacy;
    if (current.status !== "analysis_failed" && !legacyStuck) return "invalid_state";
    await database.prepare(
      `UPDATE competition_applications
       SET status = ?, evaluation_json = NULL, review_json = NULL, updated_at = ? WHERE id = ?`,
    ).bind(current.assigned_judge_id ? "assigned" : "submitted", new Date().toISOString(), id).run();
    await recordWorkflowEvent({ subjectType: "application", subjectId: id, event: "analysis_requeued", actor, detail });
  } else {
    if (current.status === "completed") return "invalid_state";
    await database.prepare(
      `UPDATE competition_applications
       SET status = 'document_reupload_requested', evaluation_json = NULL, review_json = NULL, updated_at = ? WHERE id = ?`,
    ).bind(new Date().toISOString(), id).run();
    await recordWorkflowEvent({ subjectType: "application", subjectId: id, event: "document_reupload_requested", actor, detail });
  }
  return await findApplication(id, actor) ?? "not_found";
}

export async function addSubmissionVersion(input: {
  applicationId: string;
  participant: AdminAccount;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Yeniden ölçülen PDF özeti; sürüm satırına yazılır (göç 0010). */
  pdfHash: string | null;
}): Promise<CompetitionApplication | "not_found" | "not_allowed"> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT participant_id, status, assigned_judge_id FROM competition_applications WHERE id = ?`,
  ).bind(input.applicationId).first<{ participant_id: string; status: string; assigned_judge_id: string | null }>();
  if (!current || current.participant_id !== input.participant.id) return "not_found";
  const details = await database.prepare(`SELECT outcome FROM application_submission_details WHERE application_id = ?`)
    .bind(input.applicationId).first<{ outcome: string }>();
  const allowed = current.status === "document_reupload_requested"
    || (current.status === "completed" && details?.outcome === "revision_required");
  if (!allowed) return "not_allowed";
  const latest = await database.prepare(`SELECT MAX(version_number) AS version_number FROM submission_versions WHERE application_id = ?`)
    .bind(input.applicationId).first<{ version_number: number | null }>();
  const versionNumber = (Number(latest?.version_number) || 0) + 1;
  const versionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO submission_versions
        (id, application_id, version_number, file_key, file_name, mime_type, size_bytes,
         pdf_hash, byte_length, submitted_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, input.applicationId, versionNumber, input.fileKey, input.fileName,
      input.mimeType, input.sizeBytes, input.pdfHash, input.sizeBytes, input.participant.id, timestamp,
    ),
    database.prepare(
      `UPDATE competition_applications
       SET current_version_id = ?, file_key = ?, file_name = ?, mime_type = ?, size_bytes = ?,
           status = ?, evaluation_json = NULL, review_json = NULL, judge_id = NULL, judge_name = NULL,
           completed_at = NULL, updated_at = ? WHERE id = ?`,
    ).bind(
      versionId, input.fileKey, input.fileName, input.mimeType, input.sizeBytes,
      current.assigned_judge_id ? "assigned" : "resubmitted", timestamp, input.applicationId,
    ),
    database.prepare(
      `UPDATE application_submission_details SET outcome = 'pending', outcome_note = '', decided_at = NULL WHERE application_id = ?`,
    ).bind(input.applicationId),
  ]);
  await recordWorkflowEvent({
    subjectType: "application", subjectId: input.applicationId, event: "submission_version_added", actor: input.participant,
    detail: `Sürüm ${versionNumber} · ${input.fileName}`,
  });
  return await findApplication(input.applicationId, input.participant) ?? "not_found";
}

export type StoredSimilarityPeer = {
  applicationId: string;
  participantLabel: string;
  fingerprint: SimilarityFingerprint;
};

/**
 * Ham rapor metnini saklamadan aynı yarışma+yıl+aşama havuzuna ait MinHash ve
 * isteğe bağlı embedding izini kaydeder. Eski rapor sürümünün izi yeni sürümle
 * atomik olarak değiştirilir; katılımcı metni hiçbir zaman operasyon rolüne açılmaz.
 */
export async function saveAndListSimilarityFingerprints(
  applicationId: string,
  actor: AdminAccount,
  fingerprint: SimilarityFingerprint,
): Promise<StoredSimilarityPeer[] | "not_found" | "forbidden"> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT a.competition_key, a.participant_name, a.participant_id, a.current_version_id, a.assigned_judge_id,
            COALESCE(d.team_name, a.participant_name) AS participant_label
     FROM competition_applications a
     LEFT JOIN application_submission_details d ON d.application_id = a.id
     WHERE a.id = ?`,
  ).bind(applicationId).first<{
    competition_key: string; participant_name: string; participant_id: string; participant_label: string;
    current_version_id: string | null; assigned_judge_id: string | null;
  }>();
  if (!current) return "not_found";
  if (actor.roleCode === "02" && current.assigned_judge_id !== actor.id) return "forbidden";
  const timestamp = new Date().toISOString();
  await database.prepare(
    `INSERT INTO submission_fingerprints
      (application_id, submission_version_id, competition_key, participant_label, fingerprint_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(application_id) DO UPDATE SET
       submission_version_id = excluded.submission_version_id,
       competition_key = excluded.competition_key,
       participant_label = excluded.participant_label,
       fingerprint_json = excluded.fingerprint_json,
       updated_at = excluded.updated_at`,
  ).bind(applicationId, current.current_version_id, current.competition_key, current.participant_label, JSON.stringify(fingerprint), timestamp).run();
  /*
   * Eş izleri (madde 8): silinmiş/arşivlenmiş başvurular ve ESKİ PDF
   * sürümlerinden kalan izler havuza GİRMEZ — iz, başvurunun geçerli
   * sürümüne aitse sayılır (eski başvurularda current_version_id boş
   * olabilir; o durumda kayıtlı iz olduğu gibi geçerlidir). Aynı takımın
   * (aynı katılımcı hesabının) başka başvurusu "farklı takım benzerliği"
   * sayılmaz. LIMIT büyük havuzlarda D1 yanıtını sınırlar.
   */
  const rows = await database.prepare(
    `SELECT f.application_id, f.participant_label, f.fingerprint_json
     FROM submission_fingerprints f
     INNER JOIN competition_applications a
       ON a.id = f.application_id AND a.deleted_at IS NULL
       AND (a.current_version_id IS NULL OR f.submission_version_id IS NULL
            OR a.current_version_id = f.submission_version_id)
     WHERE f.competition_key = ? AND f.application_id <> ? AND a.participant_id <> ?
     ORDER BY f.updated_at DESC
     LIMIT 500`,
  ).bind(current.competition_key, applicationId, current.participant_id).all<{
    application_id: string; participant_label: string; fingerprint_json: string;
  }>();
  return (rows.results ?? []).flatMap((row) => {
    try {
      const parsed = JSON.parse(row.fingerprint_json) as SimilarityFingerprint;
      return parsed?.algorithm === "minhash-v1" && Array.isArray(parsed.signature)
        ? [{ applicationId: row.application_id, participantLabel: row.participant_label, fingerprint: parsed }]
        : [];
    } catch { return []; }
  });
}

/* ------------------------------------------------------------------------- *
 * DEĞERLENDİRME BÜTÜNLÜĞÜ (madde 3)
 *
 * Hakem "Yapay Zekâ Analizi" dediğinde sunucu İSTEMCİDEN GELEN kritere,
 * profile veya PDF'e GÜVENMEZ. Zincir tamamen sunucuda kurulur:
 *
 *   application_id → competition_key → current_pdf_version (R2)
 *                                    → latest_published_criteria_version (D1)
 *                                    → evaluation_result
 *
 * Böylece istemci farklı bir PDF, farklı bir kriter seti veya eski bir profil
 * göndererek sonucu yanlış başvuruya yazdıramaz. Uyuşmayan her bağ sessizce
 * kaydedilmez; anlaşılır bir hata döner.
 * ------------------------------------------------------------------------- */

export type EvaluationContext = {
  applicationId: string;
  competitionKey: string;
  competitionName: string;
  competitionArchived: boolean;
  competitionActive: boolean;
  /** Sunucudan kurulmuş profil: künye kayıttan, kriterler SON yayımlanan sürümden. */
  profile: ProfileExport;
  criteriaVersion: CriteriaVersion;
  /** Katılımcının GEÇERLİ rapor sürümü. */
  submissionVersionId: string | null;
  submissionVersionNumber: number;
  fileKey: string;
  fileName: string;
  status: ApplicationStatus;
  assignedJudgeId: string | null;
};

export type EvaluationContextFailure =
  | "not_found"
  | "forbidden"
  | "criteria_missing"
  | "document_missing"
  | "competition_archived"
  | "competition_locked";

/**
 * Başvurunun değerlendirme bağlamını YALNIZCA sunucu kaynaklarından kurar.
 * `judge` verilirse atama kontrolü de uygulanır.
 */
export async function resolveEvaluationContext(
  applicationId: string,
  actor: AdminAccount,
): Promise<EvaluationContext | EvaluationContextFailure> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT a.id, a.competition_key, a.competition_name, a.profile_id, a.status,
            a.assigned_judge_id, a.current_version_id, a.file_key, a.file_name,
            c.deleted_at AS competition_deleted_at, c.is_active AS competition_is_active,
            c.status AS competition_status, c.decisions_locked AS competition_locked,
            v.file_key AS version_file_key, v.file_name AS version_file_name,
            v.version_number AS version_number
     FROM competition_applications a
     LEFT JOIN competitions c ON c.competition_key = a.competition_key
     LEFT JOIN submission_versions v ON v.id = a.current_version_id
     WHERE a.id = ?`,
  ).bind(applicationId).first<{
    id: string; competition_key: string; competition_name: string; profile_id: string | null;
    status: string; assigned_judge_id: string | null; current_version_id: string | null;
    file_key: string; file_name: string;
    competition_deleted_at: string | null; competition_is_active: number | null;
    competition_status: string | null; competition_locked: number | null;
    version_file_key: string | null; version_file_name: string | null; version_number: number | null;
  }>();
  if (!row) return "not_found";
  // Hakem yalnızca KENDİSİNE atanmış başvuruyu değerlendirebilir.
  if (actor.roleCode === "02" && row.assigned_judge_id !== actor.id) return "forbidden";
  if (row.competition_deleted_at || row.competition_status === "archived") return "competition_archived";
  if (row.competition_locked === 1) return "competition_locked";

  // 1) Yarışmanın SON yayımlanmış kriter sürümü — istemci ne gönderirse göndersin.
  const latest = await findLatestCriteriaVersion(row.competition_key);
  if (!latest) return "criteria_missing";

  // 2) Profil künyesi (yarışma, kategori, dil, dosya kuralları) kayıttan okunur.
  const base = (row.profile_id ? await findProfile(row.profile_id) : null)
    ?? await findProfile(latest.version.criteriaProfileId);
  if (!base) return "criteria_missing";

  // 3) Katılımcının geçerli PDF sürümü (R2 anahtarı) doğrulanır.
  const fileKey = row.version_file_key ?? row.file_key;
  if (!fileKey) return "document_missing";

  const profile: ProfileExport = {
    ...base.profile,
    profileId: latest.version.criteriaProfileId,
    // Kriterler DAİMA son yayımlanan sürümden gelir; profil JSON'undaki
    // anlık görüntü değil. İkisi ayrışırsa yürürlükteki sürüm kazanır.
    criteria: latest.criteria,
  };

  return {
    applicationId: row.id,
    competitionKey: row.competition_key,
    competitionName: row.competition_name,
    competitionArchived: false,
    competitionActive: row.competition_is_active === null || row.competition_is_active === undefined
      ? true
      : row.competition_is_active === 1,
    profile,
    criteriaVersion: latest.version,
    submissionVersionId: row.current_version_id,
    submissionVersionNumber: Number(row.version_number) || 1,
    fileKey,
    fileName: row.version_file_name ?? row.file_name,
    status: (APPLICATION_STATUSES as string[]).includes(row.status) ? row.status as ApplicationStatus : "submitted",
    assignedJudgeId: row.assigned_judge_id,
  };
}

/**
 * AI ön değerlendirmesini başlatır (Aşama C).
 * Yalnızca HAKEM ONAYLI profil varsa çalışır; onaysız profille değerlendirme yapılmaz.
 */
export async function markApplicationAnalyzing(id: string, judge: AdminAccount): Promise<"started" | "profile_missing" | "conflict"> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT competition_name, competition_key, profile_id, status, assigned_judge_id, evaluation_json FROM competition_applications WHERE id = ?`,
  ).bind(id).first<{ competition_name: string; competition_key: string; profile_id: string | null; status: string; assigned_judge_id: string | null; evaluation_json: string | null }>();
  /*
   * "ANALİZİ YENİLE" GERÇEKTEN ÇALIŞIR (madde 8)
   *
   * Eskiden yalnızca 'assigned' / 'resubmitted' / 'analysis_failed' durumları
   * (ve eski puanlı 1.0 sonucu taşıyan "takılı" dosyalar) kabul ediliyordu.
   * Başarılı bir analizden sonra durum 'awaiting_judge' olduğu için hakem
   * ekranındaki "Analizi yenile" düğmesi sunucuda 409 ("zaten analiz edilmiş")
   * ile reddediliyordu: kriterler güncellendiğinde ya da sonuç şüpheli
   * göründüğünde yeniden analiz yapılamıyordu.
   *
   * Artık hakem kuyruğundaki (analiz edilmiş) dosya da yeniden analiz
   * edilebilir; bu kural eski (puanlı) sonuç taşıyan dosyaları da kapsar.
   * Kesinleşmiş karar ('completed') ve kararları dondurulmuş yarışma
   * korumaları YERİNDE: onlar için önce "Kararı yeniden aç" gerekir ve bu
   * kural `saveApplicationEvaluation` içinde ayrıca uygulanır.
   */
  const REANALYZABLE = ["assigned", "resubmitted", "analysis_failed", "awaiting_judge", "judge_in_review"];
  if (!current || !REANALYZABLE.includes(current.status)) return "conflict";
  if (judge.roleCode === "02" && current.assigned_judge_id !== judge.id) return "conflict";
  // profile_id başvuru anında bağlanmış olsa bile hakem onayından geçmemiş olabilir;
  // o durumda AYNI yarışmanın onaylı profiline düşülür. Düşüş ada değil,
  // başvurunun kendi `competition_key` değerine bakar: ada göre arama aynı adlı
  // başka bir yarışmanın profilini bağlayabiliyordu.
  const linked = current.profile_id ? await findApprovedProfile(current.profile_id) : null;
  const profile = linked ?? await findLatestProfileForCompetitionKey(current.competition_key);
  if (!profile) return "profile_missing";
  const result = await database.prepare(
    `UPDATE competition_applications
     SET status = 'analyzing', profile_id = ?, judge_id = ?, judge_name = ?, updated_at = ?
     WHERE id = ? AND status IN ('assigned', 'resubmitted', 'analysis_failed', 'awaiting_judge', 'judge_in_review')
       AND NOT EXISTS (SELECT 1 FROM competitions c
         WHERE c.competition_key = competition_applications.competition_key
           AND (c.decisions_locked = 1 OR c.status = 'archived' OR c.deleted_at IS NOT NULL))`,
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
 *
 * `previousAnalysisKept` true döndüğünde başarısız bir deneme kaydedilmiş ama
 * önceki BAŞARILI analiz korunmuştur; çağıran bunu kullanıcıya söyler.
 */
export async function saveApplicationEvaluation(
  id: string,
  judge: AdminAccount,
  evaluation: ReportEvaluation | null,
  failed = false,
  binding: { criteriaVersion: number | null; criteriaHash: string | null; pdfHash: string | null; submissionVersionId: string | null } | null = null,
): Promise<{ previousAnalysisKept: boolean }> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT a.profile_id, a.current_version_id, a.status, a.evaluation_json, c.decisions_locked
     FROM competition_applications a
     LEFT JOIN competitions c ON c.competition_key = a.competition_key
     WHERE a.id = ?`,
  ).bind(id).first<{
    profile_id: string | null; current_version_id: string | null;
    status: string; evaluation_json: string | null; decisions_locked: number | null;
  }>();
  if (!current) throw new ConflictError("Başvuru bulunamadı.");
  /*
   * KESİNLEŞMİŞ KARAR KORUMASI: nihai karar verilmiş (completed) veya kararları
   * dondurulmuş bir başvurunun durumu, AI sonucu kaydı ya da "analiz başarısız"
   * işaretiyle BOZULAMAZ. Analiz ancak "Kararı yeniden aç"tan sonra yazılabilir;
   * bu kural deleteApplicationEvaluation/reopenApplicationReview ile tutarlıdır.
   */
  if (current.status === "completed") {
    throw new ConflictError("Bu başvurunun nihai kararı kesinleştirildi; analiz sonucu yazmak için önce “Kararı yeniden aç” işlemini yapın.");
  }
  if (current.decisions_locked === 1) {
    throw new ConflictError("Bu yarışmanın hakem kararları donduruldu; analiz sonucu kaydedilemez.");
  }
  const timestamp = new Date().toISOString();
  const versionId = binding?.submissionVersionId ?? current?.current_version_id ?? null;
  const resultRowId = crypto.randomUUID();
  /*
   * BAŞARISIZ DENEME ÖNCEKİ BAŞARILI ANALİZİ SİLMEZ (madde 8)
   *
   * Eskiden "Analizi yenile" sırasında model 503 verdiğinde bu işlev
   * `evaluation_json = NULL` yazıyordu: hakemin elindeki çalışan analiz,
   * kanıt bilgileri ve o analize bağlı kriter kararları geçici bir ağ
   * hatası yüzünden kayboluyordu. Artık başarısız denemede yalnızca DURUM
   * ve deneme kaydı yazılır; başarılı analizin kendisi ve kriter sürümü /
   * PDF özeti bağları YERİNDE KALIR. Böylece hakem eski sonucu görmeye
   * devam eder, yeni denemenin hatası `evaluation_results` tablosunda
   * ayrıca tutulur.
   *
   * Yeni sonuç ancak BAŞARIYLA üretilip bütünlük kapılarından geçtikten
   * sonra (failed = false) eskisinin üzerine yazılır.
   */
  const keepPreviousAnalysis = failed && Boolean(current.evaluation_json);
  const applicationUpdate = keepPreviousAnalysis
    ? database.prepare(
      /*
       * Başarısız deneme: sonuç ve bağ sütunlarına DOKUNULMAZ.
       *
       * Durum 'analysis_failed' YAZILMAZ, 'awaiting_judge' olarak bırakılır:
       * elde KULLANILABİLİR bir analiz var ve hakem onunla nihai kararı
       * verebilmelidir. 'analysis_failed' yazılsa `save_review` ucu "önce AI
       * ön analizi tamamlanmalı" diyerek hakemi çıkışsız bırakırdı — geçici
       * bir ağ hatası, tamamlanmış bir analizi kilitlemiş olurdu.
       * Denemenin başarısızlığı `evaluation_results` satırında ve süreç
       * geçmişinde ayrıca tutulur.
       */
      `UPDATE competition_applications
       SET status = 'awaiting_judge', judge_id = ?, judge_name = ?, updated_at = ?
       WHERE id = ? AND status <> 'completed'`,
    ).bind(judge.id, judge.fullName, timestamp, id)
    : database.prepare(
      // Koşul WHERE'de de tutulur: yukarıdaki okuma ile yazma arasında karar
      // kesinleşirse (yarış durumu) bu satır completed durumunu EZEMEZ.
      `UPDATE competition_applications
       SET status = ?, evaluation_json = ?, judge_id = ?, judge_name = ?,
           evaluation_criteria_version = ?, evaluation_criteria_hash = ?,
           evaluation_pdf_hash = ?, evaluation_version_id = ?, updated_at = ?
       WHERE id = ? AND status <> 'completed'`,
    ).bind(
      failed ? "analysis_failed" : "awaiting_judge",
      evaluation ? JSON.stringify(evaluation) : null,
      judge.id,
      judge.fullName,
      // Hiç başarılı analiz yokken başarısız denemede bağ temizlenir: eski
      // sürüm bilgisi yeni denemeyi "güncel" gibi göstermemeli.
      failed ? null : binding?.criteriaVersion ?? null,
      failed ? null : binding?.criteriaHash ?? null,
      failed ? null : binding?.pdfHash ?? null,
      failed ? null : versionId,
      timestamp,
      id,
    );
  const batchResults = await database.batch([applicationUpdate, database.prepare(
    `INSERT INTO evaluation_results
      (id, application_id, submission_version_id, profile_id, status, ai_raw_analysis, model,
       criteria_version, criteria_hash, pdf_hash, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    resultRowId, id, versionId, current?.profile_id ?? null,
    failed ? "failed" : "completed", evaluation ? JSON.stringify(evaluation) : null,
    evaluation?.model ?? null,
    binding?.criteriaVersion ?? null, binding?.criteriaHash ?? null, binding?.pdfHash ?? null,
    timestamp, failed ? null : timestamp,
  )]);
  if (!batchResults[0]?.meta.changes) {
    // Yarış durumu: okuma ile yazma arasında karar kesinleşti. Durum bozulmadı;
    // bu denemeye ait geçmiş satırı da geri alınır ve çağıran açık hata görür.
    await database.prepare(`DELETE FROM evaluation_results WHERE id = ?`).bind(resultRowId).run()
      .catch(() => undefined);
    throw new ConflictError("Başvurunun durumu bu sırada değişti (nihai karar kesinleşti); analiz sonucu yazılmadı.");
  }
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: id,
    event: failed ? "ai_analysis_failed" : "ai_prescreen_completed",
    actor: judge,
    detail: failed || !evaluation
      ? keepPreviousAnalysis
        ? "Yeni analiz denemesi tamamlanamadı; ÖNCEKİ BAŞARILI analiz ve hakem kararları korundu, başvuru yeniden denenebilir."
        : "Analiz tamamlanamadı; başvuru yeniden başlatılabilir."
      : `Kriter sürümü v${binding?.criteriaVersion ?? "?"} · PDF ${(binding?.pdfHash ?? "").slice(0, 12) || "?"} · AI bulguları: ${evaluation.summary?.basarili ?? 0} ${RULE_VERDICT_LABELS.BASARILI} · ${evaluation.summary?.revizyon ?? 0} ${RULE_VERDICT_LABELS.REVIZYON} · ${evaluation.summary?.kritikHata ?? 0} ${RULE_VERDICT_LABELS.KRITIK_HATA} · genel durum: ${evaluation.summary ? RULE_VERDICT_LABELS[evaluation.summary.overall] : "—"} · ${evaluation.summary?.total ?? evaluation.findings.length} kural hakem kararı bekliyor`,
  });
  return { previousAnalysisKept: keepPreviousAnalysis };
}

/**
 * Hakemin AI kural kararından saptığı kriterleri, gerekçesiyle birlikte çıkarır.
 * Denetim izi bu farkları taşır: "AI kararı: REVİZYON → Hakem nihai kararı: BAŞARILI".
 * Olay adı (judge_score_adjusted) geçmiş kayıtlarla uyum için korunur.
 */
function verdictAdjustmentEvents(
  id: string,
  judge: AdminAccount,
  evaluation: ReportEvaluation | null,
  review: JudgeReview,
): WorkflowEventInput[] {
  if (!evaluation) return [];
  const proposals = new Map(evaluation.findings.map((finding) => [finding.criterionId, finding]));
  const events: WorkflowEventInput[] = [];
  const label = (verdict: RuleVerdict | null | undefined) => verdict ? RULE_VERDICT_LABELS[verdict] : "—";
  for (const decision of review.decisions) {
    if (decision.verdict !== "adjusted") continue;
    const finding = proposals.get(decision.criterionId);
    const before = finding?.verdict ?? null;
    if (before === decision.finalVerdict) continue;
    const name = finding?.criterionName ?? decision.criterionId;
    const reason = decision.note.trim();
    events.push({
      subjectType: "application",
      subjectId: id,
      event: "judge_score_adjusted",
      actor: judge,
      detail: `${name} · AI kararı: ${label(before)} → Hakem nihai kararı: ${label(decision.finalVerdict)}`
        + (reason ? ` · Değişiklik gerekçesi: ${reason.slice(0, 400)}` : " · Gerekçe girilmedi"),
    });
  }
  return events;
}

/**
 * Yeni akış: hakemin REDDETTİĞİ AI bulguları denetim izine düşer. Reddedilen
 * bulgu kesin sonuç olarak KULLANILMAZ; yerine hakemin yazdığı sonuç geçer ve
 * bu değişim (AI bulgusu → hakem sonucu) olay kaydında görünür. Bulgunun
 * onaylanması sapma değildir: AI'nin sonucu (UYGUN da OLUMSUZ da olsa)
 * hakemce doğru bulunmuştur.
 */
function criterionDecisionEvents(id: string, judge: AdminAccount, review: JudgeReview): WorkflowEventInput[] {
  const events: WorkflowEventInput[] = [];
  for (const decision of review.criterionDecisions ?? []) {
    if (decision.judgeVerdict !== "rejected") continue;
    events.push({
      subjectType: "application",
      subjectId: id,
      event: "judge_score_adjusted",
      actor: judge,
      detail: findingRejectionAuditLine(decision),
    });
  }
  return events;
}

/**
 * HAKEM ALINTISINI SUNUCUDA DOĞRULAR (madde 5).
 *
 * Hakem "PDF konumu" dayanağı seçtiğinde yazdığı doğrudan alıntının, belirttiği
 * SAYFADA gerçekten bulunduğu katılımcı PDF'inden okunarak kontrol edilir.
 * İstemci verisine tek başına güvenilmez: sayfa numarası ve alıntı yalnızca
 * tarayıcıda doğrulanırsa, hatalı ya da uydurma bir kaynak kayda geçebilirdi.
 *
 * KURALLAR:
 *   - Alıntı belirtilen sayfada YOKSA karar reddedilir (ConflictError) ve
 *     hakeme hangi kriterde hangi sayfanın tutmadığı söylenir.
 *   - Doğrulama YAPILAMIYORSA (PDF okunamadı, metin katmanı yok, alıntı çok
 *     kısa) karar DÜŞÜRÜLMEZ: hakem kararı kural gereği zaten gerekçelidir ve
 *     sistem, kanıtlayamadığı bir şey yüzünden insan kararını engellemez.
 *   - "Raporda bulunamadı" dayanağında sayfa/alıntı istenmediği için hiçbir
 *     doğrulama yapılmaz.
 */
async function verifyJudgeQuotes(
  fileKey: string | null,
  decisions: JudgeCriterionDecision[],
): Promise<void> {
  const checkable = decisions.filter((decision) =>
    decision.judgeVerdict === "rejected"
    && decision.evidenceMode === "PDF_KONUMU"
    && Boolean(decision.evidencePage)
    && decision.evidenceQuote.trim().length >= 12);
  if (!checkable.length || !fileKey) return;

  let layer: ReportTextLayer;
  try {
    const object = await reportBucket().get(fileKey);
    if (!object) return;
    layer = await readReportTextLayer(await object.arrayBuffer());
  } catch (error) {
    // Metin katmanı yok / PDF okunamadı: doğrulama yapılamaz, karar düşmez.
    console.error("[workflow] hakem alıntısı doğrulanamadı; karar kabul edildi", error);
    return;
  }

  for (const decision of checkable) {
    const found = quoteFoundOnPage(layer, decision.evidencePage as number, decision.evidenceQuote);
    if (found === false) {
      throw new ConflictError(
        `“${decision.criterionName || decision.criterionId}” kriterinde yazdığınız doğrudan alıntı, `
        + `belirttiğiniz ${decision.evidencePage}. sayfada bulunamadı. Sayfa numarasını düzeltin, `
        + "alıntıyı rapordan birebir kopyalayın ya da içerik raporda hiç yoksa dayanak türünü "
        + "“Raporda bulunamadı” olarak seçin.",
      );
    }
  }
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
    `SELECT a.status, a.evaluation_json, a.review_json, a.assigned_judge_id, a.evaluation_criteria_version,
            a.file_key, c.decisions_locked,
            (SELECT MAX(cv.criteria_version) FROM criteria_profile_versions cv
              WHERE cv.competition_key = a.competition_key) AS current_criteria_version
     FROM competition_applications a
     LEFT JOIN competitions c ON c.competition_key = a.competition_key
     WHERE a.id = ?`,
  ).bind(id).first<{
    status: string; evaluation_json: string | null; review_json: string | null;
    assigned_judge_id: string | null;
    evaluation_criteria_version: number | null; file_key: string | null;
    decisions_locked: number | null; current_criteria_version: number | null;
  }>();
  // Hata türleri bilinçli: 409 (çakışma) döner, 500 değil. Hakem "İşlem
  // tamamlanamadı" yerine neden karar veremediğini görür.
  if (!before) throw new ConflictError("Başvuru bulunamadı.");
  if (judge.roleCode === "02" && before.assigned_judge_id !== judge.id) {
    throw new ConflictError("Bu başvuru size atanmadı; kararı yalnızca atanan hakem verebilir.");
  }
  if (before.decisions_locked === 1) throw new ConflictError("Bu yarışmanın hakem kararları donduruldu; değişiklik yapılamaz.");
  /*
   * KRİTER TAZELİĞİ (madde 2): kriterler analizden sonra yeniden yayımlandıysa
   * eski analiz yeni kriterler için kullanılamaz. Nihai karar da bu eski analiz
   * üzerine verilemez; hakem önce yeniden analiz etmelidir. Geçmişte KAYITLI
   * kararlar bundan etkilenmez, kendi sürümleriyle korunur.
   */
  if (completed && before.evaluation_json && before.current_criteria_version) {
    const bound = before.evaluation_criteria_version;
    if (bound === null || bound === undefined || Number(bound) < Number(before.current_criteria_version)) {
      throw new ConflictError(
        "Kriterler güncellendi, yeniden analiz gerekli. Bu başvurunun AI analizi "
        + `v${bound ?? "?"} kriter sürümüyle üretildi; yürürlükteki sürüm `
        + `v${before.current_criteria_version}. Karar vermeden önce "Analizi yenile" deyin.`,
      );
    }
  }
  const evaluation = parseJson<ReportEvaluation>(before?.evaluation_json ?? null);
  /*
   * HAKEM KRİTER KARARLARI (nihai hakem akışı)
   *
   * Sunucu istemciden gelen karar listesine güvenmez:
   *   - Her karar, başvurunun KAYITLI son AI analizindeki görünür (PDF)
   *     kriterlerden birine ait olmalıdır; başka başvurunun veya eski kriter
   *     sürümünün kararı kabul edilmez (tazelik yukarıda ayrıca doğrulanır).
   *   - Ret; gerekçe + dayanak türü (+ sayfa/alıntı ya da aranan içerik) ister.
   *   - Genel karar, bütün kriterler sonuçlanmadan verilemez.
   *   - Karar damgası (decidedBy/decidedAt) sunucuda atılır.
   */
  const visibleFindings = evaluation ? visibleFindingsOf(evaluation) : [];
  if (review.criterionDecisions?.length && !evaluation) {
    throw new ConflictError("Kriter kararları için başvurunun kayıtlı AI analizi bulunamadı; önce analizi çalıştırın.");
  }
  if (review.criterionDecisions) {
    const decisionError = validateCriterionDecisions(visibleFindings, review.criterionDecisions, completed);
    if (decisionError) throw new ConflictError(decisionError);
    await verifyJudgeQuotes(before.file_key, review.criterionDecisions);
    /*
     * SUNUCU DAMGASI: decidedBy/decidedAt İSTEMCİDEN ALINMAZ (sahtelenebilirdi);
     * karar anı sunucu saatiyle yazılır. AI ön değerlendirmesi de istemcinin
     * gönderdiği değerden değil, KAYITLI bulgudan yeniden türetilir — aksi
     * hâlde "AI Olumsuz → Hakem Onay" sapması denetim izinden gizlenebilirdi.
     */
    const findingById = new Map(visibleFindings.map((finding) => [finding.criterionId, finding]));
    review = {
      ...review,
      criterionDecisions: review.criterionDecisions.map((decision) => {
        const finding = findingById.get(decision.criterionId);
        const aiVerdict = finding ? aiVerdictOf(finding.verdict) : decision.aiVerdict;
        return decision.judgeVerdict === "pending"
          ? { ...decision, aiVerdict, judgeResult: null, decidedBy: null, decidedAt: null }
          : decision.judgeVerdict === "approved"
            // Onayda kesin sonuç AI'nindir; hakem sonucu alanı taşınmaz.
            ? { ...decision, aiVerdict, judgeResult: null, decidedBy: judge.id, decidedAt: timestamp }
            : { ...decision, aiVerdict, decidedBy: judge.id, decidedAt: timestamp };
      }),
    };
  } else if (completed && visibleFindings.length) {
    // Yeni akışta AI sonucu otomatik kabul edilmez: genel karar ancak her
    // kriter için ayrı hakem kararı verildikten sonra kesinleşebilir.
    throw new ConflictError("Genel karar için önce her görünür kriter için Onay veya Ret kararı verilmelidir.");
  }
  if (completed && review.criterionDecisions?.length && !["accepted", "rejected"].includes(review.outcome)) {
    throw new ConflictError("Nihai karar yalnızca ONAY veya RET olabilir.");
  }
  /*
   * YARIŞ KORUMASI: bütün doğrulamalar yukarıdaki okuma anına aittir. Nihai
   * yazma bu yüzden koşulsuz `WHERE id = ?` OLAMAZ — araya giren bir işlem
   * (yeni belge talebi, yeniden gönderim, analiz silme) durumu değiştirdiyse
   * karar o durumu ezmemelidir. Koşul WHERE'de tutulur; ikinci ifade yalnızca
   * ilk güncelleme başarılıysa etkili olur (yeni durum üzerinden koşullanır).
   */
  /*
   * TASLAK EŞZAMANLILIĞI (madde 6): iki sekmede açık form birbirini SESSİZCE
   * ezmemelidir. İstemci, üzerine yazdığı taslağın sunucudaki damgasını
   * gönderir; damga arada değiştiyse yazma reddedilir ve hakem ne olduğunu
   * görür. Damga sunucuda atılır (istemciden alınmaz).
   */
  const storedReview = parseJson<JudgeReview>(before.review_json);
  const storedStamp = storedReview?.draftSavedAt ?? null;
  if (storedStamp && (review.draftSavedAt ?? null) !== storedStamp) {
    throw new ConflictError(
      "Bu başvurunun kriter kararları başka bir sekmede veya oturumda güncellendi; "
      + "çalışmanız yazılmadı. Sayfayı yenileyip güncel kararların üzerine devam edin.",
    );
  }
  if (before.status === "completed") {
    throw new ConflictError("Kesinleşmiş kararın üzerine taslak yazılamaz; önce kararı yeniden açın.");
  }
  const draftScope = evaluation ? {
    analyzedAt: evaluation.analyzedAt,
    pdfHash: evaluation.report.pdfHash ?? null,
    criteriaVersion: before.evaluation_criteria_version ?? null,
  } : null;
  if (review.draftScope && (!draftScope
    || review.draftScope.analyzedAt !== draftScope.analyzedAt
    || review.draftScope.pdfHash !== draftScope.pdfHash
    || review.draftScope.criteriaVersion !== draftScope.criteriaVersion)) {
    throw new ConflictError("Analiz veya kriter sürümü değişti; eski taslak bu analize kaydedilemez.");
  }
  review = { ...review, draftScope, draftSavedAt: completed ? null : timestamp };
  const nextStatus = completed ? "completed" : "judge_in_review";
  const reviewBatch = await database.batch([database.prepare(
    `UPDATE competition_applications
     SET status = ?, review_json = ?, judge_id = ?, judge_name = ?, updated_at = ?, completed_at = ?
     WHERE id = ? AND status IN ('awaiting_judge', 'judge_in_review')
       AND status = ? AND review_json IS ? AND file_key IS ?
       AND assigned_judge_id IS ? AND evaluation_criteria_version IS ?
       AND json_extract(evaluation_json, '$.analyzedAt') IS ?
       AND NOT EXISTS (SELECT 1 FROM competitions c
         WHERE c.competition_key = competition_applications.competition_key AND c.decisions_locked = 1)`,
  ).bind(
    nextStatus,
    JSON.stringify(review),
    judge.id,
    judge.fullName,
    timestamp,
    completed ? timestamp : null,
    id,
    before.status,
    before.review_json,
    before.file_key,
    before.assigned_judge_id,
    before.evaluation_criteria_version,
    evaluation?.analyzedAt ?? null,
  ), database.prepare(
    `INSERT INTO application_submission_details
      (application_id, applicant_full_name, team_name, outcome, outcome_note, decided_at)
     SELECT id, participant_name, participant_name, ?, ?, ?
     FROM competition_applications WHERE id = ? AND status = ? AND changes() > 0
     ON CONFLICT(application_id) DO UPDATE SET
       outcome = excluded.outcome,
       outcome_note = excluded.outcome_note,
       decided_at = excluded.decided_at`,
  ).bind(
    completed ? review.outcome : "pending",
    completed ? review.outcomeNote.trim().slice(0, 1_000) : "",
    completed ? timestamp : null,
    id,
    nextStatus,
  )]);
  if (!reviewBatch[0]?.meta.changes) {
    throw new ConflictError(
      "Başvurunun durumu bu sırada değişti (örn. yeni belge istendi veya analiz silindi); karar yazılmadı. Sayfayı yenileyip yeniden deneyin.",
    );
  }

  const events: WorkflowEventInput[] = [];
  if (before?.status === "awaiting_judge") {
    events.push({ subjectType: "application", subjectId: id, event: "judge_review_started", actor: judge, detail: "" });
  }
  events.push(...verdictAdjustmentEvents(id, judge, evaluation, review));
  if (completed) {
    events.push(...criterionDecisionEvents(id, judge, review));
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
  // Kriter kararları denetim izine de yazılır (madde 3): kim, ne zaman, kaç
  // onay/ret. Karar gerekçeleri review_json içinde saklanır; audit özet taşır.
  if (completed && review.criterionDecisions?.length) {
    const counts = judgeDecisionCounts(review.criterionDecisions);
    const rejectedNames = review.criterionDecisions
      .filter((decision) => decision.judgeVerdict === "rejected")
      .map((decision) => decision.criterionName);
    await recordAudit({
      actorId: judge.id,
      actorEmail: judge.email,
      actorRole: judge.roleCode,
      action: "judge_criterion_decisions",
      targetType: "competition_application",
      targetId: id,
      detail: `Kesinleşen: ${counts.uygun} uygun · ${counts.olumsuz} olumsuz · toplam ${counts.total} PDF kriteri`
        + ` · AI bulgusu: ${counts.findingsApproved} onaylandı, ${counts.findingsRejected} reddedildi`
        + (rejectedNames.length ? ` · bulgusu reddedilen: ${rejectedNames.slice(0, 5).join(", ")}` : ""),
    }).catch((auditError) => console.error("[audit] hakem kriter kararları", auditError));
  }
}

export type AttachSimilarityResult = "attached" | "unchanged" | "not_found" | "forbidden";

/**
 * GEÇ GELEN BENZERLİK SONUCUNU KAYITLI ANALİZE BAĞLAR (madde 4).
 *
 * Kriter analizi benzerliği BEKLEMEDEN kaydedilir; benzerlik kendi hızında
 * biter ve sonucunu bu işlevle kayda iliştirir. Yalnızca `similarityReport`
 * alanı yazılır:
 *   - hakem kararları (`review_json`) ve kriter kararları BAŞKA sütundadır,
 *     bu yazma onlara DOKUNMAZ;
 *   - kaydın bağlı olduğu PDF özeti okunur, benzerlik sonucu yalnızca AYNI
 *     PDF sürümü için aranır: geç gelen sonuç yeni bir analizin üzerine
 *     yazamaz;
 *   - güncelleme, okunan `evaluation_json` ile karşılaştırmalı (CAS) yapılır:
 *     arada yeni analiz kaydedilmişse satır DEĞİŞMEZ ve "unchanged" döner;
 *   - kesinleşmiş karar ve dondurulmuş yarışma korumaları aynen geçerlidir.
 */
export async function attachSimilarityToEvaluation(
  id: string,
  judge: AdminAccount,
): Promise<AttachSimilarityResult> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT a.status, a.assigned_judge_id, a.evaluation_json, a.evaluation_pdf_hash, c.decisions_locked
     FROM competition_applications a
     LEFT JOIN competitions c ON c.competition_key = a.competition_key
     WHERE a.id = ?`,
  ).bind(id).first<{
    status: string; assigned_judge_id: string | null; evaluation_json: string | null;
    evaluation_pdf_hash: string | null; decisions_locked: number | null;
  }>();
  if (!current) return "not_found";
  if (current.assigned_judge_id && current.assigned_judge_id !== judge.id) return "forbidden";
  if (current.status === "completed" || current.decisions_locked === 1) return "unchanged";
  if (!current.evaluation_json || !current.evaluation_pdf_hash) return "unchanged";
  const stored = parseJson<ReportEvaluation>(current.evaluation_json);
  if (!stored) return "unchanged";
  const report = await findSimilarityResult(id, current.evaluation_pdf_hash);
  if (!report) return "unchanged";
  const next = JSON.stringify({ ...stored, similarityReport: report });
  if (next === current.evaluation_json) return "unchanged";
  const updated = await database.prepare(
    // CAS: arada yeni analiz kaydedildiyse (evaluation_json değişti) yazma DÜŞER.
    `UPDATE competition_applications
     SET evaluation_json = ?, updated_at = ?
     WHERE id = ? AND status <> 'completed' AND evaluation_json = ?
       AND assigned_judge_id IS ? AND evaluation_pdf_hash IS ?
       AND NOT EXISTS (SELECT 1 FROM competitions c
         WHERE c.competition_key = competition_applications.competition_key AND c.decisions_locked = 1)`,
  ).bind(next, new Date().toISOString(), id, current.evaluation_json,
    current.assigned_judge_id, current.evaluation_pdf_hash).run();
  return updated.meta.changes ? "attached" : "unchanged";
}

export type DeleteAnalysisResult = "deleted" | "not_found" | "forbidden" | "completed_locked" | "nothing_to_delete";

/**
 * Hakemin "AI analizini sil" işlemi (madde 5).
 *
 * YALNIZCA AI analizi ve tamamlanmamış kriter kararları kaldırılır:
 *   - Katılımcı başvurusu, PDF'i, takım bilgileri, hakem ataması ve yarışma
 *     kaydı SİLİNMEZ.
 *   - Bu PDF sürümüne bağlı benzerlik SONUCU kaldırılır; embedding önbelleği
 *     (similarity_chunks) geçerli kalır ve yeniden analizde tekrar üretilmez.
 *   - Başvuru yeniden "AI analizi bekliyor" durumuna döner; "Yapay Zekâ
 *     Analizi Yap" düğmesi tekrar kullanılabilir.
 *   - Nihai karar kesinleşmişse önce "Kararı yeniden aç" gerekir; bu kural
 *     burada, SUNUCUDA doğrulanır.
 *
 * Denetim izi yalnızca işlemi yapanı, tarihi, başvuruyu ve işlem türünü tutar;
 * silinen AI metni denetim kaydına YAZILMAZ ve sonuç olarak yeniden kullanılamaz.
 */
export async function deleteApplicationEvaluation(id: string, actor: AdminAccount): Promise<DeleteAnalysisResult> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT status, assigned_judge_id, evaluation_json, review_json, current_version_id
     FROM competition_applications WHERE id = ?`,
  ).bind(id).first<{
    status: string; assigned_judge_id: string | null; evaluation_json: string | null;
    review_json: string | null; current_version_id: string | null;
  }>();
  if (!current) return "not_found";
  // Yalnızca atanmış hakem kendi başvurusunun analizini silebilir.
  if (actor.roleCode === "02" && current.assigned_judge_id !== actor.id) return "forbidden";
  if (current.status === "completed") return "completed_locked";
  // "analyzing" da silinebilir: tarayıcı çökmesiyle takılan analiz bu yolla
  // kurtarılır ve başvuru yeniden "AI analizi bekliyor" durumuna döner.
  if (!current.evaluation_json && !current.review_json
    && !["analysis_failed", "analyzing"].includes(current.status)) {
    return "nothing_to_delete";
  }
  const timestamp = new Date().toISOString();
  const nextStatus = current.assigned_judge_id ? "assigned" : "submitted";
  const updated = await database.prepare(
    `UPDATE competition_applications
     SET status = ?, evaluation_json = NULL, review_json = NULL,
         judge_id = NULL, judge_name = NULL,
         evaluation_criteria_version = NULL, evaluation_criteria_hash = NULL,
         evaluation_pdf_hash = NULL, evaluation_version_id = NULL,
         completed_at = NULL, updated_at = ?
     WHERE id = ? AND status <> 'completed'`,
  ).bind(nextStatus, timestamp, id).run();
  // Yarış durumu: okuma ile yazma arasında karar kesinleştiyse hiçbir şey
  // silinmez; benzerlik sonucu ve denetim kaydı da yazılmaz.
  if (!updated.meta.changes) return "completed_locked";
  // Bu başvurunun benzerlik sonucu kaldırılır (madde 9.7); parça/embedding
  // önbelleği korunur, eski benzerlik sonucu yeni analiz sonucu gibi kullanılamaz.
  await database.prepare(`DELETE FROM similarity_results WHERE application_id = ?`).bind(id).run();
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: id,
    event: "ai_analysis_deleted",
    actor,
    detail: "AI analizi ve tamamlanmamış kriter kararları hakem tarafından kaldırıldı; başvuru yeniden analiz bekliyor.",
  }).catch((eventError) => console.error("[workflow] analiz silme olayı kaydedilemedi", eventError));
  return "deleted";
}

export type ReopenReviewResult = "reopened" | "not_found" | "forbidden" | "not_completed" | "locked";

/**
 * Kesinleşmiş nihai kararı yeniden açar (madde 5).
 *
 * Karar "açık" duruma döner: başvuru `judge_in_review`, sonuç `pending` olur ve
 * yarışmacıya görünen karar kapanır. AI analizi ve kriter kararları korunur;
 * hakem isterse analiz silmeye ancak bu adımdan sonra geçebilir.
 */
export async function reopenApplicationReview(id: string, judge: AdminAccount): Promise<ReopenReviewResult> {
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT a.status, a.assigned_judge_id, a.review_json, c.decisions_locked
     FROM competition_applications a
     LEFT JOIN competitions c ON c.competition_key = a.competition_key
     WHERE a.id = ?`,
  ).bind(id).first<{
    status: string; assigned_judge_id: string | null; review_json: string | null; decisions_locked: number | null;
  }>();
  if (!current) return "not_found";
  if (judge.roleCode === "02" && current.assigned_judge_id !== judge.id) return "forbidden";
  if (current.status !== "completed") return "not_completed";
  if (current.decisions_locked === 1) return "locked";
  const stored = parseJson<JudgeReview>(current.review_json);
  const reopened: JudgeReview | null = stored
    ? { ...stored, status: "in_progress", outcome: "pending", completedAt: null }
    : null;
  const timestamp = new Date().toISOString();
  await database.batch([
    database.prepare(
      `UPDATE competition_applications
       SET status = 'judge_in_review', review_json = ?, completed_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'completed'`,
    ).bind(reopened ? JSON.stringify(reopened) : null, timestamp, id),
    database.prepare(
      `UPDATE application_submission_details
       SET outcome = 'pending', outcome_note = '', decided_at = NULL WHERE application_id = ?`,
    ).bind(id),
  ]);
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: id,
    event: "judge_review_reopened",
    actor: judge,
    detail: "Nihai karar hakem tarafından yeniden açıldı; sonuç yarışmacıya kapatıldı.",
  }).catch((eventError) => console.error("[workflow] karar yeniden açma olayı kaydedilemedi", eventError));
  return "reopened";
}

/**
 * Onaylanmış bir başvuruyu, yalnızca atanmış hakemin tamamlanmış toplu
 * benzerlik incelemesindeki somut bir rapor çifti üzerinden OLUMSUZ'a
 * çevirmesi için atomik karar kapısı. Kriter kararları ve AI analizi aynen
 * korunur; yalnız genel sonuç, gerekçe ve benzerlik denetim izi güncellenir.
 */
export async function rejectAcceptedApplicationForSimilarity(input: {
  applicationId: string;
  peerApplicationId: string;
  pairKey: string;
  percent: number;
  aiLevel: string;
  reason: string;
}, judge: AdminAccount): Promise<void> {
  const reason = input.reason.trim().slice(0, 1_000);
  if (!reason) throw new ConflictError("Projeyi olumsuza çevirmek için hakem gerekçesi zorunludur.");
  const database = await workflowDatabase();
  const current = await database.prepare(
    `SELECT a.status, a.assigned_judge_id, a.review_json, a.competition_key,
            d.outcome, c.decisions_locked
       FROM competition_applications a
       LEFT JOIN application_submission_details d ON d.application_id = a.id
       LEFT JOIN competitions c ON c.competition_key = a.competition_key
      WHERE a.id = ? AND a.deleted_at IS NULL`,
  ).bind(input.applicationId).first<{
    status: string; assigned_judge_id: string | null; review_json: string | null;
    competition_key: string; outcome: string | null; decisions_locked: number | null;
  }>();
  if (!current) throw new ConflictError("Başvuru bulunamadı.");
  if (judge.roleCode !== "02" || current.assigned_judge_id !== judge.id) {
    throw new ConflictError("Yalnızca başvuruya atanmış hakem bu sonucu değiştirebilir.");
  }
  if (current.decisions_locked === 1) {
    throw new ConflictError("Bu yarışmanın hakem kararları donduruldu; sonuç değiştirilemez.");
  }
  if (current.status !== "completed" || current.outcome !== "accepted") {
    throw new ConflictError("Yalnızca daha önce onaylanmış ve kesinleşmiş bir proje olumsuza çevrilebilir.");
  }
  const stored = parseJson<JudgeReview>(current.review_json);
  if (!stored || stored.status !== "completed" || stored.outcome !== "accepted") {
    throw new ConflictError("Başvurunun geçerli hakem onayı bulunamadı; sonuç değiştirilmedi.");
  }
  const timestamp = new Date().toISOString();
  const next: JudgeReview = {
    ...stored,
    status: "completed",
    outcome: "rejected",
    outcomeNote: reason,
    completedAt: timestamp,
    draftSavedAt: null,
    similarityDecision: {
      pairKey: input.pairKey,
      peerApplicationId: input.peerApplicationId,
      percent: Math.max(0, Math.min(100, Math.round(input.percent))),
      aiLevel: input.aiLevel.slice(0, 80),
      reason,
      decidedBy: judge.id,
      decidedAt: timestamp,
    },
  };
  const batch = await database.batch([
    database.prepare(
      `UPDATE competition_applications
          SET review_json = ?, judge_id = ?, judge_name = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'completed' AND assigned_judge_id = ? AND review_json = ?
          AND EXISTS (SELECT 1 FROM application_submission_details d
                       WHERE d.application_id = competition_applications.id AND d.outcome = 'accepted')
          AND NOT EXISTS (SELECT 1 FROM competitions c
                           WHERE c.competition_key = competition_applications.competition_key
                             AND c.decisions_locked = 1)`,
    ).bind(JSON.stringify(next), judge.id, judge.fullName, timestamp, timestamp,
      input.applicationId, judge.id, current.review_json),
    database.prepare(
      `UPDATE application_submission_details
          SET outcome = 'rejected', outcome_note = ?, decided_at = ?
        WHERE application_id = ? AND outcome = 'accepted' AND changes() > 0`,
    ).bind(reason, timestamp, input.applicationId),
  ]);
  if (!batch[0]?.meta.changes || !batch[1]?.meta.changes) {
    throw new ConflictError("Başvuru bu sırada değişti; benzerlik kararı kaydedilmedi. Sayfayı yenileyin.");
  }
  await markSimilarityResultsStale(
    current.competition_key,
    "Hakem benzerlik incelemesi sonucunda bir başvurunun kararını değiştirdi; havuzu yeniden tarayın.",
  );
  await recordWorkflowEvent({
    subjectType: "application",
    subjectId: input.applicationId,
    event: "similarity_decision_completed",
    actor: judge,
    detail: `Başvuru benzerlik incelemesi sonucunda reddedildi · yakınlık %${Math.round(input.percent)} · gerekçe: ${reason.slice(0, 400)}`,
  }).catch((eventError) => console.error("[workflow] benzerlik kararı olayı kaydedilemedi", eventError));
  await recordAudit({
    actorId: judge.id,
    actorEmail: judge.email,
    actorRole: judge.roleCode,
    action: "similarity_result_rejected",
    targetType: "competition_application",
    targetId: input.applicationId,
    detail: `eş rapor ${input.peerApplicationId} · çift ${input.pairKey} · yakınlık %${Math.round(input.percent)} · ${reason.slice(0, 400)}`,
  }).catch((auditError) => console.error("[audit] benzerlik kararı kaydedilemedi", auditError));
}

/* ------------------------------------------------------------------------- *
 * Benzerlik kayıtları (madde 9)
 *
 * Zincir daima sunucuda kurulur:
 *   applicationId → competitionKey → currentSubmissionVersion → currentPdfHash
 *   → similarity chunks/fingerprint/embedding → similarity result
 *
 * Ham rapor metni D1'e yazılmaz; parça metinleri özel R2 nesnesinde durur.
 * ------------------------------------------------------------------------- */

export type SimilarityContext = {
  applicationId: string;
  competitionKey: string;
  submissionVersionId: string | null;
  fileKey: string;
  participantLabel: string;
  /** Başvuru sahibinin hesap kimliği: aynı takımın diğer başvuruları havuza girmez (madde 8). */
  participantId: string;
  /** Şablon temizliğinde silinecek adlar: takım + başvuru sahibi + ekip üyeleri. */
  participantNames: string[];
  competitionName: string;
  assignedJudgeId: string | null;
};

/** Benzerlik işlemi için başvuru bağlamını yalnızca sunucu kaynaklarından kurar. */
export async function resolveSimilarityContext(
  applicationId: string,
  actor: AdminAccount,
): Promise<SimilarityContext | "not_found" | "forbidden"> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT a.id, a.competition_key, a.competition_name, a.assigned_judge_id, a.current_version_id,
            a.participant_id,
            COALESCE(v.file_key, a.file_key) AS file_key,
            COALESCE(d.team_name, a.participant_name) AS participant_label,
            COALESCE(d.applicant_full_name, a.participant_name) AS applicant_full_name
     FROM competition_applications a
     LEFT JOIN application_submission_details d ON d.application_id = a.id
     LEFT JOIN submission_versions v ON v.id = a.current_version_id
     WHERE a.id = ?`,
  ).bind(applicationId).first<{
    id: string; competition_key: string; competition_name: string; assigned_judge_id: string | null;
    current_version_id: string | null; participant_id: string; file_key: string;
    participant_label: string; applicant_full_name: string;
  }>();
  if (!row) return "not_found";
  if (actor.roleCode === "02" && row.assigned_judge_id !== actor.id) return "forbidden";
  const members = await database.prepare(
    `SELECT full_name FROM application_team_members WHERE application_id = ? ORDER BY member_order`,
  ).bind(applicationId).all<{ full_name: string }>();
  return {
    applicationId: row.id,
    competitionKey: row.competition_key,
    submissionVersionId: row.current_version_id,
    fileKey: row.file_key,
    participantLabel: row.participant_label,
    participantId: row.participant_id,
    participantNames: [
      row.participant_label,
      row.applicant_full_name,
      ...(members.results ?? []).map((member) => member.full_name),
    ].filter(Boolean),
    competitionName: row.competition_name,
    assignedJudgeId: row.assigned_judge_id,
  };
}

export type StoredSimilarityChunk = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  /** Parçanın bölüm başlığı; yapısal olmayan (yedek) yolda boş dizge. */
  section: string;
  wordCount: number;
  textHash: string;
  minHash: number[];
  embedding: number[] | null;
  /** Yapısal blok aralığı (paragraf/tablo konumu, madde 4); yedek yolda 0. */
  blockStart: number;
  blockEnd: number;
  /** Tablo satırlarından üretilen parçalar ayrı işaretlenir (tablolar atılmaz). */
  kind: "text" | "table";
  /** Resmî şablon parçası: karşılaştırmaya girmez ama SİLİNMEZ (denetim, madde 3). */
  isTemplate: boolean;
  /** Üretim anındaki şablon sürümü; yalnızca denetim (önbellek anahtarına girmez). */
  templateVersion: number | null;
  /** Kelime akışı başlangıcı (madde 6 aralık hesabı); eski satırlarda null. */
  wordStart: number | null;
  /** Doğrulama özellikleri (madde 5 · Katman 2); eski satırlarda null. */
  features: SimilarityChunkFeatures | null;
  /** 64 bit işaret izi (madde 8 · CPU koruması); eski satırlarda null. */
  sketch: string | null;
  /** D1 satır kimliği; yalnızca iz geri yazımı için okunur (isteğe bağlı). */
  rowId?: string;
};

/**
 * Embedding önbelleği okuması: aynı PDF sürümü + özet + model + boru hattı
 * sürümü için kayıtlı parçalar varsa embedding API'si YENİDEN ÇAĞRILMAZ.
 *
 * Anahtara ŞABLON SÜRÜMÜ dahil DEĞİLDİR (kullanıcı kararı): şablon değişimi
 * yalnızca benzerlik SONUÇLARINI eskitir; parça/embedding önbelleği yerinde
 * kalır ve şablon işaretleri okuyan taraf güncel şablonla yeniden hesaplar.
 */
export async function findStoredSimilarityChunks(input: {
  submissionVersionId: string;
  pdfHash: string;
  embeddingModel: string;
  pipelineVersion: string;
}): Promise<StoredSimilarityChunk[] | null> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT id, chunk_index, page_start, page_end, section, word_count, text_hash, min_hash_json,
            embedding_json, embedding_model, block_start, block_end, chunk_kind,
            is_template, template_version, word_start, feature_json, embedding_sketch
     FROM similarity_chunks
     WHERE submission_version_id = ? AND pdf_hash = ? AND pipeline_version = ?
     ORDER BY chunk_index ASC`,
  ).bind(input.submissionVersionId, input.pdfHash, input.pipelineVersion).all<SimilarityChunkRow>();
  const rows = result.results ?? [];
  if (!rows.length) return null;
  return rows.map((row) => toStoredSimilarityChunk(row, input.embeddingModel));
}

type SimilarityChunkRow = {
  id: string; chunk_index: number; page_start: number; page_end: number; section: string | null;
  word_count: number; text_hash: string; min_hash_json: string;
  embedding_json: string | null; embedding_model: string | null;
  block_start: number | null; block_end: number | null; chunk_kind: string | null;
  is_template: number | null; template_version: number | null;
  word_start: number | null; feature_json: string | null; embedding_sketch: string | null;
};

/** Ortak satır eşlemesi; `embeddingModel` verilirse farklı modelin vektörü null okunur. */
function toStoredSimilarityChunk(row: SimilarityChunkRow, embeddingModel?: string): StoredSimilarityChunk {
  return {
    chunkIndex: Number(row.chunk_index) || 0,
    pageStart: Number(row.page_start) || 1,
    pageEnd: Number(row.page_end) || 1,
    section: row.section ?? "",
    wordCount: Number(row.word_count) || 0,
    textHash: row.text_hash,
    minHash: parseJson<number[]>(row.min_hash_json) ?? [],
    // Farklı embedding modellerinin vektörleri birbiriyle karşılaştırılmaz.
    embedding: embeddingModel === undefined || row.embedding_model === embeddingModel
      ? parseJson<number[]>(row.embedding_json) : null,
    blockStart: Number(row.block_start) || 0,
    blockEnd: Number(row.block_end) || 0,
    kind: row.chunk_kind === "table" ? "table" : "text",
    isTemplate: Number(row.is_template) === 1,
    templateVersion: row.template_version === null || row.template_version === undefined
      ? null : Number(row.template_version),
    wordStart: row.word_start === null || row.word_start === undefined ? null : Number(row.word_start),
    features: parseJson<SimilarityChunkFeatures>(row.feature_json),
    sketch: row.embedding_sketch ?? null,
    rowId: row.id,
  };
}

/** Parça kayıtlarını (embedding önbelleği) bu PDF sürümü için yazar; eski sürüm satırları temizlenir. */
export async function saveSimilarityChunks(input: {
  applicationId: string;
  submissionVersionId: string;
  competitionKey: string;
  pdfHash: string;
  pipelineVersion: string;
  embeddingModel: string | null;
  embeddingDim: number | null;
  /** Üretim anındaki resmî şablon sürümü; yalnızca denetim damgası (madde 3). */
  templateVersion: number | null;
  chunks: StoredSimilarityChunk[];
}): Promise<void> {
  const database = await workflowDatabase();
  const timestamp = new Date().toISOString();
  // Eski embedding yeni PDF için KULLANILMAZ: başvurunun önceki sürüm satırları
  // silinir; yalnızca geçerli sürümün parçaları havuzda kalır.
  // Never delete a newer version if an older preparation finishes late.
  await database.prepare(`DELETE FROM similarity_chunks WHERE application_id = ? AND submission_version_id = ?`)
    .bind(input.applicationId, input.submissionVersionId).run();
  if (!input.chunks.length) return;
  const statements = input.chunks.map((chunk) => database.prepare(
    `INSERT INTO similarity_chunks
      (id, application_id, submission_version_id, competition_key, pdf_hash, chunk_index,
       page_start, page_end, section, word_count, text_hash, min_hash_json,
       embedding_json, embedding_model, embedding_dim, pipeline_version, created_at,
       template_version, block_start, block_end, chunk_kind, is_template, word_start, feature_json,
       embedding_sketch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `${input.submissionVersionId}:${input.pipelineVersion}:${chunk.chunkIndex}`,
    input.applicationId,
    input.submissionVersionId,
    input.competitionKey,
    input.pdfHash,
    chunk.chunkIndex,
    chunk.pageStart,
    chunk.pageEnd,
    chunk.section,
    chunk.wordCount,
    chunk.textHash,
    JSON.stringify(chunk.minHash),
    chunk.embedding ? JSON.stringify(chunk.embedding) : null,
    chunk.embedding ? input.embeddingModel : null,
    chunk.embedding ? input.embeddingDim : null,
    input.pipelineVersion,
    timestamp,
    input.templateVersion,
    chunk.blockStart,
    chunk.blockEnd,
    chunk.kind,
    chunk.isTemplate ? 1 : 0,
    chunk.wordStart,
    chunk.features ? JSON.stringify(chunk.features) : null,
    chunk.sketch ?? null,
  ));
  // D1 tek batch'te sınırlı ifade kabul eder; parçalar dilimlenerek yazılır.
  for (let start = 0; start < statements.length; start += 20) {
    await database.batch(statements.slice(start, start + 20));
  }
}

export type SimilarityPeerChunks = {
  applicationId: string;
  participantLabel: string;
  submissionVersionId: string;
  assignedJudgeId: string | null;
  chunks: StoredSimilarityChunk[];
};

/**
 * Karşılaştırma havuzu (madde 9.2): yalnızca AYNI yarışma anahtarındaki
 * (ad + yıl + aşama) diğer başvuruların GEÇERLİ PDF sürümlerine ait parçalar.
 *
 *   - Başvuru kendisiyle karşılaştırılmaz.
 *   - Eski PDF sürümleri havuza girmez (yalnızca current_version_id eşleşir).
 *   - Arşivlenmiş başvurular ve arşivlenmiş yarışmalar havuza girmez.
 */
type PeerChunkJoinRow = SimilarityChunkRow & {
  application_id: string;
  submission_version_id: string;
  assigned_judge_id: string | null;
  participant_label: string;
};

/** Eş satırlarını başvuru başına gruplar; şablon işareti eşin kendi damgasıdır. */
function groupPeerChunkRows(rows: PeerChunkJoinRow[]): SimilarityPeerChunks[] {
  const byApplication = new Map<string, SimilarityPeerChunks>();
  for (const row of rows) {
    const entry = byApplication.get(row.application_id) ?? {
      applicationId: row.application_id,
      participantLabel: row.participant_label,
      submissionVersionId: row.submission_version_id,
      assignedJudgeId: row.assigned_judge_id,
      chunks: [],
    };
    // Eşin kendi koşusunda damgalanmış şablon işareti: eş yeniden analiz
    // edilene kadar geçerli sinyaldir; çoğunluk sezgisiyle OR'lanır.
    entry.chunks.push(toStoredSimilarityChunk(row));
    byApplication.set(row.application_id, entry);
  }
  return [...byApplication.values()];
}

const PEER_CHUNK_SELECT = `SELECT s.id, s.application_id, s.submission_version_id, s.chunk_index,
        s.page_start, s.page_end, s.section, s.word_count, s.text_hash, s.min_hash_json,
        s.embedding_json, s.embedding_model, s.block_start, s.block_end, s.chunk_kind,
        s.is_template, s.template_version, s.word_start, s.feature_json, s.embedding_sketch,
        a.assigned_judge_id,
        COALESCE(d.team_name, a.participant_name) AS participant_label
 FROM similarity_chunks s
 INNER JOIN competition_applications a
   ON a.id = s.application_id AND a.current_version_id = s.submission_version_id
 LEFT JOIN application_submission_details d ON d.application_id = a.id`;

export async function listPeerSimilarityChunks(
  competitionKey: string,
  excludeApplicationId: string,
  pipelineVersion: string,
): Promise<SimilarityPeerChunks[]> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `${PEER_CHUNK_SELECT}
     WHERE s.competition_key = ? AND s.application_id <> ? AND s.pipeline_version = ?
       AND a.deleted_at IS NULL
     ORDER BY s.application_id, s.chunk_index ASC`,
  ).bind(competitionKey, excludeApplicationId, pipelineVersion).all<PeerChunkJoinRow>();
  return groupPeerChunkRows(result.results ?? []);
}

/** Havuz sıralamasında kullanılan eş başvuru künyesi (madde 8). */
export type SimilarityPeerApp = {
  applicationId: string;
  participantLabel: string;
  submissionVersionId: string;
  assignedJudgeId: string | null;
};

/**
 * Karşılaştırma havuzundaki eş başvuruların KÜNYE listesi (madde 8):
 * parça yükü olmadan, kararlı `application_id` sırasıyla ve üst sınırla.
 *
 *   - Yalnızca aynı yarışma anahtarındaki GEÇERLİ PDF sürümleri (current join).
 *   - Arşivlenmiş başvurular dışarıda (deleted_at IS NULL).
 *   - AYNI TAKIMIN başka başvurusu "farklı takım benzerliği" SAYILMAZ:
 *     aynı katılımcı hesabının (participant_id) diğer başvuruları havuza girmez.
 */
export async function listSimilarityPeerApps(
  competitionKey: string,
  excludeApplicationId: string,
  excludeParticipantId: string | null,
  pipelineVersion: string,
  limit: number,
): Promise<SimilarityPeerApp[]> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT DISTINCT s.application_id, s.submission_version_id, a.assigned_judge_id,
            COALESCE(d.team_name, a.participant_name) AS participant_label
     FROM similarity_chunks s
     INNER JOIN competition_applications a
       ON a.id = s.application_id AND a.current_version_id = s.submission_version_id
     LEFT JOIN application_submission_details d ON d.application_id = a.id
     WHERE s.competition_key = ? AND s.application_id <> ? AND s.pipeline_version = ?
       AND a.deleted_at IS NULL AND (? = '' OR a.participant_id <> ?)
     ORDER BY s.application_id ASC
     LIMIT ?`,
  ).bind(
    competitionKey, excludeApplicationId, pipelineVersion,
    excludeParticipantId ?? "", excludeParticipantId ?? "", Math.max(1, limit),
  ).all<{
    application_id: string; submission_version_id: string;
    assigned_judge_id: string | null; participant_label: string;
  }>();
  return (result.results ?? []).map((row) => ({
    applicationId: row.application_id,
    participantLabel: row.participant_label,
    submissionVersionId: row.submission_version_id,
    assignedJudgeId: row.assigned_judge_id,
  }));
}

/** D1 IN(...) sorgularının parametre üst sınırı; sorgu bu dilimlerle bölünür. */
const SIMILARITY_ID_SLICE = 40;

/**
 * Havuz istatistik geçişi (madde 8): şablon çoğunluk sezgisi ve havuz-ortak
 * özellik süzgeci için parça META verisi okunur — embedding vektörleri
 * YÜKLENMEZ (bellek koruması). Sonuç: başvuru başına (textHash, features) listesi.
 */
export async function listSimilarityPoolStats(
  applicationIds: string[],
  pipelineVersion: string,
): Promise<Map<string, Array<{ textHash: string; features: SimilarityChunkFeatures | null }>>> {
  const database = await workflowDatabase();
  const byApplication = new Map<string, Array<{ textHash: string; features: SimilarityChunkFeatures | null }>>();
  for (let start = 0; start < applicationIds.length; start += SIMILARITY_ID_SLICE) {
    const slice = applicationIds.slice(start, start + SIMILARITY_ID_SLICE);
    const placeholders = slice.map(() => "?").join(", ");
    const result = await database.prepare(
      `SELECT s.application_id, s.text_hash, s.feature_json
       FROM similarity_chunks s
       INNER JOIN competition_applications a
         ON a.id = s.application_id AND a.current_version_id = s.submission_version_id
       WHERE s.pipeline_version = ? AND a.deleted_at IS NULL
         AND s.application_id IN (${placeholders})`,
    ).bind(pipelineVersion, ...slice).all<{
      application_id: string; text_hash: string; feature_json: string | null;
    }>();
    for (const row of result.results ?? []) {
      const list = byApplication.get(row.application_id) ?? [];
      list.push({ textHash: row.text_hash, features: parseJson<SimilarityChunkFeatures>(row.feature_json) });
      byApplication.set(row.application_id, list);
    }
  }
  return byApplication;
}

/** Parti başına tam parça yükü okunan en fazla başvuru (D1 yanıt boyutu koruması). */
const SIMILARITY_CHUNK_QUERY_APPS = 5;

/**
 * Verilen eş başvuruların TAM parça satırları (embedding dahil); parti
 * döngüsünün tek pahalı okumasıdır ve başvuru dilimleriyle sınırlanır (madde 8).
 */
export async function listSimilarityChunkBatch(
  competitionKey: string,
  applicationIds: string[],
  pipelineVersion: string,
): Promise<SimilarityPeerChunks[]> {
  const database = await workflowDatabase();
  const rows: PeerChunkJoinRow[] = [];
  for (let start = 0; start < applicationIds.length; start += SIMILARITY_CHUNK_QUERY_APPS) {
    const slice = applicationIds.slice(start, start + SIMILARITY_CHUNK_QUERY_APPS);
    const placeholders = slice.map(() => "?").join(", ");
    const result = await database.prepare(
      `${PEER_CHUNK_SELECT}
       WHERE s.competition_key = ? AND s.pipeline_version = ?
         AND a.deleted_at IS NULL AND s.application_id IN (${placeholders})
       ORDER BY s.application_id, s.chunk_index ASC`,
    ).bind(competitionKey, pipelineVersion, ...slice).all<PeerChunkJoinRow>();
    rows.push(...(result.results ?? []));
  }
  return groupPeerChunkRows(rows);
}

export type BulkSimilarityPoolEntry = {
  applicationId: string;
  submissionVersionId: string;
  participantLabel: string;
  participantId: string | null;
  assignedJudgeId: string | null;
  prepared: boolean;
};

/** Nihai olarak ONAYLANMIŞ güncel raporlar ve karşılaştırma verilerinin hazırlık durumu. */
export async function listBulkSimilarityPool(
  competitionKey: string,
  pipelineVersion: string,
): Promise<BulkSimilarityPoolEntry[]> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT a.id, a.current_version_id, a.assigned_judge_id, a.participant_id,
            COALESCE(d.team_name, a.participant_name) AS participant_label,
            CASE WHEN EXISTS (
              SELECT 1 FROM similarity_chunks s
               WHERE s.application_id = a.id
                 AND s.submission_version_id = a.current_version_id
                 AND s.pipeline_version = ?
            ) THEN 1 ELSE 0 END AS prepared
       FROM competition_applications a
       LEFT JOIN application_submission_details d ON d.application_id = a.id
       WHERE a.competition_key = ? AND a.deleted_at IS NULL
          AND a.status = 'completed' AND d.outcome = 'accepted'
          AND a.current_version_id IS NOT NULL
       ORDER BY a.id`,
  ).bind(pipelineVersion, competitionKey).all<{
    id: string; current_version_id: string; assigned_judge_id: string | null;
    participant_label: string; participant_id: string | null; prepared: number;
  }>();
  return (result.results ?? []).map((row) => ({
    applicationId: row.id,
    submissionVersionId: row.current_version_id,
    participantLabel: row.participant_label,
    participantId: row.participant_id,
    assignedJudgeId: row.assigned_judge_id,
    prepared: Number(row.prepared) === 1,
  }));
}

/**
 * İşaret izi geri yazımı (madde 8): kayıtlı vektörden ÜCRETSİZ üretilen iz,
 * bir sonraki koşuda yeniden hesaplanmasın diye satıra işlenir. YALNIZCA
 * embedding_sketch günceller; embedding vektörüne asla dokunmaz.
 */
export async function saveSimilarityChunkSketches(
  entries: Array<{ rowId: string; sketch: string }>,
): Promise<void> {
  if (!entries.length) return;
  const database = await workflowDatabase();
  const statements = entries.map((entry) => database.prepare(
    `UPDATE similarity_chunks SET embedding_sketch = ? WHERE id = ? AND embedding_sketch IS NULL`,
  ).bind(entry.sketch, entry.rowId));
  for (let start = 0; start < statements.length; start += 20) {
    await database.batch(statements.slice(start, start + 20));
  }
}

/* --------------------- Yarım kalan benzerlik koşusu (madde 8) --------------------- */

export type SimilarityRunState = {
  id: string;
  applicationId: string;
  pdfHash: string;
  competitionKey: string;
  pipelineVersion: string;
  /** İşlenen SON eş başvurunun kimliği; devam bundan SONRAKİ eşlerle başlar. */
  cursorApplicationId: string;
  processedPeers: number;
  totalPeers: number;
  poolTruncated: boolean;
  /** Şimdiye dek görülen en iyi eş sonucu (rota kendi biçiminde saklar). */
  bestJson: string;
};

/** Sahipsiz koşular bu süreden sonra geçersiz sayılır ve silinir. */
const SIMILARITY_RUN_TTL_MS = 30 * 60 * 1000;

/** Başvurunun açık benzerlik koşusu; süresi dolmuşsa silinir ve null döner. */
export async function findSimilarityRun(applicationId: string): Promise<SimilarityRunState | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT id, application_id, pdf_hash, competition_key, pipeline_version,
            cursor_application_id, processed_peers, total_peers, pool_truncated,
            best_json, updated_at
     FROM similarity_runs WHERE application_id = ?`,
  ).bind(applicationId).first<{
    id: string; application_id: string; pdf_hash: string; competition_key: string;
    pipeline_version: string; cursor_application_id: string; processed_peers: number;
    total_peers: number; pool_truncated: number; best_json: string; updated_at: string;
  }>();
  if (!row) return null;
  const age = Date.now() - Date.parse(row.updated_at);
  if (!Number.isFinite(age) || age > SIMILARITY_RUN_TTL_MS) {
    await deleteSimilarityRun(applicationId).catch(() => undefined);
    return null;
  }
  return {
    id: row.id,
    applicationId: row.application_id,
    pdfHash: row.pdf_hash,
    competitionKey: row.competition_key,
    pipelineVersion: row.pipeline_version,
    cursorApplicationId: row.cursor_application_id ?? "",
    processedPeers: Number(row.processed_peers) || 0,
    totalPeers: Number(row.total_peers) || 0,
    poolTruncated: Number(row.pool_truncated) === 1,
    bestJson: row.best_json ?? "null",
  };
}

/** Koşu ilerlemesini yazar (başvuru başına tek satır; upsert). */
export async function upsertSimilarityRun(state: SimilarityRunState): Promise<void> {
  const database = await workflowDatabase();
  const timestamp = new Date().toISOString();
  await database.prepare(
    `INSERT INTO similarity_runs
      (id, application_id, pdf_hash, competition_key, pipeline_version,
       cursor_application_id, processed_peers, total_peers, pool_truncated,
       best_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(application_id) DO UPDATE SET
       id = excluded.id,
       pdf_hash = excluded.pdf_hash,
       competition_key = excluded.competition_key,
       pipeline_version = excluded.pipeline_version,
       cursor_application_id = excluded.cursor_application_id,
       processed_peers = excluded.processed_peers,
       total_peers = excluded.total_peers,
       pool_truncated = excluded.pool_truncated,
       best_json = excluded.best_json,
       updated_at = excluded.updated_at`,
  ).bind(
    state.id, state.applicationId, state.pdfHash, state.competitionKey, state.pipelineVersion,
    state.cursorApplicationId, state.processedPeers, state.totalPeers, state.poolTruncated ? 1 : 0,
    state.bestJson, timestamp, timestamp,
  ).run();
}

/** Koşu kaydını siler (tamamlanma ya da yeni analiz başlangıcı). */
export async function deleteSimilarityRun(applicationId: string): Promise<void> {
  const database = await workflowDatabase();
  await database.prepare(`DELETE FROM similarity_runs WHERE application_id = ?`).bind(applicationId).run();
}

/**
 * Bu başvurunun, verilen PDF özetine bağlı YETKİLİ benzerlik sonucu.
 *
 * Kaydedilen AI değerlendirmesindeki `similarityReport` alanı istemciden
 * gelen kopya DEĞİL, bu satırdan yazılır: hakem istemcisi benzerlik notunu
 * silemez, yumuşatamaz veya sahteleyemez. "AI analizini sil" satırı kaldırdığı
 * için silinmiş sonuç da yeniden kullanılamaz.
 */
export async function findSimilarityResult(
  applicationId: string,
  pdfHash: string,
): Promise<SimilarityReport | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT report_json, is_stale, stale_reason, template_version, competition_key
     FROM similarity_results
     WHERE application_id = ? AND pdf_hash = ?
     ORDER BY analyzed_at DESC LIMIT 1`,
  ).bind(applicationId, pdfHash).first<{
    report_json: string; is_stale: number | null; stale_reason: string | null;
    template_version: number | null; competition_key: string;
  }>();
  if (!row) return null;
  const report = parseJson<SimilarityReport>(row.report_json);
  if (!report) return null;
  /*
   * "Güncel değil" işareti (madde 3): satırdaki bayrak esas alınır; kemer-askı
   * olarak sonucun şablon sürümü güncel şablonla da karşılaştırılır (toplu
   * UPDATE bir nedenle atlanmışsa bile eski sonuç güncel gibi görünmez).
   * Eski report_json kayıtları alan eklenmeden aynen döner.
   */
  let stale = Number(row.is_stale) === 1;
  let staleReason = row.stale_reason ?? "";
  if (!stale) {
    const current = await findCurrentSimilarityTemplate(row.competition_key).catch(() => null);
    const currentVersion = current?.version ?? null;
    const resultVersion = row.template_version === null || row.template_version === undefined
      ? null : Number(row.template_version);
    if (currentVersion !== resultVersion) {
      stale = true;
      staleReason = "Resmî şablon sürümü değişti; benzerlik analizini yenileyin.";
    }
  }
  return stale
    ? { ...report, stale: true, staleReason: staleReason || "Benzerlik sonucu güncel değil; analizi yenileyin." }
    : report;
}

export type BulkSimilarityResultEntry = {
  applicationId: string;
  closestApplicationId: string | null;
  submissionVersionId: string;
  participantLabel: string;
  assignedJudgeId: string | null;
  report: SimilarityReport;
};

/** Current-PDF mathematical results; stale rows remain visible for cross-report pair discovery. */
export async function listBulkSimilarityResults(
  competitionKey: string,
  pipelineVersion: string,
): Promise<BulkSimilarityResultEntry[]> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT r.application_id, r.submission_version_id, r.closest_application_id, r.report_json, a.assigned_judge_id,
            COALESCE(d.team_name, a.participant_name) AS participant_label
       FROM similarity_results r
       INNER JOIN competition_applications a
         ON a.id = r.application_id AND a.current_version_id = r.submission_version_id
       LEFT JOIN application_submission_details d ON d.application_id = a.id
       WHERE r.competition_key = ? AND r.pipeline_version = ?
         AND r.status IN ('completed', 'partial', 'stale') AND a.deleted_at IS NULL
       ORDER BY r.application_id`,
  ).bind(competitionKey, pipelineVersion).all<{
    application_id: string; submission_version_id: string; closest_application_id: string | null; report_json: string;
    assigned_judge_id: string | null; participant_label: string;
  }>();
  return (result.results ?? []).flatMap((row) => {
    const report = parseJson<SimilarityReport>(row.report_json);
    return report ? [{
      applicationId: row.application_id,
      closestApplicationId: row.closest_application_id,
      submissionVersionId: row.submission_version_id,
      participantLabel: row.participant_label,
      assignedJudgeId: row.assigned_judge_id,
      report,
    }] : [];
  });
}

/** Rapor düzeyi benzerlik sonucunu bu PDF sürümüne bağlı olarak kaydeder. */
export async function saveSimilarityResult(input: {
  applicationId: string;
  submissionVersionId: string | null;
  pdfHash: string;
  competitionKey: string;
  embeddingModel: string | null;
  embeddingDim: number | null;
  pipelineVersion: string;
  status: "completed" | "partial" | "skipped";
  approxPercent: number | null;
  closestApplicationId: string | null;
  closestLabel: string | null;
  /** Analiz anındaki resmî şablon sürümü; şablon yoksa null (madde 3). */
  templateVersion: number | null;
  reportJson: string;
}): Promise<void> {
  const database = await workflowDatabase();
  // Aynı başvurunun önceki sonucu geçersizdir; yeni sonuç tek satır olarak durur
  // ve HER ZAMAN güncel yazılır (is_stale = 0).
  await database.batch([
    database.prepare(`DELETE FROM similarity_results WHERE application_id = ?`).bind(input.applicationId),
    database.prepare(
      `INSERT INTO similarity_results
        (id, application_id, submission_version_id, pdf_hash, competition_key, minhash_version,
         embedding_model, embedding_dim, pipeline_version, status, approx_percent,
         closest_application_id, closest_label, template_version, is_stale, stale_reason,
         report_json, analyzed_at)
       VALUES (?, ?, ?, ?, ?, 'minhash-v1', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.applicationId,
      input.submissionVersionId,
      input.pdfHash,
      input.competitionKey,
      input.embeddingModel,
      input.embeddingDim,
      input.pipelineVersion,
      input.status,
      input.approxPercent,
      input.closestApplicationId,
      input.closestLabel,
      input.templateVersion,
      input.reportJson,
      new Date().toISOString(),
    ),
  ]);
}

/* ------------------------------------------------------------------------- *
 * Resmî rapor şablonu deposu (GÖREV 3 · madde 3)
 *
 * Bu şablon kriter üretmez ve rapor uygunluğu kararı vermez; YALNIZCA
 * benzerlik analizinde beklenen ortak metni ayıklar. Kriter akışının emekli
 * templateProfile alanıyla (types.ts) İLGİSİZDİR.
 *
 * Sürümleme: her içerik değişikliği yeni satır açar (version + 1); eski satır
 * is_current = 0 olur ama SİLİNMEZ (denetim). Şablon sürümü değiştiğinde aynı
 * yarışma anahtarındaki benzerlik sonuçları "güncel değil" işaretlenir;
 * embedding önbelleğine DOKUNULMAZ (kullanıcı kararı: yeniden embedding yok).
 * ------------------------------------------------------------------------- */

export type SimilarityTemplateRecord = {
  id: string;
  competitionId: string;
  competitionKey: string;
  version: number;
  pdfHash: string;
  fileKey: string;
  textKey: string;
  fileName: string;
  pageCount: number;
  wordCount: number;
  shingleCount: number;
  /** Shingle/katlama kural sürümü (similarity-text · TEMPLATE_FILTER_VERSION). */
  filterVersion: string;
  isCurrent: boolean;
  createdByName: string | null;
  createdAt: string;
};

type SimilarityTemplateRow = {
  id: string; competition_id: string; competition_key: string; version: number;
  pdf_hash: string; file_key: string; text_key: string; file_name: string;
  page_count: number; word_count: number; shingle_count: number;
  pipeline_version: string; is_current: number; created_by_name: string | null;
  created_at: string;
};

function toSimilarityTemplate(row: SimilarityTemplateRow): SimilarityTemplateRecord {
  return {
    id: row.id,
    competitionId: row.competition_id,
    competitionKey: row.competition_key,
    version: Number(row.version) || 0,
    pdfHash: row.pdf_hash,
    fileKey: row.file_key,
    textKey: row.text_key,
    fileName: row.file_name,
    pageCount: Number(row.page_count) || 0,
    wordCount: Number(row.word_count) || 0,
    shingleCount: Number(row.shingle_count) || 0,
    filterVersion: row.pipeline_version,
    isCurrent: Number(row.is_current) === 1,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

/** Yarışma satırından anahtar/ad çözümü; şablon uçları kimlikle çalışır (aynı adlı yarışmalar karışmaz). */
export async function findCompetitionKeyById(
  competitionId: string,
): Promise<{ competitionKey: string; competitionName: string; archived: boolean } | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT competition_key, competition_name, deleted_at FROM competitions WHERE id = ?`,
  ).bind(competitionId).first<{ competition_key: string; competition_name: string; deleted_at: string | null }>();
  return row
    ? { competitionKey: row.competition_key, competitionName: row.competition_name, archived: Boolean(row.deleted_at) }
    : null;
}

/** Yarışmanın GEÇERLİ resmî şablonu; yüklenmemişse null. */
export async function findCurrentSimilarityTemplate(
  competitionKey: string,
): Promise<SimilarityTemplateRecord | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT * FROM similarity_templates
     WHERE competition_key = ? AND is_current = 1
     ORDER BY version DESC LIMIT 1`,
  ).bind(competitionKey).first<SimilarityTemplateRow>();
  return row ? toSimilarityTemplate(row) : null;
}

/**
 * Yarışma havuzundaki benzerlik sonuçlarını "güncel değil" işaretler.
 *
 * ORTAK giriş noktasıdır: şablon sürümü değişimi burayı kullanır; "havuza yeni
 * rapor geldi" eskitmesi de (madde 8) AYNI kolonlar üzerinden bu işlevi
 * çağırmalıdır — ikinci bir eskitme mekanizması büyütülmez. Sonuç satırı
 * silinmez; hakem yeniden analizle tazeler.
 */
export async function markSimilarityResultsStale(
  competitionKey: string,
  reason: string,
  excludeApplicationId?: string,
): Promise<void> {
  const database = await workflowDatabase();
  if (excludeApplicationId) {
    await database.prepare(
      `UPDATE similarity_results SET is_stale = 1, stale_reason = ?
       WHERE competition_key = ? AND is_stale = 0 AND application_id <> ?`,
    ).bind(reason, competitionKey, excludeApplicationId).run();
    return;
  }
  await database.prepare(
    `UPDATE similarity_results SET is_stale = 1, stale_reason = ?
     WHERE competition_key = ? AND is_stale = 0`,
  ).bind(reason, competitionKey).run();
}

/**
 * Resmî şablonu kaydeder (madde 3).
 *
 *   - Aynı pdf_hash + aynı filtre sürümü yeniden yüklenirse sürüm ARTMAZ
 *     (idempotent; mevcut kayıt `unchanged: true` ile döner).
 *   - İçerik değiştiyse TEK batch içinde: eski satırlar is_current = 0 olur
 *     (silinmez), yeni satır version = max + 1 ile yazılır ve aynı yarışma
 *     anahtarındaki benzerlik sonuçları "güncel değil" işaretlenir.
 */
export async function saveSimilarityTemplate(input: {
  competitionId: string;
  competitionKey: string;
  pdfHash: string;
  fileKey: string;
  textKey: string;
  fileName: string;
  pageCount: number;
  wordCount: number;
  shingleCount: number;
  filterVersion: string;
  actor: AdminAccount;
}): Promise<{ template: SimilarityTemplateRecord; unchanged: boolean }> {
  const database = await workflowDatabase();
  const current = await findCurrentSimilarityTemplate(input.competitionKey);
  if (current && current.pdfHash === input.pdfHash && current.filterVersion === input.filterVersion) {
    return { template: current, unchanged: true };
  }
  const maxRow = await database.prepare(
    `SELECT COALESCE(MAX(version), 0) AS max_version FROM similarity_templates WHERE competition_key = ?`,
  ).bind(input.competitionKey).first<{ max_version: number }>();
  const version = (Number(maxRow?.max_version) || 0) + 1;
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const staleReason = `Resmî şablon sürümü değişti (v${version}); benzerlik analizini yenileyin.`;
  await database.batch([
    database.prepare(
      `UPDATE similarity_templates SET is_current = 0 WHERE competition_key = ?`,
    ).bind(input.competitionKey),
    database.prepare(
      `INSERT INTO similarity_templates
        (id, competition_id, competition_key, version, pdf_hash, file_key, text_key, file_name,
         page_count, word_count, shingle_count, pipeline_version, is_current,
         created_by, created_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(
      id, input.competitionId, input.competitionKey, version, input.pdfHash,
      input.fileKey, input.textKey, input.fileName, input.pageCount, input.wordCount,
      input.shingleCount, input.filterVersion, input.actor.id, input.actor.fullName, timestamp,
    ),
    // Şablon değişimi SONUÇLARI eskitir; parça/embedding önbelleğine dokunmaz.
    database.prepare(
      `UPDATE similarity_results SET is_stale = 1, stale_reason = ?
       WHERE competition_key = ? AND is_stale = 0`,
    ).bind(staleReason, input.competitionKey),
  ]);
  return {
    template: {
      id,
      competitionId: input.competitionId,
      competitionKey: input.competitionKey,
      version,
      pdfHash: input.pdfHash,
      fileKey: input.fileKey,
      textKey: input.textKey,
      fileName: input.fileName,
      pageCount: input.pageCount,
      wordCount: input.wordCount,
      shingleCount: input.shingleCount,
      filterVersion: input.filterVersion,
      isCurrent: true,
      createdByName: input.actor.fullName,
      createdAt: timestamp,
    },
    unchanged: false,
  };
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
  // Analiz, yarışmayı "kriter incelemesinde" olarak işaretler. Ama bu ad için
  // ZATEN yayımlanmış bir profil varsa yeni satır AÇILMAZ: modelin çıkardığı
  // yıl/aşama iki analiz arasında biraz farklı olduğunda `competitionKey` de
  // farklı çıkıyor ve aynı adla profilsiz ikinci bir satır oluşuyordu. Bu satır
  // yayımlanmış olanı gölgeleyip başvuruları reddettiriyordu.
  const published = await database.prepare(
    `SELECT 1 AS ok FROM competitions WHERE competition_name = ? AND current_profile_id IS NOT NULL LIMIT 1`,
  ).bind(result.setup.competition.slice(0, 240)).first<{ ok: number }>();
  if (!published) {
    const key = competitionKey(result.setup.competition, result.setup.year, result.setup.stage);
    await database.prepare(
      `INSERT INTO competitions
        (id, competition_key, competition_name, status, current_profile_id, decisions_locked,
         results_published_at, created_at, updated_at)
       VALUES (?, ?, ?, 'criteria_review', NULL, 0, NULL, ?, ?)
       ON CONFLICT(competition_key) DO UPDATE SET
         competition_name = excluded.competition_name,
         status = CASE WHEN competitions.status IN ('draft_criteria', 'criteria_processing', 'criteria_review') THEN 'criteria_review' ELSE competitions.status END,
         updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), key, result.setup.competition.slice(0, 240), timestamp, timestamp).run();
  }
  const row = await database.prepare(`SELECT * FROM criteria_extraction_runs WHERE id = ?`)
    .bind(id).first<ExtractionRow>();
  if (!row) throw new Error("Analiz geçmişi kaydedildi ancak geri okunamadı.");
  return toExtractionRun(row);
}

/**
 * Kalıcı analiz önbelleğinin satır üst sınırı. Amaç kayıt tutmaktır, arşiv
 * şişirmek değil: sınır aşıldığında en uzun süredir KULLANILMAYAN kayıtlar
 * silinir; sık analiz edilen şartnameler kalır.
 */
const ANALYSIS_CACHE_ROW_LIMIT = 200;

export type StoredAnalysisEntry = {
  /** Modelin şemalı ham JSON çıktısı; normalizasyon her okumada yeniden çalışır. */
  rawJson: string;
  model: string;
  pageCount: number;
  /** Bu belgenin modelle İLK analiz edildiği an. */
  createdAt: string;
};

/**
 * Aynı belge + aynı analiz yapılandırması daha önce işlendiyse kalıcı kaydı
 * döndürür. İsabet, kayıt tazeliği için `last_used_at` üzerinden işaretlenir;
 * işaretleme başarısız olsa bile sonuç döner (okuma yolunu kırmaz).
 */
export async function findStoredAnalysis(cacheKey: string): Promise<StoredAnalysisEntry | null> {
  const database = await workflowDatabase();
  const row = await database.prepare(
    `SELECT raw_json, model, page_count, created_at FROM criteria_analysis_cache WHERE cache_key = ?`,
  ).bind(cacheKey).first<{ raw_json: string; model: string; page_count: number; created_at: string }>();
  if (!row) return null;
  await database.prepare(
    `UPDATE criteria_analysis_cache SET last_used_at = ?, use_count = use_count + 1 WHERE cache_key = ?`,
  ).bind(new Date().toISOString(), cacheKey).run().catch(() => undefined);
  return {
    rawJson: row.raw_json,
    model: row.model,
    pageCount: Number(row.page_count) || 0,
    createdAt: row.created_at,
  };
}

/**
 * Bellek katmanından sunulan isabetlerde kalıcı kaydın tazeliğini işaretler.
 * Bu olmadan sık kullanılan bir belge hep bellekten servis edildiği için
 * D1'de "soğuk" görünür ve satır sınırı budaması en sıcak kaydı silebilirdi.
 */
export async function touchStoredAnalysis(cacheKey: string): Promise<void> {
  const database = await workflowDatabase();
  await database.prepare(
    `UPDATE criteria_analysis_cache SET last_used_at = ?, use_count = use_count + 1 WHERE cache_key = ?`,
  ).bind(new Date().toISOString(), cacheKey).run();
}

/**
 * Kalıcı analiz kaydını siler.
 *
 * "Yeniden analiz et" seçeneği bunu kullanır: eski (belki hatalı) sonucun
 * yerine modelin taze çıktısı gelir. Kaydın bulunmaması hata değildir.
 */
export async function deleteStoredAnalysis(cacheKey: string): Promise<void> {
  const database = await workflowDatabase();
  await database.prepare(`DELETE FROM criteria_analysis_cache WHERE cache_key = ?`).bind(cacheKey).run();
}

/** Taze analiz sonucunu kalıcı önbelleğe yazar ve satır sınırını uygular. */
export async function saveStoredAnalysis(input: {
  cacheKey: string;
  documentHash: string;
  sourceDocumentName: string;
  model: string;
  pageCount: number;
  rawJson: string;
}): Promise<void> {
  const database = await workflowDatabase();
  const timestamp = new Date().toISOString();
  await database.prepare(
    `INSERT INTO criteria_analysis_cache
      (cache_key, document_hash, source_document_name, model, page_count, raw_json, created_at, last_used_at, use_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(cache_key) DO UPDATE SET
       raw_json = excluded.raw_json,
       source_document_name = excluded.source_document_name,
       model = excluded.model,
       page_count = excluded.page_count,
       last_used_at = excluded.last_used_at`,
  ).bind(
    input.cacheKey,
    input.documentHash,
    input.sourceDocumentName.slice(0, 240),
    input.model,
    input.pageCount,
    input.rawJson,
    timestamp,
    timestamp,
  ).run();
  await database.prepare(
    `DELETE FROM criteria_analysis_cache WHERE cache_key IN (
       SELECT cache_key FROM criteria_analysis_cache
       ORDER BY last_used_at DESC
       LIMIT -1 OFFSET ?
     )`,
  ).bind(ANALYSIS_CACHE_ROW_LIMIT).run().catch(() => undefined);
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
 * Değerlendirme Yöneticisi (Rol 04) panosunun sayaçları.
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
  // "AI bekliyor" sayacı yalnızca 'submitted' değildir: hakeme atanmış ama
  // analizi başlatılmamış ('assigned'), yeniden gönderilmiş ('resubmitted') ve
  // belge beklenen dosyalar da analiz kuyruğundadır. Eski sayaç bunları
  // görmediği için pano "0 bekleyen" gösterip tıkanmayı gizliyordu.
  const aiPending = at("submitted") + at("assigned") + at("resubmitted")
    + at("analysis_failed") + at("document_reupload_requested");
  return {
    total,
    aiPending,
    aiProcessing: at("analyzing"),
    aiCompleted: at("awaiting_judge") + at("judge_in_review") + completed,
    judgePending: at("awaiting_judge"),
    judgeInReview: at("judge_in_review"),
    completed,
    failed: at("analysis_failed"),
    completionRate: total ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * Değerlendirme Yöneticisine yalnızca toplulaştırılmış katılım ve karar uyumu
 * verisi üretir. Satır kimlikleri, katılımcı adları, PDF ve serbest gerekçeler
 * bu fonksiyonun dönüş tipine hiçbir zaman girmez.
 */
export async function operationsAnalytics(
  filters: OperationsAnalyticsFilters = {},
): Promise<OperationsAnalytics> {
  const database = await workflowDatabase();
  const result = await database.prepare(
    `SELECT
       a.participant_id,
       a.competition_key,
       a.competition_name,
       a.submitted_at,
       a.evaluation_json,
       a.review_json,
       p.profile_json,
       COALESCE(a.judge_id, a.assigned_judge_id, '') AS judge_id,
       COALESCE(a.judge_name, a.assigned_judge_name, '') AS judge_name,
       COALESCE(d.outcome, 'pending') AS outcome,
       COALESCE(p.stage, '') AS profile_stage,
       COALESCE(s.education_status, pp.education_status, 'belirtilmedi') AS education_status,
       COALESCE(s.education_grade, pp.education_grade, '') AS education_grade,
       COALESCE(s.institution_name, pp.institution_name, 'Belirtilmedi') AS institution_name,
       COALESCE(s.city, pp.city, 'Belirtilmedi') AS city,
       COALESCE(s.gender, pp.gender) AS gender,
       COALESCE(s.discovery_source, pp.discovery_source, 'belirtilmedi') AS discovery_source,
       COALESCE(s.teknofest_history, pp.teknofest_history, 'belirtilmedi') AS teknofest_history,
       COALESCE(s.team_size, 1) AS team_size
     FROM competition_applications a
     LEFT JOIN application_submission_details d ON d.application_id = a.id
     LEFT JOIN application_participant_snapshots s ON s.application_id = a.id
     LEFT JOIN participant_profiles pp ON pp.account_id = a.participant_id
     LEFT JOIN competition_profiles p ON p.id = a.profile_id
     WHERE a.deleted_at IS NULL
     ORDER BY a.submitted_at DESC`,
  ).all<{
    participant_id: string;
    competition_key: string;
    competition_name: string;
    submitted_at: string;
    evaluation_json: string | null;
    review_json: string | null;
    profile_json: string | null;
    judge_id: string;
    judge_name: string;
    outcome: string;
    profile_stage: string;
    education_status: string;
    education_grade: string;
    institution_name: string;
    city: string;
    gender: string | null;
    discovery_source: string;
    teknofest_history: string;
    team_size: number;
  }>();
  const applications: AnalyticsApplicationFact[] = (result.results ?? []).map((row) => {
    const evaluation = parseJson<ReportEvaluation>(row.evaluation_json);
    const review = parseJson<JudgeReview>(row.review_json);
    const profile = parseJson<ProfileExport>(row.profile_json);
    const outcome: AnalyticsApplicationFact["outcome"] = ["accepted", "rejected", "revision_required"].includes(row.outcome)
      ? row.outcome as AnalyticsApplicationFact["outcome"]
      : "pending";
    return {
      participantId: row.participant_id,
      competitionKey: row.competition_key,
      competitionName: row.competition_name,
      year: evaluation?.profileRef.year || profile?.setup.year || row.submitted_at.slice(0, 4) || "Belirtilmedi",
      stage: evaluation?.profileRef.stage || row.profile_stage || "Belirtilmedi",
      outcome,
      teamSize: Math.max(1, Number(row.team_size) || 1),
      judgeId: row.judge_id,
      judgeName: row.judge_name,
      review,
      evaluation,
      educationStatus: row.education_status,
      educationGrade: row.education_grade,
      institutionName: row.institution_name,
      city: row.city,
      gender: row.gender,
      discoverySource: row.discovery_source,
      teknofestHistory: row.teknofest_history,
    };
  });
  const registrationResult = await database.prepare(
    `SELECT pp.account_id, pp.education_status, pp.education_grade, pp.institution_name,
            pp.city, pp.gender, pp.discovery_source, pp.teknofest_history
     FROM participant_profiles pp
     INNER JOIN admin_accounts a ON a.id = pp.account_id AND a.role_code = '03'`,
  ).all<{
    account_id: string;
    education_status: string;
    education_grade: string;
    institution_name: string;
    city: string;
    gender: string | null;
    discovery_source: string;
    teknofest_history: string;
  }>();
  const registrations: AnalyticsRegistrationFact[] = (registrationResult.results ?? []).map((row) => ({
    participantId: row.account_id,
    educationStatus: row.education_status,
    educationGrade: row.education_grade,
    institutionName: row.institution_name,
    city: row.city,
    gender: row.gender,
    discoverySource: row.discovery_source,
    teknofestHistory: row.teknofest_history,
  }));
  return buildOperationsAnalytics(applications, registrations, filters);
}
