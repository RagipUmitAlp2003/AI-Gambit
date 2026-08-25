import { env } from "cloudflare:workers";
import {
  createSession,
  findAccountByEmail,
  insertAccount,
  recordAudit,
  restoreAccount,
} from "../../../lib/admin-db";
import { handleError, json, jsonError, readJson } from "../../../lib/admin-guard";
import { isRoleCode, roleByCode } from "../../../lib/admin-roles";
import type { RoleCode } from "../../../lib/admin-types";
import { generatePassword, hashPassword } from "../../../lib/password";
import {
  authConfigured,
  hashToken,
  isProduction,
  issueSession,
  sessionCookieHeader,
} from "../../../lib/session";

const DEMO_IDENTITIES: Record<RoleCode, { fullName: string; email: string }> = {
  // E-posta kimlik anahtarıdır; değiştirilirse mevcut demo hesabının kopyası oluşur.
  "00": { fullName: "Demo Moderatör", email: "demo.bas.yonetici@yerel.test" },
  "01": { fullName: "Demo Yarışma Yöneticisi", email: "demo.yarisma.yoneticisi@yerel.test" },
  "02": { fullName: "Demo Hakem", email: "demo.hakem@yerel.test" },
  "03": { fullName: "Demo Değerlendirme Yöneticisi", email: "demo.degerlendirme.yoneticisi@yerel.test" },
  "04": { fullName: "Demo Yarışmacı", email: "demo.yarismaci@yerel.test" },
};

/**
 * Şifresiz rol kısayolu yalnızca yerel geliştirme içindir. Üretimde veya
 * ALLOW_DEV_LOGIN=on açıkça verilmemişse uç yokmuş gibi davranır.
 */
export async function POST(request: Request): Promise<Response> {
  if (isProduction() || env.APP_ENV !== "development" || env.ALLOW_DEV_LOGIN !== "on") {
    return jsonError(404, "Hızlı giriş bu ortamda kullanılamıyor.");
  }
  if (!authConfigured()) {
    return jsonError(503, "Yerel oturum anahtarı yapılandırılmamış.", { authUnavailable: true });
  }

  try {
    const body = await readJson(request);
    const roleCode = body.roleCode;
    if (!isRoleCode(roleCode)) return jsonError(400, "Geçerli bir rol seçin.");

    const identity = DEMO_IDENTITIES[roleCode];
    let account = await findAccountByEmail(identity.email);
    if (!account) {
      account = await insertAccount({
        fullName: identity.fullName,
        email: identity.email,
        roleCode,
        password: await hashPassword(generatePassword(24)),
        createdBy: "yerel hızlı giriş",
      });
    } else if (account.status === "revoked") {
      const restored = await restoreAccount(account.id, roleCode);
      if (!restored.ok) return jsonError(409, "Demo hesabı yeniden etkinleştirilemedi.");
      account = restored.account;
    }

    const session = await issueSession();
    await createSession({
      tokenHash: await hashToken(session.token),
      accountId: account.id,
      expiresAt: session.expiresAt,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200) || null,
    });
    await recordAudit({
      actorId: account.id,
      actorEmail: account.email,
      actorRole: account.roleCode,
      action: "development_quick_login",
      targetType: "account",
      targetId: account.id,
      detail: `Yerel hızlı giriş · rol ${roleCode}`,
    });

    return json(
      { account, role: roleByCode(account.roleCode), expiresAt: session.expiresAt },
      200,
      { "set-cookie": sessionCookieHeader(session.cookieValue) },
    );
  } catch (error) {
    return handleError(error);
  }
}
