/**
 * Analitik ucu yetki/gizlilik sözleşmeleri ve frontend.md ekran özelliklerinin
 * korunduğunun kaynak üzerinden doğrulanması. Canlı sunucu veya D1 yoktur;
 * yetki matrisi saf işlevle, uygulama noktaları kaynak metniyle denetlenir.
 *
 *   10. Yetkisiz rol analitik API'ye erişemez (operations_dashboard = yalnızca 04).
 *   11. Analitik API isim, e-posta, PDF metni ve hakem gerekçesi döndürmez.
 *   12. frontend.md ile gelen üç arayüz özelliği korunur.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PERMISSIONS, can } from "../app/lib/authorization.ts";
import type { RoleCode } from "../app/lib/admin-types.ts";

const ANALYTICS_ROUTE = readFileSync("app/api/operations/analytics/route.ts", "utf8");
const WORKFLOW_DB = readFileSync("app/lib/workflow-db.ts", "utf8");
const APPLICATIONS_ROUTE = readFileSync("app/api/applications/route.ts", "utf8");
const OPERATIONS_PANEL = readFileSync("app/components/operations-panel.tsx", "utf8");
const ANALYTICS_PANEL = readFileSync("app/components/participation-analytics-panel.tsx", "utf8");
const ADMIN_PANEL = readFileSync("app/components/admin-accounts-panel.tsx", "utf8");
const COMPETITION_PICKER = readFileSync("app/components/competition-picker.tsx", "utf8");
const EVALUATION_APP = readFileSync("app/components/evaluation-app.tsx", "utf8");
const CRITERIA_APP = readFileSync("app/components/criteria-app.tsx", "utf8");
const GLOBALS_CSS = readFileSync("app/globals.css", "utf8");
const EVALUATION_CSS = readFileSync("app/evaluation.css", "utf8");
const PARTICIPANT_PORTAL = readFileSync("app/components/participant-portal.tsx", "utf8");
const ACCESS_LOGIN = readFileSync("app/components/access-login.tsx", "utf8");

/* --------------------------------------------------------------------- *
 * 10 · Yetki
 * --------------------------------------------------------------------- */

test("analitik ucu sunucuda operations_dashboard izniyle korunur; yalnızca 04 erişir", () => {
  assert.match(
    ANALYTICS_ROUTE,
    /const auth = await requirePermission\(request, "operations_dashboard"\);\s*\n\s*if \(!auth\.ok\) return auth\.response;/,
    "Analitik GET ucu ilk iş olarak yetki kontrolü yapmalı.",
  );
  assert.deepEqual([...PERMISSIONS.operations_dashboard], ["04"]);
  for (const role of ["00", "01", "02", "03"] as RoleCode[]) {
    assert.ok(!can({ roleCode: role }, "operations_dashboard"), `Rol ${role} analitik ucuna erişememeli.`);
  }
  assert.ok(can({ roleCode: "04" }, "operations_dashboard"));
  assert.ok(!can(null, "operations_dashboard"), "Oturumsuz istek reddedilmeli.");
});

test("analitik filtreleri sunucuda allowlist ile doğrulanır; bilinmeyen anahtar 400 döner", () => {
  assert.match(ANALYTICS_ROUTE, /parseAnalyticsFilters\(url\.searchParams\.entries\(\), knownFilterValues\(records\)\)/);
  assert.match(ANALYTICS_ROUTE, /if \(parsed\.invalid\.length\) \{\s*\n\s*return jsonError\(400/);
});

/* --------------------------------------------------------------------- *
 * 11 · Gizlilik
 * --------------------------------------------------------------------- */

test("analitik ham kayıt okuyucu isim, e-posta, dosya adı ve gerekçe sütunlarını okumaz", () => {
  const start = WORKFLOW_DB.indexOf("export async function listAnalyticsRecords");
  assert.ok(start > 0, "listAnalyticsRecords bulunmalı.");
  const body = WORKFLOW_DB.slice(start);
  const selects = [...body.matchAll(/`SELECT[\s\S]*?`/g)].map((match) => match[0]);
  assert.ok(selects.length >= 2, "Başvuru ve üye sorguları bulunmalı.");
  for (const query of selects) {
    for (const column of ["participant_name", "participant_email", "applicant_full_name", "full_name", "file_name", "file_key", "outcome_note", "team_name"]) {
      assert.ok(!query.includes(column), `Analitik sorgusu ${column} sütununu okumamalı.`);
    }
  }
  // Hakem kararlarından yalnızca sonuç/aşama alınır; gerekçe ve alıntı kopyalanmaz.
  const decisionsStart = WORKFLOW_DB.indexOf("function analyticsDecisionsOf");
  const decisionsBody = WORKFLOW_DB.slice(decisionsStart, start);
  for (const field of ["rejectionReason", "evidenceQuote", "rationale", "overallNote", "outcomeNote", "decidedBy"]) {
    assert.ok(!decisionsBody.includes(field), `Analitik karar özeti ${field} alanını taşımamalı.`);
  }
});

test("analitik yanıtı yalnızca toplulaştırılmış sonucu döndürür", () => {
  assert.match(ANALYTICS_ROUTE, /return json\(\{ analytics: buildParticipationAnalytics\(records, parsed\.filters\) \}\)/);
  assert.ok(!/\brecords\s*:|\{\s*records\b/.test(ANALYTICS_ROUTE), "Ham kayıt listesi yanıta konmamalı.");
});

/* --------------------------------------------------------------------- *
 * Veri modeli: hesap değil başvuru; değerlendirmeyi etkilemez
 * --------------------------------------------------------------------- */

test("demografik bilgiler hesap oluşturma ekranında sorulmaz; başvuru formunda toplanır", () => {
  assert.ok(!/TeamMembersEditor|educationLevel|teknofestHistory/.test(ACCESS_LOGIN), "Giriş/kayıt ekranı demografi sormamalı.");
  assert.match(PARTICIPANT_PORTAL, /<TeamMembersEditor/, "Ekip bilgileri başvuru formunda toplanmalı.");
  assert.match(APPLICATIONS_ROUTE, /readTeamProfile\(form, applicantFullName\)/);
  assert.match(APPLICATIONS_ROUTE, /legacyTeamProfile\(applicantFullName, readTeamMembers\(form\)\)/, "Eski istemci yolu korunmalı.");
  // Üye satırı başvuru kimliği + başvuru sahibi bayrağı + demografi alanlarıyla yazılır.
  assert.match(WORKFLOW_DB, /INSERT INTO application_team_members\s*\n\s*\(id, application_id, member_order, full_name, is_applicant, gender, education_level,\s*\n\s*grade_level, institution, city, teknofest_history\)/);
  assert.match(WORKFLOW_DB, /INSERT INTO application_submission_details\s*\n\s*\(application_id, applicant_full_name, team_name, outcome, outcome_note, discovery_source, team_size\)/,
    "Duyuru kaynağı başvuru düzeyinde saklanmalı.");
  // Hesap tablosuna demografi sütunu eklenmez.
  const adminDb = readFileSync("app/lib/admin-db.ts", "utf8");
  assert.ok(!/education_level|teknofest_history|discovery_source/.test(adminDb), "Demografi hesap tablosuna bağlanmamalı.");
});

test("demografi alanları AI değerlendirmesi, hakem kararı ve benzerlik motoruna girmez", () => {
  for (const file of [
    "app/lib/report-evaluator.ts", "app/lib/gemini-analyzer.ts", "app/lib/judge-review.ts",
    "app/lib/similarity-engine.ts", "app/lib/similarity-bulk-engine.ts", "app/api/evaluate-report/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/teamProfile|teknofestHistory|discoverySource|education_level/.test(source), `${file} demografi alanı okumamalı.`);
  }
});

/* --------------------------------------------------------------------- *
 * Operasyon paneli: mevcut görünüm korunur, ikinci görünüm eklenir
 * --------------------------------------------------------------------- */

test("operasyon panelinde süreç görünümü korunur ve analitik ikinci görünüm olarak eklenir", () => {
  assert.match(OPERATIONS_PANEL, /\{ id: "process", label: "Süreç ve iş yükü"/);
  assert.match(OPERATIONS_PANEL, /\{ id: "analytics", label: "Katılım ve karar analitiği"/);
  assert.match(OPERATIONS_PANEL, /useState<WorkView>\("process"\)/, "İlk açılışta mevcut süreç ekranı gelmeli.");
  // Mevcut süreç ekranının parçaları yerinde: sayaçlar, uyarılar, üç sekme, öncelik ve aktiflik işlemleri.
  for (const marker of [
    'className="operations-summary"', 'className="operations-alerts"', 'className="operations-tabs-section"',
    '{ id: "overview", label: "Şartname ve kriter özeti"', '{ id: "judges", label: "Hakem iş yükü"', '{ id: "timeline", label: "Son süreç hareketleri"',
    "togglePriority(item)", "toggleActive(item)", 'applicationAction(item, "remind_judge")', 'className="operations-archive"',
  ]) {
    assert.ok(OPERATIONS_PANEL.includes(marker), `Süreç görünümü parçası korunmalı: ${marker}`);
  }
  assert.match(OPERATIONS_PANEL, /\{workView === "analytics" \? <ParticipationAnalyticsPanel \/> : null\}/);
  // Analitik ekranındaki zorunlu açıklama ve iki alt bölüm.
  assert.match(ANALYTICS_PANEL, /A · Katılım ve başarı/);
  assert.match(ANALYTICS_PANEL, /B · AI–hakem uyumu/);
  assert.match(ANALYTICS_PANEL, /AGREEMENT_DISCLAIMER/);
  assert.ok(!/Hakem tutarlılığı|AI doğruluğu/.test(ANALYTICS_PANEL), "Kesin 'tutarlılık/doğruluk' ifadesi kullanılmamalı.");
});

/* --------------------------------------------------------------------- *
 * 12 · frontend.md ekran özellikleri
 * --------------------------------------------------------------------- */

test("frontend.md · 1 — yönetici panelinin üç kutucuklu görünümü korunur", () => {
  assert.match(ADMIN_PANEL, /type PanelView = "create" \| "accounts" \| "outbox"/);
  assert.match(ADMIN_PANEL, /useState<PanelView>\("create"\)/, "İlk açılışta form görünmeli.");
  assert.match(ADMIN_PANEL, /className="admin-view-nav"/);
  assert.match(ADMIN_PANEL, /Yeni hesap ata/);
  assert.match(ADMIN_PANEL, /Kayıtlı yönetici hesapları/);
  assert.match(ADMIN_PANEL, /Bildirim kayıtları/);
  assert.match(GLOBALS_CSS, /\.admin-view-nav \{ display: grid; grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
});

test("frontend.md · 2 — hakem panelinde yarışma arama kutusu ve öncelikli kartlar korunur", () => {
  assert.match(COMPETITION_PICKER, /role="combobox"/);
  assert.match(COMPETITION_PICKER, /role="listbox"/);
  assert.match(COMPETITION_PICKER, /Yarışma ara/);
  assert.match(COMPETITION_PICKER, /combo-option-count/);
  assert.match(COMPETITION_PICKER, /eval-priority-pins/);
  assert.match(COMPETITION_PICKER, /eval-priority-card/);
  assert.match(COMPETITION_PICKER, /ACİL \/ ÖNCELİKLİ/);
  assert.match(EVALUATION_APP, /<CompetitionPicker/);
  assert.match(EVALUATION_APP, /Yukarıdaki kutudan bir yarışma seçin/);
  assert.match(EVALUATION_CSS, /\.combo-option-count/);
  assert.match(EVALUATION_CSS, /\.eval-priority-card/);
});

test("frontend.md · 3 — kriter editörü satırın hemen altında açılır, tekrar tıklayınca kapanır", () => {
  assert.match(CRITERIA_APP, /function renderInspector\(\)/);
  assert.match(CRITERIA_APP, /className=\{`criterion-entry \$\{open \? "open" : ""\}`\.trim\(\)\}/,
    "Satır kutusu açık durumda .open sınıfı almalı.");
  assert.match(CRITERIA_APP, /Kapat ▴/);
  assert.match(CRITERIA_APP, /criterion-chevron/);
  assert.ok(!/id="criterion-detail"[\s\S]*Kriter listesine dön/.test(CRITERIA_APP), "Sayfa altı 'Kriter listesine dön' düzeni geri gelmemeli.");
  assert.match(GLOBALS_CSS, /\.criterion-entry\.open \{/);
  assert.match(GLOBALS_CSS, /\.criterion-chevron \{/);
});
