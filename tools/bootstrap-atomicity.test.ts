/**
 * BOOTSTRAP ATOMİKLİĞİ REGRESYON TESTLERİ (madde 9.1 · regresyon #19)
 *
 * Bildirilen senaryo: "İlk Admin hesabı D1'e yazılıyor, sonraki bir adım
 * fırlatıyor, uç 5xx dönüyor ve tek kullanımlık parola hiç dönmüyor; geriye
 * parolası bilinmeyen AKTİF bir Admin kalıyor."
 *
 * Senaryo birleştirilmiş kod (entegrasyon/umit-umut-2026-09-03) üzerinde
 * YENİDEN DOĞRULANDI ve ÜRETİLEMEDİ. Koruyan üç sözleşme:
 *
 *   1. app/lib/admin-db.ts · recordAudit: getDatabase çağrısı DAHİL bütün
 *      gövde try/catch içindedir; catch bloğu yalnızca loglar, yeniden
 *      fırlatmaz. Denetim izi yazılamasa bile çağıran devam eder.
 *   2. app/api/admin/bootstrap/route.ts · hem createDevAdmin hem üretim POST:
 *      insertAccount(...) kapanışı ile `oneTimePassword` yanıtı arasında
 *      recordAudit dışında hiçbir await/throw yoktur. hashPassword,
 *      insertAccount çağrısının ARGÜMANI olduğu için hesap yazılmadan ÖNCE
 *      çalışır. json() eşzamanlı JSON.stringify + new Response'tur.
 *   3. app/api/admin/accounts/route.ts: hesap yazıldıktan sonra deliverMail
 *      ve recordMail ayrı try/catch bloklarındadır, assignPendingApplications
 *      .catch ile bağlıdır, recordAudit (1) gereği fırlatmaz; parola her
 *      zaman 201 ile döner.
 *
 * admin-db "cloudflare:workers" içe aktardığı için Node testinde doğrudan
 * yüklenemez. Bu yüzden kaynak sözleşmesi (readFileSync + sıra/regex)
 * kullanılır; recordAudit için ayrıca GERÇEK kaynak metni tiplerinden
 * arındırılıp fırlatan sahte veri tabanıyla çalıştırılır (saf davranış testi).
 *
 * Çalıştırma:
 *   node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs --test tools/bootstrap-atomicity.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

/** Satır sonları (CRLF/LF) normalize edilerek okunur; sıra denetimleri LF varsayar. */
function source(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const BOOTSTRAP_ROUTE = source("app/api/admin/bootstrap/route.ts");
const ACCOUNTS_ROUTE = source("app/api/admin/accounts/route.ts");
const ADMIN_DB = source("app/lib/admin-db.ts");
const ADMIN_GUARD = source("app/lib/admin-guard.ts");

/** Üst düzey (sütun 0) bir fonksiyon bildiriminin tam metnini döndürür. */
function topLevelFunction(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `${header} bulunamadı.`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${header} kapanışı bulunamadı.`);
  return source.slice(start, end + 3);
}

/**
 * insertAccount(...) çağrısının KAPANIŞINDAN parola yanıtına kadar olan
 * dilimi döndürür. Kapanış, `await insertAccount({` sonrasındaki ilk `});`
 * satırıdır; hashPassword gibi argüman içi await'ler dilimin DIŞINDA kalır
 * (hesap yazılmadan önce çalışırlar).
 */
function afterInsertUntil(source: string, responseMarker: string): string {
  const insertAt = source.indexOf("await insertAccount({");
  assert.notEqual(insertAt, -1, "insertAccount çağrısı bulunamadı.");
  const close = source.indexOf("});", insertAt);
  assert.notEqual(close, -1, "insertAccount kapanışı bulunamadı.");
  const responseAt = source.indexOf(responseMarker, close);
  assert.notEqual(responseAt, -1, `${responseMarker} yanıtı insertAccount'tan sonra bulunamadı.`);
  return source.slice(close + 3, responseAt);
}

/** Dilimdeki `await ad(` çağrılarının adları. */
function awaitedCalls(segment: string): string[] {
  return [...segment.matchAll(/await\s+([A-Za-z_$][\w$.]*)\s*\(/g)].map((match) => match[1]);
}

/*
 * 1. recordAudit: bütün gövde try/catch içinde, catch yeniden fırlatmaz.
 */
test("recordAudit gövdesi bütünüyle try/catch içindedir ve catch yeniden fırlatmaz", () => {
  const fn = topLevelFunction(ADMIN_DB, "export async function recordAudit(");
  const bodyStart = fn.indexOf("{\n", fn.indexOf("): Promise<void>")) + 2;
  const body = fn.slice(bodyStart, fn.lastIndexOf("}"));

  // Gövdenin ilk anlamlı ifadesi `try {` olmalı; getDatabase de try içinde.
  assert.match(body.trimStart(), /^try \{/, "recordAudit gövdesi try ile başlamalıdır.");
  const tryAt = body.indexOf("try {");
  const dbAt = body.indexOf("await getDatabase()");
  assert.ok(dbAt > tryAt, "getDatabase çağrısı try bloğunun İÇİNDE olmalıdır (D1 bağlaması yokken bile fırlatmamalı).");
  assert.ok(body.indexOf("admin_audit_log") > tryAt, "Denetim INSERT'i try bloğunun içinde olmalıdır.");

  const catchAt = body.indexOf("} catch (error) {");
  assert.notEqual(catchAt, -1, "recordAudit catch bloğu olmalıdır.");
  const catchBody = body.slice(catchAt);
  assert.doesNotMatch(catchBody, /\bthrow\b/, "recordAudit catch bloğu yeniden fırlatmamalıdır.");
  assert.match(catchBody, /console\.error\("\[audit\]/, "Denetim hatası sunucu loguna yazılmalıdır.");
  // catch'ten sonra başka ifade yok: gövde catch bloğuyla biter.
  assert.match(catchBody.trimEnd(), /\}\s*$/);
});

/*
 * 1b. SAF DAVRANIŞ: gerçek recordAudit kaynağı, fırlatan bir getDatabase ile
 * çalıştırılır; söz (promise) REDDEDİLMEZ. Hem bağlama yokluğu (getDatabase
 * fırlatır) hem INSERT hatası (run() reddeder) denenir.
 */
test("recordAudit kaynağı fırlatan veri tabanıyla çalıştırılınca sessizce tamamlanır", async () => {
  const fn = topLevelFunction(ADMIN_DB, "export async function recordAudit(");
  const plain = stripTypeScriptTypes(fn.replace(/^export /, ""), { mode: "strip" });
  const logged: unknown[][] = [];
  const fakeConsole = { error: (...args: unknown[]) => { logged.push(args); } };
  const factory = new Function(
    "getDatabase", "nowIso", "crypto", "console",
    `${plain}\nreturn recordAudit;`,
  );
  const input = {
    actorId: null, actorEmail: null, actorRole: null,
    action: "bootstrap_moderator_created", targetType: "account", targetId: "x", detail: "test",
  };

  // (a) D1 bağlaması yok: getDatabase fırlatır.
  const withoutDb = factory(
    async () => { throw new Error("D1 bağlaması bulunamadı"); },
    () => new Date().toISOString(), globalThis.crypto, fakeConsole,
  ) as (i: typeof input) => Promise<void>;
  await assert.doesNotReject(() => withoutDb(input), "getDatabase hatası recordAudit'ten sızmamalıdır.");

  // (b) INSERT reddedilir (ör. tablo yok / D1 geçici hata).
  const rejectingDb = {
    prepare: () => ({ bind: () => ({ run: async () => { throw new Error("no such table: admin_audit_log"); } }) }),
  };
  const withFailingInsert = factory(
    async () => rejectingDb, () => new Date().toISOString(), globalThis.crypto, fakeConsole,
  ) as (i: typeof input) => Promise<void>;
  await assert.doesNotReject(() => withFailingInsert(input), "INSERT hatası recordAudit'ten sızmamalıdır.");

  assert.equal(logged.length, 2, "Her iki hata da sunucu loguna yazılmalıdır.");
  assert.ok(logged.every((args) => args[0] === "[audit] kayıt yazılamadı"));
});

/*
 * 2. Bootstrap ucu: hesap yazıldıktan sonra parola yanıtına kadar yalnızca
 *    recordAudit beklenir; throw yoktur.
 */
test("createDevAdmin: insertAccount ile parola yanıtı arasında recordAudit dışında await/throw yoktur", () => {
  const fn = topLevelFunction(BOOTSTRAP_ROUTE, "async function createDevAdmin(");
  const segment = afterInsertUntil(fn, "oneTimePassword: DEV_ADMIN.password");
  assert.deepEqual(awaitedCalls(segment), ["recordAudit"]);
  assert.doesNotMatch(segment, /\bthrow\b/, "Hesap yazıldıktan sonra fırlatan adım olmamalıdır.");
  assert.doesNotMatch(segment, /\bnew URL\(|JSON\.parse\(|hashPassword\(/, "Hesap yazıldıktan sonra fırlatabilecek yardımcı çağrılmamalıdır.");
  // Şifre üretimi ve hash'leme hesap yazılmadan ÖNCE (argüman içinde) yapılır.
  const insertAt = fn.indexOf("await insertAccount({");
  const hashAt = fn.indexOf("await hashPassword(DEV_ADMIN.password)");
  assert.ok(hashAt > insertAt && hashAt < fn.indexOf("});", insertAt), "hashPassword insertAccount argümanı olmalıdır.");
  // Yanıt 201 ve created: true ile döner.
  assert.match(segment + fn.slice(fn.indexOf("oneTimePassword: DEV_ADMIN.password")), /created: true,[\s\S]*\}, 201\)/);
});

test("üretim POST: insertAccount ile { account, oneTimePassword } yanıtı arasında recordAudit dışında await/throw yoktur", () => {
  const fn = topLevelFunction(BOOTSTRAP_ROUTE, "export async function POST(");
  const segment = afterInsertUntil(fn, "return json({ account, oneTimePassword }, 201)");
  assert.deepEqual(awaitedCalls(segment), ["recordAudit"]);
  assert.doesNotMatch(segment, /\bthrow\b/, "Hesap yazıldıktan sonra fırlatan adım olmamalıdır.");
  assert.doesNotMatch(segment, /\bnew URL\(|JSON\.parse\(|hashPassword\(|requiredText\(|assertEmail\(/);
  // Doğrulama, parola üretimi ve hash'leme hesap yazılmadan ÖNCE tamamlanır.
  const insertAt = fn.indexOf("await insertAccount({");
  for (const before of ["requiredText(body, \"fullName\"", "assertEmail(", "generatePassword()", "await hashPassword(oneTimePassword)"]) {
    const at = fn.indexOf(before);
    assert.ok(at !== -1 && at < fn.indexOf("});", insertAt), `${before} hesap yazılmadan önce çalışmalıdır.`);
  }
  // Tek insertAccount çağrısı vardır (iki farklı hesap yazma yolu yok).
  assert.equal(fn.split("await insertAccount(").length - 1, 1);
});

test("json() yardımcısı eşzamanlıdır: await/throw içermez, JSON.stringify + new Response'tur", () => {
  const fn = topLevelFunction(ADMIN_GUARD, "export function json(");
  assert.match(fn, /JSON\.stringify\(data\)/);
  assert.match(fn, /new Response\(/);
  assert.doesNotMatch(fn, /\bawait\b|\bthrow\b/);
});

/*
 * 3. Hesap oluşturma ucu: defter işlemleri try/catch veya .catch ile bağlı.
 */
test("accounts POST: hesap yazıldıktan sonra mail/outbox try/catch blokları korunur ve parola 201 ile döner", () => {
  const fn = topLevelFunction(ACCOUNTS_ROUTE, "export async function POST(");
  const segment = afterInsertUntil(fn, "return json(result, 201)");
  const calls = awaitedCalls(segment);
  const allowed = new Set(["assignPendingApplications", "deliverMail", "recordMail", "recordAudit"]);
  for (const name of calls) assert.ok(allowed.has(name), `Beklenmeyen await: ${name}`);
  assert.doesNotMatch(segment, /\bthrow\b/, "Hesap yazıldıktan sonra fırlatan adım olmamalıdır.");

  // Mevcut regresyon sözleşmeleri (tools/regression-tests.mjs) burada da sabitlenir.
  assert.match(ACCOUNTS_ROUTE, /outcome = await deliverMail/);
  assert.match(ACCOUNTS_ROUTE, /catch \(mailError\)/);
  assert.match(ACCOUNTS_ROUTE, /mail = await recordMail/);
  assert.match(ACCOUNTS_ROUTE, /catch \(recordError\)/);
  // try bloklarının içinde olduklarını da doğrula (yalnızca varlık değil).
  assert.match(segment, /try \{\s*outcome = await deliverMail\(env, envelope\);\s*\} catch \(mailError\)/);
  assert.match(segment, /try \{\s*mail = await recordMail\(\{[\s\S]*?\}\);\s*\} catch \(recordError\)/);
  assert.match(segment, /await assignPendingApplications\(\)\.catch\(/);
  assert.match(segment, /const result: CreateAccountResult = \{ account, oneTimePassword, mail \};/);
});

/*
 * 4. Mevcut bootstrap regresyon sözleşmeleri (tools/regression-tests.mjs)
 *    değişmeden korunur.
 */
test("bootstrap ucu mevcut regresyon sözleşmelerini korur", () => {
  const b = BOOTSTRAP_ROUTE;
  assert.match(b, /username: "admin"/, "Bootstrap hesabının kullanıcı adı 'admin' olmalıdır.");
  assert.match(b, /password: "1234"/, "Bootstrap hesabının geçici şifresi '1234' olmalıdır.");
  assert.match(b, /hashPassword\(DEV_ADMIN\.password\)/, "Şifre düz metin saklanmamalı, hash'lenmelidir.");
  assert.match(b, /if \(existing\)/, "İkinci çağrı ikinci Admin üretmemelidir (idempotent).");
  assert.match(b, /isProduction\(\)/, "Geliştirme kurulumu üretimde kapalı olmalıdır.");
  assert.match(b, /GELİŞTİRME\/DEMO/, "Hesabın yalnızca geliştirme/demo için olduğu belirtilmelidir.");
  assert.match(b, /ALLOW_LOCAL_ADMIN_BOOTSTRAP/, "Dev bootstrap açık yerel izin bayrağına bağlanmalıdır.");
  assert.match(b, /isLoopbackRequest/, "Dev bootstrap yalnızca loopback isteklerde açılmalıdır.");
  assert.match(b, /isExplicitDevelopment/, "Dev bootstrap açık development işareti istemelidir.");
  assert.match(b, /Kurulum ucu kapalı\./, "Üretim bootstrap kurulumdan sonra nötr yanıt vermelidir.");
  assert.match(b, /mustChangePassword: false/, "Dev bootstrap hesabı zorunlu parola değişimine takılmamalıdır.");
  // Parola veri tabanına açık hâliyle yazılmaz; yalnızca yanıtta döner.
  assert.match(b, /Şifre yalnızca bu yanıtta döner/);
  // insertAccount UNIQUE yarışını 409'a çevirir; hesap oluşmadığı için parola dönmez.
  assert.match(ADMIN_DB, /UNIQUE constraint failed:.*username/);
  assert.match(ADMIN_DB, /UNIQUE constraint failed:.*email/);
});
