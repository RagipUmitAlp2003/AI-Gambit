import { env } from "cloudflare:workers";
import {
  ConflictError,
  countAccounts,
  countActiveModerators,
  findAccountByUsername,
  insertAccount,
  recordAudit,
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
import { authConfigured, isProduction } from "../../../lib/session";
import { PASSWORD_LENGTH, generatePassword, hashPassword } from "../../../lib/password";

/**
 * İlk Admin (00) hesabının kurulumu.
 *
 * İKİ MOD:
 *
 *   production   `MODERATOR_BOOTSTRAP_TOKEN` + isim + e-posta ile bir kez
 *                çalışır; şifre sistem tarafından üretilir ve yalnızca yanıtta
 *                döner. Kurulumdan sonra uç 409 verir.
 *
 *   development  Tek tıkla GEÇİCİ bootstrap hesabı: kullanıcı adı `admin`,
 *                şifre `1234`. Yalnızca üretim DIŞI ortamda çalışır.
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

export async function GET(): Promise<Response> {
  try {
    const [total, moderators] = await Promise.all([countAccounts(), countActiveModerators()]);
    return json({
      required: total === 0,
      tokenConfigured: Boolean(env.MODERATOR_BOOTSTRAP_TOKEN),
      authConfigured: authConfigured(),
      // Geliştirme kurulumu yalnızca üretim dışında ve hiç aktif Admin yokken sunulur.
      devBootstrapAvailable: !isProduction() && moderators === 0,
      devUsername: DEV_ADMIN.username,
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Geliştirme/demo bootstrap Admini; ikinci çağrıda ikinci hesap AÇMAZ. */
async function createDevAdmin(): Promise<Response> {
  if (isProduction()) {
    return jsonError(404, "Geliştirme kurulumu üretim ortamında kullanılamaz.");
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
    // Geçici şifre olduğu açıkça işaretlenir.
    mustChangePassword: true,
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
    if (body.mode === "development") return await createDevAdmin();

    const expected = env.MODERATOR_BOOTSTRAP_TOKEN;
    if (!expected || expected.trim().length < 8) {
      console.error("[bootstrap] MODERATOR_BOOTSTRAP_TOKEN tanımlı değil; kurulum reddedildi.");
      return jsonError(503, "Kurulum anahtarı tanımlı değil.");
    }

    if ((await countAccounts()) > 0) {
      throw new ConflictError("Sistemde hesap var; kurulum ucu kapalıdır.");
    }

    const token = requiredText(body, "token", "Kurulum anahtarı", 200);
    if (!constantTimeEqual(token, expected)) {
      console.error("[bootstrap] geçersiz kurulum anahtarı denemesi");
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
