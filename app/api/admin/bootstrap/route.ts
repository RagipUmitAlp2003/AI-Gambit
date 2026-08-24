import { env } from "cloudflare:workers";
import { ConflictError, countAccounts, insertAccount, recordAudit } from "../../../lib/admin-db";
import {
  ValidationError,
  assertEmail,
  handleError,
  json,
  jsonError,
  readJson,
  requiredText,
} from "../../../lib/admin-guard";
import { authConfigured } from "../../../lib/session";
import { PASSWORD_LENGTH, generatePassword, hashPassword } from "../../../lib/password";

/**
 * İlk moderatör (00) hesabının kurulumu.
 *
 * Yalnızca veri tabanında hiç hesap yokken ve `MODERATOR_BOOTSTRAP_TOKEN`
 * tanımlıyken çalışır. Kurulum sonrası uç kalıcı olarak 409 döner; token
 * ortam değişkeni boşaltılmalıdır.
 */

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export async function GET(): Promise<Response> {
  try {
    const total = await countAccounts();
    return json({
      required: total === 0,
      tokenConfigured: Boolean(env.MODERATOR_BOOTSTRAP_TOKEN),
      authConfigured: authConfigured(),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!authConfigured()) {
      return jsonError(503, "Kimlik doğrulama yapılandırması eksik. Yönetici uçları devre dışı.", {
        authUnavailable: true,
      });
    }

    const expected = env.MODERATOR_BOOTSTRAP_TOKEN;
    if (!expected || expected.trim().length < 8) {
      console.error("[bootstrap] MODERATOR_BOOTSTRAP_TOKEN tanımlı değil; kurulum reddedildi.");
      return jsonError(503, "Kurulum anahtarı tanımlı değil.");
    }

    if ((await countAccounts()) > 0) {
      throw new ConflictError("Sistemde hesap var; kurulum ucu kapalıdır.");
    }

    const body = await readJson(request);
    const token = requiredText(body, "token", "Kurulum anahtarı", 200);
    if (!constantTimeEqual(token, expected)) {
      console.error("[bootstrap] geçersiz kurulum anahtarı denemesi");
      return jsonError(401, "Kurulum anahtarı geçersiz.");
    }

    const fullName = requiredText(body, "fullName", "İsim Soyisim", 120);
    const email = assertEmail(requiredText(body, "email", "E-posta", 200));
    const manualPassword = typeof body.password === "string" ? body.password.trim() : "";
    if (manualPassword && manualPassword.length < PASSWORD_LENGTH) {
      throw new ValidationError(`Şifre en az ${PASSWORD_LENGTH} karakter olmalıdır.`);
    }
    const oneTimePassword = manualPassword || generatePassword();

    const account = await insertAccount({
      fullName,
      email,
      roleCode: "00",
      password: await hashPassword(oneTimePassword),
      createdBy: "kurulum",
    });

    await recordAudit({
      actorId: null,
      actorEmail: null,
      actorRole: null,
      action: "bootstrap_moderator_created",
      targetType: "account",
      targetId: account.id,
      detail: `İlk moderatör hesabı kuruldu: ${account.email}`,
    });

    // Şifre yalnızca bu yanıtta döner; veri tabanına açık hâli yazılmaz.
    return json({ account, oneTimePassword }, 201);
  } catch (error) {
    return handleError(error);
  }
}
