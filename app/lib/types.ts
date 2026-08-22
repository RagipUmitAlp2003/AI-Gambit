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
    declaredTotal: number | null;
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
