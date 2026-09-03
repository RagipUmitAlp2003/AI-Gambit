/**
 * KİMLİK GÜVENLİĞİ TESTLERİ (GÖREV 3 · madde 10)
 *
 * Canlı sunucu veya Cloudflare bağlaması GEREKTİRMEZ: göç dosyaları bellek içi
 * node:sqlite üzerinde uygulanır ve app/lib/admin-db.ts içindeki dağıtık kaba
 * kuvvet sayacının SQL sözleşmesi satır düzeyinde doğrulanır:
 *
 *   - 0014_auth_hardening göçü boş veri tabanına uygulanabilir (dosya, 0010
 *     ön eki 0010_similarity_v3 ile çakıştığı için 0014'e taşındı; göçün
 *     schema_migrations kaydı tarihsel adı '0010_auth_hardening' ile kalır).
 *   - Tek upsert: pencere içinde artar, pencere dolunca 1'e sıfırlanır.
 *   - Sayaç okuma: pencere dolmuşsa 0 sayılır.
 *   - TTL temizliği eski satırları siler, taze satırları korur.
 *   - Rol fail-closed: '99' ve '03__' gibi değerler RoleCode DEĞİLDİR;
 *     uygulama dönüşümü (toAccountOrNull) bunları hiçbir role çevirmez.
 *   - 0011_participant_password_flag veri göçü yalnızca kendi kaydını açan
 *     (created_by = 'yarışmacı kaydı') 03 hesaplarının bayrağını temizler.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { isRoleCode } from "../app/lib/admin-roles.ts";

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

/** app/lib/admin-db.ts · recordLoginFailure ile BİREBİR aynı upsert. */
const UPSERT_SQL = `INSERT INTO admin_login_failures (key_hash, window_started_at, fail_count, last_failed_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key_hash) DO UPDATE SET
         fail_count = CASE WHEN admin_login_failures.window_started_at < ?
           THEN 1 ELSE admin_login_failures.fail_count + 1 END,
         window_started_at = CASE WHEN admin_login_failures.window_started_at < ?
           THEN excluded.window_started_at ELSE admin_login_failures.window_started_at END,
         last_failed_at = excluded.last_failed_at`;

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 8;

function recordFailure(database: DatabaseSync, keyHash: string, at: Date): void {
  const now = at.toISOString();
  const cutoff = new Date(at.getTime() - WINDOW_MS).toISOString();
  database.prepare(UPSERT_SQL).run(keyHash, now, now, cutoff, cutoff);
}

/** app/lib/admin-db.ts · countRecentLoginFailures ile aynı okuma anlamı. */
function countRecent(database: DatabaseSync, keyHash: string, at: Date): number {
  const row = database
    .prepare(`SELECT fail_count, window_started_at FROM admin_login_failures WHERE key_hash = ?`)
    .get(keyHash) as { fail_count: number; window_started_at: string } | undefined;
  if (!row) return 0;
  const cutoff = new Date(at.getTime() - WINDOW_MS).toISOString();
  return row.window_started_at < cutoff ? 0 : row.fail_count;
}

test("0014: admin_login_failures tablosu göçlerle kurulur", () => {
  const database = migratedDatabase();
  const table = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_login_failures'`)
    .get();
  assert.ok(table, "admin_login_failures tablosu göçlerden sonra bulunmalıdır.");
  // Dosya 0014_auth_hardening.sql'dir; schema_migrations kaydı dosya İÇERİĞİNDE
  // sabitlenen tarihsel '0010_auth_hardening' adını taşımaya devam eder
  // (uygulanmış ortamlarda göç izi değişmez, göç iki kez koşmaz).
  const applied = database
    .prepare(`SELECT name FROM schema_migrations WHERE name = '0010_auth_hardening'`)
    .get();
  assert.ok(applied, "Göç izi schema_migrations tablosuna yazılmalıdır.");
  database.close();
});

test("sayaç penceresi: aynı pencerede artar ve limite ulaşır", () => {
  const database = migratedDatabase();
  const key = "test-anahtar-ozeti";
  const start = new Date("2026-09-01T10:00:00.000Z");
  for (let attempt = 0; attempt < LIMIT; attempt += 1) {
    recordFailure(database, key, new Date(start.getTime() + attempt * 1000));
  }
  assert.equal(countRecent(database, key, new Date(start.getTime() + LIMIT * 1000)), LIMIT);
  // Limitteki anahtar giriş ucunda 429 alır (>= LIMIT karşılaştırması).
  assert.ok(countRecent(database, key, new Date(start.getTime() + LIMIT * 1000)) >= LIMIT);
  database.close();
});

test("sayaç penceresi: pencere dolunca 0 okunur ve upsert 1'e sıfırlar", () => {
  const database = migratedDatabase();
  const key = "pencere-sifirlama";
  const start = new Date("2026-09-01T10:00:00.000Z");
  for (let attempt = 0; attempt < 5; attempt += 1) recordFailure(database, key, start);

  // Pencereden SONRA okuma: eski sayaç 0 sayılır (throttle açılır).
  const afterWindow = new Date(start.getTime() + WINDOW_MS + 60_000);
  assert.equal(countRecent(database, key, afterWindow), 0);

  // Pencereden sonra yeni başarısızlık: sayaç 8'e birikmek yerine 1'den başlar.
  recordFailure(database, key, afterWindow);
  const row = database
    .prepare(`SELECT fail_count, window_started_at FROM admin_login_failures WHERE key_hash = ?`)
    .get(key) as { fail_count: number; window_started_at: string };
  assert.equal(row.fail_count, 1, "Pencere dolunca sayaç 1'e dönmelidir.");
  assert.equal(row.window_started_at, afterWindow.toISOString(), "Pencere başlangıcı yenilenmelidir.");
  database.close();
});

test("TTL temizliği: eski satırlar silinir, taze satırlar korunur", () => {
  const database = migratedDatabase();
  const now = new Date("2026-09-01T12:00:00.000Z");
  recordFailure(database, "eski-anahtar", new Date(now.getTime() - WINDOW_MS * 3));
  recordFailure(database, "taze-anahtar", now);

  // app/lib/admin-db.ts · recordLoginFailure sonundaki TTL DELETE ile aynı.
  const expiry = new Date(now.getTime() - WINDOW_MS * 2).toISOString();
  database.prepare(`DELETE FROM admin_login_failures WHERE last_failed_at < ?`).run(expiry);

  const remaining = database
    .prepare(`SELECT key_hash FROM admin_login_failures ORDER BY key_hash`)
    .all()
    .map((row) => (row as { key_hash: string }).key_hash);
  assert.deepEqual(remaining, ["taze-anahtar"], "Yalnızca süresi geçen satır silinmelidir.");
  database.close();
});

test("rol fail-closed: tanınmayan role_code hiçbir role çevrilmez", () => {
  // Uygulama dönüşümü (admin-db · toAccountOrNull) isRoleCode allowlist'ine
  // dayanır: '99' veya göç sentineli '03__' gibi değerler hesap üretmez,
  // giriş yapamaz ve oturum tutamaz.
  assert.equal(isRoleCode("99"), false);
  assert.equal(isRoleCode("03__"), false);
  assert.equal(isRoleCode("admin"), false);
  assert.equal(isRoleCode(""), false);
  assert.equal(isRoleCode(null), false);
  for (const valid of ["00", "01", "02", "03", "04"]) {
    assert.equal(isRoleCode(valid), true, `${valid} geçerli bir rol kodudur.`);
  }

  // Veri tabanı böyle satırları TUTABİLİR (göç yarıda kalması vb.) — koruma
  // şemada değil, uygulama dönüşümündedir; satır varlığı tek başına yetki vermez.
  const database = migratedDatabase();
  database
    .prepare(
      `INSERT INTO admin_accounts
        (id, full_name, email, username, role_code, password_hash, password_salt, password_iterations,
         must_change_password, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'h', 's', 1, 0, 'active', '2026-09-01')`,
    )
    .run("bozuk-1", "Bozuk Rol", "bozuk@yerel.test", "bozukrol", "99");
  const row = database
    .prepare(`SELECT role_code FROM admin_accounts WHERE id = ?`)
    .get("bozuk-1") as { role_code: string };
  assert.equal(isRoleCode(row.role_code), false, "Satır dursa bile rol kodu allowlist'ten geçmez.");
  database.close();
});

test("0011: yarışmacı parola bayrağı göçü yalnızca kendi kaydını açan 03 hesaplarını temizler", () => {
  // Göç dosyaları 0011 HARİÇ uygulanır, eski durumu temsil eden satırlar
  // eklenir, sonra 0011 tek başına uygulanır: yalnızca yarışmacı kaydıyla
  // açılmış 03 hesabının bayrağı temizlenmeli, yönetici eliyle geçici
  // parolayla açılan hesaplar zorunlu değişimde KALMALIDIR.
  const flagMigration = "0011_participant_password_flag.sql";
  assert.ok(MIGRATION_FILES.includes(flagMigration), "0011 göç dosyası mevcut olmalıdır.");
  const database = new DatabaseSync(":memory:");
  for (const name of MIGRATION_FILES.filter((file) => file !== flagMigration)) {
    database.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const insert = database.prepare(
    `INSERT INTO admin_accounts
      (id, full_name, email, username, role_code, password_hash, password_salt, password_iterations,
       must_change_password, status, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'h', 's', 1, 1, 'active', '2026-09-01', ?)`,
  );
  insert.run("katilimci-eski", "Eski Yarışmacı", "katilimci@yerel.test", "katilimcieski", "03", "yarışmacı kaydı");
  insert.run("personel-gecici", "Geçici Parolalı Personel", "personel@yerel.test", "personelgecici", "01", "Admin");
  insert.run("uc-farkli-kaynak", "Elle Açılmış 03", "elle03@yerel.test", "elle03", "03", "Admin");

  database.exec(readFileSync(`migrations/${flagMigration}`, "utf8"));

  const flags = Object.fromEntries(
    (database.prepare(`SELECT id, must_change_password FROM admin_accounts`).all() as Array<{
      id: string;
      must_change_password: number;
    }>).map((row) => [row.id, row.must_change_password]),
  );
  assert.equal(flags["katilimci-eski"], 0, "Kendi kaydını açan yarışmacının bayrağı temizlenmelidir.");
  assert.equal(flags["personel-gecici"], 1, "Geçici parolalı personel zorunlu değişimde kalmalıdır.");
  assert.equal(flags["uc-farkli-kaynak"], 1, "Yönetici eliyle açılmış 03 hesabına dokunulmamalıdır.");
  const applied = database
    .prepare(`SELECT name FROM schema_migrations WHERE name = '0011_participant_password_flag'`)
    .get();
  assert.ok(applied, "Göç izi schema_migrations tablosuna yazılmalıdır.");
  database.close();
});
