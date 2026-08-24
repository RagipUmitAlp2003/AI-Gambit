import type { ProfileExport } from "./types";

export const LAST_PROFILE_KEY = "kriter-atolyesi:last-profile";

/**
 * Onaylı profil JSON'unu el ile doğrular: dış bağımlılık olmadan, değerlendirme
 * ekranlarının ve analiz motorunun güvenle okuyabileceği asgari alanları denetler.
 * Eski profillerdeki opsiyonel alanlar (effect, scorePlan, profileId) tolere edilir.
 */
export function validateProfileExport(value: unknown): { profile: ProfileExport | null; error: string } {
  if (typeof value !== "object" || value === null) {
    return { profile: null, error: "Dosya bir profil JSON'u değil. Kriter Atölyesi'nden indirilen dosyayı seçin." };
  }
  const candidate = value as Partial<ProfileExport>;
  if (candidate.version !== "1.0" || candidate.status !== "approved") {
    return { profile: null, error: "Profil sürümü tanınmadı. Yalnızca onaylanmış v1.0 profilleri kullanılabilir." };
  }
  const setup = candidate.setup;
  if (typeof setup !== "object" || setup === null || typeof setup.competition !== "string") {
    return { profile: null, error: "Profilde temel ayar bilgisi eksik. Profili Kriter Atölyesi'nden yeniden indirin." };
  }
  // Ekranlar ve dosya kapısı bu alanları doğrudan kullanır; eksikliği çalışma anında çökmeye yol açar.
  const textFields: Array<keyof typeof setup> = ["category", "stage", "reportType", "year"];
  if (textFields.some((field) => typeof setup[field] !== "string")) {
    return { profile: null, error: "Profilin yarışma bilgileri (kategori, aşama, rapor türü, yıl) eksik veya bozuk." };
  }
  if (!Array.isArray(setup.allowedFormats) || setup.allowedFormats.some((format) => typeof format !== "string")) {
    return { profile: null, error: "Profilde izin verilen dosya formatları tanımlı değil. Profili yeniden oluşturun." };
  }
  const numberFields: Array<keyof typeof setup> = ["maxFileSizeMb", "maxFileCount"];
  if (numberFields.some((field) => !Number.isFinite(setup[field] as number) || (setup[field] as number) < 0)) {
    return { profile: null, error: "Profildeki dosya boyutu veya dosya sayısı bilgisi geçerli değil." };
  }
  if (!["block", "warn", "jury", "unspecified"].includes(setup.defaultViolationAction as string)) {
    return { profile: null, error: "Profildeki ihlal davranışı tanınmadı. Profili Kriter Atölyesi'nden yeniden indirin." };
  }
  if (!Array.isArray(candidate.criteria) || candidate.criteria.length === 0) {
    return { profile: null, error: "Profilde kriter listesi bulunamadı. Boş profil ile değerlendirme yapılamaz." };
  }
  const invalid = candidate.criteria.find((item) => (
    typeof item?.id !== "string"
    || typeof item?.name !== "string"
    || typeof item?.type !== "string"
    || typeof item?.evaluationMethod !== "string"
    || typeof item?.active !== "boolean"
    || (item?.maxScore !== null && !Number.isFinite(item?.maxScore))
  ));
  if (invalid) {
    return { profile: null, error: "Profildeki bazı kriter kayıtları bozuk görünüyor. Profili yeniden oluşturun." };
  }
  if (typeof candidate.sourceDocument !== "object" || candidate.sourceDocument === null) {
    return { profile: null, error: "Profilde kaynak belge bilgisi eksik. Profili Kriter Atölyesi'nden yeniden indirin." };
  }
  return { profile: candidate as ProfileExport, error: "" };
}

/** Değerlendirme ekranlarında seçili tutulan profil; dışarıdan yüklenen profil de buraya yazılır. */
export const ACTIVE_PROFILE_KEY = "kriter-atolyesi:degerlendirme-profili";

/**
 * Değerlendirme için etkin profili okur: önce ekranda seçilmiş profil, yoksa
 * Kriter Atölyesi'nin en son onayladığı profil.
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
