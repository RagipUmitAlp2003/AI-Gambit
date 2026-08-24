import type { Metadata } from "next";
import ModeratorApp from "../components/moderator-app";

export const metadata: Metadata = {
  title: "Moderatör Paneli | Kriter Atölyesi",
  description: "Rol atama, yönetici hesabı oluşturma ve yarışma bazlı belge akışı izleme paneli.",
};

export default function ModeratorPage() {
  return <ModeratorApp />;
}
