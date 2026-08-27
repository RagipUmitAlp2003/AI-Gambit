import { handleError, json, requirePermission } from "../../lib/admin-guard";
import { listCriteriaExtractionRuns } from "../../lib/workflow-db";

export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "read_extractions");
  if (!auth.ok) return auth.response;
  try {
    return json({ extractions: await listCriteriaExtractionRuns(auth.account) });
  } catch (error) {
    return handleError(error);
  }
}
