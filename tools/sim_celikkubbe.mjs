/**
 * ÇELİKKUBBE TAM UÇTAN UCA SİMÜLASYONU — canlı yerel sunucuya karşı.
 *
 * Bu sürücü, kullanıcı akışlarını istemcinin yaptığı GERÇEK isteklerle birebir
 * çalıştırır (aynı uçlar, aynı gövdeler, PDF metni istemci tarafında pdfjs ile
 * BİR KEZ çıkarılır). ÜCRETLİ Gemini çağrıları yalnızca kullanıcı izniyle
 * yapılır: şartname analizi, rapor analizi ve embedding GERÇEK çağrılardır.
 *
 * Aşamalar ayrı ayrı koşturulur; durum (çerezler, kimlikler, özetler)
 * scratchpad'deki state dosyasında tutulur:
 *
 *   node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs \
 *     tools/sim_celikkubbe.mjs <asama> [secenekler]
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { applySimilarity } from "../app/lib/report-prechecks.ts";
import { buildJudgeFeedback, defaultOutcomeNote, judgeDecisionCounts } from "../app/lib/judge-review.ts";

const BASE = "http://localhost:3000";
const STATE_FILE = process.env.SIM_STATE
  ?? "C:/Users/rualp/AppData/Local/Temp/claude/C--Users-rualp-OneDrive-Documents-GitHub-AI-Gambit/6ae9f522-3660-4564-8b9c-ea51662f8402/scratchpad/sim-state.json";

const COMPETITION_NAME = "Çelikkubbe Hava Savunma Sistemleri Yarışması";
const SARTNAME_PDF = "output/pdf/official/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf";
const PDF_A = "C:/Users/rualp/Downloads/HisarNova_26_Celikkubbe_Kritik_Tasarim_Raporu_BENZERLIK_A.pdf";
const PDF_B = "C:/Users/rualp/Downloads/KalkanVizyon_26_Celikkubbe_Kritik_Tasarim_Raporu_BENZERLIK_B.pdf";
const PDF_C = "C:/Users/rualp/Downloads/GokKalkan_24_Celik_Kubbe_Kritik_Tasarim_Raporu_TEST.pdf";

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
function section(title) { console.log(`\n=== ${title} ===`); }

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { cookies: {} }; }
}
async function saveState(state) { await writeFile(STATE_FILE, JSON.stringify(state, null, 1)); }
const state = loadState();

function client(label) {
  return { label, get cookie() { return state.cookies[label] ?? ""; }, set cookie(value) { state.cookies[label] = value; } };
}

async function call(user, path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (user.cookie) headers.cookie = user.cookie;
  if (init.body && typeof init.body === "string") headers["content-type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair] = entry.split(";");
    if (pair?.startsWith("kriter_admin_session=")) user.cookie = pair;
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* metin */ }
  return { status: response.status, json, text };
}
const post = (user, path, body) => call(user, path, { method: "POST", body: JSON.stringify(body) });
const patch = (user, path, body) => call(user, path, { method: "PATCH", body: JSON.stringify(body) });
const get = (user, path) => call(user, path);

async function login(username, password) {
  const user = client(username);
  const result = await post(user, "/api/admin/session", { identifier: username, password });
  if (result.status !== 200) throw new Error(`${username} girişi başarısız: ${JSON.stringify(result.json)}`);
  return { user, account: result.json.account };
}

function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

/** PDF metni pdfjs ile BİR KEZ çıkarılır; kriter ve benzerlik aynı metni kullanır. */
async function extractPdf(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(filePath));
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim());
  }
  return { pages, pageCount: pdf.numPages };
}

/* ======================== AŞAMA 1 · ADMIN ======================== */
async function stage1() {
  section("AŞAMA 1 · Admin: hesaplar ve rol erişimleri");
  const adminPassword = process.env.SIM_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("SIM_ADMIN_PASSWORD verilmedi.");
  const { user: admin } = await login("admin", adminPassword);
  const accounts = await get(admin, "/api/admin/accounts");
  check("Admin hesap listesine erişiyor", accounts.status === 200);
  const byRole = (role) => (accounts.json?.accounts ?? []).filter((a) => a.roleCode === role && a.status === "active");
  check("Proje Yöneticisi hesapları mevcut (≥1)", byRole("01").length >= 1, `01: ${byRole("01").length}`);
  check("Hakem hesapları mevcut (≥2)", byRole("02").length >= 2, `02: ${byRole("02").length}`);
  check("Değerlendirme Yöneticisi hesabı mevcut", byRole("04").length >= 1);
  check("Katılımcı hesapları mevcut (≥3)", byRole("03").length >= 3);

  // Rol sınırları (sunucu tarafı): Admin akışa giremez.
  check("Admin başvuru listesine erişemiyor (403)", (await get(admin, "/api/applications")).status === 403);
  check("Admin kriter profillerine erişemiyor (403)", (await get(admin, "/api/profiles")).status === 403);
  check("Admin operasyon panosuna erişemiyor (403)", (await get(admin, "/api/operations")).status === 403);
  check("Admin şartname analizi yapamıyor (403)", (await call(admin, "/api/analyze", { method: "POST", body: new FormData() })).status === 403);

  // Her rol yalnız kendi paneline: sunucu uçlarıyla doğrulama.
  const { user: pm } = await login("projeyoneticisi1", "1234");
  check("Proje Yöneticisi profillere erişiyor", (await get(pm, "/api/profiles")).status === 200);
  check("Proje Yöneticisi hesap yönetimine erişemiyor (403)", (await get(pm, "/api/admin/accounts")).status === 403);
  check("Proje Yöneticisi operasyon panosuna erişemiyor (403)", (await get(pm, "/api/operations")).status === 403);
  const { user: judge1 } = await login("hakem1", "1234");
  check("Hakem başvuru listesine erişiyor", (await get(judge1, "/api/applications")).status === 200);
  check("Hakem hesap yönetimine erişemiyor (403)", (await get(judge1, "/api/admin/accounts")).status === 403);
  const { user: ops } = await login("degerlendirmeyoneticisi1", "1234");
  check("Değerlendirme Yöneticisi operasyon panosuna erişiyor", (await get(ops, "/api/operations")).status === 200);
  const { user: participant } = await login("katilimci1", "1234");
  check("Katılımcı kriter profillerine erişemiyor (403)", (await get(participant, "/api/profiles")).status === 403);
  check("Katılımcı operasyon panosuna erişemiyor (403)", (await get(participant, "/api/operations")).status === 403);
  await saveState(state);
}

/* =================== AŞAMA 2 · PROJE YÖNETİCİSİ =================== */
async function stage2() {
  section("AŞAMA 2 · Proje Yöneticisi: şartname analizi ve kriter yayımı");
  await login("projeyoneticisi1", "1234");

  const sartname = await readFile(SARTNAME_PDF);
  const { pageCount } = await extractPdf(SARTNAME_PDF);
  console.log(`  Şartname: ${pageCount} sayfa · ${(sartname.length / 1024 / 1024).toFixed(1)} MB`);

  const form = new FormData();
  form.set("file", new File([sartname], "2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf", { type: "application/pdf" }));
  form.set("pageCount", String(pageCount));
  console.log("  GERÇEK Gemini çağrısı: şartname analizi başlatıldı (kullanıcı izniyle)…");
  const startedAt = Date.now();
  const analyzeResponse = await fetch(`${BASE}/api/analyze`, {
    method: "POST", body: form, headers: { cookie: client("projeyoneticisi1").cookie },
  });
  const analysis = await analyzeResponse.json();
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  check("şartname analizi tamamlandı", analyzeResponse.status === 200 && Array.isArray(analysis.criteria),
    JSON.stringify(analysis.error ?? "").slice(0, 200));
  if (!Array.isArray(analysis.criteria)) throw new Error("Analiz başarısız; aşama durduruldu.");
  console.log(`  Süre ${seconds} sn · model ${analysis.model} · ${analysis.criteria.length} kriter · `
    + `${analysis.diagnostics?.promptTokens ?? "?"}+${analysis.diagnostics?.outputTokens ?? "?"} token · apiCalls ${analysis.diagnostics?.apiCalls}`
    + ` · cache ${analysis.diagnostics?.cached ? analysis.diagnostics?.cacheStore : "yok"}`);

  const required = analysis.criteria.filter((c) => c.required);
  const optional = analysis.criteria.filter((c) => !c.required);
  check("kriterler zorunlu / zorunlu olmayan olarak ayrılıyor", required.length > 0 && optional.length >= 0,
    `zorunlu ${required.length} · zorunlu olmayan ${optional.length}`);
  const outside = analysis.criteria.filter((c) => c.verifiability !== "PDF_DENETLENEBILIR");
  console.log(`  PDF dışı işaretlenen kural: ${outside.length} → ${outside.slice(0, 6).map((c) => c.name).join(" · ")}`);
  check("video/KYS/saha türü kurallar PDF dışı işaretlendi (katılımcı analizine gitmeyecek)", outside.length >= 1,
    "şartnamede video/portal kuralı beklenirdi");
  // Türkçe büyük İ, JS regex /i bayrağıyla eşleşmez; tr-TR küçültmesi şarttır.
  check("yarışma adı şartnameden çözüldü",
    (analysis.setup?.competition ?? "").toLocaleLowerCase("tr-TR").includes("çelikkubbe"),
    analysis.setup?.competition);

  // Yayım: istemcinin gönderdiği profil + kaynak şartname PDF'i.
  const profileId = `profil-sim-${Date.now().toString(36)}`;
  const profile = {
    version: "2.0", status: "approved", profileId,
    setup: { ...analysis.setup, competition: COMPETITION_NAME },
    sourceDocument: { name: "2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf", pages: analysis.pageCount, analyzedAt: analysis.analyzedAt },
    templateProfile: analysis.templateProfile,
    criteria: analysis.criteria.map((c) => ({ ...c, active: true })),
  };
  const publishForm = new FormData();
  publishForm.set("profile", JSON.stringify(profile));
  publishForm.set("sourceFile", new File([sartname], profile.sourceDocument.name, { type: "application/pdf" }));
  const published = await fetch(`${BASE}/api/profiles`, {
    method: "POST", body: publishForm, headers: { cookie: client("projeyoneticisi1").cookie },
  });
  const publishJson = await published.json();
  check("kriter seti yayımlandı", published.status === 201, JSON.stringify(publishJson.error ?? ""));
  check("kriter sürümü v1 açıldı", publishJson.criteriaVersion?.criteriaVersion >= 1,
    JSON.stringify(publishJson.criteriaVersion));
  check("kriter hash değeri üretildi", /^[0-9a-f]{64}$/.test(publishJson.criteriaVersion?.criteriaHash ?? ""));

  const competitions = await get(client("projeyoneticisi1"), "/api/competitions");
  const row = (competitions.json?.competitions ?? []).find((c) => c.competitionName === COMPETITION_NAME);
  check("yarışma başvuruya açık ve AKTİF", row?.status === "open" && row?.isActive === true, JSON.stringify(row));

  state.profileId = publishJson.profile?.id ?? profileId;
  state.competitionId = row?.id;
  state.competitionKey = row?.competitionKey;
  state.criteriaVersion = publishJson.criteriaVersion;
  state.criteriaCount = analysis.criteria.length;
  state.outsideCriteria = outside.map((c) => ({ id: c.id, name: c.name }));
  await saveState(state);
}

/* ====================== AŞAMA 3 · KATILIMCILAR ====================== */
async function submitApplication(username, teamName, filePath) {
  const { user } = await login(username, "1234");
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set("competitionName", COMPETITION_NAME);
  form.set("applicantFullName", `${teamName} Sorumlusu`);
  form.set("teamName", teamName);
  form.set("teamMembers", JSON.stringify([`${teamName} Üye 1`, `${teamName} Üye 2`]));
  form.set("file", new File([bytes], filePath.split(/[\\/]/).pop(), { type: "application/pdf" }));
  const response = await fetch(`${BASE}/api/applications`, { method: "POST", body: form, headers: { cookie: user.cookie } });
  const json = await response.json();
  return { status: response.status, json, localHash: sha256(bytes), user };
}

async function stage3() {
  section("AŞAMA 3 · Katılımcılar: başvurular, R2 ve otomatik atama");
  const a = await submitApplication("katilimci1", "HisarNova-26", PDF_A);
  check("HisarNova-26 başvurusu alındı", a.status === 201, JSON.stringify(a.json?.error ?? ""));
  const b = await submitApplication("katilimci2", "KalkanVizyon-26", PDF_B);
  check("KalkanVizyon-26 başvurusu alındı", b.status === 201, JSON.stringify(b.json?.error ?? ""));
  if (a.status !== 201 || b.status !== 201) throw new Error("Başvurular alınamadı.");

  state.appA = { id: a.json.application.id, judgeId: a.json.application.assignedJudgeId, judgeName: a.json.application.assignedJudgeName, hash: a.localHash };
  state.appB = { id: b.json.application.id, judgeId: b.json.application.assignedJudgeId, judgeName: b.json.application.assignedJudgeName, hash: b.localHash };

  check("HisarNova başvurusu otomatik hakeme atandı", Boolean(state.appA.judgeId), JSON.stringify(a.json.application.status));
  check("KalkanVizyon başvurusu otomatik hakeme atandı", Boolean(state.appB.judgeId));
  check("iki başvuru FARKLI hakemlere dengeli dağıtıldı (en az yüklü)", state.appA.judgeId !== state.appB.judgeId,
    `${state.appA.judgeName} / ${state.appB.judgeName}`);

  // R2 bütünlüğü: yüklenen PDF'ler geri indirilip SHA-256 karşılaştırılır.
  for (const [team, app, participant] of [["HisarNova", state.appA, "katilimci1"], ["KalkanVizyon", state.appB, "katilimci2"]]) {
    const file = await fetch(`${BASE}/api/applications/${app.id}/file`, { headers: { cookie: client(participant).cookie } });
    const stored = Buffer.from(await file.arrayBuffer());
    check(`${team} PDF'i R2'de ve hash birebir eşleşiyor`, file.status === 200 && sha256(stored) === app.hash,
      `${file.status} · ${sha256(stored).slice(0, 12)} vs ${app.hash.slice(0, 12)}`);
  }

  // İzolasyon: katılımcı başka takımın başvurusunu ve PDF'ini GÖREMEZ.
  const k1 = client("katilimci1");
  const listing = await get(k1, "/api/applications");
  check("katılımcı1 yalnız kendi başvurusunu listeliyor",
    (listing.json?.applications ?? []).every((item) => item.id !== state.appB.id));
  check("katılımcı1 diğer takımın başvurusunu açamıyor",
    (await get(k1, `/api/applications/${state.appB.id}`)).status === 404);
  const foreignFile = await fetch(`${BASE}/api/applications/${state.appB.id}/file`, { headers: { cookie: k1.cookie } });
  check("katılımcı1 diğer takımın PDF'ini indiremiyor", foreignFile.status === 404, `HTTP ${foreignFile.status}`);
  await saveState(state);
}

/* ============== Ortak: hakem AI analizi (gerçek çağrılar) ============== */
async function judgeClientFor(applicationId) {
  for (const username of ["hakem1", "hakem2", "hakem3"]) {
    const { user } = await login(username, "1234");
    const found = await get(user, `/api/applications/${applicationId}`);
    if (found.status === 200) return { username, user, application: found.json.application };
  }
  throw new Error(`${applicationId} için atanmış hakem bulunamadı.`);
}

async function runAnalysis(applicationId, filePath, { skipEmbedding = false } = {}) {
  const { username, user } = await judgeClientFor(applicationId);
  console.log(`  Atanan hakem: ${username}`);
  const started = await patch(user, `/api/applications/${applicationId}`, { action: "start_analysis" });
  if (started.status !== 200) throw new Error(`start_analysis: ${JSON.stringify(started.json)}`);

  // PDF BİR KEZ okunur: hash + metin aynı bayttan; kriter ve benzerlik aynı metni paylaşır.
  const bytes = await readFile(filePath);
  const pdfHash = sha256(bytes);
  const extracted = await extractPdf(filePath);

  console.log("  GERÇEK Gemini çağrısı: kriter analizi + benzerlik PARALEL başlatıldı…");
  const evaluateForm = new FormData();
  evaluateForm.set("applicationId", applicationId);
  evaluateForm.set("pageCount", String(extracted.pageCount));
  evaluateForm.set("pages", JSON.stringify(extracted.pages));
  const startedAt = Date.now();
  const [evaluationSettled, similaritySettled] = await Promise.allSettled([
    fetch(`${BASE}/api/evaluate-report`, { method: "POST", body: evaluateForm, headers: { cookie: user.cookie } })
      .then(async (response) => ({ status: response.status, json: await response.json() })),
    post(user, `/api/applications/${applicationId}/similarity`, {
      pages: extracted.pages, pdfHash, ...(skipEmbedding ? { skipEmbedding: true } : {}),
    }),
  ]);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (evaluationSettled.status === "rejected") throw evaluationSettled.reason;
  const evaluationResponse = evaluationSettled.value;
  if (evaluationResponse.status !== 200) {
    await patch(user, `/api/applications/${applicationId}`, { action: "analysis_failed" });
    throw new Error(`evaluate-report ${evaluationResponse.status}: ${JSON.stringify(evaluationResponse.json).slice(0, 300)}`);
  }
  let evaluation = evaluationResponse.json;
  const similarity = similaritySettled.status === "fulfilled" && similaritySettled.value.status === 200
    ? similaritySettled.value.json
    : null;
  console.log(`  Paralel süre ${seconds} sn · model ${evaluation.model} · bulgu ${evaluation.findings.length}`
    + ` · ${evaluation.diagnostics?.promptTokens}+${evaluation.diagnostics?.outputTokens} token · apiCalls ${evaluation.diagnostics?.apiCalls}`
    + ` · embeddingApiCalls ${similarity?.embeddingApiCalls ?? "—"}`);
  if (similarity) {
    evaluation = applySimilarity(evaluation, similarity.check);
    evaluation = { ...evaluation, similarityReport: similarity.similarity };
  } else {
    evaluation = { ...evaluation, similarityReport: null };
    evaluation.analysisWarnings.push(`Benzerlik kontrolü tamamlanamadı: ${JSON.stringify(similaritySettled.status === "fulfilled" ? similaritySettled.value.json?.error : String(similaritySettled.reason)).slice(0, 200)}`);
  }
  const saved = await patch(user, `/api/applications/${applicationId}`, { action: "save_evaluation", evaluation });
  if (saved.status !== 200) throw new Error(`save_evaluation: ${JSON.stringify(saved.json).slice(0, 300)}`);
  return { username, user, evaluation, saved: saved.json.application, similarity, pdfHash };
}

/* ================= AŞAMA 4 · HAKEM · HisarNova ================= */
async function stage4() {
  section("AŞAMA 4 · Hakem: HisarNova-26 analizi, bulgu doğrulama, nihai ONAY");
  const run = await runAnalysis(state.appA.id, PDF_A);
  const evaluation = run.saved.evaluation;

  check("AI yalnızca PDF kapsamındaki kriterleri analiz etti",
    evaluation.findings.every((f) => f.verifiability === "PDF_DENETLENEBILIR" && f.verdict !== "DEGERLENDIRILEMEDI"),
    `bulgu ${evaluation.findings.length} / profil ${state.criteriaCount}`);
  const outsideIds = new Set((state.outsideCriteria ?? []).map((c) => c.id));
  check("PDF dışı kurallar (video/KYS/saha) bulgulara sızmadı",
    evaluation.findings.every((f) => !outsideIds.has(f.criterionId)),
    `${state.outsideCriteria?.length ?? 0} PDF dışı kural`);
  check("her bulguda kimlik, sonuç, gerekçe var",
    evaluation.findings.every((f) => f.criterionId && f.criterionName && f.verdict && f.rationale));
  const withEvidence = evaluation.findings.filter((f) => f.evidence?.length);
  console.log(`  Kanıtlı bulgu: ${withEvidence.length}/${evaluation.findings.length}`
    + ` · AI: ${evaluation.findings.filter((f) => f.verdict === "BASARILI").length} uygun`);
  check("bulguların çoğunda katılımcı PDF'inden sayfa+alıntı var",
    withEvidence.length >= Math.ceil(evaluation.findings.length / 2),
    `${withEvidence.length}/${evaluation.findings.length}`);

  const sim = run.saved.evaluation.similarityReport;
  check("ilk raporda karşılaştırılacak başvuru yok mesajı", sim?.level === "none"
    && /karşılaştırılabilecek başka güncel başvuru bulunmadığı/.test(sim?.note ?? ""), JSON.stringify(sim));

  state.appA.findings = evaluation.findings.map((f) => ({ id: f.criterionId, name: f.criterionName, verdict: f.verdict }));
  state.appA.judgeUser = run.username;
  await saveState(state);
  console.log("  → Kararlar için: stage4-decide");
}

function decisionFrom(finding, judgeVerdict, extra = {}) {
  return {
    criterionId: finding.criterionId, criterionName: finding.criterionName,
    aiVerdict: finding.verdict === "BASARILI" ? "UYGUN" : "OLUMSUZ",
    judgeVerdict, judgeResult: null,
    rejectionReason: "", evidenceMode: null, evidencePage: null,
    evidenceSection: "", evidenceQuote: "", missingContent: "",
    decidedBy: null, decidedAt: null,
    ...extra,
  };
}

async function stage4decide() {
  section("AŞAMA 4b · Hakem bulgu doğrulamaları ve nihai ONAY (HisarNova)");
  const { username, user, application } = await judgeClientFor(state.appA.id);
  const findings = application.evaluation.findings.filter((f) => f.verdict !== "DEGERLENDIRILEMEDI");

  // En az bir AI bulgusu REDDEDİLİR ve aynı kriter için hakem değerlendirmesi girilir.
  const negative = findings.find((f) => f.verdict !== "BASARILI");
  const rejectTarget = negative ?? findings[0];
  const rejectEvidence = rejectTarget.evidence?.[0];
  const decisions = findings.map((finding) => {
    if (finding.criterionId !== rejectTarget.criterionId) return decisionFrom(finding, "approved");
    return decisionFrom(finding, "rejected", {
      // Hakem, AI bulgusuna katılmıyor ve KENDİ değerlendirmesini yazıyor.
      judgeResult: "UYGUN",
      rejectionReason: negative
        ? "AI bulgusu hatalı: gereksinim raporda karşılanıyor; ilgili bölüm ve tablo incelendi."
        : "AI gerekçesi yetersiz; hakem kendi incelemesiyle uygunluğu doğruladı.",
      evidenceMode: "PDF_KONUMU",
      evidencePage: rejectEvidence?.page ?? 1,
      evidenceSection: rejectEvidence?.section ?? "Genel",
      evidenceQuote: rejectEvidence?.text ?? "Rapor ilgili gereksinimi tanımlamaktadır.",
    });
  });
  console.log(`  Reddedilen AI bulgusu: ${rejectTarget.criterionName} (AI: ${rejectTarget.verdict}) → hakem sonucu UYGUN`);

  const counts = judgeDecisionCounts(decisions);
  const outcomeNote = defaultOutcomeNote("accepted", findings, decisions);
  const review = {
    status: "completed", outcome: "accepted", outcomeNote,
    decisions: [], criterionDecisions: decisions, overallNote: "",
    finalFeedback: buildJudgeFeedback(findings, decisions), feedbackApproved: true,
    completedAt: new Date().toISOString(),
  };

  // Önce eksik kararla dene: sunucu genel kararı REDDETMELİ.
  const incomplete = await patch(user, `/api/applications/${state.appA.id}`, {
    action: "save_review",
    review: { ...review, criterionDecisions: decisions.map((d, i) => i === 0 ? { ...d, judgeVerdict: "pending", judgeResult: null } : d) },
  });
  check("bütün kriterler kesinleşmeden nihai karar reddediliyor", incomplete.status === 409, `HTTP ${incomplete.status}`);

  const saved = await patch(user, `/api/applications/${state.appA.id}`, { action: "save_review", review });
  check("nihai ONAY kaydedildi", saved.status === 200, JSON.stringify(saved.json?.error ?? ""));
  const storedDecisions = saved.json?.application?.review?.criterionDecisions ?? [];
  const rejected = storedDecisions.find((d) => d.judgeVerdict === "rejected");
  check("hakem değerlendirmesi DOĞRU kriterle bağlandı",
    rejected?.criterionId === rejectTarget.criterionId, `${rejected?.criterionId} vs ${rejectTarget.criterionId}`);
  check("reddedilen AI bulgusu yerine hakem sonucu kesinleşti",
    rejected?.judgeResult === "UYGUN" && rejected?.rejectionReason.length > 0);
  check("kesin sonuç sayaçları hakem doğrulamasından geliyor",
    (saved.json?.application?.review?.finalFeedback?.strengths ?? []).length === counts.uygun,
    `strengths ${saved.json?.application?.review?.finalFeedback?.strengths?.length} vs uygun ${counts.uygun}`);
  console.log(`  Kesinleşen: ${counts.uygun} uygun · ${counts.olumsuz} olumsuz · bulgu: ${counts.findingsApproved} onay/${counts.findingsRejected} ret · hakem ${username}`);

  // ONAY doğru katılımcının panelinde.
  const panel = await get(client("katilimci1"), "/api/applications");
  const seen = (panel.json?.applications ?? []).find((item) => item.id === state.appA.id);
  check("ONAY sonucu katılımcı1 panelinde görünüyor", seen?.status === "completed" && seen?.outcome === "accepted",
    JSON.stringify({ status: seen?.status, outcome: seen?.outcome }));
  check("katılımcı geri bildirimi iki bölüm ve AI ilk sonucu sızmıyor",
    (seen?.review?.finalFeedback?.strengths?.length ?? 0) > 0
    && (seen?.review?.criterionDecisions ?? []).length === 0
    && (seen?.review?.finalFeedback?.suggestions ?? []).length === 0);
  const otherPanel = await get(client("katilimci2"), "/api/applications");
  check("sonuç BAŞKA katılımcının panelinde görünmüyor",
    !(otherPanel.json?.applications ?? []).some((item) => item.id === state.appA.id));
  await saveState(state);
}

/* ================= AŞAMA 5 · HAKEM · KalkanVizyon ================= */
async function stage5() {
  section("AŞAMA 5 · Hakem: KalkanVizyon-26 analizi + GERÇEK benzerlik");
  const run = await runAnalysis(state.appB.id, PDF_B);
  const evaluation = run.saved.evaluation;
  const sim = evaluation.similarityReport;

  check("kriter analizi ve benzerlik aynı akışta çalıştı", Boolean(sim), JSON.stringify(run.similarity?.error ?? ""));
  check("benzerlik yalnızca aynı yarışmadaki 1 güncel başvuruyla karşılaştırıldı", sim?.comparedCount === 1,
    JSON.stringify(sim));
  check("iki rapor anlamlı ve yüksek benzerlik gösterdi (gerçek algoritma)",
    ["review", "high"].includes(sim?.level) && (sim?.approxPercent ?? 0) >= 30,
    `%${sim?.approxPercent} · ${sim?.level} · yöntem ${sim?.method}`);
  check("en yakın başvuru etiketi HisarNova-26", /hisarnova/i.test(sim?.closestLabel ?? ""), sim?.closestLabel);
  check("benzerlik notu hakem incelemesine işaret ediyor, otomatik karar değil",
    /otomatik ihlal, intihal veya ret kararı değildir/.test(sim?.note ?? ""), sim?.note);
  check("benzerlik embedding + MinHash hibrit yöntemle ölçüldü", sim?.method === "hybrid",
    `yöntem ${sim?.method} (embedding çalışmadıysa minhash-only olur)`);
  console.log(`  BENZERLİK: %${sim?.approxPercent} · seviye ${sim?.level} · yöntem ${sim?.method} · eşleşme ${sim?.matches?.length ?? 0}`);
  for (const match of sim?.matches ?? []) {
    console.log(`    eşleşme: ${match.kind} · bu rapor s.${match.ownPage} ↔ ${match.peerLabel} s.${match.peerPage}`);
  }

  // Benzerlik bir kriter DEĞİLDİR: bulgu listesi ve sayaçlara katılmaz.
  check("benzerlik kriter bulgularına ve sayaçlara katılmadı",
    evaluation.findings.every((f) => !/benzerlik/i.test(f.criterionName))
    && evaluation.summary.total === evaluation.findings.length);
  state.appB.findings = evaluation.findings.map((f) => ({ id: f.criterionId, name: f.criterionName, verdict: f.verdict }));
  state.appB.similarity = { percent: sim?.approxPercent, level: sim?.level, method: sim?.method };
  await saveState(state);
  console.log("  → Kararlar için: stage5-decide");
}

async function stage5decide() {
  section("AŞAMA 5b · Hakem: AI UYGUN bulgusunu ret + OLUMSUZ hakem değerlendirmesi, nihai RET");
  const { user, application } = await judgeClientFor(state.appB.id);
  const findings = application.evaluation.findings.filter((f) => f.verdict !== "DEGERLENDIRILEMEDI");
  const simBefore = application.evaluation.similarityReport;

  // AI'nin UYGUN dediği bir bulgu REDDEDİLİR; hakem OLUMSUZ değerlendirme yazar.
  const target = findings.find((f) => f.verdict === "BASARILI") ?? findings[0];
  const targetEvidence = target.evidence?.[0];
  const decisions = findings.map((finding) => {
    if (finding.criterionId !== target.criterionId) return decisionFrom(finding, "approved");
    return decisionFrom(finding, "rejected", {
      judgeResult: "OLUMSUZ",
      rejectionReason: "Hakem incelemesi: raporda verilen değerler şartname sınırını karşılamıyor; AI bulgusu yüzeysel eşleşmeye dayanmış.",
      evidenceMode: "PDF_KONUMU",
      evidencePage: targetEvidence?.page ?? 2,
      evidenceSection: targetEvidence?.section ?? "Teknik tasarım",
      evidenceQuote: targetEvidence?.text ?? "Raporda ilgili bölümdeki değer şartname sınırıyla çelişmektedir.",
    });
  });
  console.log(`  Reddedilen AI bulgusu: ${target.criterionName} (AI: UYGUN) → hakem sonucu OLUMSUZ`);
  const counts = judgeDecisionCounts(decisions);

  const review = {
    status: "completed", outcome: "rejected",
    outcomeNote: defaultOutcomeNote("rejected", findings, decisions),
    decisions: [], criterionDecisions: decisions, overallNote: "",
    finalFeedback: buildJudgeFeedback(findings, decisions), feedbackApproved: true,
    completedAt: new Date().toISOString(),
  };
  const saved = await patch(user, `/api/applications/${state.appB.id}`, { action: "save_review", review });
  check("nihai RET kaydedildi", saved.status === 200, JSON.stringify(saved.json?.error ?? ""));
  const stored = saved.json?.application?.review?.criterionDecisions ?? [];
  const rejected = stored.find((d) => d.judgeVerdict === "rejected");
  check("AI UYGUN bulgusu reddedildi; hakem OLUMSUZ sonucu kesinleşti",
    rejected?.aiVerdict === "UYGUN" && rejected?.judgeResult === "OLUMSUZ");
  check("hakem değerlendirmesinde gerekçe+sayfa+bölüm+alıntı kayıtlı",
    Boolean(rejected?.rejectionReason) && Number.isInteger(rejected?.evidencePage)
    && typeof rejected?.evidenceQuote === "string" && rejected.evidenceQuote.length > 0);
  // Benzerlik sonucu sayaçları ve NİHAİ kararı DEĞİŞTİRMEDİ (karar hakemindi).
  const savedSim = saved.json?.application?.evaluation?.similarityReport;
  check("benzerlik sonucu karar sonrasında da yalnızca dipnot (değişmedi)",
    savedSim?.approxPercent === simBefore?.approxPercent && savedSim?.level === simBefore?.level);

  const panel = await get(client("katilimci2"), "/api/applications");
  const seen = (panel.json?.applications ?? []).find((item) => item.id === state.appB.id);
  check("RET sonucu katılımcı2 panelinde görünüyor", seen?.status === "completed" && seen?.outcome === "rejected",
    JSON.stringify({ status: seen?.status, outcome: seen?.outcome }));
  const improvements = seen?.review?.finalFeedback?.improvements ?? [];
  check("gelişime açık yönler kesinleşmiş olumsuz kriterlerden oluşuyor",
    improvements.length === counts.olumsuz, `${improvements.length} vs ${counts.olumsuz}`);
  check("katılımcı benzerlik ayrıntısı/başka takım verisi görmüyor",
    !(seen?.evaluation) && (seen?.review?.criterionDecisions ?? []).length === 0);
  await saveState(state);
}

/* ============== AŞAMA 6 · DEĞERLENDİRME YÖNETİCİSİ ============== */
async function stage6() {
  section("AŞAMA 6 · Değerlendirme Yöneticisi: sayaçlar, pasifleştirme, sınırlar");
  const { user: ops } = await login("degerlendirmeyoneticisi1", "1234");
  const dashboard = await get(ops, "/api/operations");
  check("operasyon panosu açılıyor", dashboard.status === 200);
  const overview = (dashboard.json?.overview ?? []).find((o) => o.competitionName === COMPETITION_NAME);
  check("başvuru sayısı doğru (2)", overview?.total === 2, JSON.stringify(overview));
  check("tamamlanan analiz sayısı doğru (2)", overview?.analysisCompleted === 2);
  check("ONAY=1 ve RET=1 sayaçları doğru", overview?.accepted === 1 && overview?.rejected === 1,
    `accepted ${overview?.accepted} · rejected ${overview?.rejected}`);
  const workloads = dashboard.json?.judges ?? [];
  check("hakem iş yükü görünüyor", workloads.length >= 2);

  // Manuel atama: API kapalı; 04 başvuru içeriğini değiştiremez.
  const manualAssign = await patch(ops, `/api/applications/${state.appA.id}`, {
    action: "assign_judge", judgeId: "herhangi", note: "deneme",
  });
  check("manuel hakem atama API'de kapalı (403)", manualAssign.status === 403);
  const opsReview = await patch(ops, `/api/applications/${state.appA.id}`, {
    action: "save_review", review: { status: "completed", outcome: "rejected", outcomeNote: "x", decisions: [], overallNote: "", finalFeedback: { strengths: [], improvements: [], suggestions: [] }, feedbackApproved: true, completedAt: new Date().toISOString() },
  });
  check("04 nihai karar veremiyor (403)", opsReview.status === 403, `HTTP ${opsReview.status}`);
  const opsAnalysis = await patch(ops, `/api/applications/${state.appA.id}`, { action: "delete_analysis" });
  check("04 AI analizini silemiyor (403)", opsAnalysis.status === 403, `HTTP ${opsAnalysis.status}`);
  const app = await get(ops, `/api/applications/${state.appA.id}`);
  check("04 katılımcı PDF içeriği/kanıt metni görmüyor (redaksiyon)",
    app.status === 200 && app.json?.application?.fileName === null
    && (app.json?.application?.evaluation?.findings ?? []).every((f) => !f.rationale && (f.evidence ?? []).length === 0));

  // Pasifleştirme: yeni başvuru kapanır, hakem geçmişi görür.
  const off = await patch(ops, "/api/competitions", { action: "activation", competitionId: state.competitionId, active: false, note: "Simülasyon: pasif testi" });
  check("04 yarışmayı pasife alabiliyor", off.status === 200 && off.json?.competition?.isActive === false);
  const blocked = await submitApplication("katilimci3", "PasifDeneme-26", PDF_C);
  check("pasif yarışmaya yeni başvuru yapılamıyor", blocked.status === 409, `HTTP ${blocked.status}`);
  const { user: judgeA } = await judgeClientFor(state.appA.id);
  check("hakem pasif yarışmanın geçmiş başvurusunu görüyor",
    (await get(judgeA, `/api/applications/${state.appA.id}`)).status === 200);
  const on = await patch(ops, "/api/competitions", { action: "activation", competitionId: state.competitionId, active: true, note: "Simülasyon: yeniden açıldı" });
  check("yarışma yeniden AKTİF", on.status === 200 && on.json?.competition?.isActive === true);
  await saveState(state);
}

/* ========== AŞAMA 7 · ANALİZ SİLME VE YENİDEN ÇALIŞTIRMA ========== */
async function stage7() {
  section("AŞAMA 7 · Üçüncü başvuru: analiz → sil → yeniden çalıştır");
  const c = await submitApplication("katilimci3", "GokKalkan-24", PDF_C);
  check("GokKalkan test başvurusu alındı", c.status === 201, JSON.stringify(c.json?.error ?? ""));
  state.appC = { id: c.json.application.id, judgeId: c.json.application.assignedJudgeId, hash: c.localHash };
  await saveState(state);

  const run = await runAnalysis(state.appC.id, PDF_C);
  check("üçüncü başvurunun AI analizi tamamlandı", Boolean(run.saved.evaluation));
  const firstSim = run.saved.evaluation.similarityReport;
  const firstEmbeddingCalls = run.similarity?.embeddingApiCalls ?? 0;
  console.log(`  İlk koşu: benzerlik %${firstSim?.approxPercent} (${firstSim?.level}) · embeddingApiCalls ${firstEmbeddingCalls}`);

  // Sil: yalnız analiz + doğrulamalar + benzerlik sonucu gider; geri kalan korunur.
  const { user: judgeC } = await judgeClientFor(state.appC.id);
  const deleted = await patch(judgeC, `/api/applications/${state.appC.id}`, { action: "delete_analysis" });
  check("AI analizi silindi", deleted.status === 200, JSON.stringify(deleted.json?.error ?? ""));
  const after = deleted.json?.application;
  check("başvuru, takım ve hakem ataması korundu",
    after?.id === state.appC.id && after?.assignedJudgeId === state.appC.judgeId && after?.teamName === "GokKalkan-24");
  check("AI analizi ve doğrulamalar temizlendi", after?.evaluation === null && after?.review === null);
  check("başvuru yeniden analiz bekliyor", after?.status === "assigned", after?.status);
  const fileAfter = await fetch(`${BASE}/api/applications/${state.appC.id}/file`, { headers: { cookie: judgeC.cookie } });
  const fileBytes = Buffer.from(await fileAfter.arrayBuffer());
  check("PDF korundu (hash birebir)", fileAfter.status === 200 && sha256(fileBytes) === state.appC.hash);

  // Yeniden çalıştır: embedding önbelleği geçerli → embedding API'si TEKRAR ÇAĞRILMAZ.
  const rerun = await runAnalysis(state.appC.id, PDF_C);
  check("analiz yeniden çalıştırılabildi", Boolean(rerun.saved.evaluation));
  check("aynı PDF için embedding ikinci kez üretilmedi (önbellek)",
    (rerun.similarity?.embeddingApiCalls ?? -1) === 0, `embeddingApiCalls ${rerun.similarity?.embeddingApiCalls}`);
  const rerunSim = rerun.saved.evaluation.similarityReport;
  check("yeniden analizde benzerlik YENİDEN hesaplandı (eski sonuç geri dönmedi)",
    Boolean(rerunSim?.analyzedAt) && rerunSim.analyzedAt !== firstSim?.analyzedAt,
    `${firstSim?.analyzedAt} vs ${rerunSim?.analyzedAt}`);

  // Denetim izi: silme kaydı.
  const { user: ops } = await login("degerlendirmeyoneticisi1", "1234");
  const dashboard = await get(ops, "/api/operations");
  check("silme işlemi denetim izinde", (dashboard.json?.audit ?? []).some((entry) => entry.action === "ai_analysis_deleted"));
  check("silme olayı süreç geçmişinde", (dashboard.json?.recent ?? []).some((entry) => entry.event === "ai_analysis_deleted"));
  await saveState(state);
}

/* ================================ SONUÇ ================================ */
async function main() {
  const stageName = process.argv[2];
  const stages = {
    stage1, stage2, stage3, stage4, "stage4-decide": stage4decide,
    stage5, "stage5-decide": stage5decide, stage6, stage7,
  };
  if (!stages[stageName]) {
    console.error(`Bilinmeyen aşama: ${stageName}. Geçerli: ${Object.keys(stages).join(", ")}`);
    process.exit(1);
  }
  await stages[stageName]();
  console.log(`\nSonuç: ${passed} PASS · ${failures.length} FAIL`);
  if (failures.length) { for (const f of failures) console.log(`  FAIL: ${f}`); process.exit(1); }
}

main().catch((error) => { console.error("\nSimülasyon hatası:", error); process.exit(1); });
