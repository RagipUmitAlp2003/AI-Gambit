/**
 * ORTAK ORTAM KİLİDİ (fail-closed) — yalnızca araç betikleri için.
 *
 * Uygulama tarafındaki güvenli varsayılanın (app/lib/session.ts ·
 * runtimeEnvironment) betik karşılığıdır: APP_ENV/NODE_ENV hiç tanımlı
 * değilse ortam GÜVENLİ varsayılan olarak production kabul edilir ve yıkıcı
 * yerel betikler ÇALIŞMAZ. Betikler yalnızca AÇIK development işaretiyle
 * koşar; "production değilse geç" biçimindeki eski fail-open kontrolün
 * yerini alır.
 */
import { existsSync, readFileSync } from "node:fs";

const DEV_VALUES = new Set(["development", "dev", "test"]);

/** .env.local içindeki APP_ENV= satırını okur; dosya ya da satır yoksa null. */
function readEnvLocalAppEnv() {
  if (!existsSync(".env.local")) return null;
  const match = readFileSync(".env.local", "utf8").match(/^\s*APP_ENV\s*=\s*(\S+)\s*$/m);
  return match ? match[1].trim().toLowerCase() : null;
}

/**
 * Açık geliştirme ortamı şartı:
 *   - process.env VEYA .env.local "production" diyorsa → reddet (eski davranış korunur).
 *   - Hiçbir kaynak AÇIKÇA development demiyorsa → reddet (fail-closed; yeni).
 * Aksi hâlde sessizce geçer.
 */
export function assertExplicitDevelopment(scriptName) {
  const fromProcess = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  const fromFile = readEnvLocalAppEnv();

  if (fromProcess === "production" || fromFile === "production") {
    console.error(
      `REDDEDİLDİ (${scriptName}): APP_ENV/NODE_ENV 'production'. Bu betik yalnızca geliştirme ortamında çalışır.`,
    );
    process.exit(1);
  }
  if (!DEV_VALUES.has(fromProcess) && !DEV_VALUES.has(fromFile ?? "")) {
    console.error(
      `REDDEDİLDİ (${scriptName}): açık geliştirme işareti yok (güvenli varsayılan production).\n`
      + "Yerelde çalıştırmak için .env.local dosyasına APP_ENV=development yazın.",
    );
    process.exit(1);
  }
}
