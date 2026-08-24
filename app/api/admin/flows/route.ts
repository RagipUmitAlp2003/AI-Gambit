import { insertFlow, listFlows, recordAudit } from "../../../lib/admin-db";
import { parseFlowInput } from "../../../lib/admin-flow-input";
import { authenticate, handleError, json, readJson, requireModerator } from "../../../lib/admin-guard";

/**
 * Yarışma bazlı belge akışı kayıtları (Kısım 2).
 *
 * Okuma her oturum açmış role (00-04) açıktır; kayıt oluşturma moderatöre
 * (00) aittir — akış kayıtlarını moderatör elle tutar.
 */

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  try {
    return json({ flows: await listFlows(), viewerRole: auth.account.roleCode });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const input = await parseFlowInput(await readJson(request));
    const flow = await insertFlow(input);
    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: "flow_created",
      targetType: "flow",
      targetId: flow.id,
      detail: `${flow.competition} · ${flow.handoffs.length} devir`,
    });
    return json({ flow }, 201);
  } catch (error) {
    return handleError(error);
  }
}
