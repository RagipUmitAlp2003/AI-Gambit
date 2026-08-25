import { handleError, json, jsonError, readJson, requirePermission } from "../../../lib/admin-guard";
import { findApplication, markApplicationAnalyzing, saveApplicationEvaluation, saveApplicationReview } from "../../../lib/workflow-db";
import type { JudgeReview, ReportEvaluation } from "../../../lib/types";
import { recordAudit } from "../../../lib/admin-db";

type RouteContext = { params: Promise<{ id: string }> };

function validReview(review: JudgeReview): boolean {
  if (!["in_progress", "completed"].includes(review.status) || !Array.isArray(review.decisions)) return false;
  if (typeof review.overallNote !== "string" || review.overallNote.length > 5_000) return false;
  if (typeof review.feedbackApproved !== "boolean" || !review.finalFeedback || typeof review.finalFeedback !== "object") return false;
  const feedbackLists = [review.finalFeedback.strengths, review.finalFeedback.improvements, review.finalFeedback.suggestions];
  if (feedbackLists.some((list) => !Array.isArray(list) || list.length > 100 || list.some((item) => typeof item !== "string" || item.length > 1_000))) return false;
  return review.decisions.every((decision) => decision && typeof decision.criterionId === "string"
    && decision.criterionId.length > 0 && decision.criterionId.length <= 240
    && ["pending", "accepted", "adjusted"].includes(decision.verdict)
    && (decision.finalScore === null || (typeof decision.finalScore === "number" && Number.isFinite(decision.finalScore)))
    && (decision.penaltyPoints === undefined || decision.penaltyPoints === null || (typeof decision.penaltyPoints === "number" && Number.isFinite(decision.penaltyPoints)))
    && typeof decision.note === "string" && decision.note.length <= 2_000);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "read_applications");
  if (!auth.ok) return auth.response;
  try {
    const application = await findApplication((await context.params).id, auth.account);
    return application ? json({ application }) : jsonError(404, "Başvuru bulunamadı.");
  } catch (error) { return handleError(error); }
}

/**
 * Başvuru üzerindeki işlemler iki ayrı yetkiye bölünür:
 *   AI ön değerlendirmesi  (start_analysis / save_evaluation / analysis_failed) → 00, 02
 *   Nihai uzman kararı     (save_review)                                        → yalnızca 02
 *
 * Nihai karar hakem dışında hiçbir role açık değildir; moderatör de veremez.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const preflight = await requirePermission(request, "run_ai_prescreen");
  if (!preflight.ok) return preflight.response;
  try {
    const id = (await context.params).id;
    const body = await readJson(request);
    const auth = body.action === "save_review"
      ? await requirePermission(request, "final_judgement")
      : preflight;
    if (!auth.ok) return auth.response;
    if (!await findApplication(id, auth.account)) return jsonError(404, "Başvuru bulunamadı.");
    if (body.action === "start_analysis") {
      const start = await markApplicationAnalyzing(id, auth.account);
      if (start === "profile_missing") return jsonError(409, "Bu yarışma için hakem onaylı değerlendirme profili yok. Yarışma yöneticisi profili hazırlayıp hakem incelemesine göndermeli, hakem de onaylamalıdır.");
      if (start === "conflict") return jsonError(409, "Bu başvuru başka bir işlemde veya zaten analiz edilmiş.");
    } else if (body.action === "save_evaluation") {
      const evaluation = body.evaluation as ReportEvaluation | undefined;
      if (!evaluation || evaluation.version !== "1.0" || !Array.isArray(evaluation.findings)) return jsonError(400, "AI değerlendirme çıktısı geçerli değil.");
      await saveApplicationEvaluation(id, auth.account, evaluation);
    } else if (body.action === "analysis_failed") {
      await saveApplicationEvaluation(id, auth.account, null, true);
    } else if (body.action === "save_review") {
      const review = body.review as JudgeReview | undefined;
      if (!review || !validReview(review)) return jsonError(400, "Hakem değerlendirmesi geçerli değil.");
      if (!["pending", "accepted", "rejected", "revision_required"].includes(review.outcome)) return jsonError(400, "Başvuru sonucu geçerli değil.");
      if (review.status === "completed" && review.outcome === "pending") return jsonError(400, "Değerlendirmeyi tamamlamak için kabul, ret veya düzeltme sonucu seçin.");
      if (typeof review.outcomeNote !== "string" || review.outcomeNote.length > 1_000) return jsonError(400, "Sonuç açıklaması en fazla 1000 karakter olabilir.");
      await saveApplicationReview(id, auth.account, review);
    } else return jsonError(400, "Başvuru işlemi tanınmadı.");
    const application = await findApplication(id, auth.account);
    await recordAudit({ actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode, action: String(body.action), targetType: "competition_application", targetId: id, detail: application?.competitionName ?? "" }).catch((auditError) => console.error("[audit] application update", auditError));
    return json({ application });
  } catch (error) { return handleError(error); }
}
