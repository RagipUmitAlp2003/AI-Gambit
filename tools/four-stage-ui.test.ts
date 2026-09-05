/**
 * Dört aşamalı çıkarımın (criteria_evidence yeniden açıldı) EKRAN ve GERİYE
 * UYUM sözleşmeleri — canlı Gemini çağrısı YOKTUR.
 *
 *   17. Benzerlik hiçbir kriter bulgusunu ve hakem kararını değiştirmez
 *       (applySimilarity yalnızca preChecks + 3. aşama `similarity` alanına yazar;
 *       kart uyarısı "Bu sonuç intihal kararı değildir." tools/similarity.test.ts
 *       içinde ayrıca sabitlenmiştir; burada tekrarlanmaz, yalnızca atıf yapılır).
 *   20. criteria_evidence kriteri taşıyan ESKİ 2.0 profili profile-loader'dan
 *       aşaması ve controlType'ı korunarak geçer.
 *   21. Teknik kriteri olmayan profil: orderStages yine dört kayıt döndürür,
 *       StageStrip 4. kartı "uygulanmıyor" olarak basar; teknik kriterli eski
 *       değerlendirme sonuç rozeti yolunu korur.
 *   9.4 Kriter Atölyesi eski çıkarım sürümü uyarısı (kaynak sözleşmesi).
 *
 * Çalıştırma: node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs --test tools/four-stage-ui.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applySimilarity, buildSimilarityCheck, orderStages } from "../app/lib/report-prechecks.ts";
import { validateProfileExport } from "../app/lib/profile-loader.ts";
import { EXTRACTION_PROMPT_VERSION } from "../app/lib/criteria-extraction.ts";
import {
  CHECK_STAGE_IDS,
  resolveControlType,
  type CheckStage,
  type Criterion,
  type CriterionFinding,
  type PreCheck,
  type RuleVerdict,
  type SetupData,
  type StageResult,
} from "../app/lib/types.ts";

const EVALUATION_APP = readFileSync("app/components/evaluation-app.tsx", "utf8");
const CRITERIA_APP = readFileSync("app/components/criteria-app.tsx", "utf8");
const EVALUATE_ROUTE = readFileSync("app/api/evaluate-report/route.ts", "utf8");
const JUDGE_REVIEW = readFileSync("app/lib/judge-review.ts", "utf8");
const ANALYZE_ROUTE = readFileSync("app/api/analyze/route.ts", "utf8");

/** tools/authorization.test.ts ile aynı dilim: StageStrip gövdesi. */
const STAGE_STRIP = EVALUATION_APP.slice(
  EVALUATION_APP.indexOf("function StageStrip"),
  EVALUATION_APP.indexOf("type RejectDraft"),
);

function finding(patch: Partial<CriterionFinding> & { stage: CheckStage; verdict: RuleVerdict }): CriterionFinding {
  return {
    criterionId: `c-${patch.stage}-${patch.verdict}`,
    criterionName: "Kriter",
    required: true,
    verifiability: "PDF_DENETLENEBILIR",
    rationale: "Gerekçe.",
    evidence: [],
    evidenceMissing: false,
    ...patch,
  };
}

/* ------------------------- 17 · Benzerlik karar değiştirmez ------------------------- */

test("17 · applySimilarity kriter bulgularını ve aşama sonuçlarını DEĞİŞTİRMEZ; yalnızca 3. aşama benzerlik alanını doldurur", () => {
  const findings = [
    finding({ stage: "headings_content", verdict: "KRITIK_HATA" }),
    finding({ stage: "criteria_evidence", verdict: "REVIZYON" }),
    finding({ stage: "criteria_evidence", verdict: "BASARILI" }),
  ];
  const before: { preChecks: PreCheck[]; stages: StageResult[]; findings: CriterionFinding[] } = {
    preChecks: [],
    stages: orderStages([], findings),
    findings,
  };
  const frozenFindings = JSON.stringify(before.findings);
  const frozenVerdicts = before.stages.map((stage) => `${stage.stage}:${stage.verdict}`);

  // Kendisiyle birebir aynı bir akran: en yüksek benzerlik senaryosu.
  const text = Array.from({ length: 200 }, (_, index) => `kelime${index % 37} govde${index % 11}`).join(" ");
  const check = buildSimilarityCheck(text, [{ label: "Takım B", text }]);
  const after = applySimilarity(before, check);

  assert.equal(JSON.stringify(after.findings), frozenFindings, "Bulgu listesi bayt bayt aynı kalmalıdır.");
  assert.deepEqual(after.stages.map((stage) => `${stage.stage}:${stage.verdict}`), frozenVerdicts,
    "Hiçbir aşama sonucu benzerlikten etkilenmemelidir.");
  assert.equal(after.preChecks.filter((item) => item.kind === "similarity").length, 1);
  const third = after.stages.find((stage) => stage.stage === "category_similarity");
  assert.ok(third?.similarity, "Benzerlik yalnızca 3. aşamanın bilgi alanına yazılır.");
  for (const stage of after.stages) {
    if (stage.stage !== "category_similarity") assert.equal(stage.similarity, undefined, `${stage.stage} benzerlik taşımamalıdır.`);
  }
  // Girdi nesnesi de değişmez (saf fonksiyon).
  assert.equal(JSON.stringify(before.findings), frozenFindings);
});

test("17 · kaynak sözleşmesi: benzerlik hakem kriter kararından tamamen ayrıdır", () => {
  // Değerlendirme ucu benzerlik üretmez ve modelden benzerlik kararı istemez.
  assert.doesNotMatch(EVALUATE_ROUTE, /applySimilarity|buildSimilarityCheck/,
    "Kriter analizi ucu benzerlik hesaplamaz; benzerlik ayrı sistemdir.");
  assert.match(EVALUATE_ROUTE, /benzerlik kararı VERME/, "Modele benzerlik kararı yasaklanır.");
  assert.match(EVALUATE_ROUTE, /result\.similarity = null/, "Sunucu 3. aşamaya benzerlik değeri yazmaz.");

  // Hakem karar mantığı benzerlikten habersizdir.
  assert.doesNotMatch(JUDGE_REVIEW, /similarity|benzerlik/i, "judge-review benzerlik okumamalıdır.");
  assert.doesNotMatch(EVALUATION_APP, /similarityReport/, "Hakem kriter ekranı benzerlik raporu okumamalıdır.");
  assert.match(EVALUATION_APP, /<SimilarityWorkspace/, "Benzerlik ayrı çalışma alanında açılmalıdır.");
});

/* ------------------------- 20 · Eski profil yüklemesi ------------------------- */

const setup: SetupData = {
  competition: "Çelikkubbe Hava Savunma",
  category: "Üniversite",
  stage: "Kritik tasarım değerlendirmesi",
  reportType: "Kritik Tasarım Raporu",
  year: "2026",
  allowedFormats: ["PDF"],
  maxFileSizeMb: 25,
  maxFileCount: 1,
  defaultViolationAction: "jury",
  reportLanguage: "Türkçe",
};

function criterion(patch: Partial<Criterion>): Criterion {
  return {
    id: "criterion-1",
    name: "Kriter",
    stage: "headings_content",
    required: true,
    description: "Açıklama.",
    violationOutcome: "Değerlendirmeye alınmaz.",
    sourcePage: 3,
    sourceText: "Kaynak.",
    verifiability: "PDF_DENETLENEBILIR",
    active: true,
    origin: "document",
    ...patch,
  };
}

test("20 · criteria_evidence kriterli eski 2.0 profili aşaması ve controlType'ı korunarak yüklenir", () => {
  // Eski (teknik kriter içeren) yayımlı profil: biri açık controlType'lı, biri alansız.
  const technicalExplicit = criterion({
    id: "teknik-1",
    name: "Motor gücü sınırı",
    stage: "criteria_evidence",
    controlType: "KANIT_KONTROLU",
    description: "Motor gücü en fazla 5 kW olmalıdır.",
    sourceText: "Motor gücü en fazla 5 kW olmalıdır.",
  });
  const technicalBare = criterion({
    id: "teknik-2",
    name: "Araç ağırlığı sınırı",
    stage: "criteria_evidence",
    description: "Araç 50 kg'dan ağır olmamalıdır.",
    sourceText: "Araç 50 kg'dan ağır olmamalıdır.",
  });
  const { profile, error } = validateProfileExport({
    version: "2.0",
    status: "approved",
    profileId: "profile-eski",
    setup,
    sourceDocument: { name: "sartname.pdf", pages: 20, analyzedAt: "2026-06-01T00:00:00.000Z" },
    criteria: [technicalExplicit, technicalBare, criterion({ id: "baslik-1", name: "Giriş" })],
  });
  assert.equal(error, "");
  assert.ok(profile);
  assert.deepEqual(profile.criteria.map((item) => item.stage), ["criteria_evidence", "criteria_evidence", "headings_content"]);
  assert.deepEqual(profile.criteria.map((item) => item.controlType), ["KANIT_KONTROLU", "KANIT_KONTROLU", "ICERIK_VARLIGI"]);
  assert.equal(profile.criteria[0].verifiability, "PDF_DENETLENEBILIR");
  assert.equal(profile.criteria[0].active, true, "Eski teknik kriter pasifleştirilmez, silinmez.");
  assert.equal(resolveControlType("criteria_evidence", undefined), "KANIT_KONTROLU");
});

/* ------------------------- 21 · Teknik kriteri olmayan profil ------------------------- */

test("21 · criteria_evidence bulgusu olmayan değerlendirmede orderStages yine DÖRT kayıt döndürür", () => {
  const findings = [
    finding({ stage: "language_template", verdict: "BASARILI" }),
    finding({ stage: "headings_content", verdict: "REVIZYON", required: false }),
  ];
  // Üç aşamalı çıkarımla üretilmiş eski kayıt: sunucu yalnız üç aşama döndürmüş olsun.
  const provided: StageResult[] = [
    { stage: "language_template", verdict: "BASARILI", summary: "Rapor dili Türkçe.", evidence: [] },
    { stage: "headings_content", verdict: "REVIZYON", summary: "1 başlık eksik.", evidence: [] },
    { stage: "category_similarity", verdict: "BASARILI", summary: "Kategoriyle uyumlu.", evidence: [], categoryScore: 80 },
  ];
  for (const stages of [orderStages([], findings), orderStages(provided, findings)]) {
    assert.deepEqual(stages.map((stage) => stage.stage), [...CHECK_STAGE_IDS], "Aşama sırası ve sayısı sabittir.");
    const fourth = stages.find((stage) => stage.stage === "criteria_evidence");
    assert.ok(fourth);
    assert.equal(fourth.verdict, "BASARILI", "Bulgusuz aşama kritik hata üretemez.");
    assert.match(fourth.summary, /aktif kriter yok/, "Özet aşamada kriter olmadığını söyler.");
  }
  // Teknik kriterli ESKİ değerlendirme: 4. aşama bulgudan türer, sonuç korunur.
  const legacy = orderStages([], [...findings, finding({ stage: "criteria_evidence", verdict: "KRITIK_HATA" })]);
  assert.equal(legacy.find((stage) => stage.stage === "criteria_evidence")?.verdict, "KRITIK_HATA");
});

test("21 · StageStrip 4. kartı: teknik kriter yoksa 'uygulanmıyor', varsa sonuç rozeti (kaynak sözleşmesi)", () => {
  assert.ok(STAGE_STRIP.length > 0, "StageStrip bulunmalıdır.");
  // Şerit bulguları alır ve 4. aşamayı bulgu varlığına göre çizer.
  assert.match(STAGE_STRIP, /function StageStrip\(\{ stages, findings, outsidePdfCount = 0 \}/,
    "StageStrip bulgu listesini ve kapsam sayısını almalıdır.");
  assert.match(STAGE_STRIP, /findings\.some\(\(finding\) => finding\.stage === "criteria_evidence"\)/,
    "Uygulanmama kararı yalnızca 4. aşama bulgusunun yokluğuna bağlıdır.");
  /*
   * Madde 7: "bulgu gelmedi" ile "profilde teknik kriter yok" ayrılır. Kart
   * artık doğrulayamadığı bir olguyu kesin biçimde İDDİA ETMEZ; PDF dışı
   * kriter varsa bunu sayıyla söyler.
   */
  assert.ok(!/Bu profilde teknik kriter tanımlı değil/.test(STAGE_STRIP),
    "Eksik veri, 'bu profilde teknik kriter yok' diye sunulamaz.");
  assert.match(STAGE_STRIP, /PDF dışı kanıt gerektirdiği için rapor analizine girmedi/,
    "PDF dışı kriter varsa aşamanın neden boş olduğu sayıyla söylenir.");
  assert.match(STAGE_STRIP, /teknik kriter tanımlı olmayabilir/,
    "Veri kesin ayrım yapmaya yetmiyorsa ifade temkinli olmalıdır.");
  // Uygulanmayan kart sonuç rengi/ikonu/rozeti taşımaz; mevcut sonuç yolu korunur.
  assert.match(STAGE_STRIP, /const verdict = notApplicable \? null : stage\?\.verdict \?\? null/,
    "Uygulanmayan aşamanın sonucu null'a düşer (chip 'none', ikon 'Sonuç yok').");
  assert.match(STAGE_STRIP, /\{verdict \? <VerdictBadge verdict=\{verdict\} \/> : null\}/,
    "Sonucu olan aşama rozetini korur; uygulanmayan aşama rozet basmaz.");
  assert.match(STAGE_STRIP, /label: "Kriter bulguları"/, "Teknik kriterli eski profil mevcut satırı korur.");
  // Çağrı yeri değerlendirmenin bulgularını geçirir.
  assert.match(EVALUATION_APP, /<StageStrip\s+stages=\{evaluation\.stages\}\s+findings=\{evaluation\.findings\}\s+outsidePdfCount=\{evaluation\.criteriaScope\?\.outsidePdf \?\? 0\}/);
  // Kutuların AI ÖN DEĞERLENDİRMESİ olduğu görünür biçimde yazılır (madde 7).
  assert.match(EVALUATION_APP, /AI ön değerlendirme özeti — kesinleşen kriter sonuçları aşağıdaki sayaçlardadır\./);
  assert.match(STAGE_STRIP, /aria-label="AI ön değerlendirme özeti/);
  // tools/authorization.test.ts sözleşmesi bozulmaz.
  assert.match(STAGE_STRIP, /CATEGORY_FIT_LABELS/);
  assert.doesNotMatch(STAGE_STRIP, /Benzerlik taraması|categoryScore/);
});

/* ------------------------- 9.4 · Eski çıkarım sürümü uyarısı ------------------------- */

test("9.4 · Kriter Atölyesi eski çıkarım sürümüyle üretilmiş sonuçta yeniden analiz uyarısı ekler (kaynak sözleşmesi)", () => {
  assert.match(CRITERIA_APP, /import \{ EXTRACTION_PROMPT_VERSION, resolveVerifiability \} from "\.\.\/lib\/criteria-extraction"/,
    "Sürüm sabiti saf modülden içe aktarılır.");
  assert.match(CRITERIA_APP, /shownPromptVersion !== EXTRACTION_PROMPT_VERSION/, "Yalnızca sürüm FARKLIYSA uyarı yazılır.");
  assert.match(CRITERIA_APP, /Bu sonuç eski çıkarım sürümüyle \(\$\{shownPromptVersion\}\) üretildi; /);
  assert.match(CRITERIA_APP, /teknik kriter aşamasının yeni kapsamı için şartnameyi yeniden analiz edin\./);
  // Uyarı mevcut önbellek notuna EKLENİR; not tek durumda (setCacheNotice(notice)) basılır.
  assert.match(CRITERIA_APP, /notice = `\$\{notice\}\$\{notice \? " " : ""\}Bu sonuç eski çıkarım sürümüyle/);
  assert.match(CRITERIA_APP, /setCacheNotice\(notice\)/);
  // Sunucu her yanıta üreten istem sürümünü yazar; alan tipte ve buildResult tanısında bulunur.
  assert.match(ANALYZE_ROUTE, /promptVersion: EXTRACTION_PROMPT_VERSION,/);
  assert.ok(
    ANALYZE_ROUTE.indexOf("promptVersion: EXTRACTION_PROMPT_VERSION") < ANALYZE_ROUTE.indexOf("const cacheContext"),
    "promptVersion yalnızca önbellek bağlamında değil, yanıt tanısında (buildResult) da yazılmalıdır.",
  );
  assert.match(readFileSync("app/lib/types.ts", "utf8"), /promptVersion\?: string;/);
  // Tarayıcı taslağından geri yüklenen ESKİ sonuç (sürüm alanı yok ya da farklı) da uyarı üretir.
  assert.match(CRITERIA_APP, /draftPromptVersion !== EXTRACTION_PROMPT_VERSION/);
  assert.match(CRITERIA_APP, /Bu taslaktaki analiz sonucu eski çıkarım sürümüyle/);
  assert.ok(EXTRACTION_PROMPT_VERSION.length > 0);
});
