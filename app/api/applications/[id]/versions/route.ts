import { handleError, json, jsonError, requirePermission } from "../../../../lib/admin-guard";
import { readFormDataWithLimit } from "../../../../lib/request-guard";
import { addSubmissionVersion, markSimilarityResultsStale, reportBucket } from "../../../../lib/workflow-db";
import { recordAudit } from "../../../../lib/admin-db";

type RouteContext = { params: Promise<{ id: string }> };
const MAX_REPORT_BYTES = 50 * 1024 * 1024;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "rapor.pdf";
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "submit_application");
  if (!auth.ok) return auth.response;
  const applicationId = (await context.params).id;
  let objectKey = "";
  try {
    // Boyut kapısı ayrıştırmadan ÖNCE (madde 9): 50 MB PDF + form alanları payı.
    const form = await readFormDataWithLimit(request, MAX_REPORT_BYTES + 1024 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "Yeni rapor PDF'i seçilmedi.");
    if (file.size <= 0 || file.size > MAX_REPORT_BYTES) return jsonError(413, "Yeni PDF boş olamaz ve en fazla 50 MB olabilir.");
    if (!file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) return jsonError(400, "Yeni rapor PDF biçiminde olmalıdır.");
    const signature = new TextDecoder().decode(new Uint8Array(await file.slice(0, 5).arrayBuffer()));
    if (signature !== "%PDF-") return jsonError(400, "Dosyanın içeriği geçerli bir PDF değil.");
    objectKey = `applications/${auth.account.id}/${applicationId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    await reportBucket().put(objectKey, file.stream(), {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { participantId: auth.account.id, applicationId },
    });
    const result = await addSubmissionVersion({
      applicationId,
      participant: auth.account,
      fileKey: objectKey,
      fileName: file.name.slice(0, 240),
      mimeType: "application/pdf",
      sizeBytes: file.size,
    });
    if (result === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    if (result === "not_allowed") return jsonError(409, "Bu başvuru için şu anda yeni rapor yükleme hakkı bulunmuyor.");
    objectKey = "";
    await recordAudit({
      actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
      action: "submission_version_added", targetType: "competition_application", targetId: applicationId,
      detail: file.name.slice(0, 240),
    }).catch((error) => console.error("[audit] submission version", error));
    // Havuza yeni rapor sürümü geldi (madde 8): eşlerin benzerlik sonuçları
    // "güncel değil" işaretlenir. Yazım BEKLENİR (Workers izolatı yanıttan
    // sonra beklemeyen D1 yazımını tamamlamayabilir); defter tutma hatası
    // yine de yüklemeyi düşürmez (.catch).
    await markSimilarityResultsStale(result.competitionKey, "Havuza yeni rapor geldi; benzerlik analizini yenileyin.", applicationId)
      .catch((staleError) => console.error("[similarity] havuz eskitme işareti yazılamadı", staleError));
    return json({ application: result }, 201);
  } catch (error) {
    return handleError(error);
  } finally {
    if (objectKey) await reportBucket().delete(objectKey).catch(() => undefined);
  }
}
