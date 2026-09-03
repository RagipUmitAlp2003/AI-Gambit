import { handleError, json, jsonError, requirePermission } from "../../../../lib/admin-guard";
import { addSubmissionVersion, reportBucket, storeReportPdf } from "../../../../lib/workflow-db";
import { pdfIntegrityError } from "../../../../lib/pdf-integrity";
import { recordAudit } from "../../../../lib/admin-db";

type RouteContext = { params: Promise<{ id: string }> };
const MAX_REPORT_BYTES = 50 * 1024 * 1024;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "rapor.pdf";
}

/**
 * POST /api/applications/:id/versions — katılımcının yeni rapor SÜRÜMÜ.
 *
 * YÜKLEME SIRASI (madde 9), ilk başvuru rotasıyla AYNI güvenli yöntem:
 *
 *   1. Yeni PDF benzersiz, sürümlü bir R2 anahtarına yazılır. Yazım `Blob`
 *      ile yapılır ve sonrasında nesnenin uzunluğu R2'den okunarak doğrulanır.
 *      Eskiden `file.stream()` kullanılıyordu: R2 içerik uzunluğunu bilemediği
 *      için boş veya yarım nesne yazılabiliyor, veri tabanı ise sürümü geçerli
 *      sayıyordu.
 *   2. PDF özeti aynı baytlardan yeniden ölçülür ve sürüm satırına yazılır.
 *   3. R2 yazımı DOĞRULANMADAN veri tabanı güncel sürüme geçmez.
 *   4. Veri tabanı işlemi başarısız olursa YALNIZCA yeni oluşturulan nesne
 *      silinir; önceki başarılı PDF yerinde kalır ve başvuru çalışmaya devam
 *      eder.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "submit_application");
  if (!auth.ok) return auth.response;
  const applicationId = (await context.params).id;
  let objectKey = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "Yeni rapor PDF'i seçilmedi.");
    if (file.size <= 0 || file.size > MAX_REPORT_BYTES) return jsonError(413, "Yeni PDF boş olamaz ve en fazla 50 MB olabilir.");
    if (!file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) return jsonError(400, "Yeni rapor PDF biçiminde olmalıdır.");
    const bytes = await file.arrayBuffer();
    // Bütünlük kontrolü ilk başvurudakiyle aynı: yarım indirilmiş veya metin
    // olarak yeniden kaydedilmiş bir dosya sürüm olarak kabul edilmez.
    const integrityError = pdfIntegrityError(bytes);
    if (integrityError) return jsonError(400, integrityError);

    objectKey = `applications/${auth.account.id}/${applicationId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const stored = await storeReportPdf({
      key: objectKey,
      bytes,
      customMetadata: { participantId: auth.account.id, applicationId },
    });
    const result = await addSubmissionVersion({
      applicationId,
      participant: auth.account,
      fileKey: objectKey,
      fileName: file.name.slice(0, 240),
      mimeType: "application/pdf",
      sizeBytes: stored.byteLength,
      pdfHash: stored.pdfHash,
    });
    if (result === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    if (result === "not_allowed") return jsonError(409, "Bu başvuru için şu anda yeni rapor yükleme hakkı bulunmuyor.");
    // Sürüm kesinleşti: yeni nesne artık başvurunun geçerli PDF'idir, silinmez.
    objectKey = "";
    await recordAudit({
      actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode,
      action: "submission_version_added", targetType: "competition_application", targetId: applicationId,
      detail: `${file.name.slice(0, 200)} · ${stored.byteLength} bayt · PDF ${stored.pdfHash.slice(0, 12)}`,
    }).catch((error) => console.error("[audit] submission version", error));
    return json({ application: result }, 201);
  } catch (error) {
    return handleError(error);
  } finally {
    // Sürüm kesinleşmediyse YALNIZCA bu istekte oluşturulan nesne silinir.
    if (objectKey) await reportBucket().delete(objectKey).catch(() => undefined);
  }
}
