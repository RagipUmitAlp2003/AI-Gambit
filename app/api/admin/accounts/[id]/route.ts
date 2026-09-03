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
import { assignPendingApplications } from "../../../../lib/workflow-db";
import type { MutationResult } from "../../../../lib/admin-db";

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

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = await readJson(request);

    const current = await findAccountById(id);
    if (!current) return jsonError(404, "Hesap bulunamadı.");

    // AÇIK "ETKİNLEŞTİR" İŞLEMİ: pasife alınmış hesap AYNI ROLLE geri açılır.
    // Rol istemciden değil VERİ TABANINDAKİ kayıttan alınır; bu yüzden bütün
    // roller (00/01/02/03/04) için tek tip çalışır ve rol yükseltme riski yoktur.
    // Rol değiştirme akışına (aşağıdaki assertRoleCode yolu) dokunmaz.
    if (body.restore === true) {
      if (current.status !== "revoked") return jsonError(409, "Hesap zaten aktif.");
      const restored = await restoreAccount(id, current.roleCode);
      if (!restored.ok) return mutationFailure(restored);

      // Hakem hesabı geri açıldıysa bekleyen başvurular otomatik dağıtılır.
      if (restored.account.roleCode === "02" && restored.account.status === "active") {
        await assignPendingApplications().catch((assignError) =>
          console.error("[workflow] hakem etkinleştirme sonrası bekleyen atama", assignError));
      }

      await recordAudit({
        actorId: auth.account.id,
        actorEmail: auth.account.email,
        actorRole: auth.account.roleCode,
        action: "account_restored",
        targetType: "account",
        targetId: id,
        detail: `${current.roleCode} → ${current.roleCode} · ${restored.account.email}`,
      });
      return json({ account: restored.account });
    }

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
      const result = await deleteAccount(id);
      if (!result.ok) return mutationFailure(result);
      await recordAudit({
        actorId: auth.account.id,
        actorEmail: auth.account.email,
        actorRole: auth.account.roleCode,
        action: "account_purged",
        targetType: "account",
        targetId: id,
        detail: `${account.email} · rol ${account.roleCode}`,
      });
      return json({ purged: true, id });
    }

    const result = await revokeAccount(id, reason);
    if (!result.ok) return mutationFailure(result);

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
      detail: `${account.email} · rol ${account.roleCode}${reason ? ` · gerekçe: ${reason}` : ""}`,
    });

    return json({ account: result.account, mail });
  } catch (error) {
    return handleError(error);
  }
}
