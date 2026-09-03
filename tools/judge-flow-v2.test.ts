/**
 * HAKEM AKIŞI · KRİTER KAPSAMI · YÜKLEME BÜTÜNLÜĞÜ REGRESYON TESTLERİ
 *
 * GÖREV 2/3 kabul ölçütlerinin (16 senaryo) otomatik karşılığı. Canlı Gemini
 * çağrısı YAPILMAZ: bütün senaryolar saf işlevler, gerçek göç dosyaları
 * (node:sqlite) ve kaynak sözleşmesi üzerinden doğrulanır.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  analyzeReportLayout,
  buildHeadingChecks,
  categoryFitOf,
  contentPresenceCriteria,
  criteriaScopeOf,
  detectLanguage,
  evidenceStageSummary,
  matchCriterionInPages,
  requiredHeadingsOf,
  summarizeFindings,
} from "../app/lib/report-prechecks.ts";
import {
  buildJudgeFeedback,
  criterionDecisionError,
  effectiveVerdictOf,
  emptyCriterionDecisions,
  judgeDecisionCounts,
  validateCriterionDecisions,
} from "../app/lib/judge-review.ts";
import { quoteFoundOnPage, readReportTextLayer, type ReportTextLayer } from "../app/lib/report-text-layer.ts";
import { evaluationCacheContext } from "../app/lib/evaluation-cache-key.ts";
import type {
  Criterion,
  CriterionControlType,
  CriterionFinding,
  CriterionVerifiability,
  JudgeCriterionDecision,
  ProfileExport,
  RuleVerdict,
} from "../app/lib/types.ts";

/* --------------------------------- Yardımcılar --------------------------------- */

function criterion(input: {
  id: string;
  name: string;
  verifiability?: CriterionVerifiability;
  controlType?: CriterionControlType;
  stage?: Criterion["stage"];
  required?: boolean;
}): Criterion {
  return {
    id: input.id,
    name: input.name,
    stage: input.stage ?? "criteria_evidence",
    required: input.required ?? true,
    active: true,
    description: `${input.name} açıklaması`,
    verifiability: input.verifiability ?? "PDF_DENETLENEBILIR",
    controlType: input.controlType,
    sourcePage: 3,
    sourceText: `${input.name} kuralı şartnamede yazılıdır.`,
  } as Criterion;
}

function profileOf(criteria: Criterion[], requiredHeadings: string[] = []): ProfileExport {
  return {
    version: "2.0",
    status: "approved",
    sourceDocument: { name: "sartname.pdf", pages: 20, analyzedAt: "2026-08-25T00:00:00.000Z" },
    setup: {
      competition: "Test Yarışması",
      category: "Test",
      stage: "Kritik Tasarım Raporu",
      reportType: "Kritik Tasarım Raporu",
      year: "2026",
      allowedFormats: ["PDF"],
      maxFileSizeMb: 0,
      maxFileCount: 0,
      defaultViolationAction: "unspecified",
      reportLanguage: "Türkçe",
    },
    templateProfile: { provided: requiredHeadings.length > 0, name: "", pages: 0, requiredHeadings, notes: [] },
    criteria,
  } as ProfileExport;
}

function finding(id: string, name: string, verdict: RuleVerdict, page: number | null = 4, quote = ""): CriterionFinding {
  return {
    criterionId: id,
    criterionName: name,
    stage: "criteria_evidence",
    required: true,
    verifiability: verdict === "DEGERLENDIRILEMEDI" ? "HARICI_KANIT_GEREKLI" : "PDF_DENETLENEBILIR",
    verdict,
    rationale: `${name} için AI gerekçesi.`,
    evidence: page ? [{ page, paragraph: 1, section: "3.2 Tasarım", text: quote || `${name} kanıt alıntısı` }] : [],
    evidenceMissing: !page,
  };
}

/** Göçlerin tamamı uygulanmış, boş bir bellek içi veri tabanı. */
function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").filter((item) => item.endsWith(".sql")).sort()) {
    database.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  return database;
}

/** Metin katmanı OLMAYAN (taranmış belge benzeri) geçerli tek sayfalık PDF. */
function textlessPdf(): ArrayBuffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = Buffer.from(pdf, "latin1");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const EVALUATION_APP = readFileSync("app/components/evaluation-app.tsx", "utf8");
const PARTICIPANT_PORTAL = readFileSync("app/components/participant-portal.tsx", "utf8");
const WORKFLOW_DB = readFileSync("app/lib/workflow-db.ts", "utf8");
const VERSIONS_ROUTE = readFileSync("app/api/applications/[id]/versions/route.ts", "utf8");
const ACCOUNTS_ROUTE = readFileSync("app/api/admin/accounts/[id]/route.ts", "utf8");
const EVALUATE_ROUTE = readFileSync("app/api/evaluate-report/route.ts", "utf8");

/* ------------------------------- 1 · Sayaçlar ------------------------------- */

test("1) 12 yayımlı kriterin 9'u PDF-denetlenebilir olduğunda sayaçlar doğru görünür", () => {
  const criteria = [
    ...Array.from({ length: 9 }, (_, index) => criterion({ id: `pdf-${index}`, name: `PDF kuralı ${index}` })),
    criterion({ id: "video-1", name: "Tanıtım videosu", verifiability: "HARICI_KANIT_GEREKLI" }),
    criterion({ id: "portal-1", name: "Portal yüklemesi", verifiability: "HARICI_KANIT_GEREKLI" }),
    criterion({ id: "saha-1", name: "Saha teslimi", verifiability: "HAKEM_KONTROLU_GEREKLI" }),
  ];
  const scope = criteriaScopeOf(profileOf(criteria));
  assert.equal(scope.published, 12, "Yayımlı toplam kriter sayısı 12 olmalıdır.");
  assert.equal(scope.pdfEvaluable, 9, "PDF üzerinden değerlendirilebilen kriter sayısı 9 olmalıdır.");
  assert.equal(scope.outsidePdf, 3, "PDF dışında kalan kriter sayısı 3 olmalıdır.");
  assert.deepEqual(scope.outsideNames, ["Tanıtım videosu", "Portal yüklemesi", "Saha teslimi"]);

  // Pasif kriter hiçbir sayaca girmez.
  const withInactive = [...criteria, { ...criterion({ id: "pasif", name: "Pasif kural" }), active: false } as Criterion];
  assert.equal(criteriaScopeOf(profileOf(withInactive)).published, 12, "Pasif kriter yayımlı sayısına eklenmemelidir.");

  // Ekran cümlesi bu üç sayıdan kurulur; sabit metin yazılmaz.
  assert.match(EVALUATION_APP, /yayımlı kriterden \{scope\.pdfEvaluable\}/, "Kapsam cümlesi sayaçlardan üretilmelidir.");
  assert.match(EVALUATION_APP, /hakem kararı bekleyen/, "Hakem kararı bekleyen kriter sayacı gösterilmelidir.");
});

/* ------------------------- 2 · PDF dışı kriterler zarar vermez ------------------------- */

test("2) PDF dışı kriterler hata ve nihai karar engeli oluşturmaz", () => {
  const findings = [
    finding("pdf-1", "Ağırlık sınırı", "BASARILI"),
    finding("pdf-2", "Batarya güvenliği", "KRITIK_HATA"),
    // Eski kayıtlardan gelebilecek PDF dışı bulgu.
    finding("video-1", "Tanıtım videosu", "DEGERLENDIRILEMEDI", null),
  ];
  const summary = summarizeFindings(findings);
  assert.equal(summary.disiKanit, 1, "PDF dışı kural ayrı sayılmalıdır.");
  assert.equal(summary.basarili, 1);
  assert.equal(summary.kritikHata, 1, "PDF dışı kural hata sayaçlarına eklenmemelidir.");

  // Karar listesi yalnızca PDF kriterlerinden kurulur: PDF dışı kural hakemden karar istemez.
  const pdfFindings = findings.filter((item) => item.verdict !== "DEGERLENDIRILEMEDI");
  const decisions = emptyCriterionDecisions(pdfFindings).map((decision) => ({ ...decision, judgeVerdict: "approved" as const }));
  assert.equal(
    validateCriterionDecisions(pdfFindings, decisions, true),
    "",
    "PDF kriterleri kesinleştiğinde nihai karar kapısı PDF dışı kural yüzünden kapanmamalıdır.",
  );
  // Katılımcıya PDF dışı kural eksiklik olarak GÖNDERİLMEZ.
  const feedback = buildJudgeFeedback(pdfFindings, decisions);
  assert.ok(
    ![...feedback.strengths, ...feedback.improvements].some((line) => line.includes("Tanıtım videosu")),
    "PDF dışı kural katılımcı geri bildirimine yazılmamalıdır.",
  );
});

/* --------------------- 3 · İçindekiler satırı kanıt değildir --------------------- */

test("3) içindekiler satırı boş bölümü dolu göstermez", () => {
  const pages = [
    "KAPAK SAYFASI\nTest Takımı\n2026",
    "İÇİNDEKİLER\n1 Giriş .......... 3\n2 Yapısal Analiz Sonuçları .......... 8\n3 Sonuç .......... 12\n4 Kaynaklar .......... 14",
    "1 GİRİŞ\nBu rapor, aracın tasarım sürecini ve doğrulama çalışmalarını ayrıntılı biçimde açıklamak "
      + "amacıyla hazırlanmıştır. Sistem mimarisi, alt bileşenler ve test sonuçları ilgili bölümlerde sunulmuştur. "
      + "Çalışmanın kapsamı ve sınırlamaları da bu bölümde belirtilmiştir. Rapor boyunca kullanılan kısaltmalar "
      + "ekte listelenmiştir.",
  ];
  const layout = analyzeReportLayout(pages);
  assert.ok(layout.tableOfContentsPages.has(2), "İçindekiler sayfası tanınmalıdır.");

  // "Yapısal Analiz Sonuçları" YALNIZCA içindekilerde geçiyor: bölüm kanıtlanmadı.
  const match = matchCriterionInPages({ name: "Yapısal Analiz Sonuçları" }, pages, layout);
  assert.equal(match.found, false, "Yalnızca içindekilerde geçen başlık bulunmuş sayılmamalıdır.");
  assert.equal(match.tableOfContentsOnly, true, "Eşleşmenin içindekilerden geldiği işaretlenmelidir.");
  assert.equal(match.contentLength, 0, "İçindekiler eşleşmesi içerik doluluğu üretmemelidir.");

  const checks = buildHeadingChecks(profileOf([], ["Yapısal Analiz Sonuçları"]), pages);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].present, false, "Başlık VAR gösterilmemelidir.");
  assert.equal(checks[0].contentFilled, false, "İçerik DOLU gösterilmemelidir.");
  assert.match(checks[0].note ?? "", /içindekiler/i, "Sebep hakeme açıkça yazılmalıdır.");

  // Gövdede gerçekten bulunan bölüm normal biçimde bulunur ve dolu sayılır.
  const real = matchCriterionInPages({ name: "Giriş bölümü" }, pages, layout);
  assert.equal(real.tableOfContentsOnly, false, "Gövdede bulunan bölüm içindekiler eşleşmesi sayılmamalıdır.");
});

test("3b) her içerik kriteri zorunlu başlık sayılmaz; controlType'a göre ayrılır", () => {
  const criteria = [
    criterion({ id: "h1", name: "Sistem Mimarisi", stage: "headings_content", controlType: "BIREBIR_BASLIK" }),
    criterion({ id: "c1", name: "Batarya kapasitesi bilgisi", stage: "headings_content", controlType: "ICERIK_VARLIGI" }),
    criterion({ id: "c2", name: "Kapsam uygunluğu", stage: "headings_content", controlType: "ANLAMSAL_UYGUNLUK" }),
  ];
  const profile = profileOf(criteria);
  assert.deepEqual(requiredHeadingsOf(profile), ["Sistem Mimarisi"], "Yalnızca BIREBIR_BASLIK zorunlu başlıktır.");
  assert.deepEqual(
    contentPresenceCriteria(profile).map((item) => item.id),
    ["c1", "c2"],
    "İçerik kriterleri başlık listesine değil içerik listesine gider.",
  );
});

/* ------------------------------ 4 · Dil tespiti ------------------------------ */

test("4) gerçek Türkçe metin yanlışlıkla unknown olmaz", () => {
  // Sabit durak sözcükleri ("ve", "bir", "bu", "için") BİLİNÇLİ olarak yok:
  // eski tespit bu metni "unknown" sayıyordu.
  const technicalTurkish = [
    "Aracın gövde yapısı karbon fiber kompozit malzemeden üretilmiştir. Dayanım hesapları sonlu elemanlar "
    + "yöntemiyle doğrulanmıştır. Motor seçimi itki gereksinimlerine göre yapılmış, batarya kapasitesi görev "
    + "süresine göre boyutlandırılmıştır. Kanat profilleri rüzgâr tünelinde denenmiş, ölçüm sonuçları "
    + "tablolarda sunulmuştur. Yazılım mimarisi katmanlı biçimde tasarlanmış, haberleşme protokolleri "
    + "şifrelenmiştir. Güvenlik senaryoları saha koşullarında sınanmıştır.",
  ];
  assert.equal(detectLanguage(technicalTurkish), "tr", "Teknik Türkçe metin Türkçe olarak tanınmalıdır.");

  const english = [
    "The vehicle structure was manufactured from carbon fiber composite material. Strength calculations were "
    + "verified using the finite element method. Motor selection was based on thrust requirements and battery "
    + "capacity was sized according to the mission duration. Wing profiles were tested in a wind tunnel and the "
    + "measurement results are presented in the tables of this section.",
  ];
  assert.equal(detectLanguage(english), "en", "İngilizce metin İngilizce olarak tanınmalıdır.");

  // Gerçekten yetersiz metin (taranmış kapak) hâlâ "unknown" olmalıdır.
  assert.equal(detectLanguage(["Rapor 2026"]), "unknown", "Çok kısa metin için karar verilmemelidir.");
  assert.equal(detectLanguage([]), "unknown");
});

/* ----------------- 5-7 · AI bulgusu ile hakem değerlendirmesinin ayrımı ----------------- */

function decisionFor(finding: CriterionFinding): JudgeCriterionDecision {
  return emptyCriterionDecisions([finding])[0];
}

test("5) AI OLUMSUZ bulgusunu aynen kullanmak kesin sonucu OLUMSUZ yapar", () => {
  const item = finding("c1", "Ağırlık sınırı", "KRITIK_HATA");
  const decision: JudgeCriterionDecision = { ...decisionFor(item), judgeVerdict: "approved" };
  assert.equal(decision.aiVerdict, "OLUMSUZ");
  assert.equal(effectiveVerdictOf(decision), "OLUMSUZ", "AI bulgusu aynen kullanıldığında kesin sonuç AI sonucudur.");
  // Aynen kullanmak ek form doldurmayı gerektirmez.
  assert.equal(criterionDecisionError(decision), "", "AI bulgusunu aynen kullanmak ek alan istememelidir.");
  assert.equal(judgeDecisionCounts([decision]).olumsuz, 1);
  assert.equal(judgeDecisionCounts([decision]).pending, 0);

  // Buton adı artık başvuru onayı/reddi ile karıştırılmıyor.
  assert.match(EVALUATION_APP, /AI bulgusunu aynen kullan/, "İşlem adı açık olmalıdır.");
  assert.match(EVALUATION_APP, /Hakem değerlendirmesi gir/, "İkinci işlem adı açık olmalıdır.");
});

test("6) hakem AI sonucunu UYGUN olarak değiştirebilir ve gerekçesi kaydedilir", () => {
  const item = finding("c1", "Ağırlık sınırı", "KRITIK_HATA");
  const decision: JudgeCriterionDecision = {
    ...decisionFor(item),
    judgeVerdict: "rejected",
    judgeResult: "UYGUN",
    rejectionReason: "Şartnamedeki sınır kuru ağırlık içindir; rapordaki değer yakıtlı ağırlıktır ve sınırı aşmaz.",
    evidenceMode: "PDF_KONUMU",
    evidencePage: 4,
    evidenceSection: "3.2 Tasarım",
    evidenceQuote: "Kuru ağırlık 96 kg olarak ölçülmüştür.",
  };
  assert.equal(criterionDecisionError(decision), "", "Sonuç + kaynak + gerekçe verilmişse karar geçerlidir.");
  assert.equal(effectiveVerdictOf(decision), "UYGUN", "Kesin sonuç hakemin yazdığı sonuç olmalıdır.");
  // AI bulgusu DEĞİŞMEDEN korunur: denetim iki kaydı ayrı tutar.
  assert.equal(decision.aiVerdict, "OLUMSUZ", "AI'nin özgün sonucu üzerine yazılmamalıdır.");
  assert.equal(item.rationale, "Ağırlık sınırı için AI gerekçesi.", "AI'nin özgün gerekçesi korunmalıdır.");
  assert.equal(judgeDecisionCounts([decision]).uygun, 1);
  assert.equal(judgeDecisionCounts([decision]).findingsRejected, 1, "Denetim sayacı sapmayı görmelidir.");
});

test("7) hakem yalnız AI açıklamasını değiştirip aynı sonucu koruyabilir", () => {
  const item = finding("c1", "Kaynak gösterimi", "BASARILI");
  const decision: JudgeCriterionDecision = {
    ...decisionFor(item),
    judgeVerdict: "rejected",
    // Sonuç AI ile AYNI; değişen yalnızca açıklama ve kaynak konumu.
    judgeResult: "UYGUN",
    rejectionReason: "Sonuç doğru ama gerekçe eksikti: kaynakça 12. sayfada, AI'nin gösterdiği yerde değil.",
    evidenceMode: "PDF_KONUMU",
    evidencePage: 12,
    evidenceSection: "Kaynakça",
    evidenceQuote: "Kaynakça bölümünde on iki referans listelenmiştir.",
  };
  assert.equal(criterionDecisionError(decision), "", "Yalnız açıklamayı değiştirmek geçerli bir hakem değerlendirmesidir.");
  assert.equal(decision.aiVerdict, effectiveVerdictOf(decision), "Sonuç AI ile aynı kalabilir.");
  assert.equal(effectiveVerdictOf(decision), "UYGUN");
  const feedback = buildJudgeFeedback([item], [decision]);
  assert.ok(feedback.strengths.some((line) => line.includes("Kaynak gösterimi")), "Kesinleşmiş UYGUN sonuç güçlü yönlere yazılır.");

  // Form AI verileriyle önceden doldurulur ki hakem yalnız bir alanı değiştirebilsin.
  assert.match(EVALUATION_APP, /judgeResult: previous\?\.judgeResult \?\? aiVerdictOf\(finding\.verdict\)/,
    "Hakem formu AI sonucuyla önceden doldurulmalıdır.");
  assert.match(EVALUATION_APP, /quote: previous\?\.evidenceQuote \|\| aiEvidence\?\.text \|\| ""/,
    "Alıntı alanı AI kanıtından önceden doldurulmalıdır.");
});

test("8) “Raporda bulunamadı” durumunda sahte sayfa/alıntı istenmez", () => {
  const item = finding("c1", "Yapısal analiz bölümü", "KRITIK_HATA", null);
  const decision: JudgeCriterionDecision = {
    ...decisionFor(item),
    judgeVerdict: "rejected",
    judgeResult: "OLUMSUZ",
    rejectionReason: "Şartnamenin istediği yapısal analiz bölümü raporda hiç yok.",
    evidenceMode: "RAPORDA_BULUNAMADI",
    missingContent: "Yapısal analiz sonuçları bölümü",
  };
  assert.equal(criterionDecisionError(decision), "", "Olmayan içerik için sayfa ve alıntı istenmemelidir.");
  assert.equal(decision.evidencePage, null);
  assert.equal(decision.evidenceQuote, "");

  // Aranan bölüm adı ise ZORUNLUDUR: aksi hâlde gerekçe doğrulanamaz.
  assert.match(
    criterionDecisionError({ ...decision, missingContent: "" }),
    /aranan bölüm\/başlık adı zorunludur/i,
  );
  // OLUMSUZ sonuç için gerekçe her hâlükârda zorunludur.
  assert.match(criterionDecisionError({ ...decision, rejectionReason: "  " }), /hakem gerekçesi zorunludur/i);
});

/* ---------------------- 9 · Kanıtın sayfa ve alıntı bağı ---------------------- */

test("9) kanıt düğmesi doğru PDF sayfasını açar; alıntı sunucuda sayfaya bağlanır", () => {
  const layer: ReportTextLayer = {
    pages: [
      "Kapak sayfası · Test Takımı",
      "Sistem mimarisi katmanlı biçimde tasarlanmıştır.",
      "Kuru ağırlık 96 kg olarak ölçülmüştür ve şartname sınırının altındadır.",
    ],
    pageCount: 3,
    textLength: 160,
  };
  assert.equal(quoteFoundOnPage(layer, 3, "Kuru ağırlık 96 kg olarak ölçülmüştür"), true, "Alıntı doğru sayfada bulunmalıdır.");
  assert.equal(quoteFoundOnPage(layer, 2, "Kuru ağırlık 96 kg olarak ölçülmüştür"), false, "Yanlış sayfa reddedilmelidir.");
  // Satır sonu ve fazla boşluk alıntıyı kaçırmamalı.
  assert.equal(quoteFoundOnPage(layer, 3, "Kuru   ağırlık\n96 kg olarak ölçülmüştür"), true);
  // Doğrulanamayan durumlar karar düşürmez: null döner.
  assert.equal(quoteFoundOnPage(layer, 9, "Kuru ağırlık 96 kg"), null, "Aralık dışı sayfa doğrulanamaz.");
  assert.equal(quoteFoundOnPage(layer, 3, "bkz"), null, "Çok kısa alıntı doğrulanamaz.");

  // Sunucu bu doğrulamayı karar kaydında gerçekten çağırır.
  assert.match(WORKFLOW_DB, /await verifyJudgeQuotes\(before\.file_key, review\.criterionDecisions\)/,
    "Karar kaydı hakem alıntısını sunucuda doğrulamalıdır.");
  assert.match(WORKFLOW_DB, /quoteFoundOnPage\(layer, decision\.evidencePage as number, decision\.evidenceQuote\)/);
});

/* ------------------- 10 · Aynı PDF, iki başvuru: künye karışmaz ------------------- */

test("10) aynı PDF'ye sahip iki farklı başvuru metadata karışması yaşamaz", () => {
  const shared = {
    promptVersion: "report-v7",
    reportHash: "ayni-pdf-ozeti",
    criteriaHash: "ayni-kriter-ozeti",
    criteriaVersion: 3,
    model: "gemini-3.6-flash",
    mediaResolution: "LOW",
  };
  const first = evaluationCacheContext({ ...shared, applicationId: "app-1", submissionVersionId: "ver-1" });
  const second = evaluationCacheContext({ ...shared, applicationId: "app-2", submissionVersionId: "ver-2" });
  assert.notEqual(first, second, "Farklı başvurular aynı önbellek anahtarına düşmemelidir.");
  assert.match(first, /app-1/, "Anahtar başvuru kimliğini kapsamalıdır.");
  assert.match(first, /ver-1/, "Anahtar rapor sürümünü kapsamalıdır.");

  // Aynı başvurunun aynı sürümü tekrar kullanılabilir (gereksiz model çağrısı yok).
  assert.equal(
    evaluationCacheContext({ ...shared, applicationId: "app-1", submissionVersionId: "ver-1" }),
    first,
    "Aynı başvuru ve sürüm için anahtar kararlı olmalıdır.",
  );
  // Yeni rapor sürümü eski sonucu kullanmaz.
  assert.notEqual(
    evaluationCacheContext({ ...shared, applicationId: "app-1", submissionVersionId: "ver-2" }),
    first,
    "Yeni rapor sürümü eski analizi yeniden kullanmamalıdır.",
  );
});

/* -------------- 11 · Başarısız yeniden analiz eski sonucu silmez -------------- */

test("11) yeniden analiz başarısız olduğunda eski başarılı analiz ve hakem kararları korunur", () => {
  const database = migratedDatabase();
  database.prepare(`INSERT INTO competition_applications
    (id, participant_id, participant_name, participant_email, competition_key, competition_name,
     profile_id, file_key, file_name, mime_type, size_bytes, status, submitted_at, updated_at,
     evaluation_json, review_json, evaluation_criteria_version, evaluation_criteria_hash, evaluation_pdf_hash)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'application/pdf', ?, 'awaiting_judge', ?, ?, ?, ?, 4, 'kriter-ozeti', 'pdf-ozeti')`)
    .run("app-1", "p-1", "Ada", "ada@test", "roket", "Roket", "r2/app-1.pdf", "rapor.pdf", 2048,
      "2026-08-25", "2026-08-25", '{"version":"2.0","findings":[{"criterionId":"c1"}]}', '{"criterionDecisions":[{"criterionId":"c1"}]}');

  // saveApplicationEvaluation'ın "önceki başarılı analizi koru" yolundaki SQL'i.
  database.prepare(
    `UPDATE competition_applications
     SET status = 'awaiting_judge', judge_id = ?, judge_name = ?, updated_at = ?
     WHERE id = ? AND status <> 'completed'`,
  ).run("judge-1", "Hakem", "2026-08-26", "app-1");

  const row = database.prepare(
    `SELECT status, evaluation_json, review_json, evaluation_criteria_version, evaluation_pdf_hash
     FROM competition_applications WHERE id = 'app-1'`,
  ).get() as Record<string, unknown>;
  // Durum 'analysis_failed' DEĞİL: elde kullanılabilir analiz var, hakem nihai
  // kararını verebilmelidir. Başarısızlık geçmiş satırında ve olayda tutulur.
  assert.equal(row.status, "awaiting_judge", "Kullanılabilir analiz varken hakem kilitlenmemelidir.");
  assert.match(String(row.evaluation_json), /"version":"2.0"/, "Önceki başarılı AI analizi SİLİNMEMELİDİR.");
  assert.match(String(row.review_json), /criterionDecisions/, "Hakem kriter kararları SİLİNMEMELİDİR.");
  assert.equal(row.evaluation_criteria_version, 4, "Kriter sürümü bağı korunmalıdır.");
  assert.equal(row.evaluation_pdf_hash, "pdf-ozeti", "PDF özeti bağı korunmalıdır.");
  database.close();

  // Başarısız deneme kendi geçmiş satırını ayrıca yazar; hata kaybolmaz.
  assert.match(WORKFLOW_DB, /const keepPreviousAnalysis = failed && Boolean\(current\.evaluation_json\)/);
  assert.match(WORKFLOW_DB, /ÖNCEKİ BAŞARILI analiz ve hakem kararları korundu/);
  assert.match(EVALUATION_APP, /önceki başarılı analiz ve verdiğiniz kriter kararları korundu/i,
    "Ekran, eski analizin korunduğunu söylemelidir.");
  // Yeni sonuç ancak BAŞARIYLA üretildiğinde eskisinin üzerine yazılır.
  assert.match(WORKFLOW_DB, /failed \? null : binding\?\.pdfHash \?\? null/,
    "Bağ sütunları yalnızca başarılı sonuçta güncellenmelidir.");
});

test("11b) “Analizi yenile” hakem kuyruğundaki dosyada da çalışır", () => {
  // Başarılı analizden sonra durum 'awaiting_judge' olur. Eskiden yeniden
  // analiz bu durumu kabul etmiyor ve düğme sunucuda 409 alıyordu.
  const marker = WORKFLOW_DB.slice(WORKFLOW_DB.indexOf("export async function markApplicationAnalyzing"));
  const body = marker.slice(0, marker.indexOf("\nexport "));
  assert.match(body, /"awaiting_judge", "judge_in_review"\]/, "Analiz edilmiş dosya yeniden analiz edilebilmelidir.");
  // Kesinleşmiş karar ve dondurulmuş yarışma korumaları YERİNDE kalır.
  assert.doesNotMatch(body, /"completed"/, "Kesinleşmiş karar yeniden analiz listesine girmemelidir.");
  assert.match(WORKFLOW_DB, /Bu başvurunun nihai kararı kesinleştirildi; analiz sonucu yazmak için/,
    "Kesinleşmiş kararda analiz yazımı engellenmeye devam etmelidir.");
  // Kendisine atanmamış dosyada analiz başlatılamaz (self-assign yok).
  assert.match(body, /judge\.roleCode === "02" && current\.assigned_judge_id !== judge\.id/);
});

/* ------------------------- 12 · Taranmış PDF koruması ------------------------- */

test("12) taranmış PDF açık OCR hatası üretir", async () => {
  await assert.rejects(
    () => readReportTextLayer(textlessPdf()),
    (error: Error) => {
      assert.equal(error.name, "ReportOcrRequiredError");
      assert.match(error.message, /okunabilir metin katmanı bulunmuyor/i);
      assert.match(error.message, /OCR uygulanmış bir PDF yüklenmelidir/i);
      return true;
    },
    "Metin katmanı olmayan rapor analiz edilmeden reddedilmelidir.",
  );
  // Uç, bu hatayı makine okunur kodla döndürür ve analiz hiç başlamaz.
  assert.match(EVALUATE_ROUTE, /code: "OCR_REQUIRED"/, "Uç OCR hatasını kodla bildirmelidir.");
  assert.match(EVALUATION_APP, /caught\.code === "OCR_REQUIRED"/, "Ekran OCR durumunu ayrı ele almalıdır.");
  // Kanıtsız analiz normal sonuç gibi sunulmaz: alıntılar sessizce silinmez.
  const evaluator = readFileSync("app/lib/report-evaluator.ts", "utf8");
  assert.match(evaluator, /istemcide doğrulanmadı/, "Metin okunamadığında alıntılar sessizce silinmemelidir.");
});

/* -------------------- 13 · Revizyon yüklemesi ve sürüm bütünlüğü -------------------- */

test("13) revizyon PDF'si R2'ye eksiksiz yazılır ve eski sürüm güvenle korunur", () => {
  // İlk başvuru rotasıyla AYNI güvenli yöntem: Blob + yazım doğrulaması.
  // `file.stream()` yalnızca eski bugu açıklayan YORUMDA geçebilir; çağrı olarak geçmemeli.
  assert.doesNotMatch(VERSIONS_ROUTE, /put\([^)]*\.stream\(\)/, "Akışla yazma içerik uzunluğunu bilinmez kılar; kullanılmamalıdır.");
  assert.doesNotMatch(VERSIONS_ROUTE, /^\s*await reportBucket\(\)\.put\(/m, "Revizyon doğrudan R2'ye yazmamalı; doğrulayan yardımcıyı kullanmalı.");
  assert.match(VERSIONS_ROUTE, /storeReportPdf\(\{/, "Revizyon, doğrulayan ortak yükleme yardımcısını kullanmalıdır.");
  assert.match(VERSIONS_ROUTE, /pdfHash: stored\.pdfHash/, "PDF özeti yeniden ölçülüp kaydedilmelidir.");
  assert.match(VERSIONS_ROUTE, /pdfIntegrityError\(bytes\)/, "Bozuk PDF sürüm olarak kabul edilmemelidir.");
  // Sürüm kesinleşmeden önceki PDF silinmez; hata yolunda YALNIZCA yeni nesne silinir.
  assert.match(VERSIONS_ROUTE, /if \(objectKey\) await reportBucket\(\)\.delete\(objectKey\)/);
  assert.match(VERSIONS_ROUTE, /objectKey = "";/, "Sürüm kesinleştikten sonra yeni nesne silinmemelidir.");

  // Yardımcı: yazım R2'den OKUNARAK doğrulanır, uyuşmazlıkta yarım nesne silinir.
  assert.match(WORKFLOW_DB, /const written = await bucket\.head\(input\.key\)/);
  assert.match(WORKFLOW_DB, /written\.size !== byteLength/);
  assert.match(WORKFLOW_DB, /Sürüm güncellenmedi/);

  // Şema: sürüm satırı özet ve doğrulanmış uzunluk taşır.
  const database = migratedDatabase();
  const columns = new Set((database.prepare(`PRAGMA table_info(submission_versions)`).all() as Array<{ name: string }>)
    .map((row) => row.name));
  assert.ok(columns.has("pdf_hash"), "submission_versions.pdf_hash bulunmalıdır.");
  assert.ok(columns.has("byte_length"), "submission_versions.byte_length bulunmalıdır.");
  database.close();
});

/* ------------------------------ 14 · Çift başvuru ------------------------------ */

test("14) çift tıklama iki başvuru oluşturmaz", () => {
  // İstemci: senkron kilit, `await`lerden ÖNCE kapanır.
  assert.match(PARTICIPANT_PORTAL, /const submitLock = useRef\(false\)/, "Senkron kilit bulunmalıdır.");
  const submitBody = PARTICIPANT_PORTAL.slice(
    PARTICIPANT_PORTAL.indexOf("async function submit()"),
    PARTICIPANT_PORTAL.indexOf("async function submitRevision("),
  );
  const lockAt = submitBody.indexOf("submitLock.current = true");
  const firstAwait = submitBody.indexOf("await ");
  assert.ok(lockAt >= 0 && firstAwait >= 0, "Kilit ve await bulunmalıdır.");
  assert.ok(lockAt < firstAwait, "Kilit ilk `await`ten ÖNCE kapanmalıdır; aksi hâlde çift tıklama geçer.");
  assert.match(submitBody, /submitLock\.current = false/, "Ağ hatasında kilit açılıp yeniden denenebilmelidir.");

  // Sunucu: benzersizlik veri tabanında; istemci tek savunma değil.
  assert.match(WORKFLOW_DB, /return "duplicate"/, "Sunucu mükerrer başvuruyu reddetmelidir.");
  assert.match(WORKFLOW_DB, /UNIQUE constraint failed/, "Eşzamanlı ikinci INSERT de yakalanmalıdır.");

  const database = migratedDatabase();
  const insert = (id: string) => database.prepare(`INSERT INTO competition_applications
    (id, participant_id, participant_name, participant_email, competition_key, competition_name,
     profile_id, file_key, file_name, mime_type, size_bytes, status, submitted_at, updated_at)
    VALUES (?, 'p-1', 'Ada', 'ada@test', 'roket', 'Roket', NULL, ?, 'rapor.pdf', 'application/pdf', 1, 'submitted', '2026-08-25', '2026-08-25')`)
    .run(id, `r2/${id}.pdf`);
  insert("app-1");
  assert.throws(() => insert("app-2"), /UNIQUE/i, "Aynı katılımcı aynı yarışmaya ikinci aktif başvuru açamaz.");

  // Arşivlenen başvurudan sonra katılımcı yeniden başvurabilir.
  database.prepare(`UPDATE competition_applications SET deleted_at = '2026-08-26' WHERE id = 'app-1'`).run();
  insert("app-3");
  assert.equal(
    (database.prepare(`SELECT COUNT(*) AS total FROM competition_applications WHERE deleted_at IS NULL`).get() as { total: number }).total,
    1,
    "Arşivleme sonrası tek aktif başvuru kalmalıdır.",
  );
  database.close();
});

/* ------------------- 15 · Pasifleştirilen hakemin dosyaları ------------------- */

test("15) pasifleştirilen hakemin açık dosyaları güvenle yeniden atanır", () => {
  assert.match(WORKFLOW_DB, /export async function reassignApplicationsFromJudge/, "Devir işlevi bulunmalıdır.");
  // Yalnızca TAMAMLANMAMIŞ ve arşivlenmemiş dosyalar devredilir.
  assert.match(WORKFLOW_DB, /WHERE assigned_judge_id = \? AND status <> 'completed' AND deleted_at IS NULL/);
  // Koşullu UPDATE: dosya bu arada başka hakeme geçtiyse üzerine yazılmaz.
  assert.match(WORKFLOW_DB, /WHERE id = \? AND assigned_judge_id = \? AND status <> 'completed' AND deleted_at IS NULL/);
  assert.match(WORKFLOW_DB, /if \(!released\.meta\.changes\) continue/, "Eşzamanlı devir çakışması atlanmalıdır.");
  // Aktif hakem yoksa dosya kuyruğa alınır; kalıcı olarak takılı kalmaz.
  assert.match(WORKFLOW_DB, /application_reassignment_queued/);
  // Denetim kaydı ve otomatik atama ilkesi korunur (manuel atama eklenmez).
  assert.match(ACCOUNTS_ROUTE, /reassignOpenJudgeFiles/, "Hesap pasife alınırken devir çağrılmalıdır.");
  assert.match(ACCOUNTS_ROUTE, /action: item\.judgeId \? "application_reassigned" : "application_reassignment_queued"/);
  assert.doesNotMatch(WORKFLOW_DB, /export async function assignJudgeManually/, "Manuel atama eklenmemelidir.");

  // Tamamlanmış değerlendirmenin tarihsel hakem bilgisi değişmez.
  const database = migratedDatabase();
  database.prepare(`INSERT INTO competition_applications
    (id, participant_id, participant_name, participant_email, competition_key, competition_name,
     profile_id, file_key, file_name, mime_type, size_bytes, status, submitted_at, updated_at,
     assigned_judge_id, assigned_judge_name, judge_id, judge_name)
    VALUES ('app-done', 'p-1', 'Ada', 'ada@test', 'roket', 'Roket', NULL, 'r2/a.pdf', 'r.pdf', 'application/pdf', 1,
            'completed', '2026-08-25', '2026-08-25', 'judge-1', 'Eski Hakem', 'judge-1', 'Eski Hakem')`).run();
  database.prepare(
    `UPDATE competition_applications
     SET assigned_judge_id = NULL, assigned_judge_name = NULL, status = 'resubmitted', updated_at = '2026-08-26'
     WHERE id = 'app-done' AND assigned_judge_id = 'judge-1' AND status <> 'completed' AND deleted_at IS NULL`,
  ).run();
  const done = database.prepare(`SELECT status, judge_name, assigned_judge_name FROM competition_applications WHERE id = 'app-done'`)
    .get() as Record<string, unknown>;
  assert.equal(done.status, "completed", "Tamamlanmış dosya devir kapsamına girmemelidir.");
  assert.equal(done.judge_name, "Eski Hakem", "Tarihsel hakem bilgisi korunmalıdır.");
  database.close();
});

/* ------------------ 16 · Nihai karar katılımcıya aynı anda görünür ------------------ */

test("16) nihai onay ve ret katılımcıya aynı anda ve aynı kaynaktan görünür", () => {
  // Görünürlük tek koşula bağlı: hakem kararı KESİNLEŞTİ mi?
  assert.match(WORKFLOW_DB, /const reviewCompleted = storedReview\?\.status === "completed"/);
  assert.match(WORKFLOW_DB, /const participantResultHidden = view === "participant" && !reviewCompleted/);
  // Sonuç, açıklama ve karar zamanı AYNI satırdan ve aynı koşulla açılır:
  // onay görünürken ret gizli (ya da tersi) kalamaz.
  assert.match(WORKFLOW_DB, /outcome: participantResultHidden \? "pending" : normalizeOutcome\(row\.outcome\)/);
  assert.match(WORKFLOW_DB, /outcomeNote: participantResultHidden \|\| operations \? "" : \(row\.outcome_note \?\? ""\)/);
  assert.match(WORKFLOW_DB, /decidedAt: participantResultHidden \? null : row\.decided_at/);

  // Kriter kararı ile NİHAİ karar ayrıdır: olumsuz kriter tek başına ret üretmez.
  const item = finding("c1", "Ağırlık sınırı", "KRITIK_HATA");
  const decision: JudgeCriterionDecision = { ...decisionFor(item), judgeVerdict: "approved" };
  assert.equal(effectiveVerdictOf(decision), "OLUMSUZ");
  assert.match(EVALUATION_APP, /sistem öneri üretmez/, "Nihai kararı sistem önermez.");
  assert.match(EVALUATION_APP, /disabled=\{!allDecided\}/, "Nihai karar bütün kriterler kesinleşmeden açılmaz.");
});

/* ---------------------- Ek · Kategori uygunluğu ve 4. aşama özeti ---------------------- */

test("kategori uygunluğu yapay yüzde yerine dört durumdan biriyle gösterilir", () => {
  assert.equal(categoryFitOf(100), "UYUMLU");
  assert.equal(categoryFitOf(70), "UYUMLU");
  assert.equal(categoryFitOf(55), "KISMEN_UYUMLU");
  assert.equal(categoryFitOf(10), "UYUMSUZ");
  // Kanıt yoksa "uyumsuz" DEĞİL, "yeterli kanıt bulunamadı" denir.
  assert.equal(categoryFitOf(null), "KANIT_YOK");
  assert.equal(categoryFitOf(undefined), "KANIT_YOK");
});

test("4. aşama özeti sade sayaçtır; uzun kriter adı sıkıştırılmaz", () => {
  const findings = [
    ...Array.from({ length: 8 }, (_, index) => finding(`ok-${index}`, `Kural ${index}`, "BASARILI")),
    finding("bad-1", "Çok uzun ve teknik bir kriter adı olan kural", "KRITIK_HATA"),
  ];
  assert.equal(evidenceStageSummary(findings), "9 kriter incelendi · 8 uygun · 1 olumsuz");
  // PDF dışı bulgu bu sayaca girmez.
  assert.equal(
    evidenceStageSummary([...findings, finding("video", "Tanıtım videosu", "DEGERLENDIRILEMEDI", null)]),
    "9 kriter incelendi · 8 uygun · 1 olumsuz",
  );
  assert.equal(evidenceStageSummary([]), "Katılımcı PDF'si üzerinden değerlendirilebilen kriter yok.");
});
