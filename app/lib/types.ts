export type Step = 1 | 2 | 3 | 4;

export type ViolationAction = "block" | "warn" | "jury";

export type SetupData = {
  competition: string;
  category: string;
  stage: string;
  reportType: string;
  year: string;
  allowedFormats: string[];
  maxFileSizeMb: number;
  maxFileCount: number;
  defaultViolationAction: ViolationAction;
};

export type CriterionType =
  | "technical_upload"
  | "format_rule"
  | "mandatory_content"
  | "qualitative_score"
  | "elimination_review"
  | "formula"
  | "human_only";

export type EvaluationMethod = "deterministic" | "ai" | "human" | "hybrid";
export type Confidence = "high" | "medium" | "low";
export type CriterionOrigin = "document" | "manager";
export type CriterionEffect = "gate" | "score" | "penalty" | "threshold" | "advisory";

export type ScoreGroup = {
  name: string;
  scope: string;
  maxScore: number;
  minimumScore: number | null;
  sourcePage: number;
  sourceText: string;
  breakdown: string[];
};

export type ScorePlan = {
  declaredTotalScore: number | null;
  groups: ScoreGroup[];
  auditStatus: "matched" | "mismatch" | "not_declared";
  auditMessage: string;
};

export type Criterion = {
  id: string;
  name: string;
  type: CriterionType;
  maxScore: number | null;
  weight: number | null;
  required: boolean;
  violationOutcome: string;
  evaluationMethod: EvaluationMethod;
  sourcePage: number | null;
  sourceText: string;
  aiInterpretation: string;
  confidence: Confidence;
  active: boolean;
  origin: CriterionOrigin;
  /** Yeni analizlerde zorunludur; eski yerel taslaklarla uyumluluk için opsiyoneldir. */
  effect?: CriterionEffect;
  /** Kuralın ait olduğu rapor, video, teknik kontrol veya görev aşaması. */
  scope?: string;
  issue?: string;
};

/** Analiz çağrısının süre ve token gözlem verileri (maliyet takibi için). */
export type AnalysisDiagnostics = {
  totalMs: number;
  modelMs: number;
  auditMs: number;
  promptTokens: number;
  outputTokens: number;
  cached: boolean;
};

export type AnalysisResult = {
  criteria: Criterion[];
  skippedChecks: string[];
  informationalNotes: string[];
  conflicts: number;
  pageCount: number;
  provider: "demo" | "api";
  model?: string;
  analyzedAt: string;
  scorePlan?: ScorePlan;
  analysisWarnings?: string[];
  diagnostics?: AnalysisDiagnostics;
};

export type ProfileExport = {
  version: "1.0";
  status: "approved";
  /** Onay anında üretilen benzersiz kimlik; değerlendirme sonuçlarını bu profile bağlar. Eski profillerde bulunmayabilir. */
  profileId?: string;
  setup: SetupData;
  sourceDocument: {
    name: string;
    pages: number;
    analyzedAt: string;
  };
  criteria: Criterion[];
  skippedChecks: string[];
  scorePlan?: ScorePlan;
  /** Sonuçların 100 üzerinden gösterimi için normalizasyon bilgisi; orijinal puan sistemi korunur. */
  normalization?: {
    /** Belgede ilan edilen genel toplam (ör. saha görevleri dahil 315). */
    declaredTotal: number | null;
    /**
     * Bu profilde fiilen değerlendirilecek toplam. Şartname birden çok aşamayı
     * (rapor, parkur, teknik kontrol) tek belgede topluyorsa yönetici yalnızca
     * ilgili puan gruplarını kapsama alır; 100'e normalizasyon bu toplamla yapılır.
     */
    evaluationTotal?: number | null;
    /** Kapsama alınan puan gruplarının adları. Boşsa tüm gruplar dahildir. */
    includedGroups?: string[];
    normalizedTo: 100;
    formula: string;
  };
  /** Toplam puanın yanında ayrıca denetlenecek geçiş/baraj/ceza/eleme kuralları. */
  decisionRules?: {
    gates: Array<{ name: string; detail: string; sourcePage: number | null }>;
    thresholds: Array<{ name: string; detail: string; sourcePage: number | null }>;
    penalties: Array<{ name: string; detail: string; sourcePage: number | null }>;
    eliminations: Array<{ name: string; detail: string; sourcePage: number | null }>;
  };
};

/* ------------------------------------------------------------------------- *
 * Rapor Değerlendirme modülü veri sözleşmesi (P4 · sonraki aşama)
 *
 * Girdi: onaylı ProfileExport JSON'u + katılımcı raporu PDF'si.
 * Çıktı: ReportEvaluation JSON'u. Analiz motoru bu şemaya üretir;
 * ekranlar bu şemadan okur. Ayrıntı: docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md
 * ------------------------------------------------------------------------- */

/** Havuzdaki bir katılımcı raporunun yaşam döngüsü durumu. */
export type ReportStatus = "received" | "analyzing" | "analyzed" | "reviewed";

/** Ön kontrol ve bulgu durumları; "skipped" motor bağlanmadan çalıştırılamayan kontroller içindir. */
export type CheckStatus = "passed" | "warning" | "flagged" | "failed" | "skipped";

/** Katılımcı raporu içindeki kanıt referansı. */
export type EvidenceRef = {
  page: number | null;
  text: string;
};

/** MVP'nin zorunlu ön kontrol başlıkları: dosya kapısı, dil, şablon/başlık, kategori, benzerlik. */
export type PreCheckKind =
  | "file_gate"
  | "language"
  | "template"
  | "headings"
  | "category"
  | "similarity";

export type PreCheck = {
  id: string;
  kind: PreCheckKind;
  name: string;
  status: CheckStatus;
  method: EvaluationMethod;
  detail: string;
  evidence: EvidenceRef[];
};

/** Kriter bulgusunun sonucu. Sistem eleme kararı vermez; şüphede "needs_human" kullanılır. */
export type FindingStatus = "met" | "partially_met" | "not_met" | "not_found" | "needs_human";

/** Tek kriter için AI bulgusu ve puan önerisi. Nihai karar her zaman hakemdedir. */
export type CriterionFinding = {
  /** ProfileExport.criteria içindeki kriterin kimliği. */
  criterionId: string;
  /** Denetim kolaylığı için kriter adının kopyası. */
  criterionName: string;
  status: FindingStatus;
  /** Orijinal puan sisteminde öneri; belge desteklemiyorsa null. Asla uydurulmaz. */
  proposedScore: number | null;
  maxScore: number | null;
  rationale: string;
  evidence: EvidenceRef[];
  confidence: Confidence;
  /** human/hybrid yöntemli veya eleme etkili kriterlerde her zaman true. */
  requiresHuman: boolean;
};

/** Yarışmacıya gösterilecek gelişim odaklı geri bildirim. */
export type ParticipantFeedback = {
  strengths: string[];
  improvements: string[];
  suggestions: string[];
};

/** Rapor analiz çıktısının tam şeması; POST /api/evaluate-report bu JSON'u döndürür. */
export type ReportEvaluation = {
  version: "1.0";
  /** Sonucun hangi onaylı profile göre üretildiği. */
  profileRef: {
    profileId: string | null;
    competition: string;
    year: string;
    stage: string;
    reportType: string;
  };
  report: {
    name: string;
    pages: number;
    sizeBytes: number;
  };
  preChecks: PreCheck[];
  /** Profildeki her aktif kriter için tam olarak bir bulgu bulunur. */
  findings: CriterionFinding[];
  proposedTotals: {
    /** Puan önerilerinin toplamı; hiç öneri yoksa null. */
    rawScore: number | null;
    declaredTotal: number | null;
    scoredCriteria: number;
    pendingCriteria: number;
  };
  /** Hakem onayından geçmeden yarışmacıya gösterilmez. */
  feedbackDraft: ParticipantFeedback;
  analysisWarnings: string[];
  provider: "demo" | "api";
  model?: string;
  analyzedAt: string;
  diagnostics?: AnalysisDiagnostics;
};

/** Hakemin tek kriter üzerindeki nihai kararı; AI önerisinden ayrı saklanır. */
export type JudgeDecision = {
  criterionId: string;
  verdict: "pending" | "accepted" | "adjusted";
  finalScore: number | null;
  note: string;
};

/** Hakem incelemesinin bütünü. */
export type JudgeReview = {
  status: "in_progress" | "completed";
  decisions: JudgeDecision[];
  overallNote: string;
  /** Hakemin düzenlediği, yarışmacıya açılacak geri bildirim. */
  finalFeedback: ParticipantFeedback;
  feedbackApproved: boolean;
  completedAt: string | null;
};

/** Değerlendirme havuzundaki rapor kaydı; PDF dosyası IndexedDB'de kayıtla birlikte tutulur. */
export type ReportRecord = {
  id: string;
  participant: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pages: number | null;
  uploadedAt: string;
  status: ReportStatus;
  /** Yükleme anında çalıştırılan dosya kapısı kontrolleri. */
  gateChecks: PreCheck[];
  evaluation: ReportEvaluation | null;
  review: JudgeReview | null;
};
