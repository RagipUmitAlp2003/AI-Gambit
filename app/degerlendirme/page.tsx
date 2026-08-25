import EvaluationApp from "../components/evaluation-app";
import RoleGate from "../components/role-gate";

export default function EvaluationPage() {
  return <RoleGate allowed={["00", "02"]} areaName="Değerlendirme Atölyesi"><EvaluationApp /></RoleGate>;
}
