import { handleError, json, requirePermission } from "../../../lib/admin-guard";
import { operationsAnalytics } from "../../../lib/workflow-db";
import type { OperationsAnalyticsFilters } from "../../../lib/workflow-types";

const FILTER_KEYS = [
  "competitionKey", "year", "stage", "outcome", "educationStatus",
  "institutionName", "city", "gender", "discoverySource", "teknofestHistory", "teamSize",
] as const satisfies readonly (keyof OperationsAnalyticsFilters)[];

export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "operations_dashboard");
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const filters: OperationsAnalyticsFilters = {};
    for (const key of FILTER_KEYS) {
      const value = url.searchParams.get(key)?.trim();
      if (value) filters[key] = value.slice(0, 200);
    }
    return json({ analytics: await operationsAnalytics(filters) });
  } catch (error) {
    return handleError(error);
  }
}

