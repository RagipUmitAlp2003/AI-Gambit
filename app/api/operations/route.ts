import { listAccounts, listRecentWorkflowEvents } from "../../lib/admin-db";
import { handleError, json, requirePermission } from "../../lib/admin-guard";
import { WORKFLOW_EVENT_LABELS } from "../../lib/admin-roles";
import { listApplications, listCompetitionWorkflows, listProfiles, operationsSummary } from "../../lib/workflow-db";
import type { CompetitionOverview, JudgeWorkload, TimelineEntry } from "../../lib/workflow-types";

/**
 * Değerlendirme Yöneticisi (Rol 04) izleme panosu.
 *
 * GİZLİLİK: bu rol yarışmacı raporlarını okumaz. Yanıt katılımcı adı, ekip
 * üyesi, dosya adı ve rapor içeriği taşımaz (bkz. workflow-db · applicationView
 * "operations" görünümü ve `redactEvaluation`). Yarışma bazlı sayaçlar burada
 * toplanır; süreç durumu yalnızca İZLENİR, değiştirilemez — başvuruyu açma
 * kapatma yetkisi Yarışma Yöneticisindedir (bkz. /api/competitions).
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
    // Yarışma bazlı özet: kriter sayısı, başvuru durumu ve sayaçlar. Katılımcı
    // adı ve rapor içeriği bu tabloya HİÇ girmez.
    const profiles = await listProfiles(auth.account);
    const overview: CompetitionOverview[] = competitions.map((competition) => {
      const items = applications.filter((application) => application.competitionKey === competition.competitionKey);
      const profile = profiles.find((item) => item.id === competition.currentProfileId)
        ?? profiles.find((item) => item.competitionKey === competition.competitionKey && item.status === "approved");
      const decided = items.filter((item) => item.status === "completed");
      return {
        competitionId: competition.id,
        competitionKey: competition.competitionKey,
        competitionName: competition.competitionName,
        category: profile?.category ?? "",
        sourceDocumentName: profile?.sourceDocumentName ?? "",
        criteriaCount: profile?.profile.criteria.length ?? 0,
        status: competition.status,
        acceptingApplications: competition.status === "open",
        isPriority: competition.isPriority,
        priorityNote: competition.priorityNote,
        total: items.length,
        evaluated: decided.length,
        accepted: decided.filter((item) => item.outcome === "accepted").length,
        rejected: decided.filter((item) => item.outcome === "rejected").length,
        revision: decided.filter((item) => item.outcome === "revision_required").length,
        pending: items.length - decided.length,
        unassigned: items.filter((item) => !item.assignedJudgeId && item.status !== "completed").length,
      };
    });
    return json({ summary, recent, judges, competitions, overview });
  } catch (error) { return handleError(error); }
}
