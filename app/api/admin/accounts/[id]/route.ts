import { env } from "cloudflare:workers";
import {
  deleteAccount,
  findAccountById,
  recordAudit,
  recordMail,
  restoreAccount,
  revokeAccount,
  updateAccountRole,
} from "../../../../lib/admin-db";
import {
  assertRoleCode,
  handleError,
  json,
  jsonError,
  requireModerator,
  readJson,
} from "../../../../lib/admin-guard";
import { buildRevokeMail, deliverMail } from "../../../../lib/mailer";
import { assignPendingApplications, reassignApplicationsFromJudge, type JudgeReassignment } from "../../../../lib/workflow-db";
import type { MutationResult } from "../../../../lib/admin-db";
import type { AdminAccount } from "../../../../lib/admin-types";

/**
 * Tek hesap üzerinde rol değiştirme, rol kaldırma (pasife alma), geri alma
 * ve kalıcı silme. Hepsi aktif Rol 00 oturumu ister.
 *
 * "Son aktif 00" koruması veri tabanında tek bir SQL ifadesinin koşulunda
 * uygulanır; istemciden gelen bir bayrakla atlatılamaz ve eşzamanlı iki
 * istek sistemi sıfır moderatörle bırakamaz.
 */

type Context = { params: Promise<{ id: string }> };

const LAST_MODERATOR_MESSAGE =
  "Bu, sistemdeki tek aktif moderatör (00) hesabı. Önce başka bir hesaba 00 rolü verin.";

function mutationFailure(result: Extract<MutationResult, { ok: false }>): Response {
  if (result.reason === "not_found") return jsonError(404, "Hesap bulunamadı.");
  return jsonError(409, LAST_MODERATOR_MESSAGE, { lastModerator: true });
}

/**
 * Pasife alınan/silinen HAKEMİN açık dosyalarını devreder ve her devri denetim
 * kaydına yazar (madde 10). Devir başarısız olursa hesabın pasife alınması
 * geri ALINMAZ: dosyalar atanmamış kalır ve operasyon panosu açıldığında
 * `assignPendingApplications` tarafından dağıtılır. Sebep loga yazılır.
 */
async function reassignOpenJudgeFiles(
  judgeId: string,
  reason: string,
  actor: AdminAccount,
): Promise<JudgeReassignment[]> {
  let moved: JudgeReassignment[] = [];
  try {
    moved = await reassignApplicationsFromJudge(judgeId, reason);
  } catch (error) {
    console.error("[workflow] pasif hakemin açık dosyaları devredilemedi", error);
    return [];
  }
  for (const item of moved) {
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.roleCode,
      action: item.judgeId ? "application_reassigned" : "application_reassignment_queued",
      targetType: "competition_application",
      targetId: item.applicationId,
      detail: item.detail.slice(0, 400),
    }).catch((auditError) => console.error("[audit] hakem devri", auditError));
  }
  return moved;
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = await readJson(request);

    const current = await findAccountById(id);
    if (!current) return jsonError(404, "Hesap bulunamadı.");

    // ADMIN KORUMASI: Rol atama yetkisi yalnızca 01, 02 ve 04 içindir. Bir
    // Admin (00) hesabının rolü panelden değiştirilemez; aksi hâlde ilk sistem
    // Admin hesabı 01'e çevrilerek etkisiz bırakılabilirdi. Pasife alınmış bir
    // Admin yalnızca kendi rolüyle geri alınır (yeni Admin ataması değildir).
    if (current.roleCode === "00") {
      if (current.status !== "revoked") {
        return jsonError(403, "Admin (00) hesabının rolü panelden değiştirilemez.");
      }
      const restoredAdmin = await restoreAccount(id, "00");
      if (!restoredAdmin.ok) return mutationFailure(restoredAdmin);
      await recordAudit({
        actorId: auth.account.id,
        actorEmail: auth.account.email,
        actorRole: auth.account.roleCode,
        action: "account_restored",
        targetType: "account",
        targetId: id,
        detail: `00 → 00 · ${restoredAdmin.account.email}`,
      });
      return json({ account: restoredAdmin.account });
    }

    const roleCode = assertRoleCode(body.roleCode);
    const result =
      current.status === "revoked" ? await restoreAccount(id, roleCode) : await updateAccountRole(id, roleCode);
    if (!result.ok) return mutationFailure(result);

    // Hesap aktif bir Hakeme dönüştüyse bekleyen başvurular otomatik dağıtılır.
    if (result.account.roleCode === "02" && result.account.status === "active") {
      await assignPendingApplications().catch((assignError) =>
        console.error("[workflow] hakem rolü sonrası bekleyen atama", assignError));
    }

    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: current.status === "revoked" ? "account_restored" : "account_role_changed",
      targetType: "account",
      targetId: id,
      detail: `${current.roleCode} → ${roleCode} · ${result.account.email}`,
    });

    return json({ account: result.account });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const purge = url.searchParams.get("purge") === "1";
    const reason = (url.searchParams.get("reason") ?? "").trim().slice(0, 400);

    const account = await findAccountById(id);
    if (!account) return jsonError(404, "Hesap bulunamadı.");

    if (purge) {
      /*
       * KALICI SİLME ÖNCESİ DEVİR (madde 10): hesap satırı gittikten sonra
       * hangi dosyaların ona bağlı olduğu okunamaz. Bu yüzden açık dosyalar
       * ÖNCE serbest bırakılıp yeniden atanır.
       */
      const handover = account.roleCode === "02"
        ? await reassignOpenJudgeFiles(id, reason || "hesap kalıcı olarak silindi", auth.account)
        : [];
      const result = await deleteAccount(id);
      if (!result.ok) return mutationFailure(result);
      await recordAudit({
        actorId: auth.account.id,
        actorEmail: auth.account.email,
        actorRole: auth.account.roleCode,
        action: "account_purged",
        targetType: "account",
        targetId: id,
        detail: `${account.email} · rol ${account.roleCode}`
          + (handover.length ? ` · ${handover.length} açık dosya devredildi` : ""),
      });
      return json({ purged: true, id, reassignedApplications: handover.length });
    }

    const result = await revokeAccount(id, reason);
    if (!result.ok) return mutationFailure(result);

    /*
     * HAKEM PASİFLEŞTİRİLDİ (madde 10): ona atanmış TAMAMLANMAMIŞ dosyalar
     * kalıcı olarak takılı kalmasın diye en az yüklü aktif hakeme devredilir;
     * aktif hakem yoksa yeniden atama kuyruğuna alınır. Tamamlanmış
     * değerlendirmelerin tarihsel hakem bilgisi değişmez. Devir başarısız
     * olsa bile hesabın pasife alınması GERİ ALINMAZ.
     */
    const handover = account.roleCode === "02"
      ? await reassignOpenJudgeFiles(id, reason || "hesap pasife alındı", auth.account)
      : [];

    // Rol kaldırma bildirimi; sağlayıcı yoksa ortamına göre işaretlenir.
    const envelope = buildRevokeMail({
      fullName: result.account.fullName,
      email: result.account.email,
      roleCode: account.roleCode,
      reason,
    });
    const outcome = await deliverMail(env, envelope);
    const mail = await recordMail({
      accountId: result.account.id,
      toEmail: envelope.to,
      subject: envelope.subject,
      body: envelope.storedBody,
      status: outcome.status,
      provider: outcome.provider,
      error: outcome.error,
    });

    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: "account_revoked",
      targetType: "account",
      targetId: id,
      detail: `${account.email} · rol ${account.roleCode}${reason ? ` · gerekçe: ${reason}` : ""}`
        + (handover.length ? ` · ${handover.length} açık dosya yeniden atandı` : ""),
    });

    return json({ account: result.account, mail, reassignedApplications: handover.length });
  } catch (error) {
    return handleError(error);
  }
}
