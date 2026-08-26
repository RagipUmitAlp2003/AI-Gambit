import { recordAudit } from "../../lib/admin-db";
import { handleError, json, jsonError, readJson, requirePermission } from "../../lib/admin-guard";
import {
  changeCompetitionStage,
  listCompetitionsFor,
  ownsCompetition,
  setCompetitionPriority,
} from "../../lib/workflow-db";
import type { CompetitionStatus } from "../../lib/workflow-types";

/**
 * Yarışma süreç uçları.
 *
 * İki ayrı yetki, iki ayrı rol — bilinçli olarak ayrıştırıldı:
 *
 *   stage     Başvuruyu açma/kapatma, kararları dondurma, sonuç yayımlama.
 *             Yarışmanın SAHİBİ olan Yarışma Yöneticisine (01) aittir ve
 *             yalnızca KENDİ yayımladığı yarışmada uygulanır.
 *   priority  ÖNCELİKLİ işareti. Değerlendirme Yöneticisinin (04) operasyonel
 *             aksiyonu; yarışmanın takvimini veya kararlarını değiştirmez,
 *             yalnızca hakem panelinde öne çıkarır.
 *
 * Değerlendirme Yöneticisi başvuru durumunu DEĞİŞTİREMEZ, yalnızca izler.
 */

export async function GET(request: Request): Promise<Response> {
  // Liste, profil okuma yetkisiyle aynı kapıdan geçer; yarışmacı (03) giremez.
  const auth = await requirePermission(request, "read_profiles");
  if (!auth.ok) return auth.response;
  try {
    return json({ competitions: await listCompetitionsFor(auth.account) });
  } catch (error) { return handleError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const competitionId = typeof body.competitionId === "string" ? body.competitionId.trim() : "";
    if (!competitionId) return jsonError(400, "Yarışma kimliği gerekli.");
    const action = body.action === "priority" ? "priority" : "stage";

    if (action === "priority") {
      const auth = await requirePermission(request, "flag_competition_priority");
      if (!auth.ok) return auth.response;
      const priority = body.priority === true;
      const note = typeof body.note === "string" ? body.note : "";
      const result = await setCompetitionPriority(competitionId, priority, note, auth.account);
      if (result === "not_found") return jsonError(404, "Yarışma bulunamadı.");
      await recordAudit({
        actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
        action: priority ? "competition_priority_set" : "competition_priority_cleared",
        targetType: "competition", targetId: competitionId,
        detail: `${result.competitionName}${note.trim() ? ` · ${note.trim().slice(0, 200)}` : ""}`,
      }).catch((auditError) => console.error("[audit] competition priority", auditError));
      return json({ competition: result });
    }

    const auth = await requirePermission(request, "manage_competition_stage");
    if (!auth.ok) return auth.response;
    // SAHİPLİK: bir yönetici başka bir yöneticinin yarışmasının başvuru
    // durumunu değiştiremez. Kontrol sunucudadır; ekranda düğme gizlemek yetmez.
    if (!await ownsCompetition(competitionId, auth.account)) {
      return jsonError(403, "Bu yarışmanın süreç durumunu yalnızca kriterlerini yayımlayan Yarışma Yöneticisi değiştirebilir.");
    }
    const nextStatus = typeof body.nextStatus === "string" ? body.nextStatus as CompetitionStatus : null;
    if (!nextStatus) return jsonError(400, "Hedef süreç durumu gerekli.");
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
    }).catch((auditError) => console.error("[audit] competition stage", auditError));
    return json({ competition: result });
  } catch (error) { return handleError(error); }
}
