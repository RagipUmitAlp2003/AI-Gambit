/**
 * ÇELİKKUBBE SİMÜLASYON TEMİZLİĞİ — hedefli ve idempotent.
 *
 * YALNIZCA Çelikkubbe simülasyon koşusunun ürettiği kayıtları siler:
 * yarışma + profiller + kriter sürümleri + başvurular (AI analizleri, hakem
 * kararları, benzerlik/embedding izleri, süreç olayları, denetim satırları,
 * posta kayıtları dahil). R2 nesne anahtarları listelenir (SQL dosya silemez).
 *
 * DOKUNMAZ: hesaplar (admin + test hesapları), diğer yarışmalar (ör. İDA test
 * verisi), kalıcı ŞARTNAME ANALİZ ÖNBELLEĞİ (jeton tasarrufu için korunur),
 * kaynak kod, göç dosyaları.
 *
 * İDEMPOTENT: ikinci koşuda silinecek kayıt bulamaz ve hata üretmez.
 *
 *   node tools/cleanup_sim_celikkubbe.mjs           # kuru çalıştırma
 *   node tools/cleanup_sim_celikkubbe.mjs --apply   # gerçekten siler
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import path from "node:path";
import { assertExplicitDevelopment } from "./env_guard.mjs";

const LOCAL_D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const COMPETITION_NAME = "Çelikkubbe Hava Savunma Sistemleri Yarışması";
const apply = process.argv.includes("--apply");

// FAIL-CLOSED ortam kilidi (ortak: tools/env_guard.mjs): production reddi
// korunur; APP_ENV hiç tanımlı değilse de reddedilir.
assertExplicitDevelopment("cleanup_sim_celikkubbe");

let entries;
try { entries = readdirSync(LOCAL_D1_DIR); } catch { console.error("Yerel D1 yok."); process.exit(1); }
const file = entries.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")[0];
if (!file) { console.error("Yerel D1 dosyası yok."); process.exit(1); }

const db = new DatabaseSync(path.join(LOCAL_D1_DIR, file));
const all = (sql, ...binds) => db.prepare(sql).all(...binds);
const tableExists = (name) => Boolean(all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, name)[0]);

const keys = all(`SELECT competition_key FROM competitions WHERE competition_name = ?`, COMPETITION_NAME)
  .map((row) => row.competition_key);
const applicationIds = keys.length
  ? all(`SELECT id, file_key FROM competition_applications WHERE competition_key IN (${keys.map(() => "?").join(",")})`, ...keys)
  : [];
const profileIds = keys.length
  ? all(`SELECT id FROM competition_profiles WHERE competition_key IN (${keys.map(() => "?").join(",")})`, ...keys).map((row) => row.id)
  : [];

console.log(apply ? "MOD: UYGULA" : "MOD: kuru çalıştırma");
console.log(`Hedef: "${COMPETITION_NAME}" · anahtar ${keys.length} · başvuru ${applicationIds.length} · profil ${profileIds.length}`);
if (!keys.length && !applicationIds.length && !profileIds.length) {
  console.log("Silinecek simülasyon verisi yok (temizlik zaten uygulanmış). İdempotent çıkış.");
  db.close();
  process.exit(0);
}

// R2 nesneleri: başvuru PDF'leri, benzerlik parça dosyaları, şartname kopyası.
const r2Keys = [
  ...applicationIds.map((row) => row.file_key),
  ...(keys.length && tableExists("submission_versions")
    ? all(`SELECT v.file_key FROM submission_versions v
           INNER JOIN competition_applications a ON a.id = v.application_id
           WHERE a.competition_key IN (${keys.map(() => "?").join(",")})`, ...keys).map((row) => row.file_key)
    : []),
  ...(keys.length && tableExists("similarity_chunks")
    ? all(`SELECT DISTINCT 'similarity/' || application_id || '/' || submission_version_id || '.json' AS k
           FROM similarity_chunks WHERE competition_key IN (${keys.map(() => "?").join(",")})`, ...keys).map((row) => row.k)
    : []),
  ...profileIds.flatMap((id) => [`profiles/${id}/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf`]),
].filter(Boolean);
const uniqueR2 = [...new Set(r2Keys)];
if (uniqueR2.length) {
  console.log(`\nSahipsiz kalacak R2 nesneleri (${uniqueR2.length}) — betik dosya silmez; yerelde .wrangler/state/v3/r2 elle temizlenebilir:`);
  for (const key of uniqueR2.slice(0, 20)) console.log(`  ${key}`);
}

if (!apply) { console.log("\nDeğişiklik yapılmadı. Silmek için: --apply"); db.close(); process.exit(0); }

const appIdList = applicationIds.map((row) => row.id);
const inApps = appIdList.length ? `(${appIdList.map(() => "?").join(",")})` : "(NULL)";
const inKeys = `(${keys.map(() => "?").join(",")})`;
const inProfiles = profileIds.length ? `(${profileIds.map(() => "?").join(",")})` : "(NULL)";

db.exec("BEGIN TRANSACTION");
try {
  const run = (sql, binds) => { if (tableExists(sql.match(/FROM (\w+)/)[1])) db.prepare(sql).run(...binds); };
  if (appIdList.length) {
    for (const table of [
      "application_team_members", "application_submission_details", "submission_versions",
      "application_assignments", "submission_fingerprints", "similarity_chunks",
      "similarity_results", "evaluation_results",
    ]) run(`DELETE FROM ${table} WHERE application_id IN ${inApps}`, appIdList);
    run(`DELETE FROM workflow_events WHERE subject_id IN ${inApps}`, appIdList);
    run(`DELETE FROM admin_audit_log WHERE target_id IN ${inApps}`, appIdList);
    run(`DELETE FROM admin_mail_outbox WHERE account_id IN (
      SELECT participant_id FROM competition_applications WHERE id IN ${inApps}
    ) AND subject LIKE '%Çelikkubbe%'`, appIdList);
    run(`DELETE FROM competition_applications WHERE id IN ${inApps}`, appIdList);
  }
  run(`DELETE FROM criteria WHERE profile_id IN ${inProfiles}`, profileIds);
  run(`DELETE FROM criteria_profile_versions WHERE competition_key IN ${inKeys}`, keys);
  if (profileIds.length) {
    run(`DELETE FROM workflow_events WHERE subject_id IN ${inProfiles}`, profileIds);
    run(`DELETE FROM admin_audit_log WHERE target_id IN ${inProfiles}`, profileIds);
    run(`DELETE FROM criteria_extraction_runs WHERE profile_id IN ${inProfiles}`, profileIds);
  }
  run(`DELETE FROM criteria_extraction_runs WHERE competition_name = ?`, [COMPETITION_NAME]);
  run(`DELETE FROM competition_profiles WHERE competition_key IN ${inKeys}`, keys);
  const competitionIds = all(`SELECT id FROM competitions WHERE competition_key IN ${inKeys}`, ...keys).map((row) => row.id);
  if (competitionIds.length) {
    const inComps = `(${competitionIds.map(() => "?").join(",")})`;
    run(`DELETE FROM workflow_events WHERE subject_id IN ${inComps}`, competitionIds);
    run(`DELETE FROM admin_audit_log WHERE target_id IN ${inComps}`, competitionIds);
  }
  run(`DELETE FROM competitions WHERE competition_key IN ${inKeys}`, keys);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  console.error("Temizlik başarısız; hiçbir kayıt silinmedi.", error);
  db.close();
  process.exit(1);
}

console.log(`\nTemizlik tamamlandı: ${appIdList.length} başvuru, ${profileIds.length} profil, ${keys.length} yarışma anahtarı silindi.`);
console.log("KORUNDU: hesaplar, diğer yarışmalar (İDA vb.), şartname analiz önbelleği.");
db.close();
