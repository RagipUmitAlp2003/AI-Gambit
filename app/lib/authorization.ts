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
 */
export const PERMISSIONS = {
  /** Hesap açma, rol atama/kaldırma, pasife alma, denetim izi. */
  manage_accounts: ["00"],
  /** Şartname PDF'sinden kriter çıkarımı (Kriter Atölyesi analizi). */
  author_criteria: ["00", "01"],
  /** Değerlendirme profilini ilk hazırlama ve hakem incelemesine gönderme. */
  author_profile: ["00", "01"],
  /** Profilin ikinci aşama doğrulaması: onay veya düzeltme talebi. */
  review_profile: ["00", "02"],
  /** Profil listesi/okuma. Yarışmacı kriterleri görmez. */
  read_profiles: ["00", "01", "02", "03"],
  /** Başvuru gönderme — yalnızca yarışmacı. */
  submit_application: ["04"],
  /** Başvuru listesi. Görünen alanlar role göre daraltılır (bkz. workflow-db applicationView). */
  read_applications: ["00", "01", "02", "03", "04"],
  /** Yarışmacı PDF'ine erişim. 01 ve 03 proje içeriğini görmez. */
  read_application_file: ["00", "02", "04"],
  /** AI ön değerlendirmesini başlatma ve sonucunu kaydetme. */
  run_ai_prescreen: ["00", "02"],
  /** Nihai uzman değerlendirmesi ve nihai karar — yalnızca hakem. */
  final_judgement: ["02"],
  /** Operasyon panosu ve kullanım ölçümleri. */
  operations_dashboard: ["00", "03"],
  /** Ayıklama (analiz) geçmişi. */
  read_extractions: ["00", "01", "03"],
  /** Süreç zaman çizelgesi. Yarışmacı iç görüşmeyi görmez; kendi durumunu portalda izler. */
  read_timeline: ["00", "01", "02", "03"],
} as const satisfies Record<string, readonly RoleCode[]>;

export type Permission = keyof typeof PERMISSIONS;

export function rolesFor(permission: Permission): RoleCode[] {
  return [...PERMISSIONS[permission]];
}

/** Sunucu ve istemci tarafında aynı matristen okuyan saf kontrol. */
export function can(account: Pick<AdminAccount, "roleCode"> | null | undefined, permission: Permission): boolean {
  return !!account && (PERMISSIONS[permission] as readonly string[]).includes(account.roleCode);
}
