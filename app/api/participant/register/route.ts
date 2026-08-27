import { createSession, findAccountByEmail, insertAccount, recordAudit } from "../../../lib/admin-db";
import { assertEmail, handleError, json, jsonError, readJson, requiredText } from "../../../lib/admin-guard";
import { PARTICIPANT_ROLE } from "../../../lib/admin-roles";
import { hashPassword } from "../../../lib/password";
import { authConfigured, hashToken, issueSession, sessionCookieHeader } from "../../../lib/session";

export async function POST(request: Request): Promise<Response> {
  if (!authConfigured()) return jsonError(503, "Kimlik doğrulama yapılandırması eksik.");
  try {
    const body = await readJson(request);
    const fullName = requiredText(body, "fullName", "İsim Soyisim", 120);
    const email = assertEmail(requiredText(body, "email", "E-posta", 200));
    const password = requiredText(body, "password", "Şifre", 200);
    if (password.length < 8) return jsonError(400, "Şifre en az 8 karakter olmalıdır.");
    if (await findAccountByEmail(email)) return jsonError(409, "Bu e-posta ile kayıtlı bir hesap var.");
    // İsteğe bağlı basit kullanıcı adı (ör. katilimci1); benzersizlik insertAccount'ta denetlenir.
    const username = typeof body.username === "string" ? body.username : null;
    const account = await insertAccount({ fullName, email, username, roleCode: PARTICIPANT_ROLE, password: await hashPassword(password), createdBy: "yarışmacı kaydı" });
    const session = await issueSession();
    await createSession({ tokenHash: await hashToken(session.token), accountId: account.id, expiresAt: session.expiresAt, userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200) || null });
    await recordAudit({ actorId: account.id, actorEmail: account.email, actorRole: PARTICIPANT_ROLE, action: "participant_registered", targetType: "account", targetId: account.id });
    return json({ account, expiresAt: session.expiresAt }, 201, { "set-cookie": sessionCookieHeader(session.cookieValue) });
  } catch (error) { return handleError(error); }
}

