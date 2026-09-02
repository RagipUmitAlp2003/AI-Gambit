import { ProfileOwnershipError, findProfile, listProfiles, reportBucket, submitProfileForReview } from "../../lib/workflow-db";
import { handleError, json, jsonError, readJson, requirePermission } from "../../lib/admin-guard";
import { validateProfileExport } from "../../lib/profile-loader";
import { pdfIntegrityError } from "../../lib/pdf-integrity";
import { recordAudit } from "../../lib/admin-db";
import type { ProfileExport } from "../../lib/types";

/** Şartname PDF'i için sistem sınırı; analiz ucuyla aynı. */
const MAX_SOURCE_BYTES = 18 * 1024 * 1024;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "sartname.pdf";
}

/**
 * Yayımlama isteğinin gövdesi: JSON ya da multipart.
 *
 * Multipart biçiminde `profile` alanı JSON dizgesi, `sourceFile` alanı şartname
 * PDF'idir. PDF isteğe bağlıdır; gönderilirse R2'ye yazılır ve anahtarı profile
 * işlenir, böylece KAYNAK SAYFA BAĞLANTISI profil geçmişten açıldığında da
 * çalışır (tarayıcıdaki yerel taslak dosyası orada yoktur).
 */
async function readPublishRequest(request: Request): Promise<{ profile: unknown; sourceFile: File | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    const body = await readJson(request);
    return { profile: body.profile, sourceFile: null };
  }
  const form = await request.formData();
  const raw = form.get("profile");
  if (typeof raw !== "string") return { profile: undefined, sourceFile: null };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { profile: undefined, sourceFile: null }; }
  const file = form.get("sourceFile");
  return { profile: parsed, sourceFile: file instanceof File && file.size > 0 ? file : null };
}

/**
 * Değerlendirme profili uçları (Aşama A).
 *
 *   GET    profil listesi / tek profil — rol görünürlüğüne göre
 *   POST   kriter profilini yayımlama   — 01
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "read_profiles");
  if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const profile = await findProfile(id);
      if (!profile) return jsonError(404, "Değerlendirme profili bulunamadı.");
      // 01 yalnızca kendi hazırladığı profili, 02/04 yalnızca yürürlüktekini görür.
      if (auth.account.roleCode === "01" && profile.createdBy !== auth.account.id) {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
      if (["02", "04"].includes(auth.account.roleCode) && profile.status !== "approved") {
        return jsonError(403, "Bu işlem için yetkiniz yok.");
      }
      return json({ profile });
    }
    return json({ profiles: await listProfiles(auth.account) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "publish_profile");
  if (!auth.ok) return auth.response;
  let uploadedKey = "";
  try {
    const { profile: candidate, sourceFile } = await readPublishRequest(request);
    const validated = validateProfileExport(candidate);
    if (!validated.profile) return jsonError(400, validated.error);
    let profileExport: ProfileExport = validated.profile;
    // Sahiplik R2 yazımından ÖNCE doğrulanır. Yeni profil kimliğini istemci
    // belirleyemez; sunucu üretir. Mevcut fileKey de istemciden güvenilmez,
    // veritabanındaki doğrulanmış profilden alınır.
    const requestedId = profileExport.profileId;
    const existing = requestedId ? await findProfile(requestedId) : null;
    if (existing && existing.createdBy !== auth.account.id) {
      return jsonError(403, "Bu kriter profilini yalnızca onu hazırlayan Yarışma Yöneticisi güncelleyebilir.");
    }
    const profileId = existing?.id ?? crypto.randomUUID();
    profileExport = {
      ...profileExport,
      profileId,
      sourceDocument: {
        ...profileExport.sourceDocument,
        ...(existing?.profile.sourceDocument.fileKey
          ? { fileKey: existing.profile.sourceDocument.fileKey }
          : { fileKey: undefined }),
      },
    };

    // Şartname PDF'i verildiyse yeni ve sürümlü bir anahtara yazılır. D1
    // yayımı kesinleşmeden eski nesne silinmez veya üzerine yazılmaz.
    if (sourceFile) {
      if (sourceFile.size > MAX_SOURCE_BYTES) return jsonError(413, "Şartname PDF'i en fazla 18 MB olabilir.");
      if (!sourceFile.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
        return jsonError(400, "Şartname belgesi PDF biçiminde olmalıdır.");
      }
      const bytes = await sourceFile.arrayBuffer();
      const integrityError = pdfIntegrityError(bytes);
      if (integrityError) return jsonError(422, `Şartname PDF'i okunamıyor: ${integrityError}`);
      uploadedKey = `profiles/${profileId}/${crypto.randomUUID()}-${safeFileName(sourceFile.name)}`;
      await reportBucket().put(uploadedKey, sourceFile, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { profileId, createdBy: auth.account.id },
      });
      profileExport = {
        ...profileExport,
        profileId,
        sourceDocument: { ...profileExport.sourceDocument, fileKey: uploadedKey },
      };
    }
    const published = await submitProfileForReview(profileExport, auth.account)
      .catch((caught) => {
        if (caught instanceof ProfileOwnershipError) return "forbidden" as const;
        throw caught;
      });
    if (published === "forbidden") {
      if (uploadedKey) { try { await reportBucket().delete(uploadedKey); } catch { /* Asıl hata korunur. */ } }
      return jsonError(403, "Bu kriter profilini yalnızca onu hazırlayan Yarışma Yöneticisi güncelleyebilir.");
    }
    const { profile, criteriaVersion, versionCreated, sourceLockReverted } = published;
    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: "profile_published",
      targetType: "competition_profile",
      targetId: profile.id,
      detail: `${profile.competitionName} · kriter sürümü v${criteriaVersion.criteriaVersion}`
        + ` (${criteriaVersion.criteriaCount} kriter, özet ${criteriaVersion.criteriaHash.slice(0, 12)})`
        + `${versionCreated ? "" : " · içerik değişmedi, sürüm korundu"}`
        + `${sourceLockReverted.length ? ` · ${sourceLockReverted.length} kriterde kaynak değişikliği reddedildi` : ""}`,
    }).catch((auditError) => console.error("[audit] profile_published", auditError));
    return json({
      profile,
      criteriaVersion,
      versionCreated,
      // İstemci bu uyarıyı gösterir: kaynak alanları salt okunurdur, sunucu
      // elle yapılan değişiklikleri kabul etmez (madde 12).
      ...(sourceLockReverted.length ? {
        sourceLockWarning: `${sourceLockReverted.length} kriterin kaynak sayfası/alıntısı değiştirilemez ve `
          + `ilk yayımdaki değerine geri alındı: ${sourceLockReverted.slice(0, 5).join(", ")}`
          + `${sourceLockReverted.length > 5 ? ` ve ${sourceLockReverted.length - 5} kriter daha` : ""}.`,
      } : {}),
    }, 201);
  } catch (error) {
    // Profil kaydedilemediyse yüklenen şartname nesnesi geri alınır.
    if (uploadedKey) { try { await reportBucket().delete(uploadedKey); } catch { /* Asıl hata korunur. */ } }
    return handleError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "publish_profile");
  if (!auth.ok) return auth.response;
  return jsonError(405, "Kriter profilini değiştirmek için Kriter Atölyesi'nde düzenleyip yeniden yayımlayın.");
}
