import { env } from "cloudflare:workers";
import { handleError, json, jsonError, readJson, requirePermission } from "../../../lib/admin-guard";
import { assignApplication, coordinateApplication, findApplication, markApplicationAnalyzing, saveApplicationEvaluation, saveApplicationReview } from "../../../lib/workflow-db";
import { isRuleVerdict, type JudgeReview, type ReportEvaluation } from "../../../lib/types";
import { findAccountById, recordAudit, recordMail } from "../../../lib/admin-db";
import type { CompetitionApplication } from "../../../lib/workflow-types";
import { buildApplicationOutcomeMail, deliverMail } from "../../../lib/mailer";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Hakem kararı puan taşımaz: her kriter için nihai kural durumu
 * (BAŞARILI / REVİZYON / KRİTİK_HATA) ya da karar bekliyorken null bulunur.
 */
function validReview(review: JudgeReview): boolean {
  if (!["in_progress", "completed"].includes(review.status) || !Array.isArray(review.decisions)) return false;
  if (typeof review.overallNote !== "string" || review.overallNote.length > 5_000) return false;
  if (typeof review.feedbackApproved !== "boolean" || !review.finalFeedback || typeof review.finalFeedback !== "object") return false;
  const feedbackLists = [review.finalFeedback.strengths, review.finalFeedback.improvements, review.finalFeedback.suggestions];
  if (feedbackLists.some((list) => !Array.isArray(list) || list.length > 100 || list.some((item) => typeof item !== "string" || item.length > 1_000))) return false;
  return review.decisions.every((decision) => decision && typeof decision.criterionId === "string"
    && decision.criterionId.length > 0 && decision.criterionId.length <= 240
    && ["pending", "accepted", "adjusted"].includes(decision.verdict)
    && (decision.finalVerdict === null || isRuleVerdict(decision.finalVerdict))
    && (decision.verdict === "pending" || decision.finalVerdict !== null)
    && typeof decision.note === "string" && decision.note.length <= 2_000);
}

/** Sunucuya yazılmadan önce dört aşamalı sözleşmenin asgari şekli doğrulanır. */
function validEvaluation(evaluation: ReportEvaluation | undefined): evaluation is ReportEvaluation {
  if (!evaluation || evaluation.version !== "2.0") return false;
  if (!Array.isArray(evaluation.findings) || !Array.isArray(evaluation.stages) || !Array.isArray(evaluation.preChecks)) return false;
  const summary = evaluation.summary;
  if (!summary || typeof summary !== "object" || !isRuleVerdict(summary.overall)) return false;
  if ([summary.total, summary.basarili, summary.revizyon, summary.kritikHata].some((value) => !Number.isInteger(value) || value < 0)) return false;
  const feedback = evaluation.feedbackDraft;
  if (!feedback || typeof feedback !== "object" || [feedback.strengths, feedback.improvements, feedback.suggestions].some((list) => !Array.isArray(list))) return false;
  return evaluation.findings.every((finding) => finding && typeof finding.criterionId === "string" && isRuleVerdict(finding.verdict) && Array.isArray(finding.evidence))
    && evaluation.stages.every((stage) => stage && typeof stage.stage === "string" && isRuleVerdict(stage.verdict));
}

/**
 * Nihai karar yarışmacıya e-posta ile bildirilir. Ret kararında gerekçe mesajın
 * gövdesindedir; aynı gerekçe yarışmacının "Başvurularım" ekranında da görünür
 * (bkz. workflow-db · participantResultHidden).
 *
 * KARAR GERİ ALINMAZ: bu işlev `saveApplicationReview` BAŞARILI olduktan sonra
 * çağrılır ve hiçbir koşulda hata fırlatmaz. Bildirim gönderilemezse sebep
 * giden kutusuna ve sunucu günlüğüne yazılır, çağırana `notificationWarning`
 * alanıyla bildirilir; kararın kendisi veri tabanında kalır.
 */
async function notifyOutcome(
  application: CompetitionApplication,
  review: JudgeReview,
  requestUrl: string,
): Promise<{ delivered: boolean; message: string }> {
  if (review.status !== "completed" || review.outcome === "pending") return { delivered: false, message: "" };
  if (!application.participantEmail) {
    return { delivered: false, message: "Yarışmacının kayıtlı e-posta adresi bulunmadığı için bildirim gönderilemedi. Karar kaydedildi." };
  }
  try {
    const baseUrl = env.APP_BASE_URL || new URL(requestUrl).origin;
    const envelope = buildApplicationOutcomeMail({
      fullName: application.applicantFullName || application.participantName,
      email: application.participantEmail,
      teamName: application.teamName,
      competitionName: application.competitionName,
      outcome: review.outcome,
      reason: review.outcomeNote,
      portalUrl: `${baseUrl.replace(/\/+$/, "")}/`,
    });
    const outcome = await deliverMail(env, envelope);
    await recordMail({
      accountId: application.participantId || null,
      toEmail: envelope.to,
      subject: envelope.subject,
      body: envelope.storedBody,
      status: outcome.status,
      provider: outcome.provider,
      error: outcome.error,
    }).catch((mailError) => console.error("[mail] application outcome kaydedilemedi", mailError));
    if (outcome.status === "sent") return { delivered: true, message: "" };
    return {
      delivered: false,
      message: `${outcome.error ?? "Bildirim gönderilemedi; giden kutusuna alındı."} Karar kaydedildi.`,
    };
  } catch (notifyError) {
    // Bildirim katmanının hiçbir hatası kararı düşürmez.
    console.error("[mail] nihai karar bildirimi başarısız", notifyError);
    return {
      delivered: false,
      message: "Karar kaydedildi ancak yarışmacıya bildirim gönderilemedi; sistem yöneticisi giden kutusunu kontrol etmelidir.",
    };
  }
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
 * Başvuru üzerindeki işlemler üç ayrı yetkiye bölünür (bkz. authorization.ts):
 *   AI ön değerlendirmesi  (start_analysis / save_evaluation / analysis_failed) → run_ai_prescreen (02)
 *   Nihai uzman kararı     (save_review)                                        → final_judgement (02)
 *   Atama ve koordinasyon  (assign_judge / remind / requeue / request_document) → coordinate_evaluation (04)
 *
 * Admin (00) başvuru akışına erişmez; yalnızca yönetici ataması yapar.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    const body = await readJson(request);
    const permission = body.action === "save_review"
      ? "final_judgement"
      : body.action === "assign_judge" || ["remind_judge", "requeue_analysis", "request_document"].includes(String(body.action))
        ? "coordinate_evaluation"
        : "run_ai_prescreen";
    const auth = await requirePermission(request, permission);
    if (!auth.ok) return auth.response;
    const visibleApplication = await findApplication(id, auth.account);
    if (!visibleApplication) return jsonError(404, "Başvuru bulunamadı.");
    let notification: { delivered: boolean; message: string } = { delivered: false, message: "" };
    if (body.action === "assign_judge") {
      const judgeId = typeof body.judgeId === "string" ? body.judgeId.trim() : "";
      const judge = judgeId ? await findAccountById(judgeId) : null;
      if (!judge || judge.status !== "active" || judge.roleCode !== "02") return jsonError(400, "Aktif bir Hakem seçin.");
      const assigned = await assignApplication(id, judge, auth.account, typeof body.note === "string" ? body.note : "");
      if (assigned === "initial_forbidden") return jsonError(403, "İlk hakem atamasını yalnızca Değerlendirme Yöneticisi yapabilir.");
      if (assigned === "already_assigned") return jsonError(409, "Bu başvuru zaten seçilen Hakeme atanmış.");
      if (assigned === "completed") return jsonError(409, "Tamamlanmış başvuru yeniden atanamaz.");
      if (assigned === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    } else if (["remind_judge", "requeue_analysis", "request_document"].includes(String(body.action))) {
      const coordinated = await coordinateApplication(
        id,
        body.action as "remind_judge" | "requeue_analysis" | "request_document",
        auth.account,
        typeof body.note === "string" ? body.note : "",
      );
      if (coordinated === "invalid_state") return jsonError(409, "Bu işlem başvurunun mevcut durumunda uygulanamaz.");
      if (coordinated === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    } else if (body.action === "start_analysis") {
      const start = await markApplicationAnalyzing(id, auth.account);
      if (start === "profile_missing") return jsonError(409, "Bu yarışma için yayımlanmış değerlendirme profili yok. Yarışma Yöneticisi şartname kriterlerini doğrulayıp profili yayımlamalıdır.");
      if (start === "conflict") return jsonError(409, "Bu başvuru başka bir işlemde veya zaten analiz edilmiş.");
    } else if (body.action === "save_evaluation") {
      const evaluation = body.evaluation as ReportEvaluation | undefined;
      if (!validEvaluation(evaluation)) return jsonError(400, "AI değerlendirme çıktısı geçerli değil.");
      await saveApplicationEvaluation(id, auth.account, evaluation);
    } else if (body.action === "analysis_failed") {
      await saveApplicationEvaluation(id, auth.account, null, true);
    } else if (body.action === "save_review") {
      const review = body.review as JudgeReview | undefined;
      if (!review || !validReview(review)) return jsonError(400, "Hakem değerlendirmesi geçerli değil.");
      if (auth.account.roleCode === "02" && !["awaiting_judge", "judge_in_review", "completed"].includes(visibleApplication.status)) {
        return jsonError(409, "Nihai karar verilmeden önce bu raporun AI ön analizi tamamlanmalıdır.");
      }
      if (!["pending", "accepted", "rejected", "revision_required"].includes(review.outcome)) return jsonError(400, "Başvuru sonucu geçerli değil.");
      if (review.status === "completed" && review.outcome === "pending") return jsonError(400, "Değerlendirmeyi tamamlamak için kabul, ret veya düzeltme sonucu seçin.");
      if (typeof review.outcomeNote !== "string" || review.outcomeNote.length > 1_000) return jsonError(400, "Sonuç açıklaması en fazla 1000 karakter olabilir.");
      if (review.status === "completed" && review.outcome === "rejected" && !review.outcomeNote.trim()) {
        return jsonError(400, "Ret kararı için yarışmacıya iletilecek bir gerekçe yazın.");
      }
      await saveApplicationReview(id, auth.account, review);
      // Karar veri tabanına yazıldı; bildirim başarısız olsa bile geri alınmaz.
      notification = await notifyOutcome(visibleApplication, review, request.url);
    } else return jsonError(400, "Başvuru işlemi tanınmadı.");
    const application = await findApplication(id, auth.account);
    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: String(body.action),
      targetType: "competition_application",
      targetId: id,
      // Bildirim hatası ayrıca denetim izine yazılır; kararın kendisi etkilenmez.
      detail: `${application?.competitionName ?? ""}${notification.message ? ` · bildirim başarısız: ${notification.message}` : ""}`,
    }).catch((auditError) => console.error("[audit] application update", auditError));
    return json({ application, ...(notification.message ? { notificationWarning: notification.message } : {}) });
  } catch (error) { return handleError(error); }
}
