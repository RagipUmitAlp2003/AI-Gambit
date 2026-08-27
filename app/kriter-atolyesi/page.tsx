import CriteriaApp from "../components/criteria-app";
import RoleGate from "../components/role-gate";
import { rolesFor } from "../lib/authorization";

/** Kriter Atölyesi profili HAZIRLAR; onayı hakem verir (bkz. authorization.ts). */
export default function CriteriaWorkspacePage() {
  return <RoleGate allowed={rolesFor("author_profile")} areaName="Kriter Atölyesi"><CriteriaApp /></RoleGate>;
}
