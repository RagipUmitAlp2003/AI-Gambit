import { listAccounts, listRecentWorkflowEvents, recordAudit } from "../../lib/admin-db";
import { handleError, json, jsonError, readJson, requirePermission } from "../../lib/admin-guard";
import { WORKFLOW_EVENT_LABELS } from "../../lib/admin-roles";
import { changeCompetitionStage, listApplications, listCompetitionWorkflows, operationsSummary } from "../../lib/workflow-db";
import type { CompetitionStatus, JudgeWorkload, TimelineEntry } from "../../lib/workflow-types";

/**
 * Değerlendirme Yöneticisi (Rol 04) ve Admin için operasyon özeti.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "operations_dashboard");
  if (!auth.ok) return auth.response;
  try {
    const [summary, events, applications, accounts, competitions] = await Promise.all([
      operationsSummary(auth.account),
      listRecentWorkflowEvents(40),
      listApplications(auth.account),
      listAccounts(),
      listCompetitionWorkflows(),
    ]);
    const recent: TimelineEntry[] = events.map((event) => ({
      id: event.id,
      event: event.event,
      label: WORKFLOW_EVENT_LABELS[event.event] ?? event.event,
      actorName: event.actorName,
      actorRole: event.actorRole,
      // Rol 04 yalnızca operasyon durumunu izler; hakem gerekçesi ve yarışmacı
      // dosya adı gibi proje içeriğine dönüşebilecek serbest metinleri görmez.
      detail: auth.account.roleCode === "04" ? "" : event.detail,
      createdAt: event.createdAt,
    }));
    const judges: JudgeWorkload[] = accounts.filter((account) => account.roleCode === "02" && account.status === "active").map((judge) => {
      const assigned = applications.filter((application) => application.assignedJudgeId === judge.id);
      return {
        judgeId: judge.id,
        judgeName: judge.fullName,
        active: assigned.filter((application) => application.status !== "completed").length,
        completed: assigned.filter((application) => application.status === "completed").length,
        failed: assigned.filter((application) => application.status === "analysis_failed").length,
      };
    });
    return json({ summary, recent, judges, competitions });
  } catch (error) { return handleError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "manage_competition_stage");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(request);
    const competitionId = typeof body.competitionId === "string" ? body.competitionId.trim() : "";
    const nextStatus = typeof body.nextStatus === "string" ? body.nextStatus as CompetitionStatus : null;
    if (!competitionId || !nextStatus) return jsonError(400, "Yarışma ve hedef süreç durumu gerekli.");
    const result = await changeCompetitionStage(
      competitionId, nextStatus, auth.account,
      typeof body.reason === "string" ? body.reason : "",
      body.force === true,
    );
    if (result === "not_found") return jsonError(404, "Yarışma bulunamadı.");
    if (result === "invalid_transition") return jsonError(409, "Bu yarışma durumu doğrudan seçilen aşamaya geçirilemez.");
    if (result === "unresolved") return jsonError(409, "Kararlar dondurulmadan önce bütün başvurular sonuçlandırılmalıdır.");
    await recordAudit({
      actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
      action: "competition_stage_changed", targetType: "competition", targetId: competitionId,
      detail: `${result.competitionName} · ${result.status}`,
    }).catch((error) => console.error("[audit] competition stage", error));
    return json({ competition: result });
  } catch (error) { return handleError(error); }
}
