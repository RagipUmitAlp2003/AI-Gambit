/**
 * Tek kullanımlık şifre üretimi ve PBKDF2-SHA256 özeti.
 * Açık şifre hiçbir zaman saklanmaz; yalnızca hesap oluşturma yanıtında
 * bir kez döner ve e-posta gövdesine yazılır.
 */

/** Karışabilen karakterler (0/O, 1/I/l) dışarıda bırakılmıştır. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export const PASSWORD_LENGTH = 8;

export type PasswordRecord = {
  hash: string;
  salt: string;
  iterations: number;
};

/**
 * Kriptografik rastgelelikle 8 haneli şifre üretir. Modulo sapmasını
 * önlemek için alfabe uzunluğuna bölünmeyen baytlar atılır.
 */
export function generatePassword(length: number = PASSWORD_LENGTH): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let result = "";
  while (result.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      result += ALPHABET[byte % ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Bozuk kayıtta istisna fırlatmak yerine null döner. */
function fromBase64(value: string): Uint8Array | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return { hash: toBase64(hash), salt: toBase64(salt), iterations: PBKDF2_ITERATIONS };
}

/**
 * Sabit süreli karşılaştırma; erken çıkış yapılmaz.
 * Bozuk veya eksik özet kaydı istisna fırlatmaz, yalnızca false döner —
 * tek bir hatalı satır giriş akışını düşürmemelidir.
 */
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const expected = fromBase64(record?.hash);
  const salt = fromBase64(record?.salt);
  const iterations = Number.isInteger(record?.iterations) && record.iterations > 0 ? record.iterations : 0;
  if (!expected || !salt || !iterations) return false;

  const actual = await derive(password, salt, iterations);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected[index] ^ actual[index];
  }
  return diff === 0;
}
