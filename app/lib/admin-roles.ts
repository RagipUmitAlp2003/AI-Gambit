import type { FlowActorRole, RoleCode } from "./admin-types";

export type RoleDefinition = {
  code: RoleCode;
  title: string;
  shortTitle: string;
  summary: string;
  area: string;
  /** 00 kendi kendini atayamaz; yalnızca mevcut bir moderatör tarafından tanımlanır. */
  assignable: boolean;
};

/**
 * Rol katalogu. Başlık ve açıklamalar organizasyonun iş bölümüne göre
 * güncellenebilir; kodlar (00-04) veri tabanında sabit kalır.
 */
export const ROLES: RoleDefinition[] = [
  {
    code: "00",
    title: "Baş Yönetici",
    shortTitle: "Baş Yönetici",
    summary: "Yönetici hesaplarını ve rol yetkilerini yönetir; tüm çalışma alanlarını denetler.",
    area: "Sistem ve yetki yönetimi",
    assignable: true,
  },
  {
    code: "01",
    title: "Yarışma Yöneticisi",
    shortTitle: "Yarışma Yöneticisi",
    summary: "Güncel kriter PDF'sini sisteme aktarır, AI çıkarımlarını inceler ve değerlendirme profilini kesinleştirir.",
    area: "Kriter Atölyesi",
    assignable: true,
  },
  {
    code: "02",
    title: "Hakem / Değerlendirici",
    shortTitle: "Hakem",
    summary: "AI ön değerlendirmesini ve kanıtları inceler; uzman değerlendirmesini yaparak nihai kararı verir.",
    area: "Değerlendirme Atölyesi",
    assignable: true,
  },
  {
    code: "03",
    title: "Yarışmacı",
    shortTitle: "Yarışmacı",
    summary: "Yarışmaya başvurur, PDF raporunu gönderir ve yalnızca hakem onaylı sonucunu görüntüler. Yönetici hesabı değildir.",
    area: "Başvuru ve sonuç takibi",
    assignable: false,
  },
  {
    code: "04",
    title: "Değerlendirme Yöneticisi",
    shortTitle: "Değerlendirme Yöneticisi",
    summary: "Analiz durumlarını, tamamlanma oranlarını ve sonuç dağılımını salt okunur izler; katılımcı PDF'ine ve proje içeriğine erişmez.",
    area: "Operasyon görünümü",
    assignable: true,
  },
];

export const ROLE_CODES: RoleCode[] = ROLES.map((role) => role.code);

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === "string" && (ROLE_CODES as string[]).includes(value);
}

export function isFlowActorRole(value: unknown): value is FlowActorRole {
  return value === "author" || isRoleCode(value);
}

export function roleByCode(code: string): RoleDefinition | null {
  return ROLES.find((role) => role.code === code) ?? null;
}

export function roleLabel(code: FlowActorRole): string {
  if (code === "author") return "Belgeyi oluşturan";
  const role = roleByCode(code);
  return role ? `${role.code} · ${role.title}` : code;
}
