import { handleError, json, jsonError, requirePermission } from "../../../../lib/admin-guard";
import { SIMILARITY_PIPELINE_VERSION, sha256Hex } from "../../../../lib/similarity-text";
import {
  findCompetitionWorkflowById,
  listBulkSimilarityPool,
  listBulkSimilarityResults,
} from "../../../../lib/workflow-db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "run_ai_prescreen");
  if (!auth.ok) return auth.response;
  try {
    const competition = await findCompetitionWorkflowById((await context.params).id);
    if (!competition) return jsonError(404, "Yarışma bulunamadı.");
    const pool = await listBulkSimilarityPool(competition.competitionKey, SIMILARITY_PIPELINE_VERSION);
    if (auth.account.roleCode === "02" && !pool.some((entry) => entry.assignedJudgeId === auth.account.id)) {
      return jsonError(403, "Bu yarışmada size atanmış başvuru bulunmuyor.");
    }
    const results = await listBulkSimilarityResults(competition.competitionKey, SIMILARITY_PIPELINE_VERSION);
    const preparedCount = pool.filter((entry) => entry.prepared).length;
    const byId = new Map(results.map((entry) => [entry.applicationId, entry]));
    const unique = new Map<string, {
      pairKey: string; leftLabel: string; rightLabel: string; mathematicalPercent: number;
    }>();
    for (const left of results) {
      const right = left.closestApplicationId ? byId.get(left.closestApplicationId) : null;
      if (!right || (left.report.approxPercent ?? 0) < 20) continue;
      const pairKey = [left.applicationId, right.applicationId].sort().join(":");
      const pair = {
        pairKey,
        leftLabel: left.participantLabel,
        rightLabel: right.participantLabel,
        mathematicalPercent: left.report.approxPercent ?? 0,
      };
      if (!unique.has(pairKey) || pair.mathematicalPercent > unique.get(pairKey)!.mathematicalPercent) unique.set(pairKey, pair);
    }
    const candidates = [...unique.values()].sort((a, b) => b.mathematicalPercent - a.mathematicalPercent).slice(0, 5);
    const snapshot = await sha256Hex(JSON.stringify(pool.map((entry) => [entry.applicationId, entry.submissionVersionId])));
    return json({
      competitionId: competition.id,
      competitionName: competition.competitionName,
      snapshot,
      poolSize: pool.length,
      preparedCount,
      analyzedCount: results.length,
      missingCount: Math.max(0, pool.length - preparedCount),
      possiblePairCount: pool.length * (pool.length - 1) / 2,
      candidates,
      llmStatus: "not_requested",
      note: candidates.length
        ? "En güçlü matematiksel eşleşmeler hazır. Üretken AI özgünlük yorumu henüz çalıştırılmadı."
        : "LLM incelemesine gönderilecek anlamlı eşleşme bulunmadı.",
    });
  } catch (error) { return handleError(error); }
}
