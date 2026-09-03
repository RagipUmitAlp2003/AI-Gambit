import { ConflictError, DatabaseUnavailableError, findSessionAccount } from "./admin-db";
import { PayloadTooLargeError, configuredByteLimit, readBodyWithLimit } from "./request-guard";
import { ReportStorageUnavailableError } from "./workflow-db";
import { ASSIGNABLE_ROLE_CODES, isRoleCode } from "./admin-roles";
import { PERMISSIONS, type Permission } from "./authorization";
import type { AdminAccount, RoleCode } from "./admin-types";
import { AuthConfigError, authConfigured, hashToken, isProduction, readSignedToken } from "./session";

/**
 * Yönetici uçlarının ortak yanıt, doğrulama ve yetki yardımcıları.
 *
 * Yetki kontrolü tamamen sunucu tarafındadır. Oturum yoksa 401, oturum var
 * ama rol yetmiyorsa 403 döner. `MODERATOR_SECRET` tanımlı değilse uçlar
 * korumasız kalmaz; 503 ile reddedilir (fail-closed).
 */

/** Girdi doğrulama hatası (400). Çakışmadan (409) ayrılır. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

export type AuthSuccess = { ok: true; account: AdminAccount; tokenHash: string };
export type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Oturumu doğrular. Jetonun imzası, veri tabanındaki karşılığı, süresi ve
 * hesabın hâlâ aktif olduğu her istekte yeniden kontrol edilir; pasife alınan
 * bir hesabın açık oturumu anında geçersizdir.
 */
export async function authenticate(request: Request): Promise<AuthResult> {
  if (!authConfigured()) {
    console.error("[auth] MODERATOR_SECRET tanımlı değil; yönetici uçları reddediliyor.");
    return {
      ok: false,
      response: jsonError(503, "Kimlik doğrulama yapılandırması eksik. Yönetici uçları devre dışı.", {
        authUnavailable: true,
      }),
    };
  }

  try {
    const token = await readSignedToken(request);
    if (!token) return { ok: false, response: jsonError(401, "Oturum açmanız gerekiyor.", { needsLogin: true }) };

    const tokenHash = await hashToken(token);
    const account = await findSessionAccount(tokenHash);
    if (!account) {
      return { ok: false, response: jsonError(401, "Oturum geçersiz veya süresi dolmuş.", { needsLogin: true }) };
    }
    return { ok: true, account, tokenHash };
  } catch (error) {
    return { ok: false, response: handleError(error) };
  }
}

/**
 * Oturum + rol kontrolü. Yalnızca verilen rollerdeki hesaplar geçer.
 * Rol yetmiyorsa 403 döner ve hangi rolün gerektiği söylenmez fazlasıyla.
 */
export async function requireRoles(request: Request, roles: RoleCode[]): Promise<AuthResult> {
  const result = await authenticate(request);
  if (!result.ok) return result;
  if (!roles.includes(result.account.roleCode)) {
    return {
      ok: false,
      response: jsonError(403, "Bu işlem için yetkiniz yok."),
    };
  }
  return result;
}

/**
 * İzin adı üzerinden yetki kontrolü. Rol listeleri route dosyalarında
 * tekrarlanmaz; tek kaynak `app/lib/authorization.ts` içindeki matristir.
 */
export function requirePermission(request: Request, permission: Permission): Promise<AuthResult> {
  return requireRoles(request, [...PERMISSIONS[permission]]);
}

/** Hesap ve rol yönetimi yalnızca aktif Rol 00 (Moderatör) hesabına açıktır. */
export function requireModerator(request: Request): Promise<AuthResult> {
  return requirePermission(request, "manage_accounts");
}

export function handleError(error: unknown): Response {
  if (error instanceof AuthConfigError) {
    console.error("[auth] yapılandırma hatası", error);
    return jsonError(503, "Kimlik doğrulama yapılandırması eksik. Yönetici uçları devre dışı.", {
      authUnavailable: true,
    });
  }
  if (error instanceof DatabaseUnavailableError) {
    // Ayrıntı (bağlama adı, yapılandırma yolu) yalnızca sunucu logunda kalır.
    console.error("[db] D1 bağlaması bulunamadı; hosting.json içindeki d1 alanını ve dağıtım ayarını kontrol edin.");
    return jsonError(503, error.message, { databaseUnavailable: true });
  }
  if (error instanceof ReportStorageUnavailableError) {
    // R2 bağlaması yoksa başvuru PDF'i hiçbir yere yazılamaz; sebebi açıkça söylenir.
    console.error("[r2] REPORTS bağlaması bulunamadı; .openai/hosting.json ve dağıtım ayarını kontrol edin.");
    return jsonError(
      503,
      "Başvuru PDF'i saklanamıyor: sunucudaki dosya deposu (R2 “REPORTS” bağlaması) tanımlı değil. "
      + "Sistem yöneticisi bu bağlamayı tanımlayana kadar başvuru alınamaz.",
      { storageUnavailable: true },
    );
  }
  if (error instanceof PayloadTooLargeError) {
    // Boyut kapısı ayrıştırmadan ÖNCE çalışır (madde 9); 400'e düşürülmez.
    return jsonError(413, "İstek gövdesi izin verilen boyutu aşıyor.");
  }
  if (error instanceof ValidationError) {
    return jsonError(400, error.message);
  }
  if (error instanceof ConflictError) {
    return jsonError(409, error.message);
  }
  // Beklenmeyen hata. Referans kodu hem günlüğe hem yanıta yazılır: kullanıcının
  // ekranda gördüğü kod, sunucu günlüğündeki satırla birebir eşleşir.
  const reference = crypto.randomUUID().slice(0, 8).toUpperCase();
  console.error(`[admin] beklenmeyen hata · Ref ${reference}`, error);
  const cause = describeUnexpected(error);
  return jsonError(
    500,
    // Üretimde teknik ayrıntı (SQL, tablo adı, yol) istemciye gitmez; yalnızca
    // referans kodu gider ve ayrıntı sunucu günlüğünde kalır.
    isProduction()
      ? `İşlem tamamlanamadı. Sunucuda beklenmeyen bir hata oluştu (Ref: ${reference}). Bu kodu sistem yöneticisine iletin.`
      : `İşlem tamamlanamadı: ${cause} (Ref: ${reference})`,
    { reference, ...(isProduction() ? {} : { detail: cause }) },
  );
}

/**
 * Beklenmeyen hatayı tek satırlık, okunur bir nedene indirger.
 * Sık görülen SQLite/D1 ihlalleri için Türkçe karşılık üretir ki ekrandaki
 * mesaj "İşlem tamamlanamadı" gibi boş bir cümle olarak kalmasın.
 */
function describeUnexpected(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.trim() || "bilinmeyen hata";
  if (/UNIQUE constraint failed/i.test(message)) {
    const column = message.match(/UNIQUE constraint failed:\s*([^\s)]+)/i)?.[1] ?? "";
    return `aynı kayıt zaten var (benzersizlik ihlali${column ? `: ${column}` : ""})`;
  }
  if (/NOT NULL constraint failed/i.test(message)) {
    const column = message.match(/NOT NULL constraint failed:\s*([^\s)]+)/i)?.[1] ?? "";
    return `zorunlu alan boş gönderildi${column ? ` (${column})` : ""}`;
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) return "bağlı kayıt bulunamadı (yabancı anahtar ihlali)";
  if (/no such table|no such column/i.test(message)) return `veri tabanı şeması güncel değil (${message})`;
  if (/too many SQL variables|expression tree is too large/i.test(message)) return "tek işlemde gönderilen kayıt sayısı veri tabanı sınırını aşıyor";
  if (/D1_ERROR/i.test(message)) return message.replace(/^D1_ERROR:?\s*/i, "veri tabanı hatası: ");
  return message.slice(0, 300);
}

/** Ortak JSON gövde tavanı (madde 9): bütün küçük JSON uçları için bol pay. */
export const DEFAULT_JSON_BODY_BYTES = 2 * 1024 * 1024;

/**
 * JSON gövdeyi BOYUT KAPISINDAN geçirerek okur (madde 9): gerçek baytlar akış
 * sırasında sayılır, sınır aşımı ayrıştırma başlamadan 413'e gider
 * (`PayloadTooLargeError` → handleError). Content-Length eksik olan istek
 * otomatik güvenli sayılmaz. Varsayılan tavan REQUEST_JSON_MAX_BYTES ortam
 * değişkeniyle ayarlanabilir; benzerlik gibi büyük uçlar kendi tavanını verir.
 */
export async function readJson(
  request: Request,
  maxBytes = configuredByteLimit("REQUEST_JSON_MAX_BYTES", DEFAULT_JSON_BODY_BYTES),
): Promise<Record<string, unknown>> {
  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, maxBytes);
  } catch (error) {
    // KRİTİK: boyut aşımı 400'e DÜŞÜRÜLMEZ; handleError bunu 413'e çevirir.
    if (error instanceof PayloadTooLargeError) throw error;
    throw new ValidationError("İstek gövdesi okunamadı; geçerli bir JSON gönderin.");
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Gövde bir nesne olmalı.");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new ValidationError("İstek gövdesi okunamadı; geçerli bir JSON gönderin.");
  }
}

export function requiredText(body: Record<string, unknown>, key: string, label: string, maxLength = 400): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} alanı zorunludur.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${label} en fazla ${maxLength} karakter olabilir.`);
  }
  return trimmed;
}

export function optionalText(body: Record<string, unknown>, key: string, maxLength = 2000): string {
  const value = body[key];
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/** RFC'nin tamamı değil; yazım hatalarını erkenden yakalayan pratik kontrol. */
export function assertEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ValidationError("Geçerli bir e-posta adresi girin.");
  }
  return email;
}

/**
 * Rol kodu allowlist kontrolü; 05, admin, -1 gibi değerler reddedilir.
 *
 * Allowlist yalnızca 01, 02 ve 04 içerir (bkz. admin-roles · ASSIGNABLE_ROLE_CODES):
 * Yarışmacı (03) kendi kaydını açar, yeni Admin (00) ise hiçbir API ucundan
 * oluşturulamaz. Bu, arayüz kısıtı değil sunucu tarafı doğrulamadır.
 */
export function assertRoleCode(value: unknown, label = "Rol numarası"): RoleCode {
  if (!isRoleCode(value) || !ASSIGNABLE_ROLE_CODES.includes(value)) {
    throw new ValidationError(`${label} geçersiz. İzin verilen yönetici rolleri: ${ASSIGNABLE_ROLE_CODES.join(", ")}.`);
  }
  return value;
}
