import type { RoleCode, WorkflowEventName } from "./admin-types";

export type RoleDefinition = {
  code: RoleCode;
  title: string;
  shortTitle: string;
  summary: string;
  area: string;
  /** Rolün karar sınırı: bu rolün YAPAMADIĞI şey. Ekranlarda uyarı olarak gösterilir. */
  boundary: string;
  /** Moderatör bu rolü bir hesaba atayabilir mi? Yarışmacı kendi kaydını açar. */
  assignable: boolean;
};

/**
 * Rol katalogu — tek doğruluk kaynağı.
 *
 * Kullanıcıya görünen her rol adı buradan okunur; bileşenler rol başlığını
 * kendi içinde sabitlemez. Kodlar (00-04) veri tabanında sabittir.
 *
 * Süreçteki yerleri:
 *   00 sistemi yönetir, operasyonel akışın adımı değildir.
 *   01 değerlendirme altyapısını hazırlar → 02 ikinci aşamada doğrular.
 *   04 başvurur → AI ön değerlendirme çalışır → 02 nihai kararı verir.
 *   03 bu akışı üstten izler; içeriğe müdahale etmez.
 */
export const ROLES: RoleDefinition[] = [
  {
    code: "00",
    title: "Moderatör / Sistem Yöneticisi",
    shortTitle: "Moderatör",
    summary: "Kullanıcı hesabı açar, rol atar veya kaldırır, hesapları pasife alır ve yeniden aktifleştirir.",
    area: "Sistem ve yetki yönetimi",
    boundary: "Değerlendirme sürecinin operasyonel adımlarından biri değildir; hakem yerine nihai karar veremez.",
    assignable: true,
  },
  {
    code: "01",
    title: "Yarışma Yöneticisi",
    shortTitle: "Yarışma Yöneticisi",
    summary: "Yarışmayı tanımlar; şartname, rapor şablonu, kategori, değerlendirme kriterleri ve puan yapısını hazırlar.",
    area: "Kriter Atölyesi",
    boundary: "Hazırladığı profili kendisi onaylayamaz; ikinci doğrulama hakemdedir.",
    assignable: true,
  },
  {
    code: "02",
    title: "Hakem",
    shortTitle: "Hakem",
    summary: "Yarışma yöneticisinin hazırladığı profili ikinci aşamada doğrular; yarışmacı raporunda AI ön değerlendirmesini inceleyip nihai kararı verir.",
    area: "Değerlendirme Atölyesi",
    boundary: "Hesap ve rol yönetimi yapamaz. AI sonucu öneridir; nihai karar hakemindir.",
    assignable: true,
  },
  {
    code: "03",
    title: "Değerlendirme Yöneticisi",
    shortTitle: "Değerlendirme Yöneticisi",
    summary: "AI analiz durumlarını, hakem kuyruğunu, tamamlanma oranını ve başarısız analizleri izler; operasyonu yönetir.",
    area: "Operasyon görünümü",
    boundary: "Kriter değiştiremez, puana dokunamaz, hakem yerine nihai karar veremez.",
    assignable: true,
  },
  {
    code: "04",
    title: "Yarışmacı",
    shortTitle: "Yarışmacı",
    summary: "Kendisine açık yarışmayı görür, rapor/başvuru dosyasını yükler, başvurur ve kendi başvurusunun durumunu izler.",
    area: "Başvuru ve sonuç takibi",
    boundary: "Kriteri, şartnameyi, AI sonucunu ve hakem kararını değiştiremez; başka yarışmacının başvurusunu göremez.",
    assignable: false,
  },
];

export const ROLE_CODES: RoleCode[] = ROLES.map((role) => role.code);

/** Moderatörün (00) bir hesaba atayabileceği roller. Yarışmacı kendi kaydını açar. */
export const ASSIGNABLE_ROLE_CODES: RoleCode[] = ROLES.filter((role) => role.assignable).map((role) => role.code);

/** Yarışmacı rolü; başvuru sahibi kimliğidir, yönetici hesabı değildir. */
export const PARTICIPANT_ROLE: RoleCode = "04";

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === "string" && (ROLE_CODES as string[]).includes(value);
}

export function roleByCode(code: string): RoleDefinition | null {
  return ROLES.find((role) => role.code === code) ?? null;
}

export function roleLabel(code: RoleCode | null | undefined): string {
  if (!code) return "sistem";
  const role = roleByCode(code);
  return role ? `${role.code} · ${role.title}` : code;
}

/** Süreç olaylarının kullanıcıya gösterilen karşılıkları (olay bazlı zaman çizelgesi). */
export const WORKFLOW_EVENT_LABELS: Record<WorkflowEventName, string> = {
  profile_drafted: "Değerlendirme profili oluşturuldu",
  profile_submitted_for_review: "Değerlendirme profili hakem incelemesine gönderildi",
  profile_changes_requested: "Hakem düzeltme istedi",
  profile_criteria_edited: "Hakem kriterleri güncelledi",
  profile_approved: "Değerlendirme profili hakem tarafından onaylandı",
  application_submitted: "Yarışmacı başvurusunu gönderdi",
  ai_analysis_started: "AI ön değerlendirmesi başladı",
  ai_prescreen_completed: "AI ön değerlendirmesi tamamlandı",
  ai_analysis_failed: "AI analizi başarısız oldu",
  judge_review_started: "Hakem nihai değerlendirmeye başladı",
  judge_score_adjusted: "Hakem AI puanını değiştirdi",
  judge_decision_completed: "Nihai değerlendirme tamamlandı",
};
