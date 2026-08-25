import { findPublishedProfile, listPublishedProfiles, savePublishedProfile } from "../../lib/workflow-db";
import { handleError, json, jsonError, readJson, requireRoles } from "../../lib/admin-guard";
import { validateProfileExport } from "../../lib/profile-loader";
import { recordAudit } from "../../lib/admin-db";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireRoles(request, ["00", "01", "02", "04"]);
  if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const profile = await findPublishedProfile(id);
      return profile ? json({ profile }) : jsonError(404, "Onaylı değerlendirme profili bulunamadı.");
    }
    return json({ profiles: await listPublishedProfiles(auth.account) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireRoles(request, ["00", "01"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(request);
    const validated = validateProfileExport(body.profile);
    if (!validated.profile) return jsonError(400, validated.error);
    const profile = await savePublishedProfile(validated.profile, auth.account);
    await recordAudit({ actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode, action: "profile_published", targetType: "competition_profile", targetId: profile.id, detail: profile.competitionName }).catch((auditError) => console.error("[audit] profile_published", auditError));
    return json({ profile }, 201);
  } catch (error) { return handleError(error); }
}
