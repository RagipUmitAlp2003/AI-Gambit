import { listRecentWorkflowEvents } from "../../lib/admin-db";
import { handleError, json, requirePermission } from "../../lib/admin-guard";
import { WORKFLOW_EVENT_LABELS } from "../../lib/admin-roles";
import { operationsSummary } from "../../lib/workflow-db";
import type { TimelineEntry } from "../../lib/workflow-types";

/**
 * Değerlendirme Yöneticisi (Rol 03) panosunun özeti: durum sayaçları,
 * tamamlanma oranı ve son süreç hareketleri.
 *
 * Salt okunur bir görünümdür; bu uç hiçbir puanı veya kararı değiştirmez.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "operations_dashboard");
  if (!auth.ok) return auth.response;
  try {
    const [summary, events] = await Promise.all([
      operationsSummary(auth.account),
      listRecentWorkflowEvents(40),
    ]);
    const recent: TimelineEntry[] = events.map((event) => ({
      id: event.id,
      event: event.event,
      label: WORKFLOW_EVENT_LABELS[event.event] ?? event.event,
      actorName: event.actorName,
      actorRole: event.actorRole,
      detail: event.detail,
      createdAt: event.createdAt,
    }));
    return json({ summary, recent });
  } catch (error) { return handleError(error); }
}
