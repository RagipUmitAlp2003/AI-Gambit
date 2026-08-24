import {
  createSession,
  deleteSession,
  findCredentialsByEmail,
  recordAudit,
} from "../../../lib/admin-db";
import { roleByCode } from "../../../lib/admin-roles";
import {
  ValidationError,
  authenticate,
  handleError,
  json,
  jsonError,
  readJson,
  requiredText,
} from "../../../lib/admin-guard";
import {
  authConfigured,
  clearedSessionCookieHeader,
  hashToken,
  issueSession,
  sessionCookieHeader,
} from "../../../lib/session";
import { hashPassword, verifyPassword } from "../../../lib/password";

/**
 * Oturum ucu: giriş (POST), çıkış (DELETE) ve mevcut oturum (GET).
 *
 * Giriş akışı: e-posta + şifre → hesap D1'den bulunur → hesap aktif mi
 * kontrol edilir → parola özeti doğrulanır → imzalı oturum çerezi verilir.
 */

/** Aynı izolat içinde kaba kuvvet denemelerini yavaşlatan basit sayaç. */
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_LIMIT = 8;
const failures = new Map<string, { count: number; firstAt: number }>();

function failureKey(request: Request, email: string): string {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
  return `${ip}|${email}`;
}

function throttled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > FAILURE_WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= FAILURE_LIMIT;
}

function noteFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.firstAt > FAILURE_WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  return json({
    account: auth.account,
    role: roleByCode(auth.account.roleCode),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!authConfigured()) {
    console.error("[auth] MODERATOR_SECRET tanımlı değil; giriş reddedildi.");
    return jsonError(503, "Kimlik doğrulama yapılandırması eksik. Yönetici uçları devre dışı.", {
      authUnavailable: true,
    });
  }

  try {
    const body = await readJson(request);
    const email = requiredText(body, "email", "E-posta", 200).toLowerCase();
    const password = requiredText(body, "password", "Şifre", 200);

    const key = failureKey(request, email);
    if (throttled(key)) {
      return jsonError(429, "Çok fazla başarısız deneme. Lütfen bir süre sonra tekrar deneyin.");
    }

    const credentials = await findCredentialsByEmail(email);

    if (!credentials) {
      // Hesap yokken de bir türetme çalıştırılır; yanıt süresi hesap
      // varlığını ele vermesin.
      await verifyPassword(password, await hashPassword("kayitsiz-hesap-icin-sabit-deger"));
      noteFailure(key);
      return jsonError(401, "E-posta veya şifre hatalı.");
    }

    if (credentials.account.status !== "active") {
      noteFailure(key);
      await recordAudit({
        actorId: credentials.account.id,
        actorEmail: credentials.account.email,
        actorRole: credentials.account.roleCode,
        action: "login_denied_inactive",
        targetType: "account",
        targetId: credentials.account.id,
      });
      return jsonError(403, "Hesap aktif değil.");
    }

    let valid = false;
    try {
      valid = await verifyPassword(password, credentials.password);
    } catch (error) {
      // Bozuk/eksik özet kaydı giriş akışını düşürmez.
      console.error("[auth] parola özeti okunamadı", error);
      valid = false;
    }

    if (!valid) {
      noteFailure(key);
      return jsonError(401, "E-posta veya şifre hatalı.");
    }

    failures.delete(key);

    const session = await issueSession();
    await createSession({
      tokenHash: await hashToken(session.token),
      accountId: credentials.account.id,
      expiresAt: session.expiresAt,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200) || null,
    });
    await recordAudit({
      actorId: credentials.account.id,
      actorEmail: credentials.account.email,
      actorRole: credentials.account.roleCode,
      action: "login",
      targetType: "account",
      targetId: credentials.account.id,
    });

    return json(
      {
        account: credentials.account,
        role: roleByCode(credentials.account.roleCode),
        expiresAt: session.expiresAt,
      },
      200,
      { "set-cookie": sessionCookieHeader(session.cookieValue) },
    );
  } catch (error) {
    if (error instanceof ValidationError) return jsonError(400, error.message);
    return handleError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  // Oturum zaten geçersizse bile çerez temizlenir.
  if (!auth.ok) {
    return json({ signedOut: true }, 200, { "set-cookie": clearedSessionCookieHeader() });
  }

  try {
    await deleteSession(auth.tokenHash);
    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: "logout",
      targetType: "account",
      targetId: auth.account.id,
    });
    return json({ signedOut: true }, 200, { "set-cookie": clearedSessionCookieHeader() });
  } catch (error) {
    return handleError(error);
  }
}
