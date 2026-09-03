import { env } from "cloudflare:workers";
import {
  LOGIN_FAILURE_LIMIT,
  countAccounts,
  countActiveModerators,
  countRecentLoginFailures,
  findAccountByUsername,
  insertAccount,
  recordAudit,
  recordLoginFailure,
} from "../../../lib/admin-db";
import {
  ValidationError,
  assertEmail,
  handleError,
  json,
  jsonError,
  readJson,
  requiredText,
} from "../../../lib/admin-guard";
import { authConfigured, hashToken, isExplicitDevelopment, isProduction } from "../../../lib/session";
import { PASSWORD_LENGTH, generatePassword, hashPassword } from "../../../lib/password";

/**
 * İlk Admin (00) hesabının kurulumu.
 *
 * İKİ MOD:
 *
 *   production   `MODERATOR_BOOTSTRAP_TOKEN` + isim + e-posta ile YALNIZCA
 *                sistemde hiç hesap yokken çalışır; şifre sistem tarafından
 *                üretilir ve yalnızca yanıtta döner. Kurulum tamamlandıktan
 *                sonra uç hiçbir durum bilgisi sızdırmaz: POST nötr 404
 *                "Kurulum ucu kapalı." döner, GET anahtar yapılandırmasını
 *                raporlamaz.
 *
 *   development  Tek tıkla GEÇİCİ bootstrap hesabı: kullanıcı adı `admin`,
 *                şifre `1234`. DÖRT kilit birlikte sağlanmalıdır (aşağıdaki
 *                devBootstrapPermitted): açık development ortamı + açık yerel
 *                izin bayrağı + loopback istek + üretim DEĞİL. Beşinci koşul
 *                (hiç aktif Admin yok) createDevAdmin içinde denetlenir.
 *
 * IDEMPOTENT (madde 7): her iki modda da sistemde aktif bir Admin varsa YENİ
 * hesap AÇILMAZ. Geliştirme modu ikinci çağrıda `created: false` ile mevcut
 * hesabın künyesini döndürür; ikinci bir Admin üretmez.
 */

/** Geliştirme/demo bootstrap hesabının sabit künyesi. */
const DEV_ADMIN = {
  username: "admin",
  password: "1234",
  fullName: "Kurulum Admini (geçici)",
  email: "admin@yerel.test",
} as const;

const DEV_WARNING =
  "DİKKAT: bu hesap yalnızca GELİŞTİRME/DEMO ortamı içindir. Şifresi (1234) herkesçe bilinen "
  + "geçici bir değerdir. Üretime çıkmadan önce bu hesabı kaldırın ve gerçek bir Admin hesabı açın.";

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

/** Yerel/loopback adresler; hem istek ana bilgisayarı hem gerçek istemci IP'si denetlenir. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackRequest(request: Request): boolean {
  let hostname = "";
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(hostname)) return false;
  // Proxy arkasından gelen gerçek istemci IP'si loopback DEĞİLSE reddedilir.
  const connectingIp = (request.headers.get("cf-connecting-ip") ?? "").trim().toLowerCase();
  if (connectingIp && !LOOPBACK_HOSTS.has(connectingIp)) return false;
  return true;
}

/**
 * Geliştirme bootstrap kilidi — koşulların HEPSİ birlikte sağlanmalıdır:
 *   1. Üretim ortamı DEĞİL (fail-closed: eksik APP_ENV/NODE_ENV üretim sayılır).
 *   2. AÇIK geliştirme işareti (APP_ENV=development).
 *   3. AÇIK yerel izin bayrağı: ALLOW_LOCAL_ADMIN_BOOTSTRAP=on.
 *   4. Yerel/loopback istek.
 * Beşinci koşul (hiç aktif Admin yok) createDevAdmin içinde ayrıca denetlenir.
 * Ek tek kullanımlık token dev modu için BİLİNÇLİ olarak istenmez (karar kaydı).
 */
function devBootstrapPermitted(request: Request): boolean {
  if (isProduction()) return false;
  if (!isExplicitDevelopment()) return false;
  const allow = (env.ALLOW_LOCAL_ADMIN_BOOTSTRAP ?? "").trim().toLowerCase();
  if (allow !== "on" && allow !== "true" && allow !== "1") return false;
  return isLoopbackRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const [total, moderators] = await Promise.all([countAccounts(), countActiveModerators()]);
    const required = total === 0;
    const devBootstrapAvailable = devBootstrapPermitted(request) && moderators === 0;
    return json({
      required,
      // SIZINTI KAPALI: anahtar yapılandırması yalnızca sıfır hesaplı kurulum
      // evresinde raporlanır; kurulumdan sonra uç nötrdür.
      tokenConfigured: required ? Boolean(env.MODERATOR_BOOTSTRAP_TOKEN) : false,
      authConfigured: authConfigured(),
      // Geliştirme kurulumu yalnızca dev kilitleri sağlanınca ve hiç aktif
      // Admin yokken sunulur; kullanıcı adı da yalnızca o zaman söylenir.
      devBootstrapAvailable,
      devUsername: devBootstrapAvailable ? DEV_ADMIN.username : "",
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Geliştirme/demo bootstrap Admini; ikinci çağrıda ikinci hesap AÇMAZ. */
async function createDevAdmin(request: Request): Promise<Response> {
  if (!devBootstrapPermitted(request)) {
    // Hangi koşulun eksik olduğu istemciye SÖYLENMEZ; ayrıntı sunucu logunda kalır.
    console.error("[bootstrap] geliştirme kurulumu koşulları sağlanmadı; istek reddedildi.");
    return jsonError(404, "Geliştirme kurulumu bu ortamda kullanılamaz.");
  }
  const existing = await findAccountByUsername(DEV_ADMIN.username);
  if (existing) {
    // İDEMPOTENT: hesap zaten var, ikincisi üretilmez.
    return json({
      account: existing,
      username: DEV_ADMIN.username,
      oneTimePassword: "",
      created: false,
      warning: `Bootstrap Admin hesabı zaten var; yeni hesap oluşturulmadı. ${DEV_WARNING}`,
    });
  }
  if ((await countActiveModerators()) > 0) {
    return jsonError(409, "Sistemde zaten aktif bir Admin hesabı var; ikinci bootstrap hesabı açılmaz.");
  }
  const account = await insertAccount({
    fullName: DEV_ADMIN.fullName,
    email: DEV_ADMIN.email,
    username: DEV_ADMIN.username,
    roleCode: "00",
    password: await hashPassword(DEV_ADMIN.password),
    createdBy: "geliştirme kurulumu",
    // admin/1234 yerel kolaylığı zorunlu parola değişimine TAKILMAZ (onaylı
    // karar): hesap zaten yalnızca açık dev kilitleriyle açılabilir ve
    // DEV_WARNING üretim öncesi kaldırılmasını söyler.
    mustChangePassword: false,
  });
  await recordAudit({
    actorId: null,
    actorEmail: null,
    actorRole: null,
    action: "bootstrap_dev_admin_created",
    targetType: "account",
    targetId: account.id,
    detail: `Geliştirme bootstrap Admini oluşturuldu: ${DEV_ADMIN.username}`,
  });
  return json({
    account,
    username: DEV_ADMIN.username,
    oneTimePassword: DEV_ADMIN.password,
    created: true,
    warning: DEV_WARNING,
  }, 201);
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!authConfigured()) {
      return jsonError(503, "Kimlik doğrulama yapılandırması eksik. Yönetici uçları devre dışı.", {
        authUnavailable: true,
      });
    }

    const body = await readJson(request);
    if (body.mode === "development") return await createDevAdmin(request);

    // ÜRETİM KURULUM EVRESİ (orta yol): token akışı YALNIZCA sistemde hiç
    // hesap yokken çalışır. Kurulum tamamlandıktan sonra uç, hesap varlığı
    // dahil hiçbir durum bilgisi sızdırmadan nötr 404 döner.
    if ((await countAccounts()) > 0) {
      return jsonError(404, "Kurulum ucu kapalı.");
    }

    const expected = env.MODERATOR_BOOTSTRAP_TOKEN;
    if (!expected || expected.trim().length < 8) {
      // Yapılandırma eksikliği istemciye AYNI nötr yanıtla döner; ayrıntı logda.
      console.error("[bootstrap] MODERATOR_BOOTSTRAP_TOKEN tanımlı değil veya çok kısa; kurulum reddedildi.");
      return jsonError(404, "Kurulum ucu kapalı.");
    }

    const token = requiredText(body, "token", "Kurulum anahtarı", 200);

    // Kurulum anahtarı denemeleri de D1 sayacıyla sınırlanır (izolatlar arası).
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
    const throttleKey = await hashToken(`${ip}|bootstrap`);
    if ((await countRecentLoginFailures(throttleKey)) >= LOGIN_FAILURE_LIMIT) {
      return jsonError(429, "Çok fazla başarısız deneme. Lütfen bir süre sonra tekrar deneyin.");
    }
    if (!constantTimeEqual(token, expected)) {
      console.error("[bootstrap] geçersiz kurulum anahtarı denemesi");
      await recordLoginFailure(throttleKey);
      return jsonError(401, "Kurulum anahtarı geçersiz.");
    }

    const fullName = requiredText(body, "fullName", "İsim Soyisim", 120);
    const email = assertEmail(requiredText(body, "email", "E-posta", 200));
    const username = typeof body.username === "string" ? body.username : null;
    const manualPassword = typeof body.password === "string" ? body.password.trim() : "";
    if (manualPassword && manualPassword.length < PASSWORD_LENGTH) {
      throw new ValidationError(`Şifre en az ${PASSWORD_LENGTH} karakter olmalıdır.`);
    }
    const oneTimePassword = manualPassword || generatePassword();

    const account = await insertAccount({
      fullName,
      email,
      username,
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
      detail: `İlk Admin hesabı kuruldu: ${account.email}`,
    });

    // Şifre yalnızca bu yanıtta döner; veri tabanına açık hâli yazılmaz.
    return json({ account, oneTimePassword }, 201);
  } catch (error) {
    return handleError(error);
  }
}
