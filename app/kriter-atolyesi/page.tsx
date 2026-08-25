import CriteriaApp from "../components/criteria-app";
import RoleGate from "../components/role-gate";

export default function CriteriaWorkspacePage() {
  return <RoleGate allowed={["00", "01"]} areaName="Kriter Atölyesi"><CriteriaApp /></RoleGate>;
}
