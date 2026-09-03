import {
  LOGIN_FAILURE_LIMIT,
  clearLoginFailures,
  countRecentLoginFailures,
  deleteOtherSessionsForAccount,
  findCredentialsById,
  recordAudit,
  recordLoginFailure,
  updatePassword,
} from "../../../lib/admin-db";
import {
  ValidationError,
  authenticate,
  handleError,
  json,
  jsonError,
  readJson,
  requiredText,
} from "../../../lib/admin-guard";
import { hashToken } from "../../../lib/session";
import { PASSWORD_LENGTH, hashPassword, verifyPassword } from "../../../lib/password";

/**
 * Parola değiştirme ucu (madde 10 · must_change_password gerçek akışı).
 *
 * Rol fark etmeksizin her AKTİF hesap kendi parolasını değiştirebilir
 * (yarışmacı dahil). Akış:
 *   oturum doğrulanır → D1 sayaç kontrolü → mevcut (geçici) parola doğrulanır
 *   → yeni parola politika kontrolünden geçer → tek UPDATE ile parola yazılır
 *   ve `must_change_password` bayrağı temizlenir → hesabın DİĞER oturumları
 *   düşürülür (mevcut oturum korunur) → denetim kaydı.
 *
 * Yanlış mevcut parola denemeleri, giriş ucuyla aynı dağıtık D1 sayacına
 * yazılır; geçici parolayı ele geçirmeye çalışan kaba kuvvet 429 ile durur.
 */

const THROTTLE_MESSAGE = "Çok fazla başarısız deneme. Lütfen bir süre sonra tekrar deneyin.";

/** Anahtar SHA-256(ip|pw|hesap) özetidir; açık IP veya kimlik saklanmaz. */
function failureKey(request: Request, accountId: string): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
  return hashToken(`${ip}|pw|${accountId}`);
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await readJson(request);
    const currentPassword = requiredText(body, "currentPassword", "Mevcut şifre", 200);
    const newPassword = requiredText(body, "newPassword", "Yeni şifre", 200);

    const key = await failureKey(request, auth.account.id);
    if ((await countRecentLoginFailures(key)) >= LOGIN_FAILURE_LIMIT) {
      return jsonError(429, THROTTLE_MESSAGE);
    }

    const credentials = await findCredentialsById(auth.account.id);
    if (!credentials) {
      // Hesap bu istekle yarışan bir işlemle silinmiş/bozulmuş olabilir.
      return jsonError(401, "Oturum geçersiz veya süresi dolmuş.", { needsLogin: true });
    }

    // ESKİ (GEÇİCİ) PAROLA DOĞRULANIR: oturum çerezi tek başına yetmez.
    let valid = false;
    try {
      valid = await verifyPassword(currentPassword, credentials.password);
    } catch (error) {
      console.error("[auth] parola özeti okunamadı", error);
      valid = false;
    }
    if (!valid) {
      await recordLoginFailure(key);
      return jsonError(401, "Mevcut şifre doğrulanamadı.");
    }

    // Politika: sistemin ürettiği tek kullanımlık parolayla aynı asgari uzunluk.
    if (newPassword.length < PASSWORD_LENGTH) {
      throw new ValidationError(`Yeni şifre en az ${PASSWORD_LENGTH} karakter olmalıdır.`);
    }
    if (newPassword === currentPassword) {
      throw new ValidationError("Yeni şifre eskisiyle aynı olamaz.");
    }

    const record = await hashPassword(newPassword);
    // Tek UPDATE: parola özeti + must_change_password bayrağı birlikte yazılır.
    await updatePassword(auth.account.id, record);
    // Eski oturumlar iptal edilir; kullanıcının mevcut oturumu korunur.
    await deleteOtherSessionsForAccount(auth.account.id, auth.tokenHash);
    await clearLoginFailures(key);

    await recordAudit({
      actorId: auth.account.id,
      actorEmail: auth.account.email,
      actorRole: auth.account.roleCode,
      action: "password_changed",
      targetType: "account",
      targetId: auth.account.id,
      detail: "parola değiştirildi; hesabın diğer oturumları düşürüldü",
    });

    return json({ account: { ...auth.account, mustChangePassword: false } });
  } catch (error) {
    return handleError(error);
  }
}
