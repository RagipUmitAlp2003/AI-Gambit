import { handleError, jsonError, requirePermission } from "../../../../lib/admin-guard";
import { findProfile, reportBucket } from "../../../../lib/workflow-db";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Yayımlanmış profilin KAYNAK ŞARTNAME PDF'ini sunar.
 *
 * Kriter Atölyesi ve Kriter Geçmişi'ndeki "Kaynak s. N" bağlantısı buraya
 * gider (`#page=N` ile). Şartname yalnızca tarayıcıdaki taslakta dursaydı
 * profil geçmişten açıldığında bağlantı çalışmazdı; bu yüzden yayımlama
 * sırasında R2'ye de yazılır (bkz. app/api/profiles/route.ts).
 *
 * Görünürlük profil okuma yetkisiyle aynıdır: Yarışma Yöneticisi (01) yalnızca
 * KENDİ hazırladığı profilin şartnamesine, Hakem (02) ve Değerlendirme
 * Yöneticisi (04) yalnızca yayımlanmış profillerinkine erişir. Yarışmacı (03)
 * bu uca hiç giremez.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "read_profiles");
  if (!auth.ok) return auth.response;
  try {
    const id = (await context.params).id;
    const profile = await findProfile(id);
    if (!profile) return jsonError(404, "Değerlendirme profili bulunamadı.");
    if (auth.account.roleCode === "01" && profile.createdBy !== auth.account.id) {
      return jsonError(403, "Bu işlem için yetkiniz yok.");
    }
    if (["02", "04"].includes(auth.account.roleCode) && profile.status !== "approved") {
      return jsonError(403, "Bu işlem için yetkiniz yok.");
    }

    const key = profile.profile.sourceDocument.fileKey;
    if (!key) {
      return jsonError(404, "Bu profilin şartname PDF'i sunucuda saklanmamış. Kriterleri yeniden yayımladığınızda kaynak belge de kaydedilir.");
    }
    const object = await reportBucket().get(key);
    if (!object) return jsonError(404, "Şartname PDF'i saklama alanında bulunamadı.");

    return new Response(object.body, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(object.size),
        // `inline`: tarayıcı PDF'i açar ve `#page=N` çapası çalışır.
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(profile.sourceDocumentName || "sartname.pdf")}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) { return handleError(error); }
}
