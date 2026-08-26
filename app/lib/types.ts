export type Step = 1 | 2 | 3;

export type ViolationAction = "block" | "warn" | "jury" | "unspecified";

/** Yarışma ve teslim bilgileri; yalnızca organizatör PDF'sinden çıkarılır. */
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
  /** Şartnamenin raporda beklediği dil (ör. "Türkçe"); belge sessizse null. */
  reportLanguage?: string | null;
};

/* ------------------------------------------------------------------------- *
 * Dört aşamalı kontrol prensibi
 *
 * Şartname analizi (Kriter Atölyesi) ve rapor değerlendirmesi (Değerlendirme
 * Atölyesi) aynı dört aşamayı kullanır. Şartnameden çıkarılan her kriter bu
 * aşamalardan birine bağlanır; rapor kontrolü aşama aşama sonuç üretir.
 *
 *   1. Dil ve Şablon Uygunluğu
 *   2. Başlık ve İçerik Kontrolü
 *   3. Kategori Uygunluğu ve Benzerlik
 *   4. Kriter Bazlı Kanıt Çıkarma
 *
 * Yalnızca yarışmanın PDF (rapor) aşaması kontrol edilir. Fiziksel/saha
 * aşaması puanları ve puanlama sistemleri kriter sistemine dahil değildir.
 * ------------------------------------------------------------------------- */

export type CheckStage =
  | "language_template"
  | "headings_content"
  | "category_similarity"
  | "criteria_evidence";

export type CheckStageDefinition = {
  id: CheckStage;
  order: 1 | 2 | 3 | 4;
  title: string;
  shortTitle: string;
  detail: string;
};

export const CHECK_STAGES: readonly CheckStageDefinition[] = [
  {
    id: "language_template",
    order: 1,
    title: "Dil ve Şablon Uygunluğu",
    shortTitle: "Dil / Şablon",
    detail: "Tespit edilen dil ve şablon format uyumu.",
  },
  {
    id: "headings_content",
    order: 2,
    title: "Başlık ve İçerik Kontrolü",
    shortTitle: "Başlık / İçerik",
    detail: "Zorunlu başlıkların raporda varlığı ve altındaki içeriğin doluluğu.",
  },
  {
    id: "category_similarity",
    order: 3,
    title: "Kategori Uygunluğu ve Benzerlik",
    shortTitle: "Kategori / Benzerlik",
    detail: "Kategoriye uygunluk skoru ve başvurular arası benzerlik durumu.",
  },
  {
    id: "criteria_evidence",
    order: 4,
    title: "Kriter Bazlı Kanıt Çıkarma",
    shortTitle: "Teknik kural",
    detail: "Her teknik kural için durum (BAŞARILI / REVİZYON / KRİTİK_HATA), rapordan sayfa/paragraf numaralı doğrudan alıntı ve gerekçe.",
  },
] as const;

export const CHECK_STAGE_IDS: readonly CheckStage[] = CHECK_STAGES.map((stage) => stage.id);

export function checkStageOf(id: CheckStage): CheckStageDefinition {
  return CHECK_STAGES.find((stage) => stage.id === id) ?? CHECK_STAGES[3];
}

export function isCheckStage(value: unknown): value is CheckStage {
  return typeof value === "string" && (CHECK_STAGE_IDS as readonly string[]).includes(value);
}

/**
 * Kural bazlı durum. Şartname kriteri raporda kontrol edildiğinde yalnızca bu
 * üç sonuçtan biri verilir; güven seviyesi veya "emin değilim" durumu yoktur.
 *
 *   BASARILI     Kural karşılandı.
 *   REVIZYON     Kural eksik/kısmi karşılandı; düzeltme gerekir.
 *   KRITIK_HATA  Zorunlu kural karşılanmadı veya belgede açık ihlal var.
 */
/**
 *   BASARILI            Kural karşılandı.
 *   REVIZYON            Kural eksik/kısmi karşılandı; düzeltme gerekir.
 *   KRITIK_HATA         Zorunlu kural karşılanmadı veya belgede açık ihlal var.
 *   DEGERLENDIRILEMEDI  Kural PDF'den doğrulanamaz (video, saha, kurul kararı).
 *                       Bu durum bir İHLAL DEĞİLDİR: sayaçlarda hata sayılmaz,
 *                       aşama sonucunu kötüleştirmez ve yalnızca sunucu
 *                       tarafından, kriterin `verifiability` alanına bakılarak
 *                       atanır — model bu değeri üretemez.
 */
export type RuleVerdict = "BASARILI" | "REVIZYON" | "KRITIK_HATA" | "DEGERLENDIRILEMEDI";

export const RULE_VERDICTS: readonly RuleVerdict[] = ["BASARILI", "REVIZYON", "KRITIK_HATA", "DEGERLENDIRILEMEDI"];

/**
 * Modelin ve hakemin PDF üzerinde kullanabileceği durumlar.
 * `DEGERLENDIRILEMEDI` buraya dahil değildir; onu yalnızca sunucu atar.
 */
export const PDF_RULE_VERDICTS: readonly RuleVerdict[] = ["BASARILI", "REVIZYON", "KRITIK_HATA"];

export const RULE_VERDICT_LABELS: Record<RuleVerdict, string> = {
  BASARILI: "BAŞARILI",
  REVIZYON: "REVİZYON",
  KRITIK_HATA: "KRİTİK HATA",
  DEGERLENDIRILEMEDI: "PDF'DEN DEĞERLENDİRİLEMEZ",
};

export function isRuleVerdict(value: unknown): value is RuleVerdict {
  return typeof value === "string" && (RULE_VERDICTS as readonly string[]).includes(value);
}

export type CriterionOrigin = "document" | "manager";

/* ------------------------------------------------------------------------- *
 * Kriterin PDF'den denetlenebilirliği
 *
 * Şartname analizinde tanıtım videosu, saha videosu, canlı demo veya kurul
 * onayı gibi kurallar da kriter olarak çıkabilir. Katılımcı rapor analizi
 * YALNIZCA PDF üzerinde çalıştığı için, PDF'de video bulunmaması bir ihlal
 * DEĞİLDİR. Bu alan, kuralın hangi kanıtla doğrulanacağını söyler:
 *
 *   PDF_DENETLENEBILIR      AI kuralı rapor PDF'i üzerinde değerlendirir.
 *   HARICI_KANIT_GEREKLI    Video, saha teslimi, portal yüklemesi gibi PDF dışı
 *                           kanıt gerekir; AI olumlu/olumsuz karar VERMEZ.
 *   HAKEM_KONTROLU_GEREKLI  Takdir veya kurul kararı gerektirir; hakeme bırakılır.
 *
 * Son iki tür hiçbir koşulda otomatik olarak KRİTİK_HATA veya eksik sayılmaz.
 * ------------------------------------------------------------------------- */
export type CriterionVerifiability =
  | "PDF_DENETLENEBILIR"
  | "HARICI_KANIT_GEREKLI"
  | "HAKEM_KONTROLU_GEREKLI";

export const CRITERION_VERIFIABILITIES: readonly CriterionVerifiability[] = [
  "PDF_DENETLENEBILIR",
  "HARICI_KANIT_GEREKLI",
  "HAKEM_KONTROLU_GEREKLI",
];

export const VERIFIABILITY_LABELS: Record<CriterionVerifiability, string> = {
  PDF_DENETLENEBILIR: "PDF'den denetlenebilir",
  HARICI_KANIT_GEREKLI: "Harici kanıt gerekli",
  HAKEM_KONTROLU_GEREKLI: "Hakem kontrolü gerekli",
};

export const VERIFIABILITY_HINTS: Record<CriterionVerifiability, string> = {
  PDF_DENETLENEBILIR: "Kural rapor PDF'inin içinden doğrulanabilir; AI değerlendirir.",
  HARICI_KANIT_GEREKLI: "Video, saha teslimi veya portal yüklemesi gibi PDF dışı kanıt gerekir; AI karar vermez.",
  HAKEM_KONTROLU_GEREKLI: "Takdir veya kurul kararı gerektirir; karar hakeme bırakılır.",
};

export function isCriterionVerifiability(value: unknown): value is CriterionVerifiability {
  return typeof value === "string" && (CRITERION_VERIFIABILITIES as readonly string[]).includes(value);
}

/** AI'nin PDF üzerinden karar veremeyeceği kriter türü mü? */
export function verifiedOutsidePdf(verifiability: CriterionVerifiability): boolean {
  return verifiability !== "PDF_DENETLENEBILIR";
}

/**
 * Şartnameden çıkarılan, yarışmanın PDF aşamasında kontrol edilecek tek kural.
 * Puan, ağırlık, güven seviyesi veya değerlendirme yöntemi taşımaz; kriter ya
 * zorunludur (ihlali KRİTİK_HATA) ya da "diğer"dir (ihlali REVİZYON).
 */
export type Criterion = {
  id: string;
  name: string;
  /** Kuralın hangi aşamada kontrol edileceği. */
  stage: CheckStage;
  /** true → Zorunlu; false → Diğer. Ekranda iki ayrı bölümde listelenir. */
  required: boolean;
  /** Kuralın tek anlamlı açıklaması: koşul, raporda ne aranacağı ve sonucu. */
  description: string;
  /** Belgede yazan ihlal sonucu; yoksa "Belgede belirtilmemiş". */
  violationOutcome: string;
  /** PDF dosyasındaki 1 tabanlı sayfa sırası; belgede dayanağı yoksa null. */
  sourcePage: number | null;
  /** Kaynak sayfadan özgün dilde birebir kısa alıntı. */
  sourceText: string;
  /**
   * Kuralın hangi kanıtla doğrulanacağı (bkz. CriterionVerifiability).
   * Eski (1.0/2.0-erken) profillerde bulunmaz; okunurken PDF_DENETLENEBILIR sayılır.
   */
  verifiability: CriterionVerifiability;
  /**
   * Geriye uyumluluk alanı: YENİ profillerde her zaman `true`.
   *
   * "Pasif kriter" kavramı kaldırıldı; Kriter Atölyesi'nde aktif/pasif anahtarı
   * yoktur ve yayımlanan sette yarı etkin kriter bulunmaz — yönetici istemediği
   * kriteri siler. Alan yalnızca eski (1.0) profillerde pasif taşınmış maddeleri
   * okuyabilmek için korunur; değerlendirme motoru bu bayrağı hâlâ dikkate alır.
   */
  active: boolean;
  origin: CriterionOrigin;
};

/** Analiz çağrısının süre ve token gözlem verileri (maliyet takibi için). */
export type AnalysisDiagnostics = {
  totalMs: number;
  modelMs: number;
  promptTokens: number;
  outputTokens: number;
  cached: boolean;
  /** Belgenin Files API'ye yüklenmesi için geçen süre; satır içi gönderimde 0. */
  uploadMs?: number;
  /** Bu analizde modele yapılan üretim çağrısı sayısı (yükleme hariç). Yeni prensipte 1. */
  apiCalls?: number;
  /** PDF baytlarının ağ üzerinden kaç kez taşındığı. */
  documentTransfers?: number;
  /** Belge referansla mı gönderildi (Files API) yoksa satır içi mi? */
  documentDelivery?: "file_uri" | "inline";
  /** Önbellek isabetinin kaynağı: süreç belleği ya da D1'deki kalıcı kayıt. */
  cacheStore?: "memory" | "database";
  /** Önbellekten dönen sonucun İLK analiz zamanı; taze analizde bulunmaz. */
  firstAnalyzedAt?: string;
};

/**
 * Şablon yapısı (geriye uyumluluk).
 *
 * Ayrı resmî rapor şablonu yükleme alanı kaldırıldı: Yarışma Yöneticisi yalnızca
 * şartname PDF'si yükler. Yeni profillerde `provided` her zaman false kalır ve
 * zorunlu başlıklar 2. aşama kriterlerinden okunur (bkz. report-prechecks ·
 * requiredHeadingsOf). Alan, eski profillerde saklanmış şablon başlıklarını
 * okuyabilmek için korunur.
 */
export type TemplateProfile = {
  provided: boolean;
  name: string;
  pages: number;
  /** Şablonun ana bölüm başlıkları; zorunlu başlıklar ayrıca 2. aşama kriteri olarak listelenir. */
  requiredHeadings: string[];
  notes: string[];
};

/** POST /api/analyze cevabı: tek LLM çağrısıyla çıkarılan dört aşamalı kriter seti. */
export type AnalysisResult = {
  setup: SetupData;
  templateProfile: TemplateProfile;
  criteria: Criterion[];
  pageCount: number;
  provider: "api";
  model?: string;
  analyzedAt: string;
  analysisWarnings: string[];
  diagnostics?: AnalysisDiagnostics;
};

export type ProfileExport = {
  /** 2.0: dört aşamalı, puansız kriter modeli. 1.0 profilleri okunurken bu şekle yükseltilir. */
  version: "2.0";
  /**
   * Dışa aktarım dosyasının kendi bütünlük işareti: yarışma yöneticisi kriter
   * düzenlemesini bitirmiştir. Süreçteki YAŞAM DÖNGÜSÜ bu alan değildir;
   * yayın durumu `competition_profiles.status` sütununda tutulur
   * (bkz. workflow-types.ts · ProfileStatus).
   */
  status: "approved";
  /** Onay anında üretilen benzersiz kimlik; değerlendirme sonuçlarını bu profile bağlar. */
  profileId?: string;
  setup: SetupData;
  sourceDocument: {
    name: string;
    pages: number;
    analyzedAt: string;
    /**
     * Şartname PDF'inin R2 nesne anahtarı (yayımlarken yüklendiyse).
     *
     * Kaynak sayfa bağlantısı bunu kullanır: profil geçmişten açıldığında
     * tarayıcıdaki yerel taslak dosyası yoktur, bu yüzden kaynağa gitmenin
     * tek yolu sunucudaki kopyadır. Eski profillerde bulunmaz (isteğe bağlı).
     */
    fileKey?: string | null;
  };
  templateProfile?: TemplateProfile;
  criteria: Criterion[];
};

/* ------------------------------------------------------------------------- *
 * Rapor Değerlendirme modülü veri sözleşmesi
 *
 * Girdi: yayımlı ProfileExport JSON'u + katılımcı raporu PDF'si.
 * Çıktı: ReportEvaluation JSON'u. Analiz motoru bu şemaya üretir;
 * ekranlar bu şemadan okur. Ayrıntı: docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md
 * ------------------------------------------------------------------------- */

/** Deterministik ön kontrol durumları (dosya kapısı, benzerlik vb.). */
export type CheckStatus = "passed" | "warning" | "flagged" | "failed" | "skipped";

export type EvaluationMethod = "deterministic" | "ai" | "human" | "hybrid";

/** Katılımcı raporu içindeki kanıt referansı. */
export type EvidenceRef = {
  page: number | null;
  /** Sayfa içindeki paragraf sırası (1 tabanlı); model veremediyse null. */
  paragraph: number | null;
  /** Kanıtın bulunduğu bölüm/başlık. */
  section?: string;
  /** Rapordan doğrudan alıntı. */
  text: string;
};

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

/** Tek kriter için AI bulgusu. Nihai karar her zaman hakemdedir. */
export type CriterionFinding = {
  /** ProfileExport.criteria içindeki kriterin kimliği. */
  criterionId: string;
  /** Denetim kolaylığı için kriter adının kopyası. */
  criterionName: string;
  stage: CheckStage;
  required: boolean;
  /** Kriterin kanıt türü; PDF dışı kurallar hiçbir zaman ihlal sayılmaz. */
  verifiability: CriterionVerifiability;
  verdict: RuleVerdict;
  rationale: string;
  /** Rapordan sayfa/paragraf numaralı doğrudan alıntılar. */
  evidence: EvidenceRef[];
  /** Sistem alıntı gösteremedi; hakem kaynağı kendisi doğrulamalı. */
  evidenceMissing: boolean;
};

/** 2. aşama: zorunlu başlığın raporda varlığı ve altındaki içeriğin doluluğu. */
export type HeadingCheck = {
  heading: string;
  present: boolean;
  contentFilled: boolean;
  page: number | null;
  note: string;
};

export type SimilarityResult = {
  status: CheckStatus;
  percent: number | null;
  closestTeam: string | null;
  detail: string;
};

/** Dört aşamadan birinin bütüncül sonucu. */
export type StageResult = {
  stage: CheckStage;
  verdict: RuleVerdict;
  summary: string;
  /** 1. aşama */
  detectedLanguage?: string | null;
  expectedLanguage?: string | null;
  /** 2. aşama */
  headings?: HeadingCheck[];
  /** 3. aşama: 0–100 kategori uygunluk skoru */
  categoryScore?: number | null;
  similarity?: SimilarityResult | null;
  evidence: EvidenceRef[];
};

export type VerdictSummary = {
  total: number;
  basarili: number;
  revizyon: number;
  kritikHata: number;
  /**
   * PDF'den değerlendirilemeyen (harici kanıt / hakem kontrolü) kural sayısı.
   * Eski kayıtlarda bulunmaz; okunurken 0 sayılır. Hata sayacı DEĞİLDİR.
   */
  disiKanit?: number;
  overall: RuleVerdict;
};

/**
 * Yarışmacıya gösterilecek gelişim odaklı geri bildirim (Problem 4 · "AI 4. Göz").
 *
 * Yarışmacı portalında üç kart hâlinde görünür; alan adları veri sözleşmesinde
 * korunur, ekrandaki başlıklar `PARTICIPANT_FEEDBACK_LABELS` üzerinden okunur.
 *
 *   strengths     → Güçlü Yönler          (karşılanan kriterler)
 *   improvements  → Gelişime Açık Yönler  (hatalı kriterler ve sebepleri)
 *   suggestions   → Gelişim Önerileri     (revizyon önerileri)
 */
export type ParticipantFeedback = {
  strengths: string[];
  improvements: string[];
  suggestions: string[];
};

/** Geri bildirim kartlarının kullanıcıya görünen başlıkları — tek doğruluk kaynağı. */
export const PARTICIPANT_FEEDBACK_LABELS = {
  strengths: "Güçlü Yönler",
  improvements: "Gelişime Açık Yönler",
  suggestions: "Gelişim Önerileri",
} as const satisfies Record<keyof ParticipantFeedback, string>;

/** Kartların altındaki kısa açıklamalar. */
export const PARTICIPANT_FEEDBACK_HINTS = {
  strengths: "Raporunuzda karşılanan kriterler.",
  improvements: "Karşılanmayan kriterler ve hakem gerekçesi.",
  suggestions: "Bir sonraki sürümde düzeltmeniz önerilen noktalar.",
} as const satisfies Record<keyof ParticipantFeedback, string>;

/**
 * Yapay zekâ uyarısı — tek doğruluk kaynağı (madde 10).
 *
 * Yapay zekâ analizinin gösterildiği bütün hakem ve katılımcı ekranlarında,
 * sonucun HEMEN ALTINDA görünür. Genel sayfa altbilgisine konmaz.
 */
export const AI_DISCLAIMER =
  "Yapay zekâ tarafından üretilen analizler hata içerebilir. Nihai değerlendirme yetkili hakeme aittir.";

/** Rapor analiz çıktısının tam şeması; POST /api/evaluate-report bu JSON'u döndürür. */
export type ReportEvaluation = {
  version: "2.0";
  /** Sonucun hangi yayımlı profile göre üretildiği. */
  profileRef: {
    profileId: string | null;
    competition: string;
    year: string;
    stage: string;
    reportType: string;
    /**
     * Sonucun üretildiği DEĞİŞMEZ kriter sürümü. Kriterler yeniden
     * yayımlandığında sürüm artar ve bu sonuç eskir; ekran "Kriterler
     * güncellendi, yeniden analiz gerekli" uyarısı gösterir.
     * Eski kayıtlarda bulunmaz.
     */
    criteriaVersion?: number | null;
    criteriaHash?: string | null;
  };
  report: {
    name: string;
    pages: number;
    sizeBytes: number;
    /** Analiz edilen PDF'in SHA-256'sı; sonuç başka bir dosyaya bağlanamaz. */
    pdfHash?: string | null;
    /** Analizin yapıldığı katılımcı rapor sürümü (submission_versions.id). */
    submissionVersionId?: string | null;
  };
  /** Dosya kapısı ve havuz benzerliği gibi deterministik kontroller. */
  preChecks: PreCheck[];
  /** Dört aşamanın bütüncül sonuçları (her zaman 4 kayıt, aşama sırasıyla). */
  stages: StageResult[];
  /** Profildeki her aktif kriter için tam olarak bir bulgu bulunur. */
  findings: CriterionFinding[];
  summary: VerdictSummary;
  /** Hakem onayından geçmeden yarışmacıya gösterilmez. */
  feedbackDraft: ParticipantFeedback;
  analysisWarnings: string[];
  provider: "demo" | "api";
  model?: string;
  analyzedAt: string;
  diagnostics?: AnalysisDiagnostics;
};

/** Hakemin tek kriter üzerindeki nihai kararı; AI bulgusundan ayrı saklanır. */
export type JudgeDecision = {
  criterionId: string;
  /** pending: karar yok · accepted: AI kararı onaylandı · adjusted: hakem kararı değiştirdi. */
  verdict: "pending" | "accepted" | "adjusted";
  /** Hakemin nihai kural durumu; pending iken null. */
  finalVerdict: RuleVerdict | null;
  note: string;
};

/** Hakem incelemesinin bütünü. */
export type JudgeReview = {
  status: "in_progress" | "completed";
  /** Başvurunun hakem tarafından kesinleştirilen genel sonucu. */
  outcome: "pending" | "accepted" | "rejected" | "revision_required";
  /** Sonucun yarışmacıya gösterilebilen kısa açıklaması. */
  outcomeNote: string;
  decisions: JudgeDecision[];
  overallNote: string;
  /** Hakemin düzenlediği, yarışmacıya açılacak geri bildirim. */
  finalFeedback: ParticipantFeedback;
  feedbackApproved: boolean;
  completedAt: string | null;
};
