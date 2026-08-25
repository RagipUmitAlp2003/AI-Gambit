import { findProfile, listProfiles, reviewProfile, submitProfileForReview } from "../../lib/workflow-db";
import { handleError, json, jsonError, readJson, requirePermission } from "../../lib/admin-guard";
import { validateProfileExport } from "../../lib/profile-loader";
import { recordAudit } from "../../lib/admin-db";

/**
 * Değerlendirme profili uçları (Aşama A).
 *
 *   GET    profil listesi / tek profil        — 00, 01 (kendi), 02, 03 (yalnızca onaylı)
 *   POST   hakem incelemesine gönderme        — 00, 01
 *   PATCH  ikinci aşama doğrulama (onay/red)  — 00, 02
 *
 * Profil POST ile YÜRÜRLÜĞE GİRMEZ; hakem onayı beklemeye alınır.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "read_profiles");
  if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const profile = await findProfile(id);
      if (!profile) return jsonError(404, "Değerlendirme profili bulunamadı.");
      // 01 yalnızca kendi hazırladığı profili, 03 yalnızca yürürlüktekini görür.
      if (auth.account.roleCode === "01" && profile.createdBy !== auth.account.id) {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
      if (auth.account.roleCode === "03" && profile.status !== "approved") {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
      return json({ profile });
    }
    return json({ profiles: await listProfiles(auth.account) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "author_profile");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(request);
    const validated = validateProfileExport(body.profile);
    if (!validated.profile) return jsonError(400, validated.error);
    const profile = await submitProfileForReview(validated.profile, auth.account);
    await recordAudit({ actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode, action: "profile_submitted_for_review", targetType: "competition_profile", targetId: profile.id, detail: profile.competitionName }).catch((auditError) => console.error("[audit] profile_submitted_for_review", auditError));
    return json({ profile }, 201);
  } catch (error) { return handleError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "review_profile");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(request);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return jsonError(400, "Profil kimliği gerekli.");
    if (body.decision !== "approve" && body.decision !== "request_changes") {
      return jsonError(400, "Karar 'approve' veya 'request_changes' olmalıdır.");
    }
    const note = typeof body.note === "string" ? body.note : "";
    if (body.decision === "request_changes" && !note.trim()) {
      return jsonError(400, "Düzeltme talebinde gerekçe zorunludur.");
    }

    // Hakem kriterleri düzenlediyse düzeltilmiş profil gövdede gelir.
    let edited: undefined | Parameters<typeof reviewProfile>[4];
    if (body.profile !== undefined) {
      const validated = validateProfileExport(body.profile);
      if (!validated.profile) return jsonError(400, validated.error);
      edited = validated.profile;
    }

    const result = await reviewProfile(id, auth.account, body.decision, note, edited);
    if (result === "not_found") return jsonError(404, "Değerlendirme profili bulunamadı.");
    if (result === "not_pending") return jsonError(409, "Bu profil zaten onaylanmış; yeniden incelemeye alınamaz.");
    await recordAudit({ actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode, action: body.decision === "approve" ? "profile_approved" : "profile_changes_requested", targetType: "competition_profile", targetId: id, detail: result.competitionName }).catch((auditError) => console.error("[audit] profile review", auditError));
    return json({ profile: result });
  } catch (error) { return handleError(error); }
}
