import { handleError, json, requireRoles } from "../../lib/admin-guard";
import { listCriteriaExtractionRuns } from "../../lib/workflow-db";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireRoles(request, ["00", "01", "04"]);
  if (!auth.ok) return auth.response;
  try {
    return json({ extractions: await listCriteriaExtractionRuns(auth.account) });
  } catch (error) {
    return handleError(error);
  }
}
