import { COMPETITIONS } from "../../lib/competitions";
import { handleError, json, jsonError, requirePermission, ValidationError } from "../../lib/admin-guard";
import { competitionAcceptsApplications, createApplication, findLatestProfileForCompetition, listApplications, reportBucket } from "../../lib/workflow-db";
import { recordAudit } from "../../lib/admin-db";

const SYSTEM_UPLOAD_LIMIT = 50 * 1024 * 1024;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "rapor.pdf";
}

function requiredFormText(form: FormData, key: string, label: string, maxLength: number): string {
  const value = String(form.get(key) ?? "").trim();
  if (!value) throw new ValidationError(`${label} alanı zorunludur.`);
  if (value.length > maxLength) throw new ValidationError(`${label} en fazla ${maxLength} karakter olabilir.`);
  return value;
}

function readTeamMembers(form: FormData): string[] {
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("teamMembers") ?? "[]")); }
  catch { throw new ValidationError("Ekip üyeleri okunamadı."); }
  if (!Array.isArray(raw)) throw new ValidationError("Ekip üyeleri geçerli bir liste olmalıdır.");
  const members = raw.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (members.length > 30) throw new ValidationError("Bir başvuruda en fazla 30 ekip üyesi kaydedilebilir.");
  if (members.some((name) => name.length > 120)) throw new ValidationError("Ekip üyesi adı en fazla 120 karakter olabilir.");
  return members;
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "read_applications");
  if (!auth.ok) return auth.response;
  try { return json({ applications: await listApplications(auth.account) }); }
  catch (error) { return handleError(error); }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "submit_application");
  if (!auth.ok) return auth.response;
  let objectKey = "";
  try {
    const form = await request.formData();
    const competitionName = String(form.get("competitionName") ?? "").trim();
    const applicantFullName = requiredFormText(form, "applicantFullName", "Başvuru sahibi adı soyadı", 120);
    const teamName = requiredFormText(form, "teamName", "Takım adı", 120);
    const teamMembers = readTeamMembers(form);
    const file = form.get("file");
    if (!COMPETITIONS.some((item) => item.name === competitionName)) return jsonError(400, "Listeden geçerli bir yarışma seçin.");
    if (!await competitionAcceptsApplications(competitionName)) {
      return jsonError(409, "Bu yarışma henüz başvuruya açık değil veya yayımlanmış kriter profili bulunmuyor.");
    }
    if (!(file instanceof File)) return jsonError(400, "Başvuru PDF'i seçilmedi.");
    if (file.size <= 0) return jsonError(400, "Seçilen PDF boş görünüyor.");
    if (file.size > SYSTEM_UPLOAD_LIMIT) return jsonError(413, "PDF bu sistemde en fazla 50 MB olabilir.");
    if (!file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) return jsonError(400, "Başvuru belgesi PDF biçiminde olmalıdır.");
    const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (new TextDecoder().decode(signature) !== "%PDF-") return jsonError(400, "Dosyanın içeriği geçerli bir PDF olarak doğrulanamadı.");

    const profile = await findLatestProfileForCompetition(competitionName);
    if (!profile) return jsonError(409, "Bu yarışmanın yayımlanmış kriter profili bulunmuyor.");
    objectKey = `applications/${auth.account.id}/${crypto.randomUUID()}/${safeFileName(file.name)}`;
    await reportBucket().put(objectKey, file.stream(), {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { participantId: auth.account.id, competition: competitionName.slice(0, 160) },
    });
    const application = await createApplication({
      participant: auth.account,
      applicantFullName,
      teamName,
      teamMembers,
      competitionName,
      competitionKey: profile.competitionKey,
      profileId: profile.id,
      fileKey: objectKey,
      fileName: file.name.slice(0, 240),
      mimeType: "application/pdf",
      sizeBytes: file.size,
    });
    await recordAudit({ actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode, action: "application_submitted", targetType: "competition_application", targetId: application.id, detail: competitionName }).catch((auditError) => console.error("[audit] application_submitted", auditError));
    return json({ application }, 201);
  } catch (error) {
    if (objectKey) { try { await reportBucket().delete(objectKey); } catch { /* Asıl hata korunur. */ } }
    return handleError(error);
  }
}
