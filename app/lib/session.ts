import { env } from "cloudflare:workers";

/**
 * Oturum jetonu üretimi, imzalama ve çerez biçimi.
 *
 * Jeton opak ve rastgeledir; veri tabanında yalnızca SHA-256 özeti tutulur.
 * Çerezdeki değer ayrıca `MODERATOR_SECRET` ile HMAC imzalanır, böylece
 * istemci jetonu üretemez ve yalnızca veri tabanını okuyabilen bir sızıntı
 * geçerli çerez üretmeye yetmez.
 */

export const SESSION_COOKIE = "kriter_admin_session";
/** Mutlak oturum ömrü. Yenileme yok; süre dolunca yeniden giriş gerekir. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_SECRET_LENGTH = 16;
const TOKEN_BYTES = 32;

/** Oturum yapılandırması eksikken uçların açık kalmaması için fırlatılır. */
export class AuthConfigError extends Error {
  constructor() {
    super("Kimlik doğrulama yapılandırması eksik.");
    this.name = "AuthConfigError";
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Geçersiz girdide istisna fırlatmak yerine null döner. */
function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** Yapılandırma eksikse AuthConfigError fırlatır; sessizce geçmez. */
function requireSecret(): string {
  const secret = env.MODERATOR_SECRET;
  if (!secret || secret.trim().length < MIN_SECRET_LENGTH) throw new AuthConfigError();
  return secret;
}

export function authConfigured(): boolean {
  try {
    requireSecret();
    return true;
  } catch {
    return false;
  }
}

export type RuntimeEnvironment = "production" | "development";

let missingEnvWarned = false;

/**
 * Ortak ortam çıkarımı — GÜVENLİ VARSAYILAN ÜRETİMDİR (fail-closed).
 *
 * `APP_ENV`/`NODE_ENV` hiç tanımlı değilse ya da tanınmayan bir değer
 * taşıyorsa sistem production sayılır: dev bootstrap kapanır, çerezler
 * `Secure` olur, hata ayrıntısı maskelenir. Geliştirme kolaylıkları yalnızca
 * AÇIKÇA development yazıldığında açılır. Uygulamadaki bütün ortam kontrolleri
 * bu tek fonksiyondan geçer; dağınık `process.env` okuması yapılmaz.
 */
export function runtimeEnvironment(): RuntimeEnvironment {
  const value = (env.APP_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  if (value === "development" || value === "dev" || value === "test") return "development";
  if (!value && !missingEnvWarned) {
    missingEnvWarned = true;
    console.warn("[env] APP_ENV/NODE_ENV tanımsız; güvenli varsayılan production uygulanıyor.");
  }
  // Eksik veya tanınmayan değer = güvenli varsayılan production.
  return "production";
}

export function isProduction(): boolean {
  return runtimeEnvironment() === "production";
}

/** Geliştirme kolaylıkları yalnızca AÇIK development işaretiyle açılır. */
export function isExplicitDevelopment(): boolean {
  return runtimeEnvironment() === "development";
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

/** Veri tabanında saklanan biçim; ham jeton hiçbir yerde yazılmaz. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64UrlEncode(new Uint8Array(digest));
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export type IssuedSession = { token: string; cookieValue: string; expiresAt: string };

export async function issueSession(): Promise<IssuedSession> {
  const raw = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(raw);
  const token = base64UrlEncode(raw);
  const signature = await hmac(token);
  return {
    token,
    cookieValue: `${token}.${signature}`,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  };
}

/** İmzası doğrulanmış ham jetonu döner; aksi hâlde null. */
export async function readSignedToken(request: Request): Promise<string | null> {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const entry = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!entry) return null;

  const value = decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1));
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!base64UrlDecode(token) || !base64UrlDecode(signature)) return null;

  const expected = await hmac(token);
  return constantTimeEqual(expected, signature) ? token : null;
}

function cookieAttributes(maxAge: number): string {
  // Yerel geliştirmede http üzerinden çalışılabilsin diye Secure yalnızca
  // üretimde eklenir; diğer koruma bayrakları her ortamda açıktır.
  const attributes = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Max-Age=${maxAge}`,
  ];
  if (isProduction()) attributes.push("Secure");
  return attributes.join("; ");
}

export function sessionCookieHeader(cookieValue: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; ${cookieAttributes(SESSION_TTL_SECONDS)}`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}
