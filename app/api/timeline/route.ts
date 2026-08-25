import { listWorkflowEvents } from "../../lib/admin-db";
import { handleError, json, jsonError, requirePermission } from "../../lib/admin-guard";
import { WORKFLOW_EVENT_LABELS } from "../../lib/admin-roles";
import { findApplication, findProfile } from "../../lib/workflow-db";
import type { TimelineEntry } from "../../lib/workflow-types";

/**
 * Olay bazlı süreç zaman çizelgesi.
 *
 * Eski `01 → 02 → 03 → 04` belge devri listesinin yerini alır: her rol kendi
 * görevini yaptığında bir olay düşer ve sıra dayatılmaz.
 *
 * Yarışmacı bu uca erişemez; kendi başvurusunun durumunu portalda görür.
 * Erişebilen roller için de kayıt düzeyi görünürlük yeniden doğrulanır:
 * 01 yalnızca kendi yarışmasının, 03 yalnızca yürürlükteki profilin olaylarını görür.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "read_timeline");
  if (!auth.ok) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const subject = params.get("subject");
    const id = (params.get("id") ?? "").trim();
    if ((subject !== "application" && subject !== "profile") || !id) {
      return jsonError(400, "subject 'application' veya 'profile' olmalı ve id verilmelidir.");
    }

    if (subject === "application") {
      // findApplication rol bazlı görünürlüğü zaten uygular.
      if (!await findApplication(id, auth.account)) return jsonError(404, "Başvuru bulunamadı.");
    } else {
      const profile = await findProfile(id);
      if (!profile) return jsonError(404, "Değerlendirme profili bulunamadı.");
      if (auth.account.roleCode === "01" && profile.createdBy !== auth.account.id) {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
      if (auth.account.roleCode === "03" && profile.status !== "approved") {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
    }

    const events = await listWorkflowEvents(subject, id);
    const timeline: TimelineEntry[] = events.map((event) => ({
      id: event.id,
      event: event.event,
      label: WORKFLOW_EVENT_LABELS[event.event] ?? event.event,
      actorName: event.actorName,
      actorRole: event.actorRole,
      detail: event.detail,
      createdAt: event.createdAt,
    }));
    return json({ timeline });
  } catch (error) { return handleError(error); }
}
