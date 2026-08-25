import { handleError, jsonError, requireRoles } from "../../../../lib/admin-guard";
import { applicationFileKey, findApplication, reportBucket } from "../../../../lib/workflow-db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireRoles(request, ["00", "02", "03"]);
  if (!auth.ok) return auth.response;
  try {
    const id = (await context.params).id;
    const application = await findApplication(id, auth.account);
    if (!application) return jsonError(404, "Başvuru bulunamadı.");
    const key = await applicationFileKey(id, auth.account);
    const object = key ? await reportBucket().get(key) : null;
    if (!object) return jsonError(404, "Başvuru PDF'i saklama alanında bulunamadı.");
    return new Response(object.body, { headers: {
      "content-type": "application/pdf",
      "content-length": String(object.size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(application.fileName ?? "basvuru.pdf")}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    } });
  } catch (error) { return handleError(error); }
}
