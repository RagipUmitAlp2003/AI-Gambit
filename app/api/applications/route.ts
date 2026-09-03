import { handleError, json, jsonError, requirePermission, ValidationError } from "../../lib/admin-guard";
import { readFormDataWithLimit } from "../../lib/request-guard";
import {
  createApplication,
  findApprovedProfile,
  findCompetitionWorkflow,
  findCompetitionWorkflowById,
  listApplications,
  listOpenCompetitions,
  markSimilarityResultsStale,
  reportBucket,
} from "../../lib/workflow-db";
import { COMPETITION_STATUS_LABELS } from "../../lib/workflow-types";
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
  try {
    // `openCompetitions` yarışmacı portalının seçim listesini daraltır; başvuruya
    // kapalı bir yarışma hiç seçilemez. Yetki kararı değildir — asıl kontrol
    // POST içindeki tek-satır (kararlı kimlik) yarışma çözümlemesidir.
    const [applications, openCompetitions] = await Promise.all([
      listApplications(auth.account),
      listOpenCompetitions(),
    ]);
    return json({ applications, openCompetitions });
  }
  catch (error) { return handleError(error); }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requirePermission(request, "submit_application");
  if (!auth.ok) return auth.response;
  let objectKey = "";
  try {
    // Boyut kapısı ayrıştırmadan ÖNCE (madde 9): 50 MB PDF + form alanları payı.
    const form = await readFormDataWithLimit(request, SYSTEM_UPLOAD_LIMIT + 1024 * 1024);
    const competitionName = String(form.get("competitionName") ?? "").trim();
    const competitionId = String(form.get("competitionId") ?? "").trim();
    const applicantFullName = requiredFormText(form, "applicantFullName", "Başvuru sahibi adı soyadı", 120);
    const teamName = requiredFormText(form, "teamName", "Takım adı", 120);
    const teamMembers = readTeamMembers(form);
    const file = form.get("file");
    // Yarışma adının YETKİLİ kaynağı yayımlanmış profildir, koddaki sabit havuz
    // değil: şartnameden çıkarılan ad (ör. bir festival adı) havuzda bulunmayabilir
    // ve bu kontrol yayımlanmış yarışmayı başvuruya kapatıyordu.
    if (!competitionName) return jsonError(400, "Başvuruya açık bir yarışma seçin.");
    if (competitionName.length > 240) return jsonError(400, "Yarışma adı en fazla 240 karakter olabilir.");

    // AYNI ADLI YARIŞMALAR: kabul kararı ve kriter profili birbirinden bağımsız
    // ad sorgularıyla DEĞİL, tek bir yarışma satırından çözülür. Seçim listesi
    // kararlı kimliği (competitionId) gönderir; eski istemci / sabit havuz yolu
    // için ada göre en uygun satıra düşülür — iki yolda da profil, başvurunun
    // seçtiği aynı yarışma satırına bağlıdır.
    const workflow = competitionId
      ? await findCompetitionWorkflowById(competitionId)
      : await findCompetitionWorkflow(competitionName);
    if (!workflow || workflow.archivedAt || workflow.status !== "open" || !workflow.isActive || !workflow.currentProfileId) {
      // Neyin eksik olduğu ayrı ayrı söylenir: "açık değil VEYA profil yok" ikilemi
      // yarışmacıya ne yapacağını anlatmıyordu.
      const reason = !workflow
        ? "bu yarışma için henüz şartname kriterleri yayımlanmadı"
        : !workflow.currentProfileId
          ? "bu yarışmanın yayımlanmış kriter profili yok"
          : `bu yarışmanın durumu “${COMPETITION_STATUS_LABELS[workflow.status] ?? workflow.status}”, başvuruya açık değil`;
      return jsonError(409, `Başvuru alınamadı: ${reason}. Başvuruya açık yarışmalar seçim listesinde görünür.`);
    }
    if (!(file instanceof File)) return jsonError(400, "Başvuru PDF'i seçilmedi.");
    if (file.size <= 0) return jsonError(400, "Seçilen PDF boş görünüyor.");
    if (file.size > SYSTEM_UPLOAD_LIMIT) return jsonError(413, "PDF bu sistemde en fazla 50 MB olabilir.");
    if (!file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) return jsonError(400, "Başvuru belgesi PDF biçiminde olmalıdır.");
    const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (new TextDecoder().decode(signature) !== "%PDF-") return jsonError(400, "Dosyanın içeriği geçerli bir PDF olarak doğrulanamadı.");

    // Profil, kabul kararını veren AYNI yarışma satırının yayımlanmış profilidir;
    // ada göre bağımsız arama aynı adlı başka (pasif/arşivli) yarışmanın
    // profilini bağlayabiliyordu.
    const profile = await findApprovedProfile(workflow.currentProfileId);
    if (!profile) return jsonError(409, "Bu yarışmanın yayımlanmış kriter profili bulunmuyor.");
    if (profile.competitionKey !== workflow.competitionKey) {
      return jsonError(409, "Başvuru alınamadı: yarışma kaydı ile kriter profili eşleşmiyor.");
    }
    // Saklanan yarışma adının kaynağı SUNUCUDAKİ satırdır, istemci metni değil.
    const storedCompetitionName = workflow.competitionName;
    objectKey = `applications/${auth.account.id}/${crypto.randomUUID()}/${safeFileName(file.name)}`;
    // Blob doğrudan verilir: `ReadableStream` ile R2 içerik uzunluğunu bilemediği
    // için yükleme sessizce düşebiliyordu. `File` zaten bir `Blob`'tur.
    await reportBucket().put(objectKey, file, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { participantId: auth.account.id, competition: storedCompetitionName.slice(0, 160) },
    });
    const application = await createApplication({
      participant: auth.account,
      applicantFullName,
      teamName,
      teamMembers,
      competitionName: storedCompetitionName,
      competitionKey: profile.competitionKey,
      profileId: profile.id,
      fileKey: objectKey,
      fileName: file.name.slice(0, 240),
      mimeType: "application/pdf",
      sizeBytes: file.size,
    });
    await recordAudit({ actorId: auth.account.id, actorEmail: auth.account.email, actorRole: auth.account.roleCode, action: "application_submitted", targetType: "competition_application", targetId: application.id, detail: storedCompetitionName }).catch((auditError) => console.error("[audit] application_submitted", auditError));
    // Havuza yeni rapor geldi (madde 8): aynı yarışma anahtarındaki DİĞER
    // başvuruların benzerlik sonuçları "güncel değil" işaretlenir. Yazım
    // BEKLENİR (Workers izolatı yanıttan sonra beklemeyen D1 yazımını
    // tamamlamayabilir); defter tutma hatası yine de başvuruyu düşürmez (.catch).
    await markSimilarityResultsStale(profile.competitionKey, "Havuza yeni rapor geldi; benzerlik analizini yenileyin.", application.id)
      .catch((staleError) => console.error("[similarity] havuz eskitme işareti yazılamadı", staleError));
    return json({ application }, 201);
  } catch (error) {
    if (objectKey) { try { await reportBucket().delete(objectKey); } catch { /* Asıl hata korunur. */ } }
    return handleError(error);
  }
}
