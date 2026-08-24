import { deleteFlow, findFlow, recordAudit, updateFlow } from "../../../../lib/admin-db";
import { parseFlowInput } from "../../../../lib/admin-flow-input";
import { handleError, json, jsonError, readJson, requireModerator } from "../../../../lib/admin-guard";

/**
 * Tek belge akışının güncellenmesi ve silinmesi (yalnızca Rol 00).
 * Güncelleme künyeyi değiştirir ve yalnızca YENİ devirleri ekler; kayıtlı
 * devir geçmişi bu uçtan değiştirilemez.
 */

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const before = await findFlow(id);
    if (!before) return jsonError(404, "Belge akışı bulunamadı.");

    const input = await parseFlowInput(await readJson(request));
    const flow = await updateFlow(id, input);
    if (!flow) return jsonError(404, "Belge akışı bulunamadı.");

    const appended = flow.handoffs.length - before.handoffs.length;
    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: appended > 0 ? "flow_handoff_added" : "flow_updated",
      targetType: "flow",
      targetId: id,
      detail: `${flow.competition}${appended > 0 ? ` · ${appended} yeni devir` : ""}`,
    });

    return json({ flow });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const existing = await findFlow(id);
    if (!existing) return jsonError(404, "Belge akışı bulunamadı.");

    const removed = await deleteFlow(id);
    if (!removed) return jsonError(404, "Belge akışı bulunamadı.");

    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: "flow_deleted",
      targetType: "flow",
      targetId: id,
      detail: `${existing.competition} · ${existing.title || "başlıksız"}`,
    });

    return json({ deleted: true, id });
  } catch (error) {
    return handleError(error);
  }
}
