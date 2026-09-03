import {
  LOGIN_FAILURE_LIMIT,
  clearLoginFailures,
  countRecentLoginFailures,
  createSession,
  deleteSession,
  findCredentialsByIdentifier,
  recordAudit,
  recordLoginFailure,
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
import type { PasswordRecord } from "../../../lib/password";

/**
 * Oturum ucu: giriş (POST), çıkış (DELETE) ve mevcut oturum (GET).
 *
 * Giriş akışı: kullanıcı adı VEYA e-posta + şifre → D1 sayaç kontrolü →
 * hesap D1'den bulunur → parola özeti doğrulanır (hesap yoksa sahte kayıtla
 * aynı maliyette) → hesap aktif mi kontrol edilir → imzalı oturum çerezi
 * verilir. Bütün başarısız dallar aynı 401 + mesajı döner (hesap keşfi yok).
 *
 * ROL SEÇİMİ YOKTUR (madde 7): kullanıcı giriş sırasında rol seçmez; rol
 * veri tabanındaki hesaptan okunur ve panel ona göre açılır. Şifresiz rol
 * kısayolu (eski `/api/admin/dev-session`) kaldırılmıştır.
 */

/**
 * HESAP KEŞFİNE KARŞI TEKDÜZELİK: bilinmeyen kullanıcı, yanlış şifre ve
 * pasif hesap AYNI durum kodunu (401) ve AYNI mesajı alır; hiçbir dal hesap
 * varlığını veya pasifliğini ele vermez.
 */
const UNIFORM_LOGIN_MESSAGE = "Kullanıcı adı, e-posta veya şifre hatalı.";
const THROTTLE_MESSAGE = "Çok fazla başarısız deneme. Lütfen bir süre sonra tekrar deneyin.";

/**
 * Dağıtık kaba kuvvet sınırı: sayaç D1'dedir (bkz. admin-db ·
 * admin_login_failures) ve Cloudflare izolatları arasında paylaşılır; eski
 * proses içi Map izolat-yerel kaldığı için üretimde etkisizdi. Anahtar,
 * IP + kimliğin SHA-256 özetidir; açık IP veya kimlik saklanmaz.
 */
function failureKey(request: Request, identifier: string): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
  return hashToken(`${ip}|${identifier}`);
}

/**
 * ZAMANLAMA TEKDÜZELİĞİ: hesap bulunamadığında da tam olarak BİR PBKDF2
 * türetmesi çalışsın diye izolat başına bir kez üretilip önbelleklenen sahte
 * kayıt. (Eski akış bilinmeyen kullanıcıda her istekte 2× türetme yapıyordu;
 * bu, bilinen kullanıcı yoluna göre ölçülebilir bir zamanlama farkıydı.)
 */
let dummyRecordPromise: Promise<PasswordRecord> | null = null;
function dummyRecord(): Promise<PasswordRecord> {
  dummyRecordPromise ??= hashPassword("kayitsiz-hesap-icin-sabit-deger");
  return dummyRecordPromise;
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
    // `identifier` kullanıcı adı ya da e-posta olabilir. `email` alanı eski
    // istemcilerle geriye uyum için kabul edilmeye devam eder.
    const identifier = (typeof body.identifier === "string" && body.identifier.trim()
      ? requiredText(body, "identifier", "Kullanıcı adı veya e-posta", 200)
      : requiredText(body, "email", "Kullanıcı adı veya e-posta", 200)).toLowerCase();
    const password = requiredText(body, "password", "Şifre", 200);

    const key = await failureKey(request, identifier);
    if ((await countRecentLoginFailures(key)) >= LOGIN_FAILURE_LIMIT) {
      return jsonError(429, THROTTLE_MESSAGE);
    }

    const credentials = await findCredentialsByIdentifier(identifier);

    // Hesap bulunsun ya da bulunmasın HER yolda tam BİR parola türetmesi
    // çalışır; yanıt süresi hesap varlığını ele vermez.
    const record = credentials?.password ?? await dummyRecord();
    let valid = false;
    try {
      valid = await verifyPassword(password, record);
    } catch (error) {
      // Bozuk/eksik özet kaydı giriş akışını düşürmez.
      console.error("[auth] parola özeti okunamadı", error);
      valid = false;
    }

    if (!credentials || !valid) {
      await recordLoginFailure(key);
      return jsonError(401, UNIFORM_LOGIN_MESSAGE);
    }

    if (credentials.account.status !== "active") {
      await recordLoginFailure(key);
      // Parola doğrulandığı için denetim kaydı hesabın gerçek sahibini
      // gösterir; yanıt yine tekdüzedir, pasiflik istemciye SIZMAZ.
      await recordAudit({
        actorId: credentials.account.id,
        actorEmail: credentials.account.email,
        actorRole: credentials.account.roleCode,
        action: "login_denied_inactive",
        targetType: "account",
        targetId: credentials.account.id,
      });
      return jsonError(401, UNIFORM_LOGIN_MESSAGE);
    }

    await clearLoginFailures(key);

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
