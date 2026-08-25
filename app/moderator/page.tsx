import type { Metadata } from "next";
import ManagementApp from "../components/management-app";

export const metadata: Metadata = {
  title: "Moderatör Paneli | Kriter Atölyesi",
  description: "Rol bazlı yönetici girişi, hesap yetkilendirme ve değerlendirme çalışma alanı.",
};

export default function ModeratorPage() {
  return <ManagementApp />;
}
