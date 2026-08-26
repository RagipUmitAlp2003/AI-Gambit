/**
 * GELİŞTİRME SIFIRLAMASI — tek seferlik, hedefi açık, idempotent.
 *
 * NE YAPAR
 *   Yerel (miniflare) D1 veri tabanındaki DEMO/TEST verisini siler: yarışmalar,
 *   kriter profilleri ve sürümleri, başvurular, değerlendirmeler, süreç
 *   olayları ve demo kullanıcı hesapları.
 *
 * NEYE DOKUNMAZ
 *   - `corpus/` içindeki şartname PDF'leri
 *   - Kaynak kod ve `migrations/` dosyaları
 *   - Şema (tablolar korunur, yalnızca satırlar silinir)
 *   - Bootstrap Admin hesabı (rol 00, aktif) ve oturumu
 *   - R2 nesneleri (dosya silinmez; anahtarlar yalnızca RAPORLANIR)
 *   - Kalıcı analiz önbelleği (jeton tasarrufu için korunur; --purge-cache ile silinir)
 *
 * GÜVENLİK
 *   1. Yalnızca `.wrangler/state/v3/d1/...` altındaki YEREL dosyayı açar.
 *      Uzak (üretim) D1 için bir yol, bayrak veya seçenek YOKTUR.
 *   2. `APP_ENV=production` ise çalışmayı reddeder.
 *   3. Öntanımlı mod KURU ÇALIŞTIRMADIR; silmek için `--apply` şarttır.
 *   4. İşlem tek transaction içindedir: yarıda kalırsa hiçbir şey silinmez.
 *
 * KULLANIM
 *   node tools/dev_reset.mjs                 # kuru çalıştırma (hiçbir şey silinmez)
 *   node tools/dev_reset.mjs --apply         # gerçekten siler
 *   node tools/dev_reset.mjs --apply --purge-cache   # analiz önbelleğini de siler
 *
 * İDEMPOTENT: ikinci kez çalıştırıldığında silinecek kayıt bulamaz ve
 * hiçbir hata üretmez.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const LOCAL_D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const LOCAL_R2_DIR = ".wrangler/state/v3/r2";

const apply = process.argv.includes("--apply");
const purgeCache = process.argv.includes("--purge-cache");

/** Üretim ortamında çalışmayı reddeder. */
function assertNotProduction() {
  const fromEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
  if (fromEnv === "production") {
    console.error("REDDEDİLDİ: APP_ENV/NODE_ENV 'production'. Bu betik yalnızca geliştirme ortamında çalışır.");
    process.exit(1);
  }
  if (existsSync(".env.local")) {
    const local = readFileSync(".env.local", "utf8");
    if (/^\s*APP_ENV\s*=\s*production\s*$/m.test(local)) {
      console.error("REDDEDİLDİ: .env.local içinde APP_ENV=production yazıyor.");
      process.exit(1);
    }
  }
}

/** Yalnızca yerel miniflare veri tabanını bulur; uzak bağlantı desteklenmez. */
function locateLocalDatabase() {
  let entries;
  try { entries = readdirSync(LOCAL_D1_DIR); }
  catch { return null; }
  const files = entries.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  return files.length ? path.join(LOCAL_D1_DIR, files[0]) : null;
}

assertNotProduction();

const file = locateLocalDatabase();
if (!file) {
  console.error(
    `Yerel D1 veri tabanı bulunamadı (${LOCAL_D1_DIR}).\n`
    + "Önce 'npm run dev' ile uygulamayı bir kez çalıştırın; şema o zaman oluşur.",
  );
  process.exit(1);
}

const db = new DatabaseSync(file);
const all = (sql, ...binds) => db.prepare(sql).all(...binds);
const one = (sql, ...binds) => all(sql, ...binds)[0];

function tableExists(name) {
  return Boolean(one(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, name));
}

/**
 * Sütun var mı? Yerel veri tabanı göçten önce oluşturulmuş olabilir; betik
 * eksik sütun yüzünden düşmemeli, sıfırlama her şema sürümünde çalışmalıdır.
 */
function hasColumn(table, column) {
  return tableExists(table) && all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

const HAS_USERNAME = hasColumn("admin_accounts", "username");
const usernameField = HAS_USERNAME ? "username" : "NULL AS username";

/**
 * KORUNACAK HESAP ÖLÇÜTÜ
 *
 * Yalnızca GERÇEK bir aktif Admin (00) korunur:
 *   - bootstrap Admini (`username = 'admin'`), ve
 *   - demo olmayan (`@yerel.test` uzantılı olmayan) aktif Admin hesapları.
 *
 * Eski şifresiz rol kısayolunun ürettiği `demo.*@yerel.test` hesapları demo
 * verisidir ve silinir. Sıfırlamadan sonra Admin kalmazsa giriş ekranındaki
 * “Kurulum Admini oluştur” düğmesiyle admin/1234 açılır.
 */
const KEEP_ACCOUNT_SQL = HAS_USERNAME
  ? `role_code = '00' AND status = 'active' AND (username = 'admin' OR email NOT LIKE '%@yerel.test')`
  : `role_code = '00' AND status = 'active' AND email NOT LIKE '%@yerel.test'`;

/** Şema sürümüne göre var olan tablolar; eksik tablo hata değildir. */
const WORKFLOW_TABLES = [
  "submission_fingerprints",
  "evaluation_results",
  "application_assignments",
  "application_team_members",
  "application_submission_details",
  "submission_versions",
  "competition_applications",
  "criteria",
  "criteria_profile_versions",
  "criteria_extraction_runs",
  "competition_profiles",
  "competitions",
  "workflow_events",
].filter(tableExists);

const ACCOUNT_TABLES = ["admin_sessions", "admin_mail_outbox", "admin_accounts"].filter(tableExists);

function counts(tables) {
  return Object.fromEntries(tables.map((table) => [table, one(`SELECT COUNT(*) AS c FROM ${table}`).c]));
}

const before = counts([...WORKFLOW_TABLES, ...ACCOUNT_TABLES]);

console.log(apply ? "MOD: UYGULA — kayıtlar silinecek" : "MOD: kuru çalıştırma — hiçbir kayıt silinmeyecek");
console.log(`Veri tabanı (yerel): ${file}\n`);

// --------------------------------------------------------------------------
// KORUNACAK HESAPLAR: aktif Admin (00). Bootstrap Admini de buna dahildir.
// --------------------------------------------------------------------------
const keptAccounts = tableExists("admin_accounts")
  ? all(`SELECT id, full_name, email, ${usernameField}, role_code FROM admin_accounts WHERE ${KEEP_ACCOUNT_SQL}`)
  : [];
const removedAccounts = tableExists("admin_accounts")
  ? all(`SELECT id, full_name, email, role_code, status FROM admin_accounts WHERE NOT (${KEEP_ACCOUNT_SQL})`)
  : [];

console.log("=== KORUNACAK hesaplar (bootstrap Admini ve demo olmayan aktif Admin) ===");
if (keptAccounts.length) {
  for (const row of keptAccounts) console.log(`  ${row.username ?? row.email} · ${row.full_name} · rol ${row.role_code}`);
} else {
  console.log("  (yok) — sıfırlamadan sonra giriş ekranındaki “Kurulum Admini oluştur” ile admin/1234 açabilirsiniz.");
}

console.log(`\n=== SİLİNECEK hesaplar (${removedAccounts.length}) ===`);
for (const row of removedAccounts.slice(0, 40)) console.log(`  ${row.email} · rol ${row.role_code} · ${row.status}`);
if (removedAccounts.length > 40) console.log(`  … ve ${removedAccounts.length - 40} hesap daha`);

// --------------------------------------------------------------------------
// R2: SQL nesne silemez. Sahipsiz kalacak anahtarlar yalnızca RAPORLANIR.
// --------------------------------------------------------------------------
const orphanKeys = [];
if (tableExists("competition_applications")) {
  orphanKeys.push(...all(`SELECT file_key FROM competition_applications`).map((row) => row.file_key));
}
if (tableExists("submission_versions")) {
  orphanKeys.push(...all(`SELECT file_key FROM submission_versions`).map((row) => row.file_key));
}
const uniqueOrphans = [...new Set(orphanKeys.filter(Boolean))];
if (uniqueOrphans.length) {
  console.log(`\n=== Sahipsiz kalacak R2 nesneleri (${uniqueOrphans.length}) ===`);
  for (const key of uniqueOrphans.slice(0, 30)) console.log(`  ${key}`);
  if (uniqueOrphans.length > 30) console.log(`  … ve ${uniqueOrphans.length - 30} nesne daha`);
  console.log(
    `  Bu betik DOSYA SİLMEZ. Yerel geliştirmede tamamını temizlemek isterseniz\n`
    + `  '${LOCAL_R2_DIR}' klasörünü elle silin (şartname PDF kopyaları da orada durur).`,
  );
}

if (!apply) {
  console.log("\nDeğişiklik yapılmadı. Gerçekten sıfırlamak için: node tools/dev_reset.mjs --apply");
  db.close();
  process.exit(0);
}

// --------------------------------------------------------------------------
// SİLME — tek transaction, yapraktan köke doğru.
// Yarıda kalırsa ROLLBACK ile hiçbir şey silinmez.
// --------------------------------------------------------------------------
db.exec("BEGIN TRANSACTION");
try {
  for (const table of WORKFLOW_TABLES) db.exec(`DELETE FROM ${table}`);
  if (purgeCache && tableExists("criteria_analysis_cache")) db.exec("DELETE FROM criteria_analysis_cache");

  if (tableExists("admin_accounts")) {
    // Aktif Admin dışındaki bütün hesaplar ve onlara bağlı oturum/posta kayıtları.
    if (tableExists("admin_sessions")) {
      db.exec(`DELETE FROM admin_sessions WHERE account_id NOT IN
        (SELECT id FROM admin_accounts WHERE ${KEEP_ACCOUNT_SQL})`);
    }
    if (tableExists("admin_mail_outbox")) {
      db.exec(`DELETE FROM admin_mail_outbox WHERE account_id IS NOT NULL AND account_id NOT IN
        (SELECT id FROM admin_accounts WHERE ${KEEP_ACCOUNT_SQL})`);
    }
    db.exec(`DELETE FROM admin_accounts WHERE NOT (${KEEP_ACCOUNT_SQL})`);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  console.error("\nSıfırlama başarısız; hiçbir kayıt silinmedi.");
  console.error(error);
  db.close();
  process.exit(1);
}

const after = counts([...WORKFLOW_TABLES, ...ACCOUNT_TABLES]);

console.log("\n=== Silinen kayıtlar ===");
let removedTotal = 0;
for (const table of [...WORKFLOW_TABLES, ...ACCOUNT_TABLES]) {
  const removed = before[table] - after[table];
  removedTotal += removed;
  if (removed) console.log(`  ${table.padEnd(32)} -${removed} (${before[table]} → ${after[table]})`);
}
if (!removedTotal) console.log("  (silinecek kayıt yoktu — sıfırlama zaten uygulanmış)");

console.log("\n=== Kalan hesaplar ===");
for (const row of all(`SELECT full_name, email, ${usernameField}, role_code, status FROM admin_accounts`)) {
  console.log(`  ${row.username ?? row.email} · ${row.full_name} · rol ${row.role_code} · ${row.status}`);
}

console.log(
  "\nSıfırlama tamamlandı. Sonraki adımlar:\n"
  + "  1. Admin hesabı yoksa giriş ekranındaki “Kurulum Admini oluştur” düğmesiyle admin/1234 açın.\n"
  + "  2. Admin panelinden 01/02/04 hesaplarını oluşturun.\n"
  + "  3. Yarışmacılar giriş ekranındaki “Yarışmacı kaydı” sekmesinden kendi hesaplarını açar.",
);

db.close();
