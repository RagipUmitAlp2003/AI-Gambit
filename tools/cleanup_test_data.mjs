/**
 * Test/mock yarışma verisini temizler (yerel miniflare D1).
 *
 * Silme mantığının tek kaynağı `tools/cleanup-test-data.sql`'dir; bu betik onu
 * yerel veri tabanında çalıştırır, öncesinde/sonrasında sayar ve silinecek
 * başvuruların R2 nesne anahtarlarını listeler (SQL bunları silemez).
 *
 * Kullanım:
 *   node tools/cleanup_test_data.mjs           # kuru çalıştırma, hiçbir şey silinmez
 *   node tools/cleanup_test_data.mjs --apply   # gerçekten siler
 *
 * Uzak (üretim) D1 için:
 *   npx wrangler d1 execute <DB_ADI> --remote --file tools/cleanup-test-data.sql
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const apply = process.argv.includes("--apply");

function locateDatabase() {
  let entries;
  try { entries = readdirSync(D1_DIR); }
  catch { return null; }
  const files = entries.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  return files.length ? path.join(D1_DIR, files[0]) : null;
}

const file = locateDatabase();
if (!file) {
  console.error(`Yerel D1 veri tabanı bulunamadı (${D1_DIR}). Önce 'npm run dev' ile bir kez çalıştırın.`);
  process.exit(1);
}

const db = new DatabaseSync(file);
const all = (sql, ...binds) => db.prepare(sql).all(...binds);
const one = (sql, ...binds) => all(sql, ...binds)[0];

const TABLES = [
  "competitions", "competition_profiles", "criteria", "criteria_extraction_runs",
  "competition_applications", "application_submission_details", "application_team_members",
  "application_assignments", "submission_versions", "submission_fingerprints",
  "evaluation_results", "workflow_events",
];

function snapshot() {
  return Object.fromEntries(TABLES.map((table) => [table, one(`SELECT COUNT(*) AS c FROM ${table}`).c]));
}

const before = snapshot();

console.log(apply ? "MOD: uygula (kayıtlar silinecek)" : "MOD: kuru çalıştırma (hiçbir kayıt silinmeyecek)");
console.log(`Veri tabanı: ${file}\n`);

console.log("=== Silmeden önce yarışmalar ===");
for (const row of all(`SELECT competition_name, status, current_profile_id FROM competitions ORDER BY competition_name`)) {
  console.log(`  ${row.competition_name} · ${row.status} · profil ${row.current_profile_id ?? "YOK"}`);
}

// Silinecek başvuruların R2 anahtarları: SQL bunları silemez, elle temizlenmeli.
const orphanKeys = all(`
  SELECT a.file_key FROM competition_applications a
  WHERE a.competition_name IN ('Sahiplik Testi', '2026 Akıllı Ulaşım Sistemleri Yarışması', 'İnsansız Deniz Aracı Yarışması')
     OR a.competition_name LIKE 'Sahiplik Testi %'
  UNION
  SELECT v.file_key FROM submission_versions v
  JOIN competition_applications a ON a.id = v.application_id
  WHERE a.competition_name IN ('Sahiplik Testi', '2026 Akıllı Ulaşım Sistemleri Yarışması', 'İnsansız Deniz Aracı Yarışması')
     OR a.competition_name LIKE 'Sahiplik Testi %'
`).map((row) => row.file_key).filter(Boolean);

if (orphanKeys.length) {
  console.log(`\n=== Sahipsiz kalacak R2 nesneleri (${orphanKeys.length}) ===`);
  for (const key of orphanKeys) console.log(`  ${key}`);
  console.log("  (Yerel geliştirmede .wrangler/state/v3/r2 klasörü silinerek de temizlenebilir.)");
}

if (!apply) {
  console.log("\nDeğişiklik yapılmadı. Gerçekten silmek için: node tools/cleanup_test_data.mjs --apply");
  process.exit(0);
}

const sql = readFileSync("tools/cleanup-test-data.sql", "utf8");
db.exec(sql);

const after = snapshot();

console.log("\n=== Silinen kayıtlar ===");
for (const table of TABLES) {
  const removed = before[table] - after[table];
  if (removed) console.log(`  ${table.padEnd(32)} -${removed} (${before[table]} → ${after[table]})`);
}

console.log("\n=== Kalan yarışmalar ===");
const remaining = all(`SELECT competition_name, status, current_profile_id FROM competitions ORDER BY competition_name`);
for (const row of remaining) {
  console.log(`  ${row.competition_name} · ${row.status} · profil ${row.current_profile_id ?? "YOK"}`);
}

console.log("\n=== Kalan profiller ===");
for (const row of all(`SELECT competition_name, status, source_document_name FROM competition_profiles ORDER BY competition_name`)) {
  console.log(`  ${row.competition_name} · ${row.status} · ${row.source_document_name}`);
}

console.log(`\n=== Kalan başvurular: ${after.competition_applications} ===`);
for (const row of all(`SELECT competition_name, participant_name, status FROM competition_applications`)) {
  console.log(`  ${row.competition_name} · ${row.participant_name} · ${row.status}`);
}

db.close();
