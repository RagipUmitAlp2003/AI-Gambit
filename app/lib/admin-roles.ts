import type { RoleCode, WorkflowEventName } from "./admin-types";

export type RoleDefinition = {
  code: RoleCode;
  title: string;
  shortTitle: string;
  summary: string;
  area: string;
  /** Rolün karar sınırı: bu rolün YAPAMADIĞI şey. Ekranlarda uyarı olarak gösterilir. */
  boundary: string;
  /**
   * Admin (00) bu rolü bir hesaba atayabilir mi?
   *
   * Yalnızca 01, 02 ve 04 atanabilir. Yarışmacı (03) kendi kaydını açar; yeni
   * Admin (00) hesabı ise arayüzden de API'den de açılamaz — ilk Admin
   * kurulum ucuyla (POST /api/admin/bootstrap) bir kez oluşturulur ve
   * "son aktif 00" koruması onu kaldırılmaktan korur.
   */
  assignable: boolean;
};

/**
 * Rol katalogu — tek doğruluk kaynağı.
 *
 * Kullanıcıya görünen her rol adı buradan okunur; bileşenler rol başlığını
 * kendi içinde sabitlemez. Kodlar (00-04) veri tabanında sabittir.
 *
 * Süreçteki yerleri:
 *   00 yalnızca yetkili hesaplarını yönetir: 01/02/04 hesabı açar, rol atar/kaldırır. Akışa katılmaz.
 *   01 değerlendirme altyapısını hazırlar ve yayımlar.
 *   03 başvurur → 04 hakemi atar → 02 AI ön değerlendirmesini başlatır ve nihai kararı verir.
 *   04 hakem atamasını, iş yükünü, hata ve yayın akışını yönetir; teknik karar vermez.
 */
export const ROLES: RoleDefinition[] = [
  {
    code: "00",
    title: "Genel Yönetici / Admin",
    shortTitle: "Admin",
    summary: "Yalnızca yetkili hesaplarını yönetir: 01, 02 ve 04 rollerinde hesap açar, rol değiştirir ve hesabı pasife alır.",
    area: "Yönetici atama paneli",
    boundary: "Yeni Admin ve Yarışmacı hesabı açamaz; kriter hazırlayamaz, rapor değerlendiremez, hakem atayamaz ve yarışma sürecine müdahale edemez. Her atama denetim izine yazılır.",
    assignable: false,
  },
  {
    code: "01",
    title: "Yarışma Yöneticisi",
    shortTitle: "Yarışma Yöneticisi",
    summary: "Şartnameyi ve varsa rapor şablonunu yükler; tek AI çağrısıyla çıkarılan dört aşamalı kriter taslağını düzeltir ve yayımlar.",
    area: "Kriter Atölyesi",
    boundary: "Katılımcı raporunun nihai kabul, ret veya revizyon kararını veremez.",
    assignable: true,
  },
  {
    code: "02",
    title: "Hakem",
    shortTitle: "Hakem",
    summary: "Yayımlanmış kriterlere göre AI ön değerlendirmesini başlatır; kanıtları inceleyip nihai kabul, ret veya revizyon kararını verir.",
    area: "Değerlendirme Atölyesi",
    boundary: "Şartname yükleyemez ve kriter setini oluşturamaz. AI sonucu öneridir; nihai teknik karar Hakemindir.",
    assignable: true,
  },
  {
    code: "03",
    title: "Yarışmacı",
    shortTitle: "Yarışmacı",
    summary: "Açık yarışmayı seçer, raporunu yükler, kendi başvuru sürümlerini ve hakem onaylı sonucunu izler.",
    area: "Başvuru ve sonuç takibi",
    boundary: "Yönetim panellerini, başka takımların verilerini ve yayınlanmamış AI taslaklarını göremez.",
    assignable: false,
  },
  {
    code: "04",
    title: "Değerlendirme Yöneticisi",
    shortTitle: "Değerlendirme Yöneticisi",
    summary: "Hakem yüklerini, atanamayan başvuruları ve hata kuyruğunu izler; hatırlatma, yeniden analiz talebi ve sonuç yayın akışını yönetir. Hakem ataması sistem tarafından otomatik yapılır.",
    area: "Operasyon ve süreç takibi",
    boundary: "Katılımcı raporunu teknik olarak değerlendiremez, kriter değiştiremez, hakem atayamaz ve diskalifiye ya da nihai karar veremez.",
    assignable: true,
  },
];

export const ROLE_CODES: RoleCode[] = ROLES.map((role) => role.code);

/**
 * Admin'in (00) bir hesaba atayabileceği roller: yalnızca 01, 02 ve 04.
 *
 * Admin ne yeni bir Admin (00) ne de Yarışmacı (03) hesabı açabilir; bu kısıt
 * arayüzde değil, hesap uçlarının girdi doğrulamasında (admin-guard ·
 * assertRoleCode) uygulanır ve istemciden gelen bir alanla atlatılamaz.
 */
export const ASSIGNABLE_ROLE_CODES: RoleCode[] = ROLES.filter((role) => role.assignable).map((role) => role.code);

/** Yarışmacı rolü; başvuru sahibi kimliğidir, yönetici hesabı değildir. */
export const PARTICIPANT_ROLE: RoleCode = "03";

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
  profile_submitted_for_review: "Değerlendirme profili yayıma hazırlandı",
  profile_changes_requested: "Kriter taslağında düzeltme istendi",
  profile_criteria_edited: "Yarışma Yöneticisi kriterleri güncelledi",
  profile_approved: "Değerlendirme profili yayımlandı",
  application_submitted: "Yarışmacı başvurusunu gönderdi",
  application_assigned: "Başvuru hakeme atandı",
  application_reassigned: "Başvuru başka hakeme aktarıldı",
  judge_reminder_sent: "Hakeme hatırlatma gönderildi",
  analysis_requeued: "AI analizi yeniden sıraya alındı",
  document_reupload_requested: "Katılımcıdan yeni belge istendi",
  submission_version_added: "Katılımcı yeni rapor sürümü yükledi",
  ai_analysis_started: "AI ön değerlendirmesi başladı",
  ai_prescreen_completed: "AI ön değerlendirmesi tamamlandı",
  ai_analysis_failed: "AI analizi başarısız oldu",
  ai_analysis_deleted: "AI analizi hakem tarafından silindi",
  judge_review_started: "Hakem nihai değerlendirmeye başladı",
  judge_review_reopened: "Nihai karar yeniden açıldı",
  judge_score_adjusted: "Hakem AI kural kararını değiştirdi",
  judge_decision_completed: "Nihai değerlendirme tamamlandı",
  competition_stage_changed: "Yarışma süreci güncellendi",
  criteria_version_published: "Yeni kriter sürümü yayımlandı",
  criteria_source_locked: "Kaynak sayfa/alıntı değişikliği reddedildi",
  criteria_source_lock_unmatched: "Kaynak kilidi eşleşmeyen kriter yayımı",
  competition_activated: "Yarışma aktifleştirildi",
  competition_deactivated: "Yarışma pasifleştirildi",
  competition_archived: "Yarışma arşivlendi",
  application_archived: "Başvuru aktif listeden kaldırıldı",
  application_restored: "Başvuru aktif listeye geri alındı",
};
