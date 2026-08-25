import { findProfile, listProfiles, submitProfileForReview } from "../../lib/workflow-db";
import { handleError, json, jsonError, readJson, requirePermission } from "../../lib/admin-guard";
import { validateProfileExport } from "../../lib/profile-loader";
import { recordAudit } from "../../lib/admin-db";

/**
 * Değerlendirme profili uçları (Aşama A).
 *
 *   GET    profil listesi / tek profil — rol görünürlüğüne göre
 *   POST   kriter profilini yayımlama   — 00, 01
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "read_profiles");
  if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const profile = await findProfile(id);
      if (!profile) return jsonError(404, "Değerlendirme profili bulunamadı.");
      // 01 yalnızca kendi hazırladığı profili, 02/04 yalnızca yürürlüktekini görür.
      if (auth.account.roleCode === "01" && profile.createdBy !== auth.account.id) {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
      if (["02", "04"].includes(auth.account.roleCode) && profile.status !== "approved") {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
      return json({ profile });
    }
    return json({ profiles: await listProfiles(auth.account) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "publish_profile");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(request);
    const validated = validateProfileExport(body.profile);
    if (!validated.profile) return jsonError(400, validated.error);
    const profile = await submitProfileForReview(validated.profile, auth.account);
    await recordAudit({ actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode, action: "profile_published", targetType: "competition_profile", targetId: profile.id, detail: profile.competitionName }).catch((auditError) => console.error("[audit] profile_published", auditError));
    return json({ profile }, 201);
  } catch (error) { return handleError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "publish_profile");
  if (!auth.ok) return auth.response;
  return jsonError(405, "Kriter profilini değiştirmek için Kriter Atölyesi'nde düzenleyip yeniden yayımlayın.");
}
