import { criterionEliminates } from "../app/lib/evaluation-summary.ts";
import { acquireAnalysisPermit } from "../app/lib/request-guard.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseCriterion = {
  id: "regression",
  name: "Aşama 3 ardışık başarısızlık koşulu",
  type: "formula",
  maxScore: null,
  weight: null,
  required: true,
  violationOutcome: "Dört ardışık turda 0 puan verilir.",
  evaluationMethod: "deterministic",
  sourcePage: 1,
  sourceText: "",
  aiInterpretation: "",
  confidence: "high",
  active: true,
  origin: "document",
  effect: "threshold",
};

assert(!criterionEliminates(baseCriterion), "0 puan koşulu eleme sayılmamalıdır.");
assert(
  criterionEliminates({ ...baseCriterion, name: "Takım elenir", violationOutcome: "Takım yarışma dışı bırakılır." }),
  "Açık eleme sonucu yakalanmalıdır.",
);

process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS = "60000";
process.env.ANALYSIS_RATE_LIMIT_MAX = "10";
process.env.ANALYSIS_MAX_CONCURRENT = "1";
const first = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-a" } }));
assert(first.ok, "İlk analiz izni verilmelidir.");
const concurrent = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-b" } }));
assert(!concurrent.ok && concurrent.reason === "concurrency", "Eşzamanlı analiz sınırı çalışmalıdır.");
if (first.ok) first.release();

process.env.ANALYSIS_RATE_LIMIT_MAX = "1";
const rateFirst = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-c" } }));
assert(rateFirst.ok, "Yeni istemcinin ilk isteği kabul edilmelidir.");
if (rateFirst.ok) rateFirst.release();
const rateSecond = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-c" } }));
assert(!rateSecond.ok && rateSecond.reason === "rate", "İstek hız sınırı çalışmalıdır.");

console.log("Regression tests: PASS");

/*
 * `criteria.id` genel bir birincil anahtardır; analiz çıktısı ise her belgede aynı
 * "criterion-1..N" kimliklerini üretir. Satır anahtarı profille ve sırayla
 * nitelenmezse İKİNCİ profil yayımı UNIQUE ihlaliyle 500 döner.
 */
{
  const source = await import("node:fs").then((fs) => fs.readFileSync("app/lib/workflow-db.ts", "utf8"));
  assert(
    /`\$\{id\}:\$\{position\}:\$\{criterion\.id \|\| "kriter"\}`/.test(source),
    "criteria satır kimliği profil ve sıra ile nitelenmelidir.",
  );
  const rowKey = (profileId, position, criterionId) => `${profileId}:${position}:${criterionId || "kriter"}`;
  const ids = Array.from({ length: 74 }, (_, index) => `criterion-${index + 1}`);
  const keys = [
    ...ids.map((id, index) => rowKey("profil-A", index, id)),
    ...ids.map((id, index) => rowKey("profil-B", index, id)),
    // Aynı profilde yanlışlıkla tekrarlanan kriter kimliği de çakışmamalı.
    rowKey("profil-C", 0, "manual-1"), rowKey("profil-C", 1, "manual-1"),
  ];
  assert(new Set(keys).size === keys.length, "Farklı profillerin kriter satırları çakışmamalıdır.");
}

/*
 * Yarışma seçimi: yayımlanmış profilin adı şartnameden çıkarılır ve koddaki sabit
 * COMPETITIONS havuzunda bulunmayabilir. Arama bu yüzden verilen liste üzerinde
 * çalışabilmelidir; aksi hâlde "yayında ama seçilemiyor" durumu doğar.
 */
{
  const { searchCompetitionList, searchCompetitions } = await import("../app/lib/competitions.ts");
  const open = [
    { name: "TEKNOFEST Havacılık, Uzay ve Teknoloji Festivali", field: "Genel" },
    { name: "İnsansız Deniz Aracı Yarışması", field: "Deniz" },
  ];
  assert(
    !searchCompetitions("TEKNOFEST Havacılık").items.some((item) => item.name === open[0].name),
    "Kurulum varsayımı: bu ad kayıtlı havuzda yok.",
  );
  assert(
    searchCompetitionList(open, "teknofest").items.some((item) => item.name === open[0].name),
    "Kayıtlı havuzda olmayan, başvuruya açık yarışma aramada bulunmalıdır.",
  );
  assert(searchCompetitionList(open, "").items.length === 2, "Boş aramada açık yarışmaların tamamı listelenmelidir.");
  assert(
    searchCompetitionList(open, "deniz").items.length === 1,
    "Arama açık yarışma listesi içinde daraltmalıdır.",
  );
  assert(searchCompetitionList([], "").items.length === 0, "Açık yarışma yoksa liste boş olmalıdır.");
}

/*
 * Gemini hata taksonomisi: "İşlem tamamlanamadı" gibi içi boş bir cümle
 * üretilmemeli; her yukarı akış hatası nedenini söylemeli ve geçici model
 * yokluğu istemcinin deterministik yedeğine düşebilmesi için 503 dönmeli.
 */
{
  const { describeGeminiFailure } = await import("../app/lib/gemini-generation.ts");
  const overloaded = describeGeminiFailure(503, "The model is overloaded.", "AI rapor analizi");
  assert(overloaded.httpStatus === 503, "Model yoğunluğu 503 ile bildirilmeli (istemci deterministik yedeğe düşer).");
  assert(overloaded.transient, "Model yoğunluğu geçici sayılmalıdır.");
  assert(/yoğun/.test(overloaded.message), "Model yoğunluğu mesajı nedenini söylemelidir.");

  const billing = describeGeminiFailure(429, "Your prepayment credits are depleted.", "AI rapor analizi");
  assert(/kredisi tükenmiş/.test(billing.message), "Tükenmiş bakiye, hız sınırından ayrı bildirilmelidir.");

  const auth = describeGeminiFailure(401, "API key not valid", "AI rapor analizi");
  assert(auth.httpStatus === 502, "Yukarı akış 401'i oturumu düşürmemek için 502 ile iletilmelidir.");
  assert(!auth.transient, "Kimlik doğrulama hatası geçici değildir.");

  const unknown = describeGeminiFailure(502, "quota metric 'x' exhausted", "AI rapor analizi");
  assert(
    unknown.message.includes("quota metric"),
    "Sınıflandırılamayan hatada sunucunun bildirdiği neden mesaja yazılmalıdır.",
  );
  assert(
    !/^AI rapor analizi tamamlanamadı\.$/.test(unknown.message),
    "İçi boş 'tamamlanamadı' cümlesi üretilmemelidir.",
  );
}
