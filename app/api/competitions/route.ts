import { recordAudit } from "../../lib/admin-db";
import { handleError, json, jsonError, readJson, requirePermission } from "../../lib/admin-guard";
import {
  archiveCompetition,
  changeCompetitionStage,
  listCompetitionsFor,
  ownsCompetition,
  setCompetitionActive,
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
    const action = ["priority", "activation", "archive"].includes(String(body.action))
      ? String(body.action)
      : "stage";

    /*
     * AKTİF / PASİF (madde 6)
     *
     * Hem Yarışma Yöneticisi hem Değerlendirme Yöneticisi çevirebilir.
     * Yarışmanın süreç aşamasını değiştirmez; yalnızca yeni başvuru ve yeni
     * değerlendirme kuyruğu üretimini durdurur veya yeniden açar. Değişiklik
     * ilgili bütün panellere aynı sorgudan yansır.
     */
    if (action === "activation") {
      const auth = await requirePermission(request, "toggle_competition_activation");
      if (!auth.ok) return auth.response;
      // 01 yalnızca KENDİ yayımladığı yarışmayı çevirebilir; 04 süreç yöneticisi
      // olarak hepsini çevirebilir.
      if (auth.account.roleCode === "01" && !await ownsCompetition(competitionId, auth.account)) {
        return jsonError(403, "Bu yarışmayı yalnızca kriterlerini yayımlayan Yarışma Yöneticisi veya Değerlendirme Yöneticisi aktif/pasif yapabilir.");
      }
      const active = body.active === true;
      const note = typeof body.note === "string" ? body.note : "";
      const result = await setCompetitionActive(competitionId, active, note, auth.account);
      if (result === "not_found") return jsonError(404, "Yarışma bulunamadı.");
      if (result === "archived") return jsonError(409, "Arşivlenmiş yarışma yeniden aktifleştirilemez; önce arşivden çıkarın.");
      await recordAudit({
        actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
        action: "competition_activation_changed",
        targetType: "competition", targetId: competitionId,
        detail: `${result.competitionName} · ${active ? "AKTİF" : "PASİF"}${note.trim() ? ` · ${note.trim().slice(0, 200)}` : ""}`,
      }).catch((auditError) => console.error("[audit] competition activation", auditError));
      return json({ competition: result });
    }

    /*
     * ARŞİVLEME (madde 11) — soft delete. Kayıt silinmez; kim, ne zaman ve
     * hangi gerekçeyle arşivlediği Değerlendirme Yöneticisi panosunda görünür.
     */
    if (action === "archive") {
      const auth = await requirePermission(request, "archive_competition");
      if (!auth.ok) return auth.response;
      if (!await ownsCompetition(competitionId, auth.account)) {
        return jsonError(403, "Yalnızca kriterlerini yayımladığınız yarışmaları arşivleyebilirsiniz.");
      }
      const archived = body.archived !== false;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (archived && !reason) return jsonError(400, "Arşivleme gerekçesi zorunludur.");
      const result = await archiveCompetition(competitionId, archived, reason, auth.account);
      if (result === "not_found") return jsonError(404, "Yarışma bulunamadı.");
      await recordAudit({
        actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
        action: archived ? "competition_archived" : "competition_restored",
        targetType: "competition", targetId: competitionId,
        detail: `${result.competitionName}${reason ? ` · gerekçe: ${reason.slice(0, 200)}` : ""}`,
      }).catch((auditError) => console.error("[audit] competition archive", auditError));
      return json({ competition: result });
    }

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
