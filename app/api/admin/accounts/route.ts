import { env } from "cloudflare:workers";
import { insertAccount, listAccounts, recordAudit, recordMail } from "../../../lib/admin-db";
import { ROLES } from "../../../lib/admin-roles";
import {
  ValidationError,
  assertEmail,
  assertRoleCode,
  handleError,
  json,
  optionalText,
  readJson,
  requireModerator,
  requiredText,
} from "../../../lib/admin-guard";
import type { CreateAccountResult } from "../../../lib/admin-types";
import { buildAccountMail, deliverMail, mailProviderReady } from "../../../lib/mailer";
import { PASSWORD_LENGTH, generatePassword, hashPassword } from "../../../lib/password";
import { isProduction } from "../../../lib/session";

/**
 * Rol atayıcı (00) panelinin hesap listesi ve hesap oluşturma ucu.
 * Her iki yöntem de aktif Rol 00 oturumu ister; yetkisiz istek 401/403 alır.
 */

export async function GET(request: Request): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const accounts = await listAccounts();
    return json({
      accounts,
      roles: ROLES,
      mailReady: mailProviderReady(env),
      production: isProduction(),
      viewer: auth.account,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireModerator(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await readJson(request);
    const fullName = requiredText(body, "fullName", "İsim Soyisim", 120);
    const email = assertEmail(requiredText(body, "email", "E-posta", 200));
    const roleCode = assertRoleCode(body.roleCode);

    // Boş bırakılırsa sistem üretir; elle verilirse en az 8 hane istenir.
    const manualPassword = optionalText(body, "password", 64);
    if (manualPassword && manualPassword.length < PASSWORD_LENGTH) {
      throw new ValidationError(`Elle girilen şifre en az ${PASSWORD_LENGTH} karakter olmalıdır.`);
    }
    const oneTimePassword = manualPassword || generatePassword();

    const passwordRecord = await hashPassword(oneTimePassword);
    const account = await insertAccount({
      fullName,
      email,
      roleCode,
      password: passwordRecord,
      // Atamayı yapan, oturumdaki hesaptır; istemciden gelen değere güvenilmez.
      createdBy: auth.account.fullName,
    });

    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    const envelope = buildAccountMail({
      fullName: account.fullName,
      email: account.email,
      roleCode: account.roleCode,
      password: oneTimePassword,
      loginUrl: `${baseUrl}/moderator`,
    });
    const outcome = await deliverMail(env, envelope);
    // Kayda maskelenmiş gövde yazılır; açık şifre yalnızca bu yanıtta döner.
    const mail = await recordMail({
      accountId: account.id,
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
      action: "account_created",
      targetType: "account",
      targetId: account.id,
      detail: `${account.email} · rol ${account.roleCode} · bildirim ${outcome.status}`,
    });

    const result: CreateAccountResult = { account, oneTimePassword, mail };
    return json(result, 201);
  } catch (error) {
    return handleError(error);
  }
}
