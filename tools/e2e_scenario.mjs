/**
 * UÇTAN UCA SENARYO — çalışan sunucuya karşı gerçek HTTP istekleriyle.
 *
 * Problem 4 teslim ölçütlerinin ÜCRETSİZ olarak doğrulanabilen bölümünü
 * çalıştırır. ÜCRETLİ YAPAY ZEKÂ ÇAĞRISI YAPMAZ: şartname analizi
 * (/api/analyze) ve rapor analizi (/api/evaluate-report) uçlarına hiç
 * dokunmaz; bunun yerine kriter profilini doğrudan yayımlar ve hakem
 * sonucunu elle kurup BÜTÜNLÜK KAPILARINI sınar.
 *
 * KURULAN SENARYO
 *   1 Admin · 3 Yarışma Yöneticisi · 3 Hakem · 1 Değerlendirme Yöneticisi
 *   9 Katılımcı · 3 yarışma · her yarışmaya 3 başvuru (kötü / orta / iyi)
 *
 * Bu veriler UYGULAMA KODUNA GÖMÜLÜ DEĞİLDİR; yalnızca bu betik üretir ve
 * hepsi normal API akışlarından geçer.
 *
 * KULLANIM
 *   npm run dev                      # ayrı bir kabuk
 *   node tools/dev_reset.mjs --apply # temiz başlangıç
 *   node tools/e2e_scenario.mjs [http://localhost:3000]
 */
import { createHash } from "node:crypto";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
/**
 * Her koşu kendi hesaplarını ve yarışmalarını açar; betik temiz olmayan bir
 * veri tabanında da çalışabilsin diye adlar bir koşu etiketiyle ayrılır.
 * Biriken senaryo verisi `node tools/dev_reset.mjs --apply` ile temizlenir.
 */
const RUN = process.env.E2E_RUN_TAG || String(Date.now()).slice(-6);
/**
 * Admin girişi: temiz kurulumda bootstrap Admini (admin/1234) kullanılır.
 * Veri tabanında parolası değiştirilmiş GERÇEK bir Admin varsa kimlik
 * bilgileri ortamdan verilir; senaryo o hesabı DEĞİŞTİRMEZ.
 *   E2E_ADMIN_IDENTIFIER=admin E2E_ADMIN_PASSWORD=... node tools/e2e_scenario.mjs
 */
const ADMIN_IDENTIFIER = process.env.E2E_ADMIN_IDENTIFIER || "admin";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "1234";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/* -------------------------------------------------------------------------
 * Oturum taşıyan basit istemci. Her kullanıcı kendi çerez kavanozunu tutar.
 * ---------------------------------------------------------------------- */
function newClient(label) {
  return { label, cookie: "" };
}

async function call(client, path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (client.cookie) headers.cookie = client.cookie;
  if (init.body && typeof init.body === "string") headers["content-type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const entry of setCookie) {
    const [pair] = entry.split(";");
    if (pair?.startsWith("kriter_admin_session=")) client.cookie = pair;
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* metin yanıt */ }
  return { status: response.status, json, text };
}

const post = (client, path, body) => call(client, path, { method: "POST", body: JSON.stringify(body) });
const patch = (client, path, body) => call(client, path, { method: "PATCH", body: JSON.stringify(body) });
const get = (client, path) => call(client, path);

/* -------------------------------------------------------------------------
 * Küçük ama GEÇERLİ bir PDF üretir (başlık + sayfa nesnesi + xref + %%EOF).
 * Sunucudaki bütünlük kapısı (pdf-integrity.ts) bu yapıyı doğrular.
 * ---------------------------------------------------------------------- */
function buildPdf(lines) {
  const content = lines
    .map((line, index) => `BT /F1 11 Tf 56 ${760 - index * 18} Td (${line.replace(/[()\\]/g, " ")}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/* -------------------------------------------------------------------------
 * Kriter setleri. Her yarışmada bir tane PDF DIŞI KANIT kuralı bulunur:
 * "PDF'de video yok" diye hatalı sayılmadığını doğrulamak için.
 * ---------------------------------------------------------------------- */
function criteriaSet(prefix) {
  return [
    {
      id: "criterion-1", name: "Rapor dili Türkçe", stage: "language_template", required: true,
      description: "Rapor Türkçe yazılmalıdır.", violationOutcome: "Değerlendirmeye alınmaz.",
      sourcePage: 2, sourceText: `${prefix} raporu Türkçe hazırlanır.`,
      verifiability: "PDF_DENETLENEBILIR", active: true, origin: "document",
    },
    {
      id: "criterion-2", name: "Giriş bölümü", stage: "headings_content", required: true,
      description: "Raporda Giriş başlığı ve proje amacı bulunmalıdır.", violationOutcome: "Revizyon istenir.",
      sourcePage: 3, sourceText: `${prefix} raporu Giriş bölümü ile başlar.`,
      verifiability: "PDF_DENETLENEBILIR", active: true, origin: "document",
    },
    {
      id: "criterion-3", name: "Yapısal analiz sonuçları", stage: "criteria_evidence", required: true,
      description: "Raporda yapısal analiz sonuçları gösterilmelidir.", violationOutcome: "Elenir.",
      sourcePage: 5, sourceText: `${prefix} için yapısal analiz sonuçları raporda gösterilmelidir.`,
      verifiability: "PDF_DENETLENEBILIR", active: true, origin: "document",
    },
    {
      // PDF DIŞI KANIT — madde 4'ün asıl sınavı.
      id: "criterion-4", name: "Tanıtım videosu", stage: "criteria_evidence", required: true,
      description: "Takım tanıtım videosunu yarışma portalına yüklemelidir.", violationOutcome: "Elenir.",
      sourcePage: 7, sourceText: "Takımlar tanıtım videosunu portala yükler.",
      verifiability: "HARICI_KANIT_GEREKLI", active: true, origin: "document",
    },
  ];
}

function profilePayload(name, prefix, profileId) {
  return {
    version: "2.0",
    status: "approved",
    profileId,
    setup: {
      competition: name, category: "Üniversite", stage: "Kritik Tasarım",
      reportType: "Kritik Tasarım Raporu", year: "2026",
      allowedFormats: ["PDF"], maxFileSizeMb: 25, maxFileCount: 1,
      defaultViolationAction: "jury", reportLanguage: "Türkçe",
    },
    sourceDocument: { name: `${prefix}_sartname.pdf`, pages: 12, analyzedAt: "2026-08-26T00:00:00.000Z" },
    criteria: criteriaSet(prefix),
  };
}

const REPORT_QUALITY = {
  kotu: (team) => [`${team} raporu`, "Kisa bir aciklama."],
  orta: (team) => [`${team} raporu`, "Giris", "Proje amaci anlatilmistir.", "Tasarim ozeti."],
  iyi: (team) => [
    `${team} raporu`, "Giris", "Proje amaci ve kapsami ayrintili anlatilmistir.",
    "Yapisal analiz sonuclari", "Gerilme ve yer degistirme tablolari verilmistir.",
    "Test plani", "Dogrulama adimlari listelenmistir.",
  ],
};

async function uploadApplication(client, competitionName, team, quality) {
  const pdf = buildPdf(REPORT_QUALITY[quality](team));
  const form = new FormData();
  form.set("competitionName", competitionName);
  form.set("applicantFullName", `${team} Sorumlusu`);
  form.set("teamName", team);
  form.set("teamMembers", JSON.stringify([`${team} Üye 1`]));
  form.set("file", new File([pdf], `${team.replace(/\s+/g, "_")}_${quality}.pdf`, { type: "application/pdf" }));
  const headers = client.cookie ? { cookie: client.cookie } : {};
  const response = await fetch(`${BASE}/api/applications`, { method: "POST", body: form, headers });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* metin */ }
  return { status: response.status, json, pdfHash: sha256(pdf) };
}

/* ====================================================================== */

async function main() {
  console.log(`Uçtan uca senaryo · ${BASE} · koşu etiketi ${RUN}`);
  console.log("ÜCRETLİ AI ÇAĞRISI YAPILMAZ: /api/analyze ve /api/evaluate-report çağrılmaz.\n");

  /* ---------------------------------------------------------------- 1 */
  section("1 · Bootstrap Admin (madde 7)");
  const anon = newClient("anon");
  const statusBefore = await get(anon, "/api/admin/bootstrap");
  check("kurulum durumu okunabiliyor", statusBefore.status === 200, JSON.stringify(statusBefore.json));
  // Hiç aktif Admin yokken kurulum sunulur; hesap zaten varsa sunulmaz.
  check("kurulum sunumu Admin varlığıyla tutarlı", typeof statusBefore.json?.devBootstrapAvailable === "boolean");

  const admin = newClient("admin");
  const created = await post(admin, "/api/admin/bootstrap", { mode: "development" });
  const freshBootstrap = created.json?.created === true;
  check("bootstrap Admin hazır", (created.status === 201 || created.status === 200) && Boolean(created.json?.account),
    JSON.stringify(created.json?.error));
  check("kullanıcı adı admin", created.json?.username === "admin");
  if (freshBootstrap) {
    check("geçici şifre 1234", created.json?.oneTimePassword === "1234");
  } else {
    // Hesap zaten vardı (sıfırlama bootstrap Adminini korur, madde 8).
    check("mevcut bootstrap hesabı korundu", created.json?.oneTimePassword === "");
  }
  check("geliştirme/demo uyarısı var", /GELİŞTİRME\/DEMO/.test(created.json?.warning ?? ""));

  const again = await post(admin, "/api/admin/bootstrap", { mode: "development" });
  check("ikinci çağrı ikinci Admin üretmiyor (idempotent)", again.status === 200 && again.json?.created === false);

  const login = await post(admin, "/api/admin/session", { identifier: ADMIN_IDENTIFIER, password: ADMIN_PASSWORD });
  check("Admin basit kullanıcı adıyla giriş yapabildi", login.status === 200 && login.json?.account?.roleCode === "00", JSON.stringify(login.json));
  check("rol veri tabanından geldi (istemci rol seçmedi)", login.json?.role?.code === "00");

  const badLogin = await post(newClient("bad"), "/api/admin/session", { identifier: ADMIN_IDENTIFIER, password: "yanlis-parola" });
  check("yanlış şifre reddediliyor", badLogin.status === 401);

  const noDevSession = await post(newClient("x"), "/api/admin/dev-session", { roleCode: "00" });
  check("şifresiz rol kısayolu ucu yok", noDevSession.status === 404, `HTTP ${noDevSession.status}`);

  /* --------------------------------------------------------------- 1b */
  section("1b · Giriş tekdüzeliği ve dağıtık kaba kuvvet sınırı (madde 10)");
  // HESAP KEŞFİNE KARŞI: bilinmeyen kullanıcı, yanlış şifre ve pasif hesap
  // AYNI durum kodunu (401) ve AYNI mesajı almalıdır. Pasif hesap denemesi
  // için koşuya özel geçici bir hesap açılıp pasife alınır; kalıcı iz bırakmaz.
  const unknownLogin = await post(newClient("enum1"), "/api/admin/session", {
    identifier: `hic-yok-${RUN}`, password: "yanlis-parola",
  });
  const wrongLogin = await post(newClient("enum2"), "/api/admin/session", {
    identifier: ADMIN_IDENTIFIER, password: "yanlis-parola-2",
  });
  check("bilinmeyen kullanıcı 401 alıyor", unknownLogin.status === 401, `HTTP ${unknownLogin.status}`);
  check("bilinmeyen kullanıcı ve yanlış şifre AYNI mesajı alıyor",
    wrongLogin.status === 401
      && Boolean(unknownLogin.json?.error)
      && unknownLogin.json?.error === wrongLogin.json?.error,
    JSON.stringify({ bilinmeyen: unknownLogin.json?.error, yanlis: wrongLogin.json?.error }));

  const enumAccount = await post(admin, "/api/admin/accounts", {
    fullName: "Tekdüzelik Deneği", email: `tekduze.${RUN}@senaryo.test`,
    username: `tekduze${RUN}`, roleCode: "01", password: "senaryo1234",
  });
  check("tekdüzelik deneği hesabı açıldı", enumAccount.status === 201, JSON.stringify(enumAccount.json?.error));
  if (enumAccount.status === 201) {
    const revoked = await call(admin, `/api/admin/accounts/${enumAccount.json.account.id}?reason=senaryo`, {
      method: "DELETE",
    });
    check("denek hesap pasife alındı", revoked.status === 200, JSON.stringify(revoked.json?.error));
    const inactiveLogin = await post(newClient("enum3"), "/api/admin/session", {
      identifier: `tekduze${RUN}`, password: "senaryo1234",
    });
    check("pasif hesap girişi tekdüze 401 (pasiflik sızmıyor)",
      inactiveLogin.status === 401 && inactiveLogin.json?.error === unknownLogin.json?.error,
      JSON.stringify({ durum: inactiveLogin.status, mesaj: inactiveLogin.json?.error }));
  }

  // DAĞITIK SINIR (D1): koşuya özel kimlikle 8 başarısız denemeden sonra 9.
  // deneme 429 almalıdır. RUN etiketi anahtarı benzersiz kılar; sonraki
  // koşular kirlenmez ve süresi geçen satırlar fırsatçı TTL ile silinir.
  const bruteIdentifier = `kaba-kuvvet-${RUN}`;
  let lastBrute = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    lastBrute = await post(newClient(`brute${attempt}`), "/api/admin/session", {
      identifier: bruteIdentifier, password: `yanlis-${attempt}`,
    });
  }
  check("ilk 8 başarısız deneme 401 alıyor", lastBrute?.status === 401, `HTTP ${lastBrute?.status}`);
  const throttledLogin = await post(newClient("brute9"), "/api/admin/session", {
    identifier: bruteIdentifier, password: "yanlis-9",
  });
  check("9. deneme dağıtık sayaçla 429 alıyor", throttledLogin.status === 429, `HTTP ${throttledLogin.status}`);

  /* --------------------------------------------------------------- 1c */
  section("1c · Zorunlu parola değişimi ve hesap açma atomikliği (madde 10)");
  // Admin'in açtığı hesap geçici şifreyle gelir (mustChangePassword true);
  // /api/admin/password ucu eski şifreyi doğrular, bayrağı temizler ve
  // hesabın DİĞER oturumlarını düşürür. Tek kullanımlık şifre yalnızca
  // tutarlı 201 yanıtında döner; mail durumu her koşulda doludur.
  const pwUsername = `paroladenek${RUN}`;
  const pwCreated = await post(admin, "/api/admin/accounts", {
    fullName: "Parola Değişim Deneği", email: `parola.denek.${RUN}@senaryo.test`,
    username: pwUsername, roleCode: "01",
  });
  check("geçici şifreli hesap 201 + tek kullanımlık şifreyle açıldı",
    pwCreated.status === 201 && typeof pwCreated.json?.oneTimePassword === "string"
      && pwCreated.json.oneTimePassword.length >= 8,
    JSON.stringify(pwCreated.json?.error));
  check("hesap açma yanıtında mail durumu dolu",
    typeof pwCreated.json?.mail?.status === "string" && pwCreated.json.mail.status.length > 0,
    JSON.stringify(pwCreated.json?.mail));
  if (pwCreated.status === 201) {
    const tempPassword = pwCreated.json.oneTimePassword;
    check("yeni hesap zorunlu parola değişimiyle işaretli",
      pwCreated.json.account?.mustChangePassword === true);

    // İki ayrı istemci aynı geçici şifreyle girer; değişimden sonra yalnızca
    // değişimi yapan oturum yaşamalıdır.
    const pwClientA = newClient("pwA");
    const pwClientB = newClient("pwB");
    const pwLoginA = await post(pwClientA, "/api/admin/session", { identifier: pwUsername, password: tempPassword });
    const pwLoginB = await post(pwClientB, "/api/admin/session", { identifier: pwUsername, password: tempPassword });
    check("geçici şifreyle giriş yapılabiliyor (bayrak açık)",
      pwLoginA.status === 200 && pwLoginA.json?.account?.mustChangePassword === true,
      JSON.stringify(pwLoginA.json));
    check("ikinci istemci de geçici şifreyle girdi", pwLoginB.status === 200, `HTTP ${pwLoginB.status}`);

    const pwWrongCurrent = await post(pwClientA, "/api/admin/password", {
      currentPassword: "yanlis-eski-parola", newPassword: `yeni-parola-${RUN}`,
    });
    check("yanlış mevcut şifreyle değişim 401 alıyor", pwWrongCurrent.status === 401, `HTTP ${pwWrongCurrent.status}`);
    const pwShortNew = await post(pwClientA, "/api/admin/password", {
      currentPassword: tempPassword, newPassword: "kisa",
    });
    check("kısa yeni şifre politika gereği 400 alıyor", pwShortNew.status === 400, `HTTP ${pwShortNew.status}`);

    const pwChanged = await post(pwClientA, "/api/admin/password", {
      currentPassword: tempPassword, newPassword: `yeni-parola-${RUN}`,
    });
    check("doğru geçici şifreyle değişim başarılı ve bayrak temiz",
      pwChanged.status === 200 && pwChanged.json?.account?.mustChangePassword === false,
      JSON.stringify(pwChanged.json));

    const pwMeA = await get(pwClientA, "/api/admin/session");
    check("değişimi yapan oturum açık kalıyor",
      pwMeA.status === 200 && pwMeA.json?.account?.mustChangePassword === false, `HTTP ${pwMeA.status}`);
    const pwMeB = await get(pwClientB, "/api/admin/session");
    check("hesabın diğer eski oturumu düşürüldü (401)", pwMeB.status === 401, `HTTP ${pwMeB.status}`);

    const pwOldLogin = await post(newClient("pwOld"), "/api/admin/session", {
      identifier: pwUsername, password: tempPassword,
    });
    check("eski geçici şifreyle giriş artık reddediliyor", pwOldLogin.status === 401, `HTTP ${pwOldLogin.status}`);
    const pwNewLogin = await post(newClient("pwNew"), "/api/admin/session", {
      identifier: pwUsername, password: `yeni-parola-${RUN}`,
    });
    check("yeni şifreyle giriş başarılı ve bayrak temiz kalıyor",
      pwNewLogin.status === 200 && pwNewLogin.json?.account?.mustChangePassword === false,
      JSON.stringify(pwNewLogin.json));

    // Denek hesap iz bırakmasın diye pasife alınır (1b'deki kalıpla aynı).
    const pwRevoked = await call(admin, `/api/admin/accounts/${pwCreated.json.account.id}?reason=senaryo`, {
      method: "DELETE",
    });
    check("parola deneği pasife alındı", pwRevoked.status === 200, JSON.stringify(pwRevoked.json?.error));
  }

  /* ---------------------------------------------------------------- 2 */
  section("2 · Hesaplar ve rol bazlı yönlendirme");
  const staff = {};
  // BASİT KULLANICI ADLARI (madde 11): projeyoneticisi1..3 · hakem1..3 ·
  // degerlendirmeyoneticisi1. Parola yalnızca geliştirme içindir; veri
  // tabanında açık metin tutulmaz (PBKDF2 · bkz. app/lib/password.ts).
  const plan = [
    ["01", 3, "Yarışma Yöneticisi", "projeyoneticisi"],
    ["02", 3, "Hakem", "hakem"],
    ["04", 1, "Değerlendirme Yöneticisi", "degerlendirmeyoneticisi"],
  ];
  for (const [roleCode, count, title, usernameBase] of plan) {
    staff[roleCode] = [];
    for (let index = 1; index <= count; index += 1) {
      const email = `rol${roleCode}.${index}.${RUN}@senaryo.test`;
      const username = `${usernameBase}${index}`;
      const result = await post(admin, "/api/admin/accounts", {
        fullName: `${title} ${index}`, email, username, roleCode, password: "senaryo1234",
      });
      if (result.status !== 201) {
        check(`${title} ${index} hesabı açıldı`, false, JSON.stringify(result.json));
        continue;
      }
      staff[roleCode].push({ email, username, password: "senaryo1234", account: result.json.account });
    }
    check(`${count} adet ${title} hesabı açıldı`, staff[roleCode].length === count);
  }

  const adminCannotAssign = await post(admin, "/api/admin/accounts", {
    fullName: "Sahte Admin", email: "sahte.admin@senaryo.test", roleCode: "00",
  });
  check("Admin ikinci bir Admin (00) atayamıyor", adminCannotAssign.status === 400, `HTTP ${adminCannotAssign.status}`);
  const adminCannotAddParticipant = await post(admin, "/api/admin/accounts", {
    fullName: "Sahte Yarışmacı", email: `sahte.yarismaci.${RUN}@senaryo.test`, roleCode: "03",
  });
  check("Admin yarışmacı (03) hesabı açamıyor", adminCannotAddParticipant.status === 400);

  // Rol bazlı yönlendirme: her hesap BASİT KULLANICI ADIYLA giriyor (madde 11/14).
  const clients = { managers: [], judges: [], operations: null };
  for (const item of staff["01"]) {
    const client = newClient(item.username);
    const result = await post(client, "/api/admin/session", { identifier: item.username, password: item.password });
    if (result.json?.account?.roleCode === "01") clients.managers.push({ client, account: result.json.account });
  }
  for (const item of staff["02"]) {
    const client = newClient(item.username);
    const result = await post(client, "/api/admin/session", { identifier: item.username, password: item.password });
    if (result.json?.account?.roleCode === "02") clients.judges.push({ client, account: result.json.account });
  }
  {
    const item = staff["04"][0];
    const client = newClient(item.username);
    const result = await post(client, "/api/admin/session", { identifier: item.username, password: item.password });
    if (result.json?.account?.roleCode === "04") clients.operations = { client, account: result.json.account };
  }
  check("3 Yarışma Yöneticisi basit kullanıcı adıyla (projeyoneticisiN) girdi", clients.managers.length === 3);
  check("3 Hakem basit kullanıcı adıyla (hakemN) girdi", clients.judges.length === 3);
  check("1 Değerlendirme Yöneticisi basit kullanıcı adıyla girdi", Boolean(clients.operations));

  if (clients.managers.length !== 3 || clients.judges.length !== 3 || !clients.operations) {
    console.error("Hesaplar kurulamadı; senaryo durduruldu.");
    process.exit(1);
  }

  /*
   * TEMİZ VERİ TABANI ŞARTI
   *
   * Otomatik atama, SİSTEMDEKİ bütün aktif hakemler arasından en az yüklü
   * olanı seçer. Önceki koşulardan kalan hakemler varsa başvurular onlara da
   * dağılır ve senaryonun beklentileri anlamını yitirir. Bu yüzden başka
   * aktif hakem bulunursa betik açık bir mesajla durur.
   */
  const workloadCheck = await get(clients.operations.client, "/api/operations");
  const foreignJudges = (workloadCheck.json?.judges ?? [])
    .filter((item) => !clients.judges.some((entry) => entry.account.id === item.judgeId));
  if (foreignJudges.length) {
    console.error(
      [
        "",
        `Veri tabanında bu koşuya ait olmayan ${foreignJudges.length} aktif Hakem var.`,
        "Otomatik atama sistemdeki TÜM aktif hakemler arasında dağıtım yapar; senaryo",
        "temiz bir veri tabanı ister. Önce şunu çalıştırın:",
        "",
        "  node tools/dev_reset.mjs --apply",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  /* ---------------------------------------------------------------- 3 */
  section("3 · Route / RBAC yetki testleri");
  const manager = clients.managers[0];
  const judge = clients.judges[0];
  const operations = clients.operations;

  check("Admin başvuru listesine erişemiyor (403)", (await get(admin, "/api/applications")).status === 403);
  check("Admin operasyon panosuna erişemiyor (403)", (await get(admin, "/api/operations")).status === 403);
  check("Admin kriter profillerine erişemiyor (403)", (await get(admin, "/api/profiles")).status === 403);
  check("Hakem hesap yönetimine erişemiyor (403)", (await get(judge.client, "/api/admin/accounts")).status === 403);
  check("Yarışma Yöneticisi operasyon panosuna erişemiyor (403)", (await get(manager.client, "/api/operations")).status === 403);
  check("Değerlendirme Yöneticisi profil listesini görebiliyor", (await get(operations.client, "/api/profiles")).status === 200);
  check("Oturumsuz istek 401 alıyor", (await get(newClient("anon2"), "/api/applications")).status === 401);

  /* ---------------------------------------------------------------- 4 */
  section("4 · Kriter yayımı ve değişmez sürümler (madde 2)");
  const competitions = [
    { name: `Senaryo Roket Yarışması ${RUN}`, prefix: "Roket", manager: clients.managers[0] },
    { name: `Senaryo İHA Yarışması ${RUN}`, prefix: "İHA", manager: clients.managers[1] },
    { name: `Senaryo Su Altı Yarışması ${RUN}`, prefix: "Su Altı", manager: clients.managers[2] },
  ];

  for (const item of competitions) {
    item.profileId = `profil-${RUN}-${item.prefix.toLowerCase().replace(/\s+/g, "-")}`;
    const result = await post(item.manager.client, "/api/profiles", {
      profile: profilePayload(item.name, item.prefix, item.profileId),
    });
    if (result.status !== 201) {
      check(`${item.name} kriterleri yayımlandı`, false, JSON.stringify(result.json));
      continue;
    }
    item.version = result.json.criteriaVersion;
    check(`${item.name} · kriter sürümü v${item.version.criteriaVersion} açıldı`, item.version.criteriaVersion === 1);
  }

  // Aynı içerik yeniden yayımlanınca yeni sürüm açılmaz.
  const republishSame = await post(competitions[0].manager.client, "/api/profiles", {
    profile: profilePayload(competitions[0].name, competitions[0].prefix, competitions[0].profileId),
  });
  check("aynı içerik yeniden yayımlanınca sürüm artmıyor",
    republishSame.json?.criteriaVersion?.criteriaVersion === 1 && republishSame.json?.versionCreated === false);

  // Başka bir yönetici başkasının profilini güncelleyemez.
  const stolen = await post(clients.managers[1].client, "/api/profiles", {
    profile: profilePayload(competitions[0].name, competitions[0].prefix, competitions[0].profileId),
  });
  check("başka yöneticinin profili güncellenemiyor (403)", stolen.status === 403, `HTTP ${stolen.status}`);

  /* ---------------------------------------------------------------- 5 */
  section("5 · Kaynak sayfa ve alıntı kilidi (madde 12)");
  const tampered = profilePayload(competitions[0].name, competitions[0].prefix, competitions[0].profileId);
  tampered.criteria = tampered.criteria.map((criterion) => criterion.id === "criterion-1"
    ? { ...criterion, sourcePage: 99, sourceText: "ELLE DEĞİŞTİRİLMİŞ ALINTI" }
    : criterion);
  const tamperResult = await post(competitions[0].manager.client, "/api/profiles", { profile: tampered });
  check("kaynak değişikliği reddedildi ve uyarı döndü",
    typeof tamperResult.json?.sourceLockWarning === "string" && tamperResult.json.sourceLockWarning.includes("Rapor dili"),
    JSON.stringify(tamperResult.json?.sourceLockWarning));

  const savedProfile = await get(competitions[0].manager.client, `/api/profiles?id=${encodeURIComponent(competitions[0].profileId)}`);
  const lockedCriterion = savedProfile.json?.profile?.profile?.criteria?.find((item) => item.id === "criterion-1");
  check("kaynak sayfa ilk değerinde kaldı", lockedCriterion?.sourcePage === 2, `sourcePage=${lockedCriterion?.sourcePage}`);
  check("kaynak alıntı ilk değerinde kaldı", !/ELLE DEĞİŞTİRİLMİŞ/.test(lockedCriterion?.sourceText ?? ""));
  check("sürüm hâlâ v1 (içerik değişmediği için)", tamperResult.json?.criteriaVersion?.criteriaVersion === 1);

  /* --------------------------------------------------------------- 5b */
  section("5b · Kimlik şeması değişse de kaynak kilidi tutar (madde 12)");
  // Kilit eskiden yalnızca criterion.id ile eşleşiyordu; yeniden analiz kimlik
  // biçimini değiştirdiğinde (criterion-N → içerik türevi kararlı kimlik)
  // profil kilitsiz yayımlanabiliyordu. Bu blok KENDİ profilini açar: sunucu
  // yeni profile kendi kimliğini verdiği için sonraki yayım yanıttaki
  // profile.id ile yapılır ve diğer bölümlerin sürüm sayaçları etkilenmez.
  const lockCompetitionName = `Senaryo Kaynak Kilidi Yarışması ${RUN}`;
  const lockFirst = await post(competitions[0].manager.client, "/api/profiles", {
    profile: profilePayload(lockCompetitionName, "Kilit", undefined),
  });
  const lockProfileId = lockFirst.json?.profile?.id;
  check("kilit senaryosu profili yayımlandı (v1)",
    lockFirst.status === 201 && Boolean(lockProfileId), JSON.stringify(lockFirst.json?.error ?? null));
  if (lockProfileId) {
    // Yeniden analiz simülasyonu: bütün kimlikler kararlı biçime döner, bir
    // kriterin sayfası elle 99 yapılır; ALINTI DEĞİŞMEZ (alıntı anahtarı
    // sourceText'ten üretilir ve aynı PDF'in yeniden analizinde sabittir).
    const reanalyzed = profilePayload(lockCompetitionName, "Kilit", lockProfileId);
    reanalyzed.criteria = reanalyzed.criteria.map((criterion, index) => ({
      ...criterion,
      id: `criterion-sayfa-${String(criterion.sourcePage ?? 0).padStart(2, "0")}-madde-${index + 1}`,
      ...(criterion.name === "Rapor dili Türkçe" ? { sourcePage: 99 } : {}),
    }));
    const idSchemeResult = await post(competitions[0].manager.client, "/api/profiles", { profile: reanalyzed });
    check("kimlik şeması değişse de kaynak kurcalaması yakalanıyor",
      typeof idSchemeResult.json?.sourceLockWarning === "string"
        && idSchemeResult.json.sourceLockWarning.includes("Rapor dili"),
      JSON.stringify(idSchemeResult.json?.sourceLockWarning ?? idSchemeResult.json?.error ?? null));
    const lockSaved = await get(competitions[0].manager.client, `/api/profiles?id=${encodeURIComponent(lockProfileId)}`);
    const lockedByQuote = lockSaved.json?.profile?.profile?.criteria?.find(
      (item) => item.sourceText === "Kilit raporu Türkçe hazırlanır.",
    );
    // criteriaHash kriter kimliğini içerdiği için sürüm ARTABİLİR; bu yüzden
    // sürüm sayısına değil DEĞERLERE bakılır: kaynak alanları ilk yayımdaki
    // değerinde kalmalıdır.
    check("kimlik değişse de kaynak sayfa ilk değerinde kaldı",
      lockedByQuote?.sourcePage === 2, `sourcePage=${lockedByQuote?.sourcePage}`);
  }

  /* ---------------------------------------------------------------- 6 */
  section("6 · Katılımcı kaydı, R2 yükleme ve otomatik atama (madde 5)");
  const participants = [];
  for (let index = 1; index <= 9; index += 1) {
    const client = newClient(`katilimci-${index}`);
    const result = await post(client, "/api/participant/register", {
      fullName: `Katılımcı ${index}`, email: `katilimci${index}.${RUN}@senaryo.test`,
      username: `katilimci${index}`, password: "senaryo1234",
    });
    if (result.status === 201) participants.push({ client, account: result.json.account, index });
  }
  check("9 katılımcı hesabı açıldı", participants.length === 9);
  {
    // Basit kullanıcı adıyla giriş yarışmacıda da çalışır (madde 11).
    const login = await post(newClient("katilimci-username"), "/api/admin/session", {
      identifier: "katilimci1", password: "senaryo1234",
    });
    check("katılımcı basit kullanıcı adıyla (katilimci1) girebiliyor",
      login.status === 200 && login.json?.account?.roleCode === "03", JSON.stringify(login.json?.error));
  }

  const openList = await get(participants[0].client, "/api/applications");
  const openNames = (openList.json?.openCompetitions ?? []).map((item) => item.name);
  check("3 yarışma katılımcıya açık görünüyor",
    competitions.every((item) => openNames.includes(item.name)), JSON.stringify(openNames));

  const qualities = ["kotu", "orta", "iyi"];
  const applications = [];
  for (let index = 0; index < competitions.length; index += 1) {
    const competition = competitions[index];
    for (let slot = 0; slot < 3; slot += 1) {
      const participant = participants[index * 3 + slot];
      const team = `Takım ${competition.prefix} ${qualities[slot]} ${RUN}`;
      const result = await uploadApplication(participant.client, competition.name, team, qualities[slot]);
      if (result.status !== 201) {
        check(`${team} başvurusu alındı`, false, JSON.stringify(result.json));
        continue;
      }
      applications.push({
        competition, participant, team, quality: qualities[slot],
        application: result.json.application, pdfHash: result.pdfHash,
      });
    }
  }
  check("9 başvuru alındı (3 yarışma × 3 katılımcı)", applications.length === 9);
  check("her başvuruya hakem otomatik atandı",
    applications.every((item) => Boolean(item.application.assignedJudgeId)),
    `atanmayan: ${applications.filter((item) => !item.application.assignedJudgeId).length}`);

  const loads = new Map();
  for (const item of applications) {
    loads.set(item.application.assignedJudgeId, (loads.get(item.application.assignedJudgeId) ?? 0) + 1);
  }
  check("iş yükü hakemler arasında dengeli dağıldı",
    Math.max(...loads.values()) - Math.min(...loads.values()) <= 1 && loads.size === 3,
    `dağılım: ${[...loads.values()].join("/")}`);

  // R2: yüklenen PDF geri okunabiliyor ve aynı dosya.
  const sample = applications[0];
  const judgeOfSample = clients.judges.find((item) => item.account.id === sample.application.assignedJudgeId);
  const fileResponse = await fetch(`${BASE}/api/applications/${sample.application.id}/file`, {
    headers: { cookie: judgeOfSample.client.cookie },
  });
  const downloaded = Buffer.from(await fileResponse.arrayBuffer());
  check("R2'ye yüklenen PDF geri indirilebiliyor", fileResponse.status === 200 && downloaded.length > 0);
  check("indirilen PDF yüklenenle birebir aynı", sha256(downloaded) === sample.pdfHash);

  const otherJudge = clients.judges.find((item) => item.account.id !== sample.application.assignedJudgeId);
  const forbiddenFile = await fetch(`${BASE}/api/applications/${sample.application.id}/file`, {
    headers: { cookie: otherJudge.client.cookie },
  });
  check("atanmamış hakem PDF'e erişemiyor", forbiddenFile.status === 404, `HTTP ${forbiddenFile.status}`);
  const managerFile = await fetch(`${BASE}/api/applications/${sample.application.id}/file`, {
    headers: { cookie: manager.client.cookie },
  });
  check("Yarışma Yöneticisi katılımcı PDF'ini göremiyor", managerFile.status === 403, `HTTP ${managerFile.status}`);

  /* ---------------------------------------------------------------- 7 */
  section("7 · Değerlendirme bütünlüğü (madde 3)");
  const target = applications[0];
  const targetJudge = clients.judges.find((item) => item.account.id === target.application.assignedJudgeId);
  const wrongJudge = clients.judges.find((item) => item.account.id !== target.application.assignedJudgeId);

  const startWrong = await patch(wrongJudge.client, `/api/applications/${target.application.id}`, { action: "start_analysis" });
  check("atanmamış hakem analiz başlatamıyor", startWrong.status === 404 || startWrong.status === 409, `HTTP ${startWrong.status}`);

  const started = await patch(targetJudge.client, `/api/applications/${target.application.id}`, { action: "start_analysis" });
  check("atanan hakem analizi başlatabiliyor", started.status === 200, JSON.stringify(started.json?.error));

  const version = target.competition.version;
  const buildEvaluation = (overrides = {}) => ({
    version: "2.0",
    profileRef: {
      profileId: target.competition.profileId,
      competition: target.competition.name, year: "2026", stage: "Kritik Tasarım",
      reportType: "Kritik Tasarım Raporu",
      criteriaVersion: version.criteriaVersion, criteriaHash: version.criteriaHash,
      ...overrides.profileRef,
    },
    report: { name: "rapor.pdf", pages: 1, sizeBytes: 1000, pdfHash: target.pdfHash, ...overrides.report },
    preChecks: [],
    stages: ["language_template", "headings_content", "category_similarity", "criteria_evidence"].map((stage) => ({
      stage, verdict: "BASARILI", summary: "Kontrol edildi.", evidence: [],
    })),
    // PDF DIŞI KANIT KURALLARI BULGU LİSTESİNE GİRMEZ (madde 2): video kriteri
    // (criterion-4) modele gönderilmez, bulgu üretmez ve sayaçlara katılmaz.
    findings: criteriaSet(target.competition.prefix)
      .filter((criterion) => criterion.verifiability === "PDF_DENETLENEBILIR")
      .map((criterion) => ({
        criterionId: criterion.id, criterionName: criterion.name, stage: criterion.stage,
        required: criterion.required, verifiability: criterion.verifiability,
        verdict: "BASARILI",
        rationale: "Senaryo sonucu.", evidence: [], evidenceMissing: false,
      })),
    summary: { total: 3, basarili: 3, revizyon: 0, kritikHata: 0, disiKanit: 0, overall: "BASARILI" },
    feedbackDraft: { strengths: [], improvements: [], suggestions: [] },
    analysisWarnings: [],
    provider: "api", model: "senaryo", analyzedAt: new Date().toISOString(),
  });

  const wrongVersion = await patch(targetJudge.client, `/api/applications/${target.application.id}`, {
    action: "save_evaluation",
    evaluation: buildEvaluation({ profileRef: { criteriaVersion: 99, criteriaHash: "sahte" } }),
  });
  check("yanlış kriter sürümüyle sonuç kaydedilemiyor", wrongVersion.status === 409, `HTTP ${wrongVersion.status}`);
  check("hata mesajı yeniden analiz istiyor",
    /Kriterler güncellendi/.test(wrongVersion.json?.error ?? ""), wrongVersion.json?.error);

  const wrongPdf = await patch(targetJudge.client, `/api/applications/${target.application.id}`, {
    action: "save_evaluation",
    evaluation: buildEvaluation({ report: { pdfHash: sha256(Buffer.from("baska belge")) } }),
  });
  check("başka bir PDF'in sonucu kaydedilemiyor", wrongPdf.status === 409, `HTTP ${wrongPdf.status}`);

  const foreign = applications.find((item) => item.competition !== target.competition);
  const foreignSave = await patch(targetJudge.client, `/api/applications/${foreign.application.id}`, {
    action: "save_evaluation", evaluation: buildEvaluation(),
  });
  check("başka başvuruya ait sonuç reddediliyor", foreignSave.status === 409 || foreignSave.status === 404,
    `HTTP ${foreignSave.status}`);

  const goodSave = await patch(targetJudge.client, `/api/applications/${target.application.id}`, {
    action: "save_evaluation", evaluation: buildEvaluation(),
  });
  check("doğru bağlamla sonuç kaydedildi", goodSave.status === 200, JSON.stringify(goodSave.json?.error));
  check("sonuç kriter sürümüne bağlandı", goodSave.json?.application?.evaluationCriteriaVersion === version.criteriaVersion);
  check("sonuç güncel sayılıyor", goodSave.json?.application?.criteriaOutdated === false);

  /* ---------------------------------------------------------------- 8 */
  section("8 · PDF dışı (video) kriteri hakem analizinden tamamen çıktı (madde 2)");
  const savedFindings = goodSave.json?.application?.evaluation?.findings ?? [];
  const videoFinding = savedFindings.find((item) => item.criterionId === "criterion-4");
  // Video kriteri Yarışma Yöneticisinin kriter listesinde DURUR (bkz. bölüm 4:
  // profil 4 kriterle yayımlandı) ama hakem analizinde HİÇ görünmez.
  check("video kriteri için bulgu üretilmedi", !videoFinding, JSON.stringify(videoFinding));
  check("bulgu listesi yalnızca 3 PDF kriterini içeriyor", savedFindings.length === 3, `bulgu: ${savedFindings.length}`);
  check("toplam sayaç PDF dışı kuralı saymıyor", goodSave.json?.application?.evaluation?.summary?.total === 3);
  check("hiçbir bulgu DEGERLENDIRILEMEDI değil",
    savedFindings.every((item) => item.verdict !== "DEGERLENDIRILEMEDI"));
  check("genel durum video yüzünden bozulmadı", goodSave.json?.application?.evaluation?.summary?.overall === "BASARILI");
  {
    // İstemci DEGERLENDIRILEMEDI bulgusu gönderse bile sunucu süzer (geriye uyum).
    const tamperedEvaluation = buildEvaluation();
    tamperedEvaluation.findings = [...tamperedEvaluation.findings, {
      criterionId: "criterion-4", criterionName: "Tanıtım videosu", stage: "criteria_evidence",
      required: true, verifiability: "HARICI_KANIT_GEREKLI", verdict: "DEGERLENDIRILEMEDI",
      rationale: "PDF dışı.", evidence: [], evidenceMissing: false,
    }];
    tamperedEvaluation.summary = { ...tamperedEvaluation.summary, total: 4, disiKanit: 1 };
    const resaved = await patch(targetJudge.client, `/api/applications/${target.application.id}`, {
      action: "save_evaluation", evaluation: tamperedEvaluation,
    });
    const resavedFindings = resaved.json?.application?.evaluation?.findings ?? [];
    check("sunucu PDF dışı bulguyu kayıttan süzüyor",
      resaved.status === 200 && !resavedFindings.some((item) => item.criterionId === "criterion-4"),
      JSON.stringify(resaved.json?.error));
    check("süzülen kayıtta toplam sayaç 3'e düzeltildi",
      resaved.json?.application?.evaluation?.summary?.total === 3);
  }

  /* --------------------------------------------------------------- 8b */
  section("8b · Hibrit benzerlik: kapsam, PDF bağı ve MinHash (madde 9)");
  // ÜCRETLİ EMBEDDING ÇAĞRISI YAPILMAZ: skipEmbedding bayrağı test içindir;
  // sonuç minhash-only olarak işaretlenir ve bu, hakeme de aynen söylenir.
  // Metinler tekrar etmeyen kelimelerden üretilir; MinHash gerçekçi çalışır.
  const wordSequence = (seed, count) =>
    Array.from({ length: count }, (_, index) => `${seed}${index}bolumu`).join(" ");
  const similarityPagesA = [
    `Giris ${wordSequence("amac", 150)}`,
    `Yapisal analiz ${wordSequence("gerilme", 150)}`,
  ];
  const targetSimilarity = await post(targetJudge.client, `/api/applications/${target.application.id}/similarity`, {
    pages: similarityPagesA, pdfHash: target.pdfHash, skipEmbedding: true,
  });
  check("ilk başvurunun benzerlik kontrolü çalıştı", targetSimilarity.status === 200, JSON.stringify(targetSimilarity.json?.error));
  check("karşılaştırılacak başka rapor yokken oran oluşturulmadı",
    targetSimilarity.json?.similarity?.level === "none" && targetSimilarity.json?.similarity?.approxPercent === null,
    JSON.stringify(targetSimilarity.json?.similarity));
  check("boş havuz notu madde 7 cümlesini taşıyor ('Çalıştırılmadı' denmez)",
    /Karşılaştırılabilecek başka güncel rapor henüz bulunmuyor\./.test(targetSimilarity.json?.similarity?.note ?? ""),
    targetSimilarity.json?.similarity?.note);

  const wrongHash = await post(targetJudge.client, `/api/applications/${target.application.id}/similarity`, {
    pages: similarityPagesA, pdfHash: "0".repeat(64), skipEmbedding: true,
  });
  check("farklı PDF özetiyle gelen benzerlik metni reddediliyor", wrongHash.status === 409, `HTTP ${wrongHash.status}`);

  // AKIŞLI BOYUT KAPISI (madde 9): 8 MB üstü gövde parse edilmeden 413 alır.
  const oversizedSimilarity = await post(targetJudge.client, `/api/applications/${target.application.id}/similarity`, {
    pages: [wordSequence("devasa", 5000), "x".repeat(9 * 1024 * 1024)], pdfHash: target.pdfHash, skipEmbedding: true,
  });
  check("8 MB üstü benzerlik gövdesi parse edilmeden 413 alıyor",
    oversizedSimilarity.status === 413, `HTTP ${oversizedSimilarity.status}`);

  // YETKİ (madde 9): yalnızca ATANMIŞ hakem benzerlik başlatabilir.
  const strangerJudge = clients.judges.find((item) => item.account.id !== target.application.assignedJudgeId);
  if (strangerJudge) {
    const foreignSimilarity = await post(strangerJudge.client, `/api/applications/${target.application.id}/similarity`, {
      pages: similarityPagesA, pdfHash: target.pdfHash, skipEmbedding: true,
    });
    check("atanmamış hakem benzerlik başlatamıyor (403)",
      foreignSimilarity.status === 403, `HTTP ${foreignSimilarity.status}`);
  }

  // Aynı yarışmadaki İKİNCİ başvuru raporu DOĞRUDAN KOPYALAMIŞ (madde 14 · senaryo 2).
  const peerApplication = applications.find((item) => item.competition === target.competition && item !== target);
  const peerJudge = clients.judges.find((item) => item.account.id === peerApplication.application.assignedJudgeId);
  const peerSimilarity = await post(peerJudge.client, `/api/applications/${peerApplication.application.id}/similarity`, {
    pages: similarityPagesA, pdfHash: peerApplication.pdfHash, skipEmbedding: true,
  });
  check("aynı yarışmadaki başvuru havuzla karşılaştırıldı",
    peerSimilarity.status === 200 && peerSimilarity.json?.similarity?.comparedCount === 1,
    JSON.stringify(peerSimilarity.json?.similarity));
  check("doğrudan kopya MinHash tarafından yakalandı (yüksek seviye)",
    peerSimilarity.json?.similarity?.level === "high", peerSimilarity.json?.similarity?.level);
  check("yaklaşık oran içerik kapsamasına göre yüksek",
    (peerSimilarity.json?.similarity?.approxPercent ?? 0) >= 55,
    `%${peerSimilarity.json?.similarity?.approxPercent}`);
  check("en yakın rapor etiketi hakeme gösteriliyor",
    typeof peerSimilarity.json?.similarity?.closestLabel === "string" && peerSimilarity.json.similarity.closestLabel.length > 0);
  check("en fazla üç eşleşme, sayfa ve alıntıyla listeleniyor",
    (peerSimilarity.json?.similarity?.matches ?? []).length >= 1
    && (peerSimilarity.json?.similarity?.matches ?? []).length <= 3
    && (peerSimilarity.json?.similarity?.matches ?? []).every((match) =>
      typeof match.ownQuote === "string" && match.ownQuote.length > 0
      && typeof match.peerQuote === "string" && match.peerQuote.length > 0
      && typeof match.ownPage === "number" && typeof match.peerPage === "number"));
  check("embedding atlandığında yöntem minhash-only olarak işaretli",
    peerSimilarity.json?.similarity?.method === "minhash-only");
  check("benzerlik sonucu otomatik ret/intihal kararı vermiyor",
    /otomatik (ihlal|intihal)/.test(peerSimilarity.json?.similarity?.note ?? ""), peerSimilarity.json?.similarity?.note);

  // FARKLI yarışmadaki benzer metin karşılaştırmaya GİRMEZ (madde 9.2).
  const otherCompetitionApplication = applications.find((item) => item.competition !== target.competition);
  const otherJudgeClient = clients.judges.find((item) => item.account.id === otherCompetitionApplication.application.assignedJudgeId);
  const crossSimilarity = await post(otherJudgeClient.client, `/api/applications/${otherCompetitionApplication.application.id}/similarity`, {
    pages: similarityPagesA, pdfHash: otherCompetitionApplication.pdfHash, skipEmbedding: true,
  });
  check("farklı yarışmanın raporu aynı metne rağmen karşılaştırılmıyor",
    crossSimilarity.status === 200 && crossSimilarity.json?.similarity?.comparedCount === 0,
    JSON.stringify(crossSimilarity.json?.similarity));

  /* ---------------------------------------------------------------- 9 */
  section("9 · Kriter güncellenince eski analiz kullanılamıyor (madde 2)");
  const updated = profilePayload(target.competition.name, target.competition.prefix, target.competition.profileId);
  updated.criteria = [...criteriaSet(target.competition.prefix), {
    id: "criterion-5", name: "Termal analiz", stage: "criteria_evidence", required: false,
    description: "Raporda termal analiz sonuçları bulunmalıdır.", violationOutcome: "Revizyon istenir.",
    sourcePage: 9, sourceText: "Termal analiz sonuçları raporda verilir.",
    verifiability: "PDF_DENETLENEBILIR", active: true, origin: "document",
  }];
  const republished = await post(target.competition.manager.client, "/api/profiles", { profile: updated });
  check("kriterler v2 olarak yeniden yayımlandı",
    republished.json?.criteriaVersion?.criteriaVersion === 2 && republished.json?.versionCreated === true,
    JSON.stringify(republished.json?.criteriaVersion));

  const afterUpdate = await get(targetJudge.client, `/api/applications/${target.application.id}`);
  check("eski analiz artık ESKİMİŞ işaretli", afterUpdate.json?.application?.criteriaOutdated === true);
  check("ekranda yürürlükteki sürüm görünüyor", afterUpdate.json?.application?.currentCriteriaVersion === 2);

  const staleDecision = await patch(targetJudge.client, `/api/applications/${target.application.id}`, {
    action: "save_review",
    review: {
      status: "completed", outcome: "accepted", outcomeNote: "Uygun bulundu.",
      decisions: [], overallNote: "",
      finalFeedback: { strengths: [], improvements: [], suggestions: [] },
      feedbackApproved: true, completedAt: new Date().toISOString(),
    },
  });
  check("eskimiş analizle nihai karar verilemiyor", staleDecision.status === 409, `HTTP ${staleDecision.status}`);
  check("hata 'yeniden analiz gerekli' diyor", /yeniden analiz gerekli/i.test(staleDecision.json?.error ?? ""), staleDecision.json?.error);

  /* --------------------------------------------------------------- 10 */
  section("10 · Kriter bazlı hakem kararları ve ONAY görünürlüğü (maddeler 3, 4, 9)");
  // Kriterleri değişmemiş bir başvuruda hakem kararı verilir.
  const clean = applications.find((item) => item.competition !== target.competition);
  const cleanJudge = clients.judges.find((item) => item.account.id === clean.application.assignedJudgeId);
  await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, { action: "start_analysis" });
  const cleanVersion = clean.competition.version;
  const cleanPdfCriteria = criteriaSet(clean.competition.prefix)
    .filter((criterion) => criterion.verifiability === "PDF_DENETLENEBILIR");
  const cleanEvaluation = {
    version: "2.0",
    profileRef: {
      profileId: clean.competition.profileId, competition: clean.competition.name, year: "2026",
      stage: "Kritik Tasarım", reportType: "Kritik Tasarım Raporu",
      criteriaVersion: cleanVersion.criteriaVersion, criteriaHash: cleanVersion.criteriaHash,
    },
    report: { name: "rapor.pdf", pages: 1, sizeBytes: 1000, pdfHash: clean.pdfHash },
    preChecks: [],
    stages: ["language_template", "headings_content", "category_similarity", "criteria_evidence"].map((stage) => ({
      stage, verdict: "BASARILI", summary: "Kontrol edildi.", evidence: [],
    })),
    // AI son kriteri OLUMSUZ buldu; hakem buna rağmen bağımsız karar verecek.
    findings: cleanPdfCriteria.map((criterion, index) => ({
      criterionId: criterion.id, criterionName: criterion.name, stage: criterion.stage,
      required: criterion.required, verifiability: criterion.verifiability,
      verdict: index === cleanPdfCriteria.length - 1 ? "KRITIK_HATA" : "BASARILI",
      rationale: "Senaryo sonucu.", evidence: [], evidenceMissing: false,
    })),
    summary: { total: 3, basarili: 2, revizyon: 0, kritikHata: 1, disiKanit: 0, overall: "KRITIK_HATA" },
    feedbackDraft: { strengths: [], improvements: [], suggestions: [] },
    analysisWarnings: [], provider: "api", model: "senaryo", analyzedAt: new Date().toISOString(),
  };
  const cleanSaved = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_evaluation", evaluation: cleanEvaluation,
  });
  check("temiz başvurunun analizi kaydedildi", cleanSaved.status === 200, JSON.stringify(cleanSaved.json?.error));

  /**
   * Hakem AI BULGUSU doğrulaması üretici. Onayla/Ret bulgunun kabulüdür:
   * approved → kesin sonuç AI sonucu · rejected → hakemin judgeResult'u.
   */
  const criterionDecision = (criterion, judgeVerdict, extra = {}) => ({
    criterionId: criterion.id,
    criterionName: criterion.name,
    aiVerdict: criterion.id === cleanPdfCriteria[cleanPdfCriteria.length - 1].id ? "OLUMSUZ" : "UYGUN",
    judgeVerdict,
    judgeResult: null,
    rejectionReason: "", evidenceMode: null, evidencePage: null,
    evidenceSection: "", evidenceQuote: "", missingContent: "",
    decidedBy: null, decidedAt: null,
    ...extra,
  });
  const reviewEnvelope = (overrides = {}) => ({
    status: "completed", outcome: "accepted", outcomeNote: "Rapor incelendi.",
    decisions: [], overallNote: "",
    finalFeedback: { strengths: ["✓ Rapor dili Türkçe"], improvements: [], suggestions: [] },
    feedbackApproved: true, completedAt: new Date().toISOString(),
    ...overrides,
  });

  // 10a · Kararsız kriter varken genel karar verilemez (sunucu doğrular).
  const withPending = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_review",
    review: reviewEnvelope({
      criterionDecisions: [
        criterionDecision(cleanPdfCriteria[0], "approved"),
        criterionDecision(cleanPdfCriteria[1], "approved"),
        criterionDecision(cleanPdfCriteria[2], "pending"),
      ],
    }),
  });
  check("bütün kriterler sonuçlanmadan genel karar reddediliyor", withPending.status === 409, `HTTP ${withPending.status}`);
  check("hata bekleyen kriteri söylüyor", /karar bekliyor/i.test(withPending.json?.error ?? ""), withPending.json?.error);

  // 10b · Kriter kararları olmadan (eski biçim) genel karar da reddedilir.
  const withoutDecisions = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_review", review: reviewEnvelope(),
  });
  check("kriter kararları olmadan genel karar verilemiyor", withoutDecisions.status === 409, `HTTP ${withoutDecisions.status}`);

  // 10c · Bulgu reddi hakem sonucu + gerekçe ister; PDF konumlu değerlendirme sayfa/alıntı ister.
  const rejectNoJudgeResult = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_review",
    review: reviewEnvelope({
      criterionDecisions: [
        criterionDecision(cleanPdfCriteria[0], "approved"),
        criterionDecision(cleanPdfCriteria[1], "approved"),
        criterionDecision(cleanPdfCriteria[2], "rejected", { rejectionReason: "AI bulgusu hatalı." }),
      ],
    }),
  });
  check("bulgu reddinde hakemin kendi sonucu (UYGUN/OLUMSUZ) zorunlu",
    rejectNoJudgeResult.status === 409 && /kendi sonucu/.test(rejectNoJudgeResult.json?.error ?? ""),
    `HTTP ${rejectNoJudgeResult.status} · ${rejectNoJudgeResult.json?.error}`);
  const rejectNoReason = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_review",
    review: reviewEnvelope({
      criterionDecisions: [
        criterionDecision(cleanPdfCriteria[0], "approved"),
        criterionDecision(cleanPdfCriteria[1], "approved"),
        criterionDecision(cleanPdfCriteria[2], "rejected", { judgeResult: "OLUMSUZ" }),
      ],
    }),
  });
  check("gerekçesiz hakem değerlendirmesi reddediliyor", rejectNoReason.status === 409, `HTTP ${rejectNoReason.status}`);
  const rejectNoPage = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_review",
    review: reviewEnvelope({
      criterionDecisions: [
        criterionDecision(cleanPdfCriteria[0], "approved"),
        criterionDecision(cleanPdfCriteria[1], "approved"),
        criterionDecision(cleanPdfCriteria[2], "rejected", {
          judgeResult: "OLUMSUZ", rejectionReason: "Sınır aşılmış.", evidenceMode: "PDF_KONUMU",
        }),
      ],
    }),
  });
  check("PDF konumlu değerlendirme sayfa/alıntı olmadan kaydedilemiyor", rejectNoPage.status === 409, `HTTP ${rejectNoPage.status}`);
  const rejectMissingContentOk = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_review",
    review: reviewEnvelope({
      status: "in_progress", outcome: "pending", outcomeNote: "",
      criterionDecisions: [
        criterionDecision(cleanPdfCriteria[0], "approved"),
        criterionDecision(cleanPdfCriteria[1], "pending"),
        criterionDecision(cleanPdfCriteria[2], "rejected", {
          judgeResult: "OLUMSUZ", rejectionReason: "Zorunlu bölüm raporda yok.",
          evidenceMode: "RAPORDA_BULUNAMADI", missingContent: "Yapısal analiz sonuçları bölümü",
        }),
      ],
    }),
  });
  check("'Raporda bulunamadı' kararı sahte sayfa istemeden kaydedilebiliyor (taslak)",
    rejectMissingContentOk.status === 200, JSON.stringify(rejectMissingContentOk.json?.error));

  /*
   * 10d · AI son kriteri OLUMSUZ bulmuştu. Hakem BULGUYU reddeder ve kendi
   * değerlendirmesiyle UYGUN yazar → kesin sonuç UYGUN olur (AI bulgusu
   * kesin sonuç olarak KULLANILMAZ). Diğer iki bulgu onaylanır (AI UYGUN).
   */
  const approved = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "save_review",
    review: reviewEnvelope({
      outcomeNote: "Rapor kriterlere uygun bulundu.",
      criterionDecisions: [
        criterionDecision(cleanPdfCriteria[0], "approved"),
        criterionDecision(cleanPdfCriteria[1], "approved"),
        criterionDecision(cleanPdfCriteria[2], "rejected", {
          judgeResult: "UYGUN",
          rejectionReason: "AI yanlış bölüme bakmış; gereksinim raporda karşılanıyor.",
          evidenceMode: "PDF_KONUMU", evidencePage: 1,
          evidenceSection: "Yapısal analiz", evidenceQuote: "Yapisal analiz sonuclari",
        }),
      ],
      finalFeedback: {
        strengths: cleanPdfCriteria.map((criterion) => `✓ ${criterion.name}`),
        improvements: [], suggestions: [],
      },
    }),
  });
  check("hakem ONAY kararını kaydetti", approved.status === 200, JSON.stringify(approved.json?.error));
  const savedDecisions = approved.json?.application?.review?.criterionDecisions ?? [];
  const effectiveOf = (decision) => decision.judgeVerdict === "approved" ? decision.aiVerdict
    : decision.judgeVerdict === "rejected" ? decision.judgeResult : null;
  check("bulgu doğrulamaları AI sonucundan ayrı saklandı",
    savedDecisions.length === 3
    && savedDecisions.filter((decision) => decision.judgeVerdict === "approved").length === 2
    && savedDecisions.filter((decision) => decision.judgeVerdict === "rejected").length === 1);
  check("reddedilen AI bulgusu kesin sonuç olarak KULLANILMADI (hakem sonucu geçti)",
    savedDecisions.every((decision) => effectiveOf(decision) === "UYGUN"),
    JSON.stringify(savedDecisions.map(effectiveOf)));
  check("AI'nin olumsuz bulgusu denetim için korunuyor",
    savedDecisions.some((decision) => decision.aiVerdict === "OLUMSUZ"));
  check("karar damgası sunucuda atıldı (decidedBy/decidedAt)",
    savedDecisions.every((decision) => decision.decidedBy === cleanJudge.account.id && Boolean(decision.decidedAt)));

  const participantView = await get(clean.participant.client, "/api/applications");
  const seen = (participantView.json?.applications ?? []).find((item) => item.id === clean.application.id);
  check("katılımcı ONAY sonucunu görüyor", seen?.outcome === "accepted", `outcome=${seen?.outcome}`);
  check("katılımcı durumu 'tamamlandı'", seen?.status === "completed");
  check("katılımcı karar tarihini görüyor", Boolean(seen?.decidedAt));
  check("katılımcı hakem notunu görüyor", (seen?.outcomeNote ?? "").includes("uygun bulundu"));
  check("katılımcı geri bildirim kartlarını görüyor", seen?.review?.feedbackApproved === true);
  check("katılımcı yarışma ve takım bilgisini görüyor", Boolean(seen?.competitionName) && Boolean(seen?.teamName));

  const otherParticipant = participants.find((item) => item.account.id !== clean.participant.account.id);
  const otherView = await get(otherParticipant.client, "/api/applications");
  check("katılımcı başkasının başvurusunu görmüyor",
    !(otherView.json?.applications ?? []).some((item) => item.id === clean.application.id));

  /* --------------------------------------------------------------- 11 */
  section("11 · Pasif yarışma (madde 6)");
  const passive = competitions[2];
  const passiveResult = await patch(passive.manager.client, "/api/competitions", {
    action: "activation", competitionId: null, active: false,
  });
  check("yarışma kimliği olmadan istek reddediliyor", passiveResult.status === 400);

  const competitionList = await get(passive.manager.client, "/api/competitions");
  const passiveRow = (competitionList.json?.competitions ?? []).find((item) => item.competitionName === passive.name);
  check("yarışma kaydı bulundu", Boolean(passiveRow));

  const deactivate = await patch(passive.manager.client, "/api/competitions", {
    action: "activation", competitionId: passiveRow.id, active: false, note: "Sezon kapandı",
  });
  check("Yarışma Yöneticisi yarışmayı pasife alabiliyor",
    deactivate.status === 200 && deactivate.json?.competition?.isActive === false, JSON.stringify(deactivate.json?.error));

  const listAfter = await get(participants[0].client, "/api/applications");
  const namesAfter = (listAfter.json?.openCompetitions ?? []).map((item) => item.name);
  check("pasif yarışma katılımcının listesinde görünmüyor", !namesAfter.includes(passive.name), JSON.stringify(namesAfter));

  const blocked = await uploadApplication(participants[0].client, passive.name, `Takım Pasif Deneme ${RUN}`, "orta");
  check("pasif yarışmaya yeni başvuru yapılamıyor", blocked.status === 409, `HTTP ${blocked.status}`);

  const passiveApplication = applications.find((item) => item.competition === passive);
  const passiveJudge = clients.judges.find((item) => item.account.id === passiveApplication.application.assignedJudgeId);
  const historyView = await get(passiveJudge.client, `/api/applications/${passiveApplication.application.id}`);
  check("hakem pasif yarışmanın geçmiş başvurusunu görebiliyor", historyView.status === 200);

  const reactivate = await patch(operations.client, "/api/competitions", {
    action: "activation", competitionId: passiveRow.id, active: true, note: "Yeniden açıldı",
  });
  check("Değerlendirme Yöneticisi de aktif/pasif yapabiliyor",
    reactivate.status === 200 && reactivate.json?.competition?.isActive === true, JSON.stringify(reactivate.json?.error));
  const reopened = await get(participants[0].client, "/api/applications");
  check("aktifleştirilen yarışma listeye geri döndü",
    (reopened.json?.openCompetitions ?? []).some((item) => item.name === passive.name));

  /* --------------------------------------------------------------- 12 */
  section("12 · Arşivleme ve denetim görünürlüğü (maddeler 8, 11)");
  const archiveTargetApplication = applications.find(
    (item) => item.competition === competitions[1] && item.application.id !== clean.application.id,
  );
  const archiveJudge = clients.judges.find((item) => item.account.id === archiveTargetApplication.application.assignedJudgeId);

  const noReason = await patch(archiveJudge.client, `/api/applications/${archiveTargetApplication.application.id}`, {
    action: "archive_application", note: "",
  });
  check("gerekçesiz arşivleme reddediliyor", noReason.status === 400);

  const archived = await patch(archiveJudge.client, `/api/applications/${archiveTargetApplication.application.id}`, {
    action: "archive_application", note: "Yanlış yarışmaya gönderilmiş başvuru",
  });
  check("hakem başvuruyu aktif listesinden kaldırabiliyor", archived.status === 200, JSON.stringify(archived.json?.error));

  const judgeList = await get(archiveJudge.client, "/api/applications");
  check("arşivlenen başvuru hakemin listesinde görünmüyor",
    !(judgeList.json?.applications ?? []).some((item) => item.id === archiveTargetApplication.application.id));

  const participantStillSees = await get(archiveTargetApplication.participant.client, "/api/applications");
  check("katılımcı kendi başvurusunu görmeye devam ediyor (fiziksel silme yok)",
    (participantStillSees.json?.applications ?? []).some((item) => item.id === archiveTargetApplication.application.id));

  const archiveCompetition = competitions[1];
  const competitionRow = (await get(archiveCompetition.manager.client, "/api/competitions")).json?.competitions
    ?.find((item) => item.competitionName === archiveCompetition.name);
  const archivedCompetition = await patch(archiveCompetition.manager.client, "/api/competitions", {
    action: "archive", competitionId: competitionRow.id, archived: true, reason: "Sezon tamamlandı",
  });
  check("Yarışma Yöneticisi yarışmayı arşivleyebiliyor",
    archivedCompetition.status === 200 && Boolean(archivedCompetition.json?.competition?.archivedAt),
    JSON.stringify(archivedCompetition.json?.error));

  const foreignArchive = await patch(clients.managers[0].client, "/api/competitions", {
    action: "archive", competitionId: competitionRow.id, archived: true, reason: "Deneme",
  });
  check("başka yöneticinin yarışması arşivlenemiyor", foreignArchive.status === 403, `HTTP ${foreignArchive.status}`);

  const judgeArchiveAttempt = await patch(judge.client, "/api/competitions", {
    action: "archive", competitionId: competitionRow.id, archived: true, reason: "Deneme",
  });
  check("hakem yarışma arşivleyemiyor", judgeArchiveAttempt.status === 403);

  const opsView = await get(operations.client, "/api/operations");
  const trail = opsView.json?.archiveTrail ?? [];
  check("Değerlendirme Yöneticisi arşiv kaydını görüyor", trail.length >= 2, `kayıt: ${trail.length}`);
  const applicationTrail = trail.find((item) => item.kind === "application");
  check("kaldıran kişi kayıtta", Boolean(applicationTrail?.actorName));
  check("işlem tarihi kayıtta", Boolean(applicationTrail?.at));
  check("gerekçe kayıtta", (applicationTrail?.reason ?? "").includes("Yanlış yarışmaya"));
  check("önceki ve yeni durum kayıtta", Boolean(applicationTrail?.previousStatus) && Boolean(applicationTrail?.nextStatus));
  const competitionTrail = trail.find((item) => item.kind === "competition");
  check("yarışma arşivi de kayıtta", (competitionTrail?.reason ?? "").includes("Sezon tamamlandı"));

  const overview = opsView.json?.overview ?? [];
  const overviewRow = overview.find((item) => item.competitionName === competitions[0].name);
  check("operasyon panosu analiz sayaçlarını gösteriyor",
    typeof overviewRow?.analysisCompleted === "number" && typeof overviewRow?.analysisPending === "number");
  check("operasyon panosu aktif/pasif durumunu gösteriyor", typeof overviewRow?.isActive === "boolean");
  // Aynı veri tabanında birden çok koşu olabilir; bu koşunun hakemleri listede
  // bulunmalı ve her birinin yük sayacı hesaplanmış olmalıdır.
  const workloads = opsView.json?.judges ?? [];
  const runJudgeIds = new Set(clients.judges.map((item) => item.account.id));
  const runWorkloads = workloads.filter((item) => runJudgeIds.has(item.judgeId));
  check("operasyon panosu hakem iş yükünü gösteriyor",
    runWorkloads.length === 3 && runWorkloads.every((item) => typeof item.active === "number"),
    `listelenen: ${runWorkloads.length}/${workloads.length}`);

  /* --------------------------------------------------------------- 13 */
  section("13 · Manuel atama kapalı; AI analizi silme ve kararı yeniden açma (maddeler 5, 7)");
  // Manuel `assign_judge` çağrısı HANGİ rolden gelirse gelsin reddedilir.
  const manualAssign = await patch(operations.client, `/api/applications/${target.application.id}`, {
    action: "assign_judge", judgeId: clients.judges[0].account.id, note: "elle atama denemesi",
  });
  check("manuel assign_judge çağrısı reddediliyor", manualAssign.status === 403, `HTTP ${manualAssign.status}`);
  check("ret mesajı otomatik atamayı anlatıyor", /Manuel hakem atama kaldırıldı/.test(manualAssign.json?.error ?? ""));

  // Tamamlanmış karar yeniden açılmadan analiz silinemez (sunucu doğrular).
  const deleteWhileCompleted = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, {
    action: "delete_analysis",
  });
  check("kesinleşmiş kararda analiz silinemiyor", deleteWhileCompleted.status === 409, `HTTP ${deleteWhileCompleted.status}`);
  check("hata 'Kararı yeniden aç' diyor", /Kararı yeniden aç/.test(deleteWhileCompleted.json?.error ?? ""));

  // Başka hakem, başkasının analizini silemez (görünürlük 404 üretir).
  const foreignDelete = await patch(
    clients.judges.find((item) => item.account.id !== clean.application.assignedJudgeId).client,
    `/api/applications/${clean.application.id}`,
    { action: "delete_analysis" },
  );
  check("başka hakemin analizi silinemiyor", foreignDelete.status === 404 || foreignDelete.status === 403, `HTTP ${foreignDelete.status}`);

  // Kararı yeniden aç → sonuç yarışmacıya kapanır → analiz silinebilir.
  const reviewReopened = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, { action: "reopen_review" });
  check("hakem kesinleşmiş kararı yeniden açabiliyor", reviewReopened.status === 200, JSON.stringify(reviewReopened.json?.error));
  check("yeniden açılan başvuru hakem incelemesine döndü",
    reviewReopened.json?.application?.status === "judge_in_review", reviewReopened.json?.application?.status);
  const participantAfterReopen = await get(clean.participant.client, "/api/applications");
  const reopenedSeen = (participantAfterReopen.json?.applications ?? []).find((item) => item.id === clean.application.id);
  check("yeniden açılan karar yarışmacıya kapandı", reopenedSeen?.outcome === "pending", `outcome=${reopenedSeen?.outcome}`);

  const deleted = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, { action: "delete_analysis" });
  check("hakem kendi başvurusunun AI analizini silebiliyor", deleted.status === 200, JSON.stringify(deleted.json?.error));
  check("analiz sonucu kaldırıldı", deleted.json?.application?.evaluation === null);
  check("başvuru yeniden AI analizi bekliyor",
    deleted.json?.application?.status === "assigned", deleted.json?.application?.status);
  check("hakem ataması silinmedi",
    deleted.json?.application?.assignedJudgeId === clean.application.assignedJudgeId);
  const fileAfterDelete = await fetch(`${BASE}/api/applications/${clean.application.id}/file`, {
    headers: { cookie: cleanJudge.client.cookie },
  });
  check("katılımcı PDF'i silinmedi", fileAfterDelete.status === 200);
  const participantAfterDelete = await get(clean.participant.client, "/api/applications");
  check("katılımcı başvurusu silinmedi",
    (participantAfterDelete.json?.applications ?? []).some((item) => item.id === clean.application.id));
  const restart = await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, { action: "start_analysis" });
  check("analiz silindikten sonra yeniden çalıştırılabiliyor", restart.status === 200, JSON.stringify(restart.json?.error));
  // Senaryo verisini kararlı bırak: analiz 'başarısız' olarak kapatılır.
  await patch(cleanJudge.client, `/api/applications/${clean.application.id}`, { action: "analysis_failed" });

  // Değerlendirme Yöneticisi silme olayını süreç geçmişinde ve denetimde görür.
  const opsAfterDelete = await get(operations.client, "/api/operations");
  check("silme olayı süreç geçmişinde görünüyor",
    (opsAfterDelete.json?.recent ?? []).some((entry) => entry.event === "ai_analysis_deleted"));
  check("silme işlemi denetim izinde (kim/ne zaman) görünüyor",
    (opsAfterDelete.json?.audit ?? []).some((entry) => entry.action === "ai_analysis_deleted" && Boolean(entry.actorEmail)));

  /* ------------------------------------------------------------------- */
  section("SONUÇ");
  console.log(`  Geçen kontrol: ${passed}`);
  console.log(`  Başarısız    : ${failures.length}`);
  if (failures.length) {
    console.log("\nBaşarısız kontroller:");
    for (const item of failures) console.log(`  - ${item}`);
    process.exit(1);
  }
  console.log("\nUçtan uca senaryo: PASS");
}

main().catch((error) => {
  console.error("\nSenaryo çalıştırılamadı:", error);
  process.exit(1);
});
