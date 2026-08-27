import { listAccounts, listAudit, listRecentWorkflowEvents } from "../../lib/admin-db";
import { handleError, json, requirePermission } from "../../lib/admin-guard";
import { WORKFLOW_EVENT_LABELS } from "../../lib/admin-roles";
import { APPLICATION_STATUS_LABELS, COMPETITION_STATUS_LABELS } from "../../lib/workflow-types";
import { assignPendingApplications, listApplications, listCompetitionWorkflows, listProfiles, operationsSummary } from "../../lib/workflow-db";
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
    // OTOMATİK YENİDEN DENEME: pano her açıldığında bekleyen (hakemsiz)
    // başvurular sistem tarafından yeniden dağıtılmayı dener. Elle hakem
    // seçtirme yoktur; aktif hakem yoksa başvurular atanmamış görünmeye
    // devam eder ve aşağıdaki sayaçlarda izlenir.
    await assignPendingApplications().catch((assignError) =>
      console.error("[workflow] pano açılışında bekleyen atama", assignError));
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
      // "Analizi tamamlanan": AI ön değerlendirmesi başarıyla bitmiş olanlar —
      // hakem kuyruğundakiler, hakem incelemesindekiler ve karar verilmişler.
      const analysisCompleted = items.filter(
        (item) => ["awaiting_judge", "judge_in_review", "completed"].includes(item.status),
      ).length;
      return {
        competitionId: competition.id,
        competitionKey: competition.competitionKey,
        competitionName: competition.competitionName,
        category: profile?.category ?? "",
        sourceDocumentName: profile?.sourceDocumentName ?? "",
        criteriaCount: profile?.profile.criteria.length ?? 0,
        status: competition.status,
        // Başvuruya açık olmak için hem süreç durumu 'open' hem de yarışmanın
        // AKTİF olması gerekir; pasif yarışma yeni başvuru kabul etmez.
        acceptingApplications: competition.status === "open" && competition.isActive && !competition.archivedAt,
        isActive: competition.isActive && !competition.archivedAt,
        isPriority: competition.isPriority,
        priorityNote: competition.priorityNote,
        total: items.length,
        analysisCompleted,
        analysisPending: items.length - analysisCompleted,
        evaluated: decided.length,
        accepted: decided.filter((item) => item.outcome === "accepted").length,
        rejected: decided.filter((item) => item.outcome === "rejected").length,
        revision: decided.filter((item) => item.outcome === "revision_required").length,
        pending: items.length - decided.length,
        unassigned: items.filter((item) => !item.assignedJudgeId && item.status !== "completed").length,
        archived: items.filter((item) => Boolean(item.archivedAt)).length,
      };
    });
    /*
     * SİLME VE DENETİM GÖRÜNÜRLÜĞÜ (madde 11)
     *
     * Değerlendirme Yöneticisi hangi yarışmanın/başvurunun kim tarafından,
     * ne zaman ve hangi gerekçeyle arşivlendiğini görür. Bu liste yalnızca
     * GÖRÜNTÜLENİR: bu roldeki hesap katılımcı raporunun içeriğini
     * değiştiremez, yalnızca operasyonel işlemleri izler.
     */
    const archiveTrail = [
      ...competitions.filter((item) => item.archivedAt).map((item) => ({
        id: `competition:${item.id}`,
        kind: "competition" as const,
        subject: item.competitionName,
        actorName: item.archivedByName ?? "bilinmiyor",
        at: item.archivedAt as string,
        reason: item.archivedReason || "Gerekçe girilmedi",
        previousStatus: COMPETITION_STATUS_LABELS[item.status] ?? item.status,
        nextStatus: "Arşivlendi",
      })),
      ...applications.filter((item) => item.archivedAt).map((item) => ({
        id: `application:${item.id}`,
        kind: "application" as const,
        // 04 görünümünde katılımcı adı yerine takım adı bulunur; rapor içeriği taşınmaz.
        subject: `${item.teamName} · ${item.competitionName}`,
        actorName: item.archivedByName ?? "bilinmiyor",
        at: item.archivedAt as string,
        reason: item.archivedReason || "Gerekçe girilmedi",
        previousStatus: APPLICATION_STATUS_LABELS[item.status] ?? item.status,
        nextStatus: "Aktif listeden kaldırıldı",
      })),
    ].sort((left, right) => right.at.localeCompare(left.at));

    // Denetim izinin arşivleme/atama/silme satırları; içerik değil işlem kaydıdır.
    // Değerlendirme Yöneticisi AI analizi silme olayını buradan ve süreç
    // hareketlerinden görür; silinen AI içeriği hiçbir kayıtta taşınmaz.
    const auditRows = (await listAudit(60)).filter((entry) => [
      "competition_archived", "competition_restored", "competition_activation_changed",
      "application_archived", "application_restored", "application_auto_assigned",
      "ai_analysis_deleted", "judge_criterion_decisions", "profile_published",
    ].includes(entry.action));

    return json({ summary, recent, judges, competitions, overview, archiveTrail, audit: auditRows });
  } catch (error) { return handleError(error); }
}
