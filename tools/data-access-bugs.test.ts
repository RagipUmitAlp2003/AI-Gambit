import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PERMISSIONS } from "../app/lib/authorization.ts";

/**
 * GÖREV 3 · §11 — Kalan doğrulanmış veri ve erişim buglarının regresyon testleri.
 *
 * Kurallar SQL/rota/bileşen kaynağında durduğu için (arayüzde düğme gizlemek
 * yetki değildir) doğrulama, yerleşik idiome uygun olarak kaynak metin
 * üzerinden yapılır (bkz. tools/authorization.test.ts).
 */

const TIMELINE_ROUTE = readFileSync("app/api/timeline/route.ts", "utf8");
const PROFILES_ROUTE = readFileSync("app/api/profiles/route.ts", "utf8");
const PROFILE_FILE_ROUTE = readFileSync("app/api/profiles/[id]/file/route.ts", "utf8");
const APPLICATIONS_ROUTE = readFileSync("app/api/applications/route.ts", "utf8");
const WORKFLOW_DB = readFileSync("app/lib/workflow-db.ts", "utf8");
const WORKFLOW_CLIENT = readFileSync("app/lib/workflow-client.ts", "utf8");
const OPERATIONS_PANEL = readFileSync("app/components/operations-panel.tsx", "utf8");
const STAGE_PANEL = readFileSync("app/components/competition-stage-panel.tsx", "utf8");
const ACCOUNTS_PANEL = readFileSync("app/components/admin-accounts-panel.tsx", "utf8");
const ACCOUNT_ROUTE = readFileSync("app/api/admin/accounts/[id]/route.ts", "utf8");

/* --------------------------------------------------------------------- *
 * §11 · Zaman çizelgesi — taslak profil 02/04 rollerine görünmez
 * --------------------------------------------------------------------- */

const DRAFT_GUARD = '["02", "04"].includes(auth.account.roleCode) && profile.status !== "approved"';

test("zaman çizelgesi taslak profil korumasi kardeş uçlarla aynıdır", () => {
  assert.ok(
    TIMELINE_ROUTE.includes(DRAFT_GUARD),
    "Timeline profil dalı 02/04 için yalnızca onaylı profile izin vermelidir.",
  );
  assert.ok(
    !/roleCode === "03"/.test(TIMELINE_ROUTE),
    "Ölü 03 koruması kaldırılmış olmalıdır: 03 read_timeline iznine zaten sahip değildir.",
  );
  // Sürüklenme koruması: kardeş uçlar aynı korumayı kullanmaya devam etmelidir.
  assert.ok(PROFILES_ROUTE.includes(DRAFT_GUARD), "profiles ucu aynı taslak korumasını taşımalıdır.");
  assert.ok(PROFILE_FILE_ROUTE.includes(DRAFT_GUARD), "profil dosya ucu aynı taslak korumasını taşımalıdır.");
});

test("read_timeline izni 01/02/04 rollerinindir; 03 listede yoktur", () => {
  assert.deepEqual([...PERMISSIONS.read_timeline].sort(), ["01", "02", "04"]);
  assert.ok(!(PERMISSIONS.read_timeline as readonly string[]).includes("03"));
});

/* --------------------------------------------------------------------- *
 * §11 · Aynı adlı yarışmalar — kararlı kimlik, tek satırdan çözüm
 * --------------------------------------------------------------------- */

test("başvuru POST'u profili bağımsız ad sorgusuyla seçmez", () => {
  assert.ok(
    !APPLICATIONS_ROUTE.includes("findLatestProfileForCompetition("),
    "POST profili artık ada göre değil, seçilen yarışma satırından çözmelidir.",
  );
  assert.ok(
    !APPLICATIONS_ROUTE.includes("competitionAcceptsApplications("),
    "Kabul kararı da aynı tek satırdan verilmelidir; bağımsız ad sorgusu kalktı.",
  );
  // Profil, kabul kararını veren satırın kendi yayımlanmış profilidir.
  assert.match(
    APPLICATIONS_ROUTE,
    /findApprovedProfile\(workflow\.currentProfileId\)/,
    "Profil, yarışma satırının currentProfileId alanından okunmalıdır.",
  );
  // İstemcinin gönderdiği kararlı kimlik kabul edilir.
  assert.match(
    APPLICATIONS_ROUTE,
    /form\.get\("competitionId"\)/,
    "POST kararlı yarışma kimliğini formdan okumalıdır.",
  );
  assert.match(
    APPLICATIONS_ROUTE,
    /findCompetitionWorkflowById\(competitionId\)/,
    "Kimlik verildiyse yarışma satırı kimlikle bulunmalıdır.",
  );
  // Anahtar tutarlılığı: satır ile profil ayrışırsa başvuru reddedilir.
  assert.match(
    APPLICATIONS_ROUTE,
    /profile\.competitionKey !== workflow\.competitionKey/,
    "Yarışma satırı ile profil anahtarı eşleşmezse başvuru alınmamalıdır.",
  );
});

test("açık yarışma listesi kararlı kimlik taşır", () => {
  const openList = WORKFLOW_DB.slice(WORKFLOW_DB.indexOf("export async function listOpenCompetitions"));
  const openBody = openList.slice(0, openList.indexOf("\nexport "));
  assert.match(openBody, /SELECT c\.id, c\.competition_name/, "Sorgu yarışma kimliğini seçmelidir.");
  assert.match(openBody, /id: row\.id/, "Liste kayıtları kararlı kimliği taşımalıdır.");
  // Belirlenimci ikincil sıralama: ad başına hep aynı satır seçilir.
  assert.match(openBody, /ORDER BY c\.competition_name, c\.updated_at DESC/);
});

test("findLatestProfileForCompetitionKey anahtara göre onaylı profil arar", () => {
  const fn = WORKFLOW_DB.slice(WORKFLOW_DB.indexOf("export async function findLatestProfileForCompetitionKey"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  assert.match(body, /WHERE competition_key = \? AND status = 'approved'/);
  assert.match(body, /ORDER BY updated_at DESC LIMIT 1/);
});

test("markApplicationAnalyzing profil düşüşü ada değil competition_key'e bakar", () => {
  const fn = WORKFLOW_DB.slice(WORKFLOW_DB.indexOf("export async function markApplicationAnalyzing"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(
    body,
    /findLatestProfileForCompetitionKey\(current\.competition_key\)/,
    "Düşüş, başvurunun kendi competition_key değerini kullanmalıdır.",
  );
  assert.ok(
    !body.includes("findLatestProfileForCompetition(current.competition_name)"),
    "Ada göre düşüş aynı adlı yarışmaları karıştırabildiği için kaldırılmıştır.",
  );
});

test("istemci kararlı yarışma kimliğini gönderebilir", () => {
  assert.match(WORKFLOW_CLIENT, /competitionId\?: string/, "submitApplication kimliği kabul etmelidir.");
  assert.match(
    WORKFLOW_CLIENT,
    /if \(input\.competitionId\) form\.set\("competitionId", input\.competitionId\)/,
  );
});

/* --------------------------------------------------------------------- *
 * §11 · Operasyon paneli yarış durumları
 * --------------------------------------------------------------------- */

test("operasyon paneli işlem bazlı meşgul durumu kullanır", () => {
  assert.ok(
    !/const \[busyId, setBusyId\]/.test(OPERATIONS_PANEL),
    "Tek busyId farklı işlemleri birbirine karıştırıyordu; kaldırılmalıdır.",
  );
  for (const field of ["busyApplicationId", "busyPriorityId", "busyActiveId"]) {
    assert.ok(OPERATIONS_PANEL.includes(field), `${field} işlem bazlı meşgul alanı bulunmalıdır.`);
  }
});

test("operasyon panelinde eski yanıt yeni durumu ezmez (loadSeq koruması)", () => {
  assert.match(OPERATIONS_PANEL, /const loadSeq = useRef\(0\);/);
  assert.match(OPERATIONS_PANEL, /const seq = \+\+loadSeq\.current;/);
  assert.match(OPERATIONS_PANEL, /if \(seq !== loadSeq\.current\) return;/);
  // Bileşen kapanınca bekleyen yanıtlar state yazamaz.
  assert.match(OPERATIONS_PANEL, /return \(\) => \{ loadSeq\.current \+= 1; \};/);
});

test("pasifleştirme notu öncelik gerekçesinden ayrı state alanındadır", () => {
  assert.match(OPERATIONS_PANEL, /const \[deactivationNote, setDeactivationNote\] = useState<Record<string, string>>\(\{\}\);/);
  const toggle = OPERATIONS_PANEL.slice(OPERATIONS_PANEL.indexOf("async function toggleActive"));
  const toggleBody = toggle.slice(0, toggle.indexOf("\n  }") + 4);
  assert.ok(
    !toggleBody.includes("priorityNote["),
    "toggleActive öncelik gerekçesini pasifleştirme notu olarak GÖNDERMEMELİDİR.",
  );
  assert.match(toggleBody, /deactivationNote\[item\.competitionId\] \?\? ""/);
  // İşlem bazlı hata alanı: hata yalnızca ilgili kayıtla eşleşerek gösterilir.
  assert.match(OPERATIONS_PANEL, /const \[actionError, setActionError\] = useState<\{ id: string; message: string \} \| null>\(null\);/);
});

/* --------------------------------------------------------------------- *
 * §11 · Boş yarışma paneli
 * --------------------------------------------------------------------- */

test("yarışma paneli hata bandından önce return null yapmaz", () => {
  assert.ok(
    !STAGE_PANEL.includes("if (!competitions.length) return null;"),
    "Boş liste, hata bandını ve boş durumu gizleyen erken dönüşe yol açmamalıdır.",
  );
  assert.match(STAGE_PANEL, /\{error \? <p className="admin-error" role="alert">\{error\}<\/p> : null\}/);
  assert.ok(
    STAGE_PANEL.includes("Henüz size ait bir yarışma bulunmuyor."),
    "Gerçekten boş liste için ayrı boş durum metni bulunmalıdır.",
  );
  assert.match(STAGE_PANEL, /\{!competitions\.length && !error \?/);
});

/* --------------------------------------------------------------------- *
 * §11 · Pasif hesabı yeniden etkinleştirme
 * --------------------------------------------------------------------- */

test("sunucu açık restore işlemini rolü koruyarak uygular", () => {
  assert.match(
    ACCOUNT_ROUTE,
    /body\.restore === true[\s\S]{0,400}restoreAccount\(id, current\.roleCode\)/,
    "restore:true dalı rolü VERİ TABANINDAKİ kayıttan almalıdır (istemciden değil).",
  );
  assert.match(ACCOUNT_ROUTE, /Hesap zaten aktif\./, "Aktif hesap için restore 409 dönmelidir.");
  // Mevcut rol değiştirme sözleşmesi bayt bayt korunur.
  assert.match(ACCOUNT_ROUTE, /const roleCode = assertRoleCode\(body\.roleCode\);/);
  assert.match(ACCOUNT_ROUTE, /Admin \(00\) hesabının rolü panelden değiştirilemez\./);
});

test("panel açık Etkinleştir düğmesi sunar (yalnız rol select'i değil)", () => {
  assert.match(
    ACCOUNTS_PANEL,
    /adminApi\.restoreAccount\(account\.id\)/,
    "Etkinleştir düğmesi restore ucunu çağırmalıdır.",
  );
  assert.match(ACCOUNTS_PANEL, />\s*Etkinleştir\s*<\/button>/, "Düğme metni Etkinleştir olmalıdır.");
  // Select ile rol değiştirerek geri alma yolu da korunur.
  assert.ok(ACCOUNTS_PANEL.includes("Rol seçimi hesabı yeniden aktifleştirir."));
});
