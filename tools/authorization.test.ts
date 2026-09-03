import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ASSIGNABLE_ROLE_CODES, PARTICIPANT_ROLE, ROLES } from "../app/lib/admin-roles.ts";
import { PERMISSIONS, can, canUpdateProfile, canViewApplication } from "../app/lib/authorization.ts";
import type { RoleCode } from "../app/lib/admin-types.ts";

/**
 * Rol sınırlarının regresyon testleri.
 *
 * Saf karar işlevleri doğrudan çalıştırılır. Uygulama noktası SQL veya D1
 * içindeyse (başvuru görünürlüğü, profil sahipliği, nihai karar yazımı) kaynak
 * dosya üzerinden de doğrulanır: arayüzde düğme gizlemek yetki değildir, kural
 * sunucu tarafında durmalıdır.
 */

const account = (roleCode: RoleCode, id = `user-${roleCode}`) => ({ id, roleCode });

const WORKFLOW_DB = readFileSync("app/lib/workflow-db.ts", "utf8");
const ADMIN_GUARD = readFileSync("app/lib/admin-guard.ts", "utf8");
const ACCOUNT_ROUTE = readFileSync("app/api/admin/accounts/[id]/route.ts", "utf8");
const ANALYZE_ROUTE = readFileSync("app/api/analyze/route.ts", "utf8");
const EVALUATE_ROUTE = readFileSync("app/api/evaluate-report/route.ts", "utf8");

/* --------------------------------------------------------------------- *
 * 00 · Admin yalnızca 01, 02 ve 04 hesabı oluşturabilir
 * --------------------------------------------------------------------- */

test("Admin yalnızca 01, 02 ve 04 rollerinde hesap açabilir", () => {
  assert.deepEqual([...ASSIGNABLE_ROLE_CODES].sort(), ["01", "02", "04"]);
  assert.ok(!ASSIGNABLE_ROLE_CODES.includes("00"), "Admin yeni Admin hesabı açamaz.");
  assert.ok(!ASSIGNABLE_ROLE_CODES.includes(PARTICIPANT_ROLE), "Admin yarışmacı hesabı açamaz.");
  // Katalogla allowlist ayrışmamalı.
  assert.deepEqual(
    ROLES.filter((role) => role.assignable).map((role) => role.code).sort(),
    ["01", "02", "04"],
  );
});

test("rol kodu doğrulaması allowlist üzerinden yapılır (arayüz kısıtı değil)", () => {
  assert.match(
    ADMIN_GUARD,
    /export function assertRoleCode[\s\S]{0,400}ASSIGNABLE_ROLE_CODES\.includes\(value\)/,
    "assertRoleCode ASSIGNABLE_ROLE_CODES allowlist'ini kullanmalıdır.",
  );
});

test("Admin (00) hesabının rolü panelden değiştirilemez", () => {
  assert.match(
    ACCOUNT_ROUTE,
    /current\.roleCode === "00"[\s\S]{0,200}Admin \(00\) hesabının rolü panelden değiştirilemez/,
    "İlk sistem Admin hesabı rol değişikliğine kapalı olmalıdır.",
  );
  assert.match(
    ACCOUNT_ROUTE,
    /const roleCode = assertRoleCode\(body\.roleCode\);/,
    "Diğer roller için allowlist doğrulaması korunmalıdır.",
  );
});

test("Admin kriter, değerlendirme ve başvuru uçlarına erişemez", () => {
  const admin = account("00");
  for (const permission of [
    "author_criteria", "author_profile", "publish_profile", "read_profiles",
    "submit_application", "read_applications", "read_application_file",
    "run_ai_prescreen", "final_judgement", "coordinate_evaluation",
    "operations_dashboard", "manage_competition_stage",
  ] as Array<keyof typeof PERMISSIONS>) {
    assert.ok(!can(admin, permission), `Admin ${permission} yetkisine sahip olmamalı.`);
  }
  assert.ok(can(admin, "manage_accounts"), "Admin yalnızca hesap yönetimi yapar.");
});

/* --------------------------------------------------------------------- *
 * 01 · Yarışma yöneticisi başka yöneticinin profilini değiştiremez
 * --------------------------------------------------------------------- */

test("yarışma yöneticisi başka yöneticinin profilini güncelleyemez", () => {
  assert.ok(canUpdateProfile("yonetici-a", "yonetici-a"), "Kendi profilini güncelleyebilir.");
  assert.ok(canUpdateProfile("yonetici-a", null), "Yeni kayıt serbesttir.");
  assert.ok(canUpdateProfile("yonetici-a", undefined), "Kaydı olmayan kimlik yeni sayılır.");
  assert.ok(!canUpdateProfile("yonetici-b", "yonetici-a"), "Başkasının profili güncellenemez.");
});

test("profil yayımı sunucuda created_by sahipliğini doğrular", () => {
  assert.match(
    WORKFLOW_DB,
    /SELECT created_by FROM competition_profiles WHERE id = \?/,
    "submitProfileForReview mevcut kaydın sahibini okumalıdır.",
  );
  assert.match(
    WORKFLOW_DB,
    /canUpdateProfile\(actor\.id, existing\?\.created_by\)[\s\S]{0,80}ProfileOwnershipError/,
    "Sahip olmayan yönetici ProfileOwnershipError almalıdır.",
  );
});

/* --------------------------------------------------------------------- *
 * 02 · Hakem yalnızca kendisine atanmış başvuruyu görür
 * --------------------------------------------------------------------- */

test("hakem yalnızca kendisine atanmış başvuruyu görebilir", () => {
  const judge = account("02", "hakem-1");
  const mine = { participantId: "yarismaci-1", assignedJudgeId: "hakem-1" };
  const other = { participantId: "yarismaci-1", assignedJudgeId: "hakem-2" };
  const unassigned = { participantId: "yarismaci-1", assignedJudgeId: null };
  assert.ok(canViewApplication(judge, mine));
  assert.ok(!canViewApplication(judge, other), "Başka hakeme atanmış dosya görünmemeli.");
  assert.ok(!canViewApplication(judge, unassigned), "Atanmamış dosya hakem panelinde görünmemeli.");
});

test("başvuru görünürlüğü SQL'inde hakem için atanmamış dosya kaçağı yok", () => {
  const start = WORKFLOW_DB.indexOf("function applicationVisibility");
  assert.ok(start > 0, "applicationVisibility bulunmalı.");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\nfunction ", start + 10));
  const judgeStart = body.indexOf(`roleCode === "02"`);
  assert.ok(judgeStart > 0, "applicationVisibility içinde 02 dalı bulunmalı.");
  // Dal artık çok satırlı (arşivlenmiş dosyalar da dışarıda bırakılır).
  const judgeBranch = body.slice(judgeStart, body.indexOf("roleCode === \"01\"", judgeStart));
  assert.match(judgeBranch, /assigned_judge_id = \?/);
  assert.ok(
    !/assigned_judge_id IS NULL/.test(judgeBranch),
    "Hakem filtresi atanmamış başvuruları (assigned_judge_id IS NULL) kapsamamalıdır.",
  );
  // Arşivlenen (soft delete) dosya hakemin aktif listesinde görünmez; kayıt silinmez.
  assert.match(judgeBranch, /deleted_at IS NULL/, "Arşivlenen başvuru hakem listesinden çıkmalıdır.");
});

test("hakem AI analizini başlatarak atanmamış dosyayı üstlenemez", () => {
  const marker = WORKFLOW_DB.slice(WORKFLOW_DB.indexOf("export async function markApplicationAnalyzing"));
  const body = marker.slice(0, marker.indexOf("\nexport "));
  assert.ok(
    !/assigned_judge_id = \?, assigned_judge_name = \?/.test(body),
    "markApplicationAnalyzing dosyayı hakemin üzerine yazmamalıdır (self-assign yok).",
  );
  assert.match(
    body,
    /judge\.roleCode === "02" && current\.assigned_judge_id !== judge\.id/,
    "Kendisine atanmamış başvuruda analiz başlatılamamalıdır.",
  );
});

test("manuel hakem atama yetkisi ve ucu tamamen kapatıldı", () => {
  // Yetki matrisi assign_judge iznini artık TANIMLAMAZ; atama yalnızca sistemdedir.
  assert.ok(!("assign_judge" in PERMISSIONS), "assign_judge yetkisi kaldırılmalıdır.");
  assert.ok(!/export async function assignApplication/.test(WORKFLOW_DB), "Elle atama işlevi kaldırılmalıdır.");
  // API ucu, hangi rol çağırırsa çağırsın manuel atamayı reddeder.
  const route = readFileSync("app/api/applications/[id]/route.ts", "utf8");
  assert.match(
    route,
    /body\.action === "assign_judge"[\s\S]{0,300}Manuel hakem atama kaldırıldı/,
    "assign_judge eylemi açık bir retle kapatılmalıdır.",
  );
  // Bekleyen başvurular sistem tarafından otomatik dağıtılır; hakem seçtirilmez.
  assert.match(WORKFLOW_DB, /export async function assignPendingApplications/, "Bekleyen atama işlevi bulunmalıdır.");
  const panel = readFileSync("app/components/operations-panel.tsx", "utf8");
  assert.ok(!/assign_judge/.test(panel), "Operasyon panelinde atama eylemi kalmamalıdır.");
  assert.ok(!/Hakem seçin/.test(panel), "Operasyon panelinde hakem seçim kutusu kalmamalıdır.");
});

/* --------------------------------------------------------------------- *
 * 03 · Yarışmacı yalnızca kendi başvurusunu görür
 * --------------------------------------------------------------------- */

test("yarışmacı yalnızca kendi başvurusunu görebilir", () => {
  const participant = account("03", "yarismaci-1");
  assert.ok(canViewApplication(participant, { participantId: "yarismaci-1", assignedJudgeId: null }));
  assert.ok(!canViewApplication(participant, { participantId: "yarismaci-2", assignedJudgeId: null }));
  // Kendisine atanmış hakem olsa bile başkasının dosyası görünmez.
  assert.ok(!canViewApplication(participant, { participantId: "yarismaci-2", assignedJudgeId: "yarismaci-1" }));
});

test("yarışmacı kriter profillerini ve iç görüşmeyi göremez", () => {
  const participant = account("03");
  assert.ok(!can(participant, "read_profiles"));
  assert.ok(!can(participant, "read_timeline"));
  assert.ok(!can(participant, "read_extractions"));
  assert.ok(can(participant, "submit_application"));
});

/* --------------------------------------------------------------------- *
 * 04 · Değerlendirme Yöneticisi karar veremez
 * --------------------------------------------------------------------- */

test("Değerlendirme Yöneticisi nihai karar veremez ve kriter değiştiremez", () => {
  const coordinator = account("04");
  assert.ok(!can(coordinator, "final_judgement"), "04 nihai karar veremez.");
  assert.ok(!can(coordinator, "run_ai_prescreen"), "04 AI ön değerlendirmesini başlatamaz.");
  assert.ok(!can(coordinator, "author_criteria"), "04 kriter çıkaramaz.");
  assert.ok(!can(coordinator, "publish_profile"), "04 kriter profili yayımlayamaz.");
  assert.ok(!can(coordinator, "read_application_file"), "04 katılımcı raporunun içeriğini görmez.");
  assert.ok(can(coordinator, "coordinate_evaluation"));
});

test("nihai karar ve AI ön değerlendirmesi yalnızca hakemdedir", () => {
  assert.deepEqual([...PERMISSIONS.final_judgement], ["02"]);
  assert.deepEqual([...PERMISSIONS.run_ai_prescreen], ["02"]);
});

/* --------------------------------------------------------------------- *
 * AI sonucu tek başına başvuruyu reddedemez
 * --------------------------------------------------------------------- */

test("AI sonucu kaydı başvuru sonucunu (outcome) değiştirmez", () => {
  const start = WORKFLOW_DB.indexOf("export async function saveApplicationEvaluation");
  assert.ok(start > 0, "saveApplicationEvaluation bulunmalı.");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\nexport ", start + 10));
  assert.ok(!/\boutcome\b/.test(body), "AI sonucu kaydı outcome sütununa dokunmamalıdır.");
  assert.ok(!/decided_at/.test(body), "AI sonucu kaydı karar zamanını yazmamalıdır.");
  assert.match(
    body,
    /"analysis_failed" : "awaiting_judge"/,
    "AI sonucu başvuruyu ancak hakem kuyruğuna taşır; reddedemez.",
  );
});

test("başvuru sonucu yalnızca hakem incelemesiyle yazılır", () => {
  const start = WORKFLOW_DB.indexOf("export async function saveApplicationReview");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\nexport ", start + 10));
  assert.match(body, /outcome = excluded\.outcome/, "Sonuç yalnızca hakem incelemesinde yazılır.");
  assert.match(
    body,
    /completed \? review\.outcome : "pending"/,
    "Karar tamamlanmadan sonuç 'pending' kalmalıdır.",
  );
});

/* --------------------------------------------------------------------- *
 * Tek LLM çağrısı
 * --------------------------------------------------------------------- */

test("şartname analizi tek generateContent çağrısı yapar", () => {
  assert.ok(!/GEMINI_FALLBACK_MODEL|GEMINI_THIRD_MODEL/.test(ANALYZE_ROUTE), "Yedek model kademesi kalmamalı.");
  assert.ok(!/MODEL_SWEEPS|MODEL_RETRY_BUDGET_MS|markModelUnavailable/.test(ANALYZE_ROUTE), "Model taraması ve gizli yeniden deneme kalmamalı.");
  assert.match(ANALYZE_ROUTE, /runSingleGeneration\(/, "Tek çağrı katmanı kullanılmalı.");
  assert.ok(!/apiCalls: 1,/.test(ANALYZE_ROUTE), "Tanılamaya sabit 'apiCalls: 1' yazılmamalıdır.");
  assert.match(ANALYZE_ROUTE, /apiCalls,/, "Gerçek çağrı sayısı tanılamaya yazılmalıdır.");
  assert.match(ANALYZE_ROUTE, /retryable: failure\.transient/, "Geçici hatada 'Yeniden dene' bayrağı dönmelidir.");
});

test("rapor analizi tek generateContent çağrısı yapar", () => {
  assert.ok(!/GEMINI_FALLBACK_MODEL/.test(EVALUATE_ROUTE), "Yedek model kademesi kalmamalı.");
  assert.match(EVALUATE_ROUTE, /runSingleGeneration\(/, "Tek çağrı katmanı kullanılmalı.");
  assert.ok(!/apiCalls: 1,/.test(EVALUATE_ROUTE), "Tanılamaya sabit 'apiCalls: 1' yazılmamalıdır.");
  assert.match(EVALUATE_ROUTE, /retryable: failure\.transient/, "Geçici hatada 'Yeniden dene' bayrağı dönmelidir.");
});

test("şartname analizi ayrı rapor şablonu kabul etmez", () => {
  assert.ok(!/templateFile/.test(ANALYZE_ROUTE), "Ayrı rapor şablonu yükleme alanı kaldırılmalıdır.");
});

/* --------------------------------------------------------------------- *
 * Kaynak sayfa doğrulaması ve sunucu tarafı sayfa sınırı
 * --------------------------------------------------------------------- */

test("kaynak sayfa sınırı sunucuda belgeden okunur, istemciye bırakılmaz", () => {
  assert.match(
    ANALYZE_ROUTE,
    /extractPdfStructure\(pdfBytes\)/,
    "Sayfa sayısı ve kaynak sınırı PDF'nin yapısal ayrıştırmasından okunmalıdır.",
  );
  assert.ok(
    !/const pageCount = Number\.isFinite\(rawPageCount\)/.test(ANALYZE_ROUTE),
    "İstemciden gelen sayfa sayısı tek başına doğrulama sınırı olmamalıdır.",
  );
});

test("üretim ayarları kararlı ve token bütçesi sınırlı", () => {
  assert.match(ANALYZE_ROUTE, /temperature: 0/, "Kural çıkarımında sıcaklık 0 olmalıdır.");
  assert.match(ANALYZE_ROUTE, /maxOutputTokens: MAX_OUTPUT_TOKENS/, "Çıktı tavanı sabitten okunmalıdır.");
  assert.ok(!/maxOutputTokens: 65536/.test(ANALYZE_ROUTE), "Eski 64k çıktı tavanı kalmamalıdır.");
});

test("çıkarım şeması sourcePage'i zorunlu tutar, gereksiz bölüm istemez", () => {
  const extraction = readFileSync("app/lib/criteria-extraction.ts", "utf8");
  assert.match(extraction, /sourcePage: \{\s*type: "integer",\s*minimum: 1/, "sourcePage minimum 1 olmalıdır.");
  assert.match(extraction, /required: \["documentProfile", "decisions"\]/, "Şema profil ve aday kararlarını istemelidir.");
  assert.ok(!/excludedRules/.test(extraction), "Kapsam dışı madde listesi şemadan çıkarılmalıdır.");
  assert.match(extraction, /sourcePage ve sourceId'yi değiştirme/, "Sistem istemi doğrulanmış kaynak kimliğini korumalıdır.");
});

/* --------------------------------------------------------------------- *
 * Otomatik hakem ataması
 *
 * Başvuru alındığında SİSTEM en az yüklü hakeme atar. Bu, hakemin dosyayı
 * kendi üzerine alması DEĞİLDİR: hakem hâlâ yalnızca kendisine atanmış
 * dosyayı görür ve atanmamış dosyada analiz başlatamaz.
 * --------------------------------------------------------------------- */

test("başvuru alındığında sistem en az yüklü hakeme atar", () => {
  const start = WORKFLOW_DB.indexOf("async function autoAssignJudge");
  assert.ok(start > 0, "autoAssignJudge bulunmalı.");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\nexport async function createApplication", start));
  assert.match(body, /role_code = '02' AND j\.status = 'active'/, "Yalnızca aktif Hakem hesapları atanabilir.");
  assert.match(body, /open_files ASC/, "En az yüklü hakem seçilmelidir.");
  /*
   * REGRESYON: "aynı yarışmada görevli hakem" tercihi yük sırasının ÖNÜNE
   * geçmişti ve aynı yarışmanın ardışık başvuruları tek hakeme yığılıyordu
   * (Çelikkubbe simülasyonunda 2 başvuru da Hakem 1'e gitti). Birincil ölçüt
   * EN AZ AÇIK DOSYADIR; yarışma aşinalığı yalnızca eşitlik bozucudur.
   */
  assert.match(
    body,
    /ORDER BY open_files ASC, \(competition_files > 0\) DESC/,
    "Yük sırası birincil, yarışma aşinalığı yalnızca eşitlik bozucu olmalıdır.",
  );
  // Eşitlikte adil ve DETERMİNİSTİK: en eski hesap, sonra kimlik sırası. Kura yok.
  assert.match(body, /j\.created_at ASC, j\.id ASC/, "Eşit yükte sıralama deterministik olmalıdır.");
  // Arşivlenmiş dosyalar yük sayımına girmez.
  assert.match(body, /a\.deleted_at IS NULL\) AS open_files/, "Yük sayımı arşivlenen dosyaları saymamalıdır.");
  // Yarış koşulu: iki eşzamanlı başvuru aynı satırı iki kez atayamamalı.
  // Yeniden gönderilmiş ama hakemsiz kalmış başvurular da kapsamda; arşivli atanmaz.
  assert.match(
    body,
    /WHERE id = \? AND assigned_judge_id IS NULL AND status IN \('submitted', 'resubmitted'\)\s*\n?\s*AND deleted_at IS NULL/,
    "Atama koşulu WHERE içinde tutulmalı; var olan atamanın üzerine yazılmamalı.",
  );
});

test("otomatik atama başarısız olursa başvuru düşmez", () => {
  const start = WORKFLOW_DB.indexOf("export async function createApplication");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\n/**", start + 10));
  assert.match(
    body,
    /try \{\s*assignment = await autoAssignJudge\([\s\S]{0,200}catch/,
    "Atama hatası yakalanmalı; başvuru kaydı korunmalıdır.",
  );
});

test("otomatik atama denetim kaydında sistem kimliği boş bırakılmaz", () => {
  const start = WORKFLOW_DB.indexOf("async function autoAssignJudge");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\n/**", start + 10));
  assert.match(
    body,
    /VALUES \(\?, \?, \?, \?, 'system', \?, \?, 1, \?\)/,
    "application_assignments.assigned_by zorunlu olduğundan otomatik atama sistem kimliği yazmalıdır.",
  );
});

test("otomatik atama hakemin dosya seçmesine izin vermez", () => {
  // Görünürlük ve self-assign kuralları değişmedi; yalnızca atamayı sistem yapıyor.
  const judge = account("02", "hakem-1");
  assert.ok(!canViewApplication(judge, { participantId: "y1", assignedJudgeId: null }));
  assert.ok(!canViewApplication(judge, { participantId: "y1", assignedJudgeId: "hakem-2" }));
  assert.ok(canViewApplication(judge, { participantId: "y1", assignedJudgeId: "hakem-1" }));
});

/* --------------------------------------------------------------------- *
 * Kaynak sayfa bağlantısı
 * --------------------------------------------------------------------- */

test("şartname PDF'i profile bağlanır ve yetkiyle sunulur", () => {
  const route = readFileSync("app/api/profiles/[id]/file/route.ts", "utf8");
  assert.match(route, /requirePermission\(request, "read_profiles"\)/, "Şartname profil okuma yetkisiyle korunmalıdır.");
  assert.match(route, /roleCode === "01" && profile\.createdBy !== auth\.account\.id/, "01 yalnızca kendi profilinin şartnamesini görmelidir.");
  assert.match(route, /content-disposition[\s\S]{0,40}inline/, "PDF tarayıcıda açılmalı ki #page çapası çalışsın.");
  // Yarışmacı (03) read_profiles yetkisine sahip değildir; uç ona kapalıdır.
  // Tuple tipi "03" içermez; çalışma anında da içermediğini doğrularız.
  assert.ok(!(PERMISSIONS.read_profiles as readonly string[]).includes("03"), "Yarışmacı şartnameye erişememelidir.");
});

/* --------------------------------------------------------------------- *
 * Problem 4 · Değerlendirme Yöneticisi yetki sınırları
 * --------------------------------------------------------------------- */

test("başvuru durumunu yarışma sahibi (01) belirler, 04 yalnızca izler", () => {
  assert.deepEqual([...PERMISSIONS.manage_competition_stage], ["01"]);
  assert.ok(!can(account("04"), "manage_competition_stage"), "04 başvuruyu açıp kapatamaz.");
  assert.ok(can(account("01"), "manage_competition_stage"), "01 kendi yarışmasını yönetir.");
});

test("resmî şablon (benzerlik filtresi) yalnızca yarışmanın sahibi Yarışma Yöneticisindedir", () => {
  // GÖREV 3 · madde 3: şablon kriter üretmez, uygunluk kararı vermez; okuma
  // dahil hiçbir erişim 04'e (veya başka role) açılmaz — en az yetki.
  assert.deepEqual([...PERMISSIONS.manage_similarity_template], ["01"]);
  for (const role of ["00", "02", "03", "04"] as const) {
    assert.ok(!can(account(role), "manage_similarity_template"), `${role} resmî şablona erişememeli.`);
  }
  assert.ok(can(account("01"), "manage_similarity_template"));
});

test("ÖNCELİKLİ işareti yalnızca Değerlendirme Yöneticisindedir", () => {
  assert.deepEqual([...PERMISSIONS.flag_competition_priority], ["04"]);
  for (const role of ["00", "01", "02", "03"] as const) {
    assert.ok(!can(account(role), "flag_competition_priority"), `${role} öncelik atayamamalı.`);
  }
});

test("yarışma süreç ucu sahiplik doğrular", () => {
  const route = readFileSync("app/api/competitions/route.ts", "utf8");
  assert.match(
    route,
    /!await ownsCompetition\(competitionId, auth\.account\)[\s\S]{0,160}403/,
    "Başka yöneticinin yarışması değiştirilememeli.",
  );
  assert.match(route, /requirePermission\(request, "flag_competition_priority"\)/, "Öncelik ayrı yetkiye bağlı olmalı.");
  assert.match(route, /requirePermission\(request, "manage_competition_stage"\)/, "Süreç değişimi ayrı yetkiye bağlı olmalı.");
});

test("öncelik işareti yarışmanın süreç durumunu değiştirmez", () => {
  const start = WORKFLOW_DB.indexOf("export async function setCompetitionPriority");
  const body = WORKFLOW_DB.slice(start, WORKFLOW_DB.indexOf("\n/**", start + 10));
  assert.match(body, /SET is_priority = \?/, "Yalnızca öncelik alanları yazılmalı.");
  assert.ok(!/\bstatus = \?/.test(body), "Öncelik işareti yarışma durumuna dokunmamalıdır.");
  assert.ok(!/decisions_locked/.test(body), "Öncelik işareti karar kilidine dokunmamalıdır.");
});

test("operasyon panosu katılımcı adı ve rapor içeriği taşımaz", () => {
  const route = readFileSync("app/api/operations/route.ts", "utf8");
  // Yalnızca yarışma özeti bloğu: bu tablo sayı ve durum taşır, kimlik taşımaz.
  const overview = route.slice(route.indexOf("const overview"), route.indexOf("const archiveTrail"));
  for (const leak of ["participantName", "applicantFullName", "fileName", "teamName", "evaluation"]) {
    assert.ok(!overview.includes(leak), `Yarışma özeti ${leak} alanını içermemelidir.`);
  }
  // Arşiv izi de yarışmacı kimliği taşımaz: takım adı ve yarışma adı yeterlidir.
  const trail = route.slice(route.indexOf("const archiveTrail"), route.indexOf("const auditRows"));
  for (const leak of ["participantName", "applicantFullName", "fileName", "evaluation"]) {
    assert.ok(!trail.includes(leak), `Arşiv izi ${leak} alanını içermemelidir.`);
  }
  const panel = readFileSync("app/components/operations-panel.tsx", "utf8");
  assert.ok(!/criteria\.map/.test(panel), "04 panosunda kriter adları listelenmemelidir.");
});

test("öncelik sütunu eklemeli ve geriye uyumludur", () => {
  assert.match(
    WORKFLOW_DB,
    /is_priority", definition: "INTEGER NOT NULL DEFAULT 0/,
    "Öncelik sütunu varsayılan değerle eklenmelidir.",
  );
  assert.match(WORKFLOW_DB, /ALTER TABLE competitions ADD COLUMN/, "Sütun eklemeli göç ile açılmalıdır.");
  const migration = readFileSync("migrations/0006_competition_priority.sql", "utf8");
  assert.ok(!/DROP|DELETE/i.test(migration), "Göç dosyası veri silmemelidir.");
});

/* --------------------------------------------------------------------- *
 * Problem 4 · 4. prensip (teknik kriter) hassasiyeti
 * --------------------------------------------------------------------- */

test("çıkarım istemi zorunluluk kipi ifadelerini tarar", () => {
  const extraction = readFileSync("app/lib/criteria-extraction.ts", "utf8");
  for (const phrase of [
    "zorunludur", "içermelidir", "olmalıdır", "mecburidir",
    "kesinlikle yasaktır", "aşamaz", "en az", "en fazla", "aşması durumunda", "kullanılamaz",
  ]) {
    assert.ok(extraction.includes(phrase), `Sistem istemi "${phrase}" ifadesini aramalıdır.`);
  }
});

test("çıkarım istemi somut teknik gereksinim türlerini sayar", () => {
  const extraction = readFileSync("app/lib/criteria-extraction.ts", "utf8");
  for (const topic of ["Boyut kısıtları", "Ağırlık sınırları", "Elektriksel limitler", "acil durdurma", "patlayıcı"]) {
    assert.ok(extraction.includes(topic), `Sistem istemi "${topic}" başlığını içermelidir.`);
  }
  // Sürüm etiketi artırılınca eski önbellek kayıtları geçersiz olur.
  assert.match(extraction, /EXTRACTION_PROMPT_VERSION = "v2[3-9]/, "İstem sürümü v23 veya üzeri olmalıdır.");
  // Teknik odak diğer aşamaları boşaltmamalı.
  assert.match(extraction, /AŞAMA DENGESİ/, "Aşamalar arası denge kuralı bulunmalıdır.");
});

/* --------------------------------------------------------------------- *
 * Problem 4 · katılımcı geri bildirimi
 * --------------------------------------------------------------------- */

test("geri bildirim kartları PRD başlıklarını kullanır", async () => {
  const { PARTICIPANT_FEEDBACK_LABELS } = await import("../app/lib/types.ts");
  assert.deepEqual(PARTICIPANT_FEEDBACK_LABELS, {
    strengths: "Güçlü Yönler",
    improvements: "Gelişime Açık Yönler",
    suggestions: "Gelişim Önerileri",
  });
  // Hakem ve yarışmacı ekranı aynı kaynaktan okumalı; başlık ikiye ayrılmamalı.
  for (const file of ["app/components/participant-portal.tsx", "app/components/evaluation-app.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /PARTICIPANT_FEEDBACK_LABELS/, `${file} ortak başlıkları kullanmalıdır.`);
  }
});

test("hakem ekranında kaynak satıra git düğmesi ve aşama ikonları var", () => {
  const evaluation = readFileSync("app/components/evaluation-app.tsx", "utf8");
  assert.match(evaluation, /Kaynak Satıra Git/, "Kanıta gitme düğmesi bulunmalıdır.");
  assert.match(evaluation, /function StageIcon/, "Aşamalar yeşil/sarı/kırmızı ikonla gösterilmelidir.");
  // GÖREV 3 · madde 7: benzerlik dört aşamanın parçası DEĞİLDİR; aşama
  // şeridindeki "ŞÜPHELİ/Normal" satırı kaldırıldı, bağımsız kart gösterir.
  assert.match(evaluation, /Raporlar arası benzerlik/, "Bağımsız benzerlik kartı bulunmalıdır.");
});
