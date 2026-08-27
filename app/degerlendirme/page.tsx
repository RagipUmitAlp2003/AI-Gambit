import EvaluationApp from "../components/evaluation-app";
import RoleGate from "../components/role-gate";
import { rolesFor } from "../lib/authorization";

/**
 * Değerlendirme Atölyesi: AI ön değerlendirmesini çalıştırıp inceleme alanı.
 * Nihai kararı yalnızca hakem verir; bu uçtaki save_review 02 ile sınırlıdır.
 */
export default function EvaluationPage() {
  return <RoleGate allowed={rolesFor("run_ai_prescreen")} areaName="Değerlendirme Atölyesi"><EvaluationApp /></RoleGate>;
}
