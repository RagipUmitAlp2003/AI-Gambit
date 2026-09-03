import type { AdminAccount, RoleCode } from "./admin-types";

/**
 * Yetki matrisi — tek doğruluk kaynağı.
 *
 * Her API ucu bu haritadaki bir izne bağlanır; rol listesi route dosyalarında
 * tekrar yazılmaz. Frontend'de buton gizlemek yetki değildir: sunucu tarafında
 * her kritik uç `requirePermission` üzerinden geçer.
 *
 * En az yetki ilkesi: bir rol burada yoksa uç ona 403 döner. Belirsiz iş
 * kuralında yetki genişletilmez.
 *
 * Admin (00) YALNIZCA yönetici ataması yapar: personel hesabı açar, rol atar
 * ve kaldırır. Kriter, değerlendirme, operasyon ve başvuru uçlarına erişmez.
 */
export const PERMISSIONS = {
  /** Hesap açma, rol atama/kaldırma, pasife alma, denetim izi. */
  manage_accounts: ["00"],
  /** Şartname PDF'sinden kriter çıkarımı (Kriter Atölyesi analizi). */
  author_criteria: ["01"],
  /** Değerlendirme profilini hazırlama. */
  author_profile: ["01"],
  /** Yarışma Yöneticisinin doğruladığı profili doğrudan yayımlama. */
  publish_profile: ["01"],
  /** Profil listesi/okuma. Yarışmacı kriterleri görmez. */
  read_profiles: ["01", "02", "04"],
  /** Başvuru gönderme — yalnızca yarışmacı. */
  submit_application: ["03"],
  /** Başvuru listesi. Görünen alanlar role göre daraltılır (bkz. workflow-db applicationView). */
  read_applications: ["02", "03", "04"],
  /** Yarışmacı PDF'ine erişim. 01 ve 04 proje içeriğini görmez. */
  read_application_file: ["02", "03"],
  /** AI ön değerlendirmesini başlatma ve sonucunu kaydetme. */
  run_ai_prescreen: ["02"],
  /** Nihai uzman değerlendirmesi ve nihai karar — yalnızca hakem. */
  final_judgement: ["02"],
  /** Operasyon panosu ve kullanım ölçümleri. */
  operations_dashboard: ["04"],
  /*
   * `assign_judge` yetkisi KALDIRILDI: hakem ataması yalnızca sistem
   * tarafından otomatik yapılır (workflow-db · autoAssignJudge ve
   * assignPendingApplications). Değerlendirme Yöneticisi atamaları izler
   * ama hiçbir atamayı elle yapamaz veya değiştiremez.
   */
  /** Tıkanıklıkta hatırlatma ve hata kuyruğu yönetimi (atama İÇERMEZ). */
  coordinate_evaluation: ["04"],
  /**
   * Başvuru kabulünü açma/kapatma, kararları dondurma ve sonuçları yayımlama.
   *
   * Yarışmanın SAHİBİ Yarışma Yöneticisidir (01): kriterleri o çıkarır, o
   * yayımlar ve başvuruya açık olup olmadığına o karar verir. Değerlendirme
   * Yöneticisi (04) bu durumu yalnızca İZLER; süreç hızını yönetir, yarışmanın
   * takvimini değiştirmez.
   */
  manage_competition_stage: ["01"],
  /**
   * Yarışmayı AKTİF / PASİF yapma (madde 6).
   *
   * Hem yarışmanın sahibi Yarışma Yöneticisi (01) hem de süreci yöneten
   * Değerlendirme Yöneticisi (04) bu anahtarı çevirebilir. Pasifleştirme
   * yarışmanın aşamasını veya kararlarını DEĞİŞTİRMEZ; yalnızca yeni başvuru
   * ve yeni değerlendirme kuyruğu üretimini durdurur.
   */
  toggle_competition_activation: ["01", "04"],
  /**
   * Resmî rapor şablonunu yükleme/okuma — YALNIZCA yarışmanın sahibi Yarışma
   * Yöneticisi (uç ayrıca sahiplik doğrular). Bu şablon KRİTER ÜRETMEZ ve
   * rapor uygunluğu kararı VERMEZ; yalnızca benzerlik analizindeki beklenen
   * ortak metni ayıklar (GÖREV 3 · madde 3). En az yetki: 04 dahil hiçbir
   * başka rol okuyamaz.
   */
  manage_similarity_template: ["01"],
  /**
   * Eski yarışmayı arşivleme (soft delete, madde 11).
   * Yalnızca yarışmanın sahibi Yarışma Yöneticisi arşivleyebilir; kayıt
   * silinmez, işlem gerekçesiyle denetim izine yazılır.
   */
  archive_competition: ["01"],
  /**
   * Hakemin kendi aktif iş listesinden başvuru kaldırması (soft delete).
   * Fiziksel silme yoktur; kayıt, PDF ve değerlendirme geçmişi korunur.
   */
  archive_application: ["02"],
  /**
   * Yarışmaya ÖNCELİKLİ işareti koyma/kaldırma — Değerlendirme Yöneticisinin
   * operasyonel aksiyonu. Başvuru yığılan veya hakem değerlendirmesi geciken
   * yarışmalar hakem panelinde öne çıkar. Karar değil, sıralama işaretidir.
   */
  flag_competition_priority: ["04"],
  /** Ayıklama (analiz) geçmişi. */
  read_extractions: ["01", "04"],
  /** Süreç zaman çizelgesi. Yarışmacı iç görüşmeyi görmez; kendi durumunu portalda izler. */
  read_timeline: ["01", "02", "04"],
} as const satisfies Record<string, readonly RoleCode[]>;

export type Permission = keyof typeof PERMISSIONS;

export function rolesFor(permission: Permission): RoleCode[] {
  return [...PERMISSIONS[permission]];
}

/** Sunucu ve istemci tarafında aynı matristen okuyan saf kontrol. */
export function can(account: Pick<AdminAccount, "roleCode"> | null | undefined, permission: Permission): boolean {
  return !!account && (PERMISSIONS[permission] as readonly string[]).includes(account.roleCode);
}

/**
 * Bir başvurunun bu hesaba GÖSTERİLİP gösterilemeyeceği — saf karar.
 *
 * Yetkili uygulama noktası `workflow-db · applicationVisibility` içindeki SQL
 * filtresidir (liste sorgusu hiç okumadığı satırı döndürmez). Bu işlev aynı
 * kuralın test edilebilir ve okunabilir karşılığıdır; ikisi ayrışırsa
 * regresyon testi kaynak üzerinden de uyarır.
 *
 *   03 Yarışmacı  yalnızca kendi başvurusu.
 *   02 Hakem      YALNIZCA kendisine atanmış başvuru. Atanmamış dosya
 *                 görünmez ve hakem dosyayı kendi üzerine alamaz; ilk atamayı
 *                 Değerlendirme Yöneticisi (04) yapar.
 *   04 Değerlendirme Yöneticisi  süreç takibi için hepsi (içerik ayrıca kısılır).
 *   01 Yarışma Yöneticisi  yalnızca kendi yayımladığı profile bağlı başvurular.
 *   00 Admin      hiçbiri; başvuru akışına erişmez.
 */
export function canViewApplication(
  account: Pick<AdminAccount, "id" | "roleCode"> | null | undefined,
  application: {
    participantId: string;
    assignedJudgeId: string | null;
    /** Başvurunun bağlı olduğu profili hazırlayan yönetici. */
    profileCreatedBy?: string | null;
  },
): boolean {
  if (!account) return false;
  switch (account.roleCode) {
    case "03": return application.participantId === account.id;
    case "02": return !!application.assignedJudgeId && application.assignedJudgeId === account.id;
    case "04": return true;
    case "01": return !!application.profileCreatedBy && application.profileCreatedBy === account.id;
    default: return false;
  }
}

/**
 * Yayımlanmış bir kriter profilinin ÜZERİNE yazılabilir mi?
 *
 * `profileId` istemciden gelir ve kayıt "varsa güncelle" ile yazılır; kontrol
 * olmadan bir yönetici başka bir yöneticinin profil kimliğini göndererek onun
 * yayımlanmış kriter setini değiştirebilirdi. Yeni kayıt (sahip yok) serbesttir.
 */
export function canUpdateProfile(
  actorId: string,
  existingCreatedBy: string | null | undefined,
): boolean {
  if (!existingCreatedBy) return true;
  return existingCreatedBy === actorId;
}
