/**
 * D1 GÖÇ TESTİ
 *
 * Bütün göç dosyaları sırayla, boş bir veri tabanı üzerinde çalıştırılır ve
 * yeni şemanın (0008) davranışı doğrulanır:
 *
 *   - Göçler eklemelidir: hiçbir tablo düşürülmez, hiçbir satır silinmez.
 *   - Kriter sürümü satırı (competition_key, criteria_version) çiftinde tektir.
 *   - "Son yayımlanan sürüm" sorgusu en yüksek sürümü döndürür.
 *   - Pasif / arşivlenmiş yarışma başvuruya açık listesine girmez.
 *   - Kullanıcı adı benzersizdir ama birden çok NULL kabul edilir.
 *   - Değerlendirme sonucu kriter sürümüne ve PDF özetine bağlanabilir.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const MIGRATION_FILES = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const name of MIGRATION_FILES) {
    database.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  return database;
}

test("bütün göçler sırayla temiz bir veri tabanına uygulanabilir", () => {
  const database = migratedDatabase();
  const tables = new Set(
    database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all().map((row) => (row as { name: string }).name),
  );
  for (const table of [
    "admin_accounts", "admin_sessions", "admin_audit_log", "workflow_events",
    "competitions", "competition_profiles", "competition_applications",
    "criteria", "criteria_profile_versions", "criteria_analysis_cache",
    "submission_versions", "evaluation_results", "application_assignments",
  ]) {
    assert.ok(tables.has(table), `${table} tablosu göçlerden sonra bulunmalıdır.`);
  }
  database.close();
});

test("göç dosyaları veri silmez", () => {
  // Göçler EKLEMELİDİR. Rol takası (UPDATE) dışında hiçbir dosya satır
  // silmemeli veya tablo düşürmemelidir.
  for (const name of MIGRATION_FILES) {
    const sql = readFileSync(`migrations/${name}`, "utf8");
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.ok(!/\bDROP\s+TABLE\b/i.test(statements), `${name} tablo düşürmemelidir.`);
    assert.ok(!/\bDELETE\s+FROM\b/i.test(statements), `${name} satır silmemelidir.`);
  }
});

test("kriter sürümü aynı yarışmada tekrarlanamaz ve en yüksek sürüm okunur", () => {
  const database = migratedDatabase();
  const insert = database.prepare(
    `INSERT INTO criteria_profile_versions
      (id, criteria_profile_id, competition_key, criteria_version, criteria_hash,
       criteria_json, criteria_count, published_at, published_by, published_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run("v1", "profile-1", "roket", 1, "hash-1", "[]", 4, "2026-08-01", "manager-1", "Yönetici");
  insert.run("v2", "profile-1", "roket", 2, "hash-2", "[]", 6, "2026-08-02", "manager-1", "Yönetici");

  // Aynı (yarışma, sürüm) çifti ikinci kez yazılamaz: sürüm değişmezdir.
  assert.throws(
    () => insert.run("v3", "profile-1", "roket", 2, "hash-3", "[]", 6, "2026-08-03", "manager-1", "Yönetici"),
    /UNIQUE|constraint/i,
  );

  const latest = database.prepare(
    `SELECT criteria_version, criteria_hash FROM criteria_profile_versions
     WHERE competition_key = ? ORDER BY criteria_version DESC LIMIT 1`,
  ).get("roket") as { criteria_version: number; criteria_hash: string };
  assert.deepEqual({ ...latest }, { criteria_version: 2, criteria_hash: "hash-2" });

  // Eski sürüm yerinde durur: geçmiş değerlendirme denetlenebilir kalır.
  const total = database.prepare(
    `SELECT COUNT(*) AS c FROM criteria_profile_versions WHERE competition_key = ?`,
  ).get("roket") as { c: number };
  assert.equal(total.c, 2);
  database.close();
});

test("pasif ve arşivlenmiş yarışma başvuruya açık listesine girmez", () => {
  const database = migratedDatabase();
  const insert = database.prepare(
    `INSERT INTO competitions
      (id, competition_key, competition_name, status, current_profile_id, decisions_locked,
       results_published_at, created_at, updated_at)
     VALUES (?, ?, ?, 'open', ?, 0, NULL, ?, ?)`,
  );
  insert.run("c1", "aktif", "Aktif Yarışma", "p1", "2026-08-01", "2026-08-01");
  insert.run("c2", "pasif", "Pasif Yarışma", "p2", "2026-08-01", "2026-08-01");
  insert.run("c3", "arsiv", "Arşiv Yarışma", "p3", "2026-08-01", "2026-08-01");

  // Varsayılan AKTİF: eski satırlar davranış değiştirmez.
  const defaults = database.prepare(`SELECT is_active FROM competitions WHERE id = ?`).get("c1") as { is_active: number };
  assert.equal(defaults.is_active, 1, "Yeni sütunun varsayılanı aktif olmalıdır.");

  database.prepare(`UPDATE competitions SET is_active = 0 WHERE id = ?`).run("c2");
  database.prepare(`UPDATE competitions SET deleted_at = ?, deleted_by_name = ?, deleted_reason = ? WHERE id = ?`)
    .run("2026-08-05", "Yarışma Yöneticisi", "Eski sezon", "c3");

  const open = database.prepare(
    `SELECT competition_key FROM competitions
     WHERE status = 'open' AND current_profile_id IS NOT NULL
       AND is_active = 1 AND deleted_at IS NULL
     ORDER BY competition_key`,
  ).all().map((row) => (row as { competition_key: string }).competition_key);
  assert.deepEqual(open, ["aktif"]);

  // Arşivleme SOFT DELETE'tir: satır ve gerekçe yerinde kalır.
  const archived = database.prepare(`SELECT deleted_by_name, deleted_reason FROM competitions WHERE id = ?`)
    .get("c3") as { deleted_by_name: string; deleted_reason: string };
  assert.deepEqual({ ...archived }, { deleted_by_name: "Yarışma Yöneticisi", deleted_reason: "Eski sezon" });
  database.close();
});

test("kullanıcı adı benzersizdir ama boş bırakılabilir", () => {
  const database = migratedDatabase();
  const insert = database.prepare(
    `INSERT INTO admin_accounts
      (id, full_name, email, username, role_code, password_hash, password_salt, password_iterations,
       must_change_password, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'h', 's', 1, 1, 'active', '2026-08-01')`,
  );
  insert.run("a1", "Kurulum Admini", "admin@yerel.test", "admin", "00");
  // Aynı kullanıcı adı ikinci kez kullanılamaz.
  assert.throws(
    () => insert.run("a2", "Başka", "baska@yerel.test", "admin", "01"),
    /UNIQUE|constraint/i,
  );
  // Kullanıcı adı isteğe bağlıdır: birden çok NULL kabul edilir.
  insert.run("a3", "Hakem Bir", "hakem1@yerel.test", null, "02");
  insert.run("a4", "Hakem İki", "hakem2@yerel.test", null, "02");
  const total = database.prepare(`SELECT COUNT(*) AS c FROM admin_accounts`).get() as { c: number };
  assert.equal(total.c, 3);
  database.close();
});

test("değerlendirme sonucu kriter sürümüne ve PDF özetine bağlanır", () => {
  const database = migratedDatabase();
  database.prepare(
    `INSERT INTO evaluation_results
      (id, application_id, submission_version_id, profile_id, status, ai_raw_analysis, model,
       criteria_version, criteria_hash, pdf_hash, created_at, completed_at)
     VALUES (?, ?, ?, ?, 'completed', '{}', 'test-model', ?, ?, ?, ?, ?)`,
  ).run("e1", "app-1", "ver-1", "profile-1", 2, "criteria-hash", "pdf-hash", "2026-08-06", "2026-08-06");

  const row = database.prepare(
    `SELECT criteria_version, criteria_hash, pdf_hash FROM evaluation_results WHERE id = ?`,
  ).get("e1") as Record<string, unknown>;
  assert.deepEqual({ ...row }, { criteria_version: 2, criteria_hash: "criteria-hash", pdf_hash: "pdf-hash" });

  // Başvuru satırı da aynı bağı taşır: eskimiş analiz tespit edilebilir.
  database.prepare(
    `INSERT INTO competition_applications
      (id, participant_id, participant_name, participant_email, competition_key, competition_name,
       profile_id, file_key, file_name, mime_type, size_bytes, status,
       evaluation_criteria_version, evaluation_pdf_hash, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'application/pdf', 100, 'awaiting_judge', ?, ?, ?, ?)`,
  ).run("app-1", "p1", "Ada", "ada@test", "roket", "Roket", "r2/app-1.pdf", "rapor.pdf", 1, "pdf-hash", "2026-08-06", "2026-08-06");

  const application = database.prepare(
    `SELECT evaluation_criteria_version FROM competition_applications WHERE id = ?`,
  ).get("app-1") as { evaluation_criteria_version: number };
  assert.equal(application.evaluation_criteria_version, 1, "Analiz v1 ile üretilmiş sayılmalıdır.");
  database.close();
});

test("kriter satırı PDF'den denetlenebilirlik alanını taşır", () => {
  const database = migratedDatabase();
  database.prepare(
    `INSERT INTO criteria
      (id, profile_id, position, name, applicability, effect, max_score, active,
       source_page, source_text, criterion_json, created_at)
     VALUES (?, ?, 0, ?, 'criteria_evidence', 'required', NULL, 1, 4, 'alıntı', '{}', '2026-08-06')`,
  ).run("c-1", "profile-1", "Tanıtım videosu");
  const row = database.prepare(`SELECT verifiability FROM criteria WHERE id = ?`).get("c-1") as { verifiability: string };
  // Varsayılan, eski satırların davranışını korur.
  assert.equal(row.verifiability, "PDF_DENETLENEBILIR");

  database.prepare(`UPDATE criteria SET verifiability = ? WHERE id = ?`).run("HARICI_KANIT_GEREKLI", "c-1");
  const updated = database.prepare(`SELECT verifiability FROM criteria WHERE id = ?`).get("c-1") as { verifiability: string };
  assert.equal(updated.verifiability, "HARICI_KANIT_GEREKLI");
  database.close();
});
