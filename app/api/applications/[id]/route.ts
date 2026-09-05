import { env } from "cloudflare:workers";
import { after } from "next/server";
import { queueApprovedSimilarity, prepareApprovedSimilarity } from "../../../lib/similarity-preparation";
import { handleError, json, jsonError, readJson, requirePermission } from "../../../lib/admin-guard";
import { configuredByteLimit } from "../../../lib/request-guard";
import {
  archiveApplication,
  coordinateApplication,
  attachSimilarityToEvaluation,
  deleteApplicationEvaluation,
  findApplication,
  findSimilarityResult,
  markApplicationAnalyzing,
  reopenApplicationReview,
  reportBucket,
  resolveEvaluationContext,
  saveApplicationEvaluation,
  saveApplicationReview,
} from "../../../lib/workflow-db";
import {
  JUDGE_EVIDENCE_MODES,
  isRuleVerdict,
  type JudgeCriterionDecision,
  type JudgeReview,
  type ReportEvaluation,
} from "../../../lib/types";
import { recordAudit, recordMail } from "../../../lib/admin-db";
import type { CompetitionApplication } from "../../../lib/workflow-types";
import { buildApplicationOutcomeMail, deliverMail } from "../../../lib/mailer";

type RouteContext = { params: Promise<{ id: string }> };

/** Kriter kararının biçimsel doğrulaması; içerik kuralları judge-review + workflow-db'de. */
function validCriterionDecision(decision: JudgeCriterionDecision): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (typeof decision.criterionId !== "string" || !decision.criterionId || decision.criterionId.length > 240) return false;
  if (typeof decision.criterionName !== "string" || decision.criterionName.length > 300) return false;
  if (!["UYGUN", "OLUMSUZ"].includes(decision.aiVerdict)) return false;
  if (!["pending", "approved", "rejected"].includes(decision.judgeVerdict)) return false;
  // Hakem, AI bulgusunu reddettiğinde YERİNE yazdığı kendi sonucu.
  // Eski istemciler alanı hiç göndermeyebilir (undefined ≈ null): geriye uyum.
  if (decision.judgeResult != null && !["UYGUN", "OLUMSUZ"].includes(decision.judgeResult)) return false;
  if (typeof decision.rejectionReason !== "string" || decision.rejectionReason.length > 2_000) return false;
  if (decision.evidenceMode != null && !(JUDGE_EVIDENCE_MODES as readonly string[]).includes(decision.evidenceMode)) return false;
  if (decision.evidencePage != null
    && (!Number.isInteger(decision.evidencePage) || decision.evidencePage < 1 || decision.evidencePage > 10_000)) return false;
  if (decision.evidenceSection != null && (typeof decision.evidenceSection !== "string" || decision.evidenceSection.length > 300)) return false;
  if (typeof decision.evidenceQuote !== "string" || decision.evidenceQuote.length > 1_200) return false;
  if (typeof decision.missingContent !== "string" || decision.missingContent.length > 400) return false;
  return true;
}

/**
 * Hakem kararı puan taşımaz: her kriter için nihai kural durumu
 * (BAŞARILI / REVİZYON / KRİTİK_HATA) ya da karar bekliyorken null bulunur.
 * Yeni akışta `criterionDecisions` her görünür PDF kriteri için hakemin
 * bağımsız Onay/Ret kararını taşır; içerik kuralları sunucuda ayrıca doğrulanır.
 */
function validReview(review: JudgeReview): boolean {
  if (!["in_progress", "completed"].includes(review.status) || !Array.isArray(review.decisions)) return false;
  if (typeof review.overallNote !== "string" || review.overallNote.length > 5_000) return false;
  if (typeof review.feedbackApproved !== "boolean" || !review.finalFeedback || typeof review.finalFeedback !== "object") return false;
  const feedbackLists = [review.finalFeedback.strengths, review.finalFeedback.improvements, review.finalFeedback.suggestions];
  // A feedback line combines a 300-char title, 2000-char reason, 1200-char
  // quote, section and location. Do not reject valid criterion decisions.
  if (feedbackLists.some((list) => !Array.isArray(list) || list.length > 100 || list.some((item) => typeof item !== "string" || item.length > 6_000))) return false;
  if (review.criterionDecisions !== undefined) {
    if (!Array.isArray(review.criterionDecisions) || review.criterionDecisions.length > 500) return false;
    if (!review.criterionDecisions.every(validCriterionDecision)) return false;
  }
  return review.decisions.every((decision) => decision && typeof decision.criterionId === "string"
    && decision.criterionId.length > 0 && decision.criterionId.length <= 240
    && ["pending", "accepted", "adjusted"].includes(decision.verdict)
    && (decision.finalVerdict === null || isRuleVerdict(decision.finalVerdict))
    && (decision.verdict === "pending" || decision.finalVerdict !== null)
    && typeof decision.note === "string" && decision.note.length <= 2_000);
}

/**
 * Kayıt öncesi süzgeç: eski bir istemci DEGERLENDIRILEMEDI bulgusu gönderse
 * bile PDF dışı kurallar veri tabanına yazılmaz; sayaçlar yalnızca PDF
 * kriterlerini sayar (madde 2).
 */
function sanitizeEvaluation(evaluation: ReportEvaluation): ReportEvaluation {
  const findings = evaluation.findings.filter((finding) => finding.verdict !== "DEGERLENDIRILEMEDI");
  if (findings.length === evaluation.findings.length) return evaluation;
  return {
    ...evaluation,
    findings,
    summary: { ...evaluation.summary, total: findings.length, disiKanit: 0 },
  };
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
 * Başvuru üzerindeki işlemler ayrı yetkilere bölünür (bkz. authorization.ts):
 *   AI ön değerlendirmesi  (start_analysis / save_evaluation / attach_similarity /
 *                           analysis_failed / delete_analysis)                    → run_ai_prescreen (02)
 *   Nihai uzman kararı     (save_review / reopen_review)                          → final_judgement (02)
 *   Koordinasyon           (remind / requeue / request_document)                  → coordinate_evaluation (04)
 *
 * `assign_judge` eylemi KALDIRILDI: hakem ataması yalnızca sistem tarafından
 * otomatik yapılır; istek hangi rolden gelirse gelsin reddedilir.
 * Admin (00) başvuru akışına erişmez; yalnızca yönetici ataması yapar.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = (await context.params).id;
    // `save_evaluation` gövdesi (bulgular + kanıt alıntıları) 2 MB varsayılanı
    // aşabilir; akışlı bayt kapısı yine parse'tan ÖNCE çalışır (madde 9).
    const body = await readJson(request, configuredByteLimit("EVALUATION_JSON_MAX_BYTES", 4 * 1024 * 1024));
    if (body.action === "assign_judge") {
      // Kapatılan uç: hangi rol çağırırsa çağırsın manuel atama yapılamaz.
      return jsonError(403,
        "Manuel hakem atama kaldırıldı: atamayı sistem otomatik yapar. Aktif Hakem yoksa "
        + "yeni bir Hakem hesabı açıldığında bekleyen başvurular otomatik olarak dağıtılır.");
    }
    const permission = body.action === "save_review" || body.action === "reopen_review"
      ? "final_judgement"
      : body.action === "archive_application"
        ? "archive_application"
        : ["remind_judge", "requeue_analysis", "request_document"].includes(String(body.action))
          ? "coordinate_evaluation"
          : "run_ai_prescreen";
    const auth = await requirePermission(request, permission);
    if (!auth.ok) return auth.response;
    const visibleApplication = await findApplication(id, auth.account);
    if (!visibleApplication) return jsonError(404, "Başvuru bulunamadı.");
    let notification: { delivered: boolean; message: string } = { delivered: false, message: "" };
    /** Başarısız analiz denemesinde önceki başarılı sonuç korundu mu? */
    let previousAnalysisKept = false;
    if (["remind_judge", "requeue_analysis", "request_document"].includes(String(body.action))) {
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
      /*
       * BÜTÜNLÜK KAPISI (madde 3)
       *
       * Sonuç, sunucunun kendi kurduğu zincirle EŞLEŞMEDEN kaydedilmez:
       *   application_id → competition_key → current_pdf_version → latest
       *   published criteria version → evaluation_result
       *
       * Böylece istemci başka bir başvurunun, başka bir PDF sürümünün ya da
       * eski bir kriter setinin sonucunu bu kayda yazdıramaz. Uyuşmazlıkta
       * sessizce kaydedilmez; anlaşılır bir 409 döner.
       */
      const context = await resolveEvaluationContext(id, auth.account);
      if (typeof context === "string") {
        return jsonError(409, context === "forbidden"
          ? "Bu başvuru size atanmadı; sonucu yalnızca atanan hakem kaydedebilir."
          : "Değerlendirme bağlamı çözümlenemedi; sonuç kaydedilmedi.");
      }
      if (evaluation.profileRef?.criteriaVersion !== context.criteriaVersion.criteriaVersion
        || evaluation.profileRef?.criteriaHash !== context.criteriaVersion.criteriaHash) {
        return jsonError(409,
          "Kriterler güncellendi, yeniden analiz gerekli. Bu sonuç "
          + `v${evaluation.profileRef?.criteriaVersion ?? "?"} kriter sürümüyle üretildi; `
          + `yürürlükteki sürüm v${context.criteriaVersion.criteriaVersion}.`);
      }
      // PDF özeti sunucudaki GEÇERLİ sürümle karşılaştırılır: başka bir belgenin
      // analizi bu başvuruya yazılamaz.
      const object = await reportBucket().get(context.fileKey);
      if (!object) return jsonError(409, "Başvurunun geçerli PDF sürümü okunamadı; sonuç kaydedilmedi.");
      const digest = await crypto.subtle.digest("SHA-256", await object.arrayBuffer());
      const expectedHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (evaluation.report?.pdfHash !== expectedHash) {
        return jsonError(409,
          "Analiz sonucu bu başvurunun geçerli PDF sürümüne ait değil; sonuç kaydedilmedi. "
          + "Katılımcı yeni sürüm yüklemiş olabilir — analizi yenileyin.");
      }
      /*
       * BENZERLİK RAPORU SUNUCUDAN YAZILIR (madde 9.12): istemcinin gönderdiği
       * `similarityReport` kopyasına güvenilmez — hakem istemcisi inceleme
       * işaretini silemez veya sahteleyemez. Bu PDF sürümüne bağlı yetkili
       * sonuç `similarity_results` satırından okunur; satır yoksa (benzerlik
       * çalışmadı ya da "AI analizini sil" kaldırdı) alan null yazılır.
       */
      const authoritativeSimilarity = await findSimilarityResult(id, expectedHash);
      await saveApplicationEvaluation(id, auth.account, {
        ...sanitizeEvaluation(evaluation),
        similarityReport: authoritativeSimilarity,
      }, false, {
        criteriaVersion: context.criteriaVersion.criteriaVersion,
        criteriaHash: context.criteriaVersion.criteriaHash,
        pdfHash: expectedHash,
        submissionVersionId: context.submissionVersionId,
      });
    } else if (body.action === "attach_similarity") {
      /*
       * BENZERLİK SONUCUNU KAYITLI ANALİZE İLİŞTİR (madde 4).
       *
       * Kriter analizi benzerliği beklemeden kaydedilir; benzerlik bitince
       * istemci bu eylemi çağırır. Yetkili sonuç yine SUNUCUDAN okunur
       * (istemci rapor gönderemez) ve yalnızca `similarityReport` alanı
       * yazılır: hakem kararları, kriter kararları ve daha yeni bir analiz
       * bu yazmayla EZİLMEZ.
       */
      const attached = await attachSimilarityToEvaluation(id, auth.account);
      if (attached === "not_found") return jsonError(404, "Başvuru bulunamadı.");
      if (attached === "forbidden") return jsonError(403, "Bu başvuru size atanmadı.");
    } else if (body.action === "delete_analysis") {
      /*
       * AI ANALİZİNİ SİL (madde 5): yalnızca AI analizi, tamamlanmamış kriter
       * kararları ve bu PDF sürümünün benzerlik sonucu kaldırılır. Başvuru,
       * PDF, takım bilgileri, hakem ataması ve yarışma korunur. Nihai karar
       * kesinleşmişse önce "Kararı yeniden aç" gerekir — sunucu doğrular.
       */
      const deleted = await deleteApplicationEvaluation(id, auth.account);
      if (deleted === "not_found") return jsonError(404, "Başvuru bulunamadı.");
      if (deleted === "forbidden") return jsonError(403, "Yalnızca size atanmış başvurunun AI analizini silebilirsiniz.");
      if (deleted === "completed_locked") {
        return jsonError(409,
          "Bu başvurunun nihai kararı kesinleştirildi. AI analizini silmek için önce “Kararı yeniden aç” işlemini yapın.");
      }
      if (deleted === "nothing_to_delete") return jsonError(409, "Silinecek bir AI analizi yok.");
      await recordAudit({
        actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
        action: "ai_analysis_deleted", targetType: "competition_application", targetId: id,
        // Silinen AI metni denetim kaydına YAZILMAZ; yalnızca işlem künyesi tutulur.
        detail: `${visibleApplication.competitionName} · ${visibleApplication.teamName}`,
      }).catch((auditError) => console.error("[audit] ai_analysis_deleted", auditError));
    } else if (body.action === "reopen_review") {
      const reopened = await reopenApplicationReview(id, auth.account);
      if (reopened === "not_found") return jsonError(404, "Başvuru bulunamadı.");
      if (reopened === "forbidden") return jsonError(403, "Yalnızca size atanmış başvurunun kararını yeniden açabilirsiniz.");
      if (reopened === "not_completed") return jsonError(409, "Bu başvurunun kesinleşmiş bir nihai kararı yok.");
      if (reopened === "locked") return jsonError(409, "Bu yarışmanın hakem kararları donduruldu; karar yeniden açılamaz.");
    } else if (body.action === "archive_application") {
      // Arşivleme = soft delete. Kayıt, PDF ve değerlendirme geçmişi silinmez.
      const archived = body.archived !== false;
      const reason = typeof body.note === "string" ? body.note.trim() : "";
      if (archived && !reason) return jsonError(400, "Başvuruyu listeden kaldırmak için gerekçe yazın.");
      const result = await archiveApplication(id, archived, reason, auth.account);
      if (result === "not_found") return jsonError(404, "Başvuru bulunamadı.");
      if (result === "forbidden") return jsonError(403, "Yalnızca size atanmış başvuruyu listenizden kaldırabilirsiniz.");
      await recordAudit({
        actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
        action: archived ? "application_archived" : "application_restored",
        targetType: "competition_application", targetId: id,
        detail: `${visibleApplication.competitionName} · ${visibleApplication.teamName}`
          + `${reason ? ` · gerekçe: ${reason.slice(0, 200)}` : ""}`,
      }).catch((auditError) => console.error("[audit] application archive", auditError));
      // Arşivlenen kayıt hakemin aktif listesinden çıktığı için geri
      // döndürülmez; kayıt SİLİNMEDİ, yalnızca işaretlendi.
      return json({ application: result === "archived" ? null : result, archived });
    } else if (body.action === "analysis_failed") {
      /*
       * Başarısız deneme ÖNCEKİ BAŞARILI analizi silmez (madde 8): kayıt
       * yalnızca durum ve deneme geçmişi yazar. Eski sonuç korunduysa
       * istemciye söylenir ki ekran "eski analiz korunuyor" diyebilsin.
       */
      const outcome = await saveApplicationEvaluation(id, auth.account, null, true);
      previousAnalysisKept = outcome.previousAnalysisKept;
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
      // Preparation failure must never roll back or delay the final judge decision.
      if (review.status === "completed" && review.outcome === "accepted") {
        try {
          if (await queueApprovedSimilarity(id, auth.account)) {
            after(async () => {
              try { await prepareApprovedSimilarity(id, auth.account); }
              catch (error) { console.error("[similarity-background]", error); }
            });
          }
        } catch (error) { console.error("[similarity-queue] approval preserved", error); }
      }
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
    return json({
      application,
      ...(notification.message ? { notificationWarning: notification.message } : {}),
      ...(previousAnalysisKept ? { previousAnalysisKept: true } : {}),
    });
  } catch (error) { return handleError(error); }
}
