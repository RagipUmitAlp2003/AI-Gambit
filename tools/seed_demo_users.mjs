/**
 * BASİT TEST KULLANICILARI (yalnızca yerel/demo · madde 11).
 *
 * Kullanıcı adları:
 *   admin · projeyoneticisi1..3 (01) · hakem1..3 (02)
 *   degerlendirmeyoneticisi1 (04) · katilimci1..9 (03)
 *
 * Kurallar:
 *   - Parola: 1234 (yalnızca geliştirme). Veri tabanına AÇIK METİN YAZILMAZ;
 *     uygulamanın kendi mekanizması (PBKDF2-SHA256 · 150.000 iterasyon ·
 *     16 bayt tuz) ile özetlenir.
 *   - Üretim seed'i DEĞİLDİR: APP_ENV/NODE_ENV=production ise reddeder ve
 *     yalnızca .wrangler altındaki YEREL miniflare D1 dosyasını açar.
 *   - İdempotenttir: var olan kullanıcı adına dokunmaz, ikinci koşuda yeni
 *     hesap üretmez. Mevcut Admin hesabı ASLA değiştirilmez.
 *
 * Kullanım:
 *   node tools/seed_demo_users.mjs           # kuru çalıştırma
 *   node tools/seed_demo_users.mjs --apply   # hesapları oluşturur
 */
import { DatabaseSync } from "node:sqlite";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { assertExplicitDevelopment } from "./env_guard.mjs";

const LOCAL_D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const PASSWORD = "1234";
const ITERATIONS = 150_000;
const apply = process.argv.includes("--apply");

/**
 * FAIL-CLOSED ortam kilidi (ortak: tools/env_guard.mjs): production reddi
 * korunur; APP_ENV hiç tanımlı değilse de artık reddedilir — test hesapları
 * yalnızca AÇIKÇA development işaretli ortamda açılır.
 */
function assertNotProduction() {
  assertExplicitDevelopment("seed_demo_users");
}

function locateLocalDatabase() {
  let entries;
  try { entries = readdirSync(LOCAL_D1_DIR); }
  catch { return null; }
  const files = entries.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  return files.length ? path.join(LOCAL_D1_DIR, files[0]) : null;
}

/** Plan: kullanıcı adı → rol. Adlar bilinçli olarak basit tutulur (madde 11). */
const PLAN = [
  { username: "admin", roleCode: "00", fullName: "Admin" },
  ...[1, 2, 3].map((index) => ({ username: `projeyoneticisi${index}`, roleCode: "01", fullName: `Proje Yöneticisi ${index}` })),
  ...[1, 2, 3].map((index) => ({ username: `hakem${index}`, roleCode: "02", fullName: `Hakem ${index}` })),
  { username: "degerlendirmeyoneticisi1", roleCode: "04", fullName: "Değerlendirme Yöneticisi 1" },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => ({ username: `katilimci${index}`, roleCode: "03", fullName: `Katılımcı ${index}` })),
];

assertNotProduction();
const file = locateLocalDatabase();
if (!file) {
  console.error(`Yerel D1 veri tabanı bulunamadı (${LOCAL_D1_DIR}). Önce 'npm run dev' ile bir kez çalıştırın.`);
  process.exit(1);
}

const db = new DatabaseSync(file);
const one = (sql, ...binds) => db.prepare(sql).all(...binds)[0];

if (!one(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_accounts'`)) {
  console.error("admin_accounts tablosu yok; önce 'npm run dev' ile şemayı oluşturun.");
  process.exit(1);
}

const hasUsername = db.prepare(`PRAGMA table_info(admin_accounts)`).all().some((row) => row.name === "username");
if (!hasUsername) {
  console.error("admin_accounts.username sütunu yok; uygulamayı bir kez çalıştırıp şemayı güncelleyin.");
  process.exit(1);
}

console.log(apply ? "MOD: UYGULA — eksik test hesapları oluşturulacak" : "MOD: kuru çalıştırma — hiçbir hesap açılmayacak");
console.log(`Veri tabanı (yerel): ${file}\n`);

let created = 0;
let skipped = 0;
const activeAdmin = one(`SELECT COUNT(*) AS c FROM admin_accounts WHERE role_code = '00' AND status = 'active'`).c;

for (const entry of PLAN) {
  const existing = one(`SELECT id, role_code, status FROM admin_accounts WHERE username = ?`, entry.username);
  if (existing) {
    console.log(`  VAR    ${entry.username} · rol ${existing.role_code} · ${existing.status} (dokunulmadı)`);
    skipped += 1;
    continue;
  }
  // Sistemde zaten aktif bir Admin varsa ikinci bir 00 hesabı AÇILMAZ.
  if (entry.roleCode === "00" && activeAdmin > 0) {
    console.log("  ATLA   admin · sistemde zaten aktif bir Admin (00) var; ikinci Admin açılmaz.");
    skipped += 1;
    continue;
  }
  if (!apply) { console.log(`  AÇILACAK ${entry.username} · rol ${entry.roleCode}`); continue; }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(PASSWORD, salt, ITERATIONS, 32, "sha256");
  db.prepare(
    `INSERT INTO admin_accounts
      (id, full_name, email, username, role_code, password_hash, password_salt, password_iterations,
       must_change_password, status, created_at, created_by, revoked_at, revoked_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, 'demo seed', NULL, NULL)`,
  ).run(
    randomUUID(), entry.fullName, `${entry.username}@yerel.test`, entry.username, entry.roleCode,
    hash.toString("base64"), salt.toString("base64"), ITERATIONS, new Date().toISOString(),
  );
  console.log(`  AÇILDI ${entry.username} · rol ${entry.roleCode} · parola: ${PASSWORD} (yalnızca geliştirme)`);
  created += 1;
}

console.log(`\nSonuç: ${created} hesap açıldı, ${skipped} hesap zaten vardı.`);
if (!apply) console.log("Gerçekten oluşturmak için: node tools/seed_demo_users.mjs --apply");
db.close();
