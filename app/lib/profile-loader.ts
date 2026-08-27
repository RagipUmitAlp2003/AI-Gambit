import { isCheckStage, isCriterionVerifiability, type CheckStage, type Criterion, type CriterionVerifiability, type ProfileExport, type SetupData, type TemplateProfile } from "./types";

export const LAST_PROFILE_KEY = "kriter-atolyesi:last-profile";

const VIOLATION_ACTIONS = ["block", "warn", "jury", "unspecified"] as const;

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function resolveStoredVerifiability(
  raw: Record<string, unknown>,
  pdfStage: boolean,
  informational: boolean,
): CriterionVerifiability {
  if (isCriterionVerifiability(raw.verifiability)) return raw.verifiability;
  if (informational) return "HAKEM_KONTROLU_GEREKLI";
  return pdfStage ? "PDF_DENETLENEBILIR" : "HARICI_KANIT_GEREKLI";
}

/**
 * Eski (1.0, puanlı) profil kriterini dört aşamalı modele taşır.
 *
 * Eski tür alanı aşamayı belirler: biçim/yükleme kuralları 1. aşamaya, zorunlu
 * içerik 2. aşamaya, kalan her şey 4. aşamaya düşer. Fiziksel/haricî kapsamlı
 * (saha, canlı performans, kurul onayı) maddeler PDF aşamasında kontrol
 * edilemediği için pasif taşınır; bilgi notları da pasif kalır.
 */
export function upgradeLegacyCriterion(raw: Record<string, unknown>, index: number): Criterion {
  const type = stringOr(raw.type, "");
  const applicability = stringOr(raw.applicability, "report");
  const effect = stringOr(raw.effect, "");
  const stage: CheckStage = isCheckStage(raw.stage)
    ? raw.stage
    : type === "format_rule" || type === "technical_upload"
      ? "language_template"
      : type === "mandatory_content"
        ? "headings_content"
        : "criteria_evidence";
  const pdfStage = ["report", "upload"].includes(applicability);
  const informational = applicability === "informational" || effect === "advisory";
  const page = Number(raw.sourcePage);
  const required = typeof raw.required === "boolean"
    ? raw.required
    : ["gate", "threshold", "penalty"].includes(effect) || type === "elimination_review";
  return {
    id: stringOr(raw.id, `criterion-${index + 1}`),
    name: stringOr(raw.name, `İsimsiz kriter ${index + 1}`),
    stage,
    required,
    description: stringOr(raw.description, stringOr(raw.aiInterpretation, "Kuralın nasıl kontrol edileceğini açıklayın.")),
    violationOutcome: stringOr(raw.violationOutcome, "Belgede belirtilmemiş"),
    sourcePage: Number.isInteger(page) && page > 0 ? page : null,
    sourceText: stringOr(raw.sourceText, ""),
    // Alan eski profillerde yoktur. Eski modelin "PDF aşaması dışı" saydığı
    // (saha/fiziksel/bilgilendirme) maddeler harici kanıt olarak taşınır;
    // böylece rapor analizinde "PDF'de yok" diye ihlal üretilmez.
    verifiability: resolveStoredVerifiability(raw, pdfStage, informational),
    active: raw.active === true && pdfStage && !informational,
    origin: raw.origin === "manager" ? "manager" : "document",
  };
}

function normalizeTemplateProfile(value: unknown): TemplateProfile | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const list = (entry: unknown) => Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [];
  return {
    provided: raw.provided === true,
    name: stringOr(raw.name, ""),
    pages: Number.isFinite(Number(raw.pages)) ? Math.max(0, Math.round(Number(raw.pages))) : 0,
    requiredHeadings: list(raw.requiredHeadings),
    notes: list(raw.notes),
  };
}

/**
 * Profil JSON'unu el ile doğrular: dış bağımlılık olmadan, değerlendirme
 * ekranlarının ve analiz motorunun güvenle okuyabileceği asgari alanları denetler.
 * 1.0 sürümü (puanlı, eski model) kabul edilir ve 2.0 şekline yükseltilir;
 * puan planı, kapsam ve karar kuralı alanları düşürülür.
 */
export function validateProfileExport(value: unknown): { profile: ProfileExport | null; error: string } {
  if (typeof value !== "object" || value === null) {
    return { profile: null, error: "Dosya bir profil JSON'u değil. Kriter Atölyesi'nden indirilen dosyayı seçin." };
  }
  const candidate = value as Record<string, unknown>;
  const legacy = candidate.version === "1.0";
  if ((candidate.version !== "2.0" && !legacy) || candidate.status !== "approved") {
    return { profile: null, error: "Profil sürümü tanınmadı. Yalnızca yayımlanmış 1.0 veya 2.0 profilleri kullanılabilir." };
  }
  const setup = candidate.setup as Partial<SetupData> | undefined;
  if (typeof setup !== "object" || setup === null || typeof setup.competition !== "string") {
    return { profile: null, error: "Profilde temel ayar bilgisi eksik. Profili Kriter Atölyesi'nden yeniden indirin." };
  }
  // Ekranlar ve dosya kapısı bu alanları doğrudan kullanır; eksikliği çalışma anında çökmeye yol açar.
  const textFields: Array<keyof SetupData> = ["category", "stage", "reportType", "year"];
  if (textFields.some((field) => typeof setup[field] !== "string")) {
    return { profile: null, error: "Profilin yarışma bilgileri (kategori, aşama, rapor türü, yıl) eksik veya bozuk." };
  }
  if (!Array.isArray(setup.allowedFormats) || setup.allowedFormats.some((format) => typeof format !== "string")) {
    return { profile: null, error: "Profilde izin verilen dosya formatları tanımlı değil. Profili yeniden oluşturun." };
  }
  const numberFields: Array<keyof SetupData> = ["maxFileSizeMb", "maxFileCount"];
  if (numberFields.some((field) => !Number.isFinite(setup[field] as number) || (setup[field] as number) < 0)) {
    return { profile: null, error: "Profildeki dosya boyutu veya dosya sayısı bilgisi geçerli değil." };
  }
  if (!(VIOLATION_ACTIONS as readonly string[]).includes(setup.defaultViolationAction as string)) {
    return { profile: null, error: "Profildeki ihlal davranışı tanınmadı. Profili Kriter Atölyesi'nden yeniden indirin." };
  }
  if (!Array.isArray(candidate.criteria) || candidate.criteria.length === 0) {
    return { profile: null, error: "Profilde kriter listesi bulunamadı. Boş profil ile değerlendirme yapılamaz." };
  }
  const rawCriteria = candidate.criteria as unknown[];
  const invalid = rawCriteria.find((item) => (
    typeof item !== "object" || item === null
    || typeof (item as Record<string, unknown>).id !== "string"
    || typeof (item as Record<string, unknown>).name !== "string"
    || typeof (item as Record<string, unknown>).active !== "boolean"
    || (!legacy && (
      !isCheckStage((item as Record<string, unknown>).stage)
      || typeof (item as Record<string, unknown>).required !== "boolean"
    ))
  ));
  if (invalid) {
    return { profile: null, error: "Profildeki bazı kriter kayıtları bozuk görünüyor. Profili yeniden oluşturun." };
  }
  const sourceDocument = candidate.sourceDocument as Record<string, unknown> | undefined;
  if (typeof sourceDocument !== "object" || sourceDocument === null) {
    return { profile: null, error: "Profilde kaynak belge bilgisi eksik. Profili Kriter Atölyesi'nden yeniden indirin." };
  }
  const criteria = rawCriteria.map((item, index) => upgradeLegacyCriterion(item as Record<string, unknown>, index));
  const profile: ProfileExport = {
    version: "2.0",
    status: "approved",
    ...(typeof candidate.profileId === "string" ? { profileId: candidate.profileId } : {}),
    setup: {
      competition: setup.competition,
      category: setup.category as string,
      stage: setup.stage as string,
      reportType: setup.reportType as string,
      year: setup.year as string,
      allowedFormats: setup.allowedFormats as string[],
      maxFileSizeMb: setup.maxFileSizeMb as number,
      maxFileCount: setup.maxFileCount as number,
      defaultViolationAction: setup.defaultViolationAction as SetupData["defaultViolationAction"],
      reportLanguage: typeof setup.reportLanguage === "string" ? setup.reportLanguage : null,
    },
    sourceDocument: {
      name: stringOr(sourceDocument.name, "kaynak.pdf"),
      pages: Number.isFinite(Number(sourceDocument.pages)) ? Math.max(0, Math.round(Number(sourceDocument.pages))) : 0,
      analyzedAt: stringOr(sourceDocument.analyzedAt, ""),
      // Eski profillerde yok; bulunduğunda kaynak sayfa bağlantısını besler.
      ...(typeof sourceDocument.fileKey === "string" && sourceDocument.fileKey ? { fileKey: sourceDocument.fileKey } : {}),
    },
    templateProfile: normalizeTemplateProfile(candidate.templateProfile),
    criteria,
  };
  return { profile, error: "" };
}

/** Değerlendirme ekranlarında seçili tutulan profil; dışarıdan yüklenen profil de buraya yazılır. */
export const ACTIVE_PROFILE_KEY = "kriter-atolyesi:degerlendirme-profili";

/**
 * Değerlendirme için etkin profili okur: önce ekranda seçilmiş profil, yoksa
 * Kriter Atölyesi'nin en son yayımladığı profil.
 */
export function loadLastApprovedProfile(): ProfileExport | null {
  for (const key of [ACTIVE_PROFILE_KEY, LAST_PROFILE_KEY]) {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) continue;
      const { profile } = validateProfileExport(JSON.parse(stored));
      if (profile) return profile;
    } catch {
      // Bozuk kayıt yok sayılır; bir sonraki kaynağa geçilir.
    }
  }
  return null;
}

/** Ekranda seçilen profili bu cihazda kalıcı kılar; sayfa yenilendiğinde korunur. */
export function saveActiveProfile(profile: ProfileExport) {
  try {
    localStorage.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Depolama dolu veya kapalıysa profil yalnızca bu oturumda geçerli kalır.
  }
}

/** İndirilmiş profil JSON dosyasını okuyup doğrular. */
export async function readProfileFile(file: File): Promise<{ profile: ProfileExport | null; error: string }> {
  try {
    const parsed = JSON.parse(await file.text());
    return validateProfileExport(parsed);
  } catch {
    return { profile: null, error: "Dosya okunamadı veya geçerli bir JSON değil." };
  }
}
