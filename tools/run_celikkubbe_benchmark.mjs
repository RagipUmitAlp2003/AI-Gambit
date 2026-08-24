// BİR KERELİK DOĞRULUK BENCHMARKI — normal kullanıcı akışında çalışmaz.
//
// Resmî Çelikkubbe şartnamesinden elle çıkarılmış yer gerçeğini (docs/benchmarks/
// celikkubbe-expected.json) analiz motorunun çıktısıyla karşılaştırır: puan
// grupları ve puanları, ilan edilen toplam, barajlar, cezalar, geçiş/eleme
// koşulları ve görevli kararı gerektiren maddeler. Amaç değerlendirme
// mantığının gerçekten kaynaktan geldiğini doğrulamaktır.
//
// Kullanım (sunucu çalışırken):
//   node tools/run_celikkubbe_benchmark.mjs [http://127.0.0.1:3000/api/analyze]
//   node tools/run_celikkubbe_benchmark.mjs --reuse   (son çıktıyı yeniden ölçer)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const expectedPath = path.join(root, "docs", "benchmarks", "celikkubbe-expected.json");
const pdfPath = path.join(root, "output", "pdf", "official", "2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf");
const outputPath = path.join(root, "output", "benchmarks", "celikkubbe-latest.json");
const endpoint = process.argv.find((argument) => argument.startsWith("http")) || "http://127.0.0.1:3000/api/analyze";
const reuseLatest = process.argv.includes("--reuse");

const expected = JSON.parse(await readFile(expectedPath, "utf8"));
const setup = {
  competition: "Çelikkubbe Hava Savunma Sistemleri Yarışması",
  category: "Üniversite Seviyesi",
  stage: "Tüm yarışma süreci",
  reportType: "Teknik şartname değerlendirme profili",
  year: "2026",
  allowedFormats: ["PDF"],
  maxFileSizeMb: 25,
  maxFileCount: 1,
  defaultViolationAction: "jury"
};

let analysis;
if (reuseLatest) {
  const latest = JSON.parse(await readFile(outputPath, "utf8"));
  analysis = latest.analysis;
} else {
  const pdf = await readFile(pdfPath);
  const form = new FormData();
  form.append("file", new Blob([pdf], { type: "application/pdf" }), expected.document);
  form.append("setup", JSON.stringify(setup));
  form.append("pageCount", "25");
  const response = await fetch(endpoint, { method: "POST", body: form });
  analysis = await response.json();
  if (!response.ok) throw new Error(analysis.error || `HTTP ${response.status}`);
}

const lower = (value) => String(value || "").toLocaleLowerCase("tr-TR");
const includesAll = (text, keywords) => keywords.every((keyword) => lower(text).includes(lower(keyword)));
const actualGroups = analysis.scorePlan?.groups || [];
const groupMatches = expected.scoreGroups.map((item) => {
  const match = actualGroups.find((group) => includesAll(`${group.name} ${group.scope}`, item.keywords));
  return {
    expected: item.name,
    expectedMaxScore: item.maxScore,
    actual: match?.name || null,
    actualMaxScore: match?.maxScore ?? null,
    matched: Boolean(match) && match.maxScore === item.maxScore
  };
});

const criteria = analysis.criteria || [];
const criterionText = (criterion) => [
  criterion.name,
  criterion.scope,
  criterion.sourceText,
  criterion.aiInterpretation,
  criterion.violationOutcome
].join(" ");
const criterionCorpus = criteria.map(criterionText).join("\n");
const corpus = `${criterionCorpus}\n${JSON.stringify(analysis.scorePlan || {})}`;
/** Tam / kısmi / eksik ayrımı: anahtar kelimelerin kaçının tuttuğuna bakılır. */
const classify = (text, keywords) => {
  const hits = keywords.filter((keyword) => lower(text).includes(lower(keyword))).length;
  if (hits === keywords.length) return { verdict: "tam", hits };
  if (hits > 0) return { verdict: "kismi", hits };
  return { verdict: "eksik", hits };
};

// Her beklenen bulgu tek bir gerçek kriterle eşleşir. Bütün kriterleri tek bir
// metne birleştirmek, anahtar sözcüklerin farklı maddelerden toplanıp yanlış
// bir "tam eşleşme" üretmesine yol açıyordu.
const claimedCriteria = new Set();
const findingMatches = expected.requiredFindings.map((item) => {
  let bestIndex = -1;
  let bestHits = 0;
  for (let index = 0; index < criteria.length; index += 1) {
    if (claimedCriteria.has(index)) continue;
    const hits = classify(criterionText(criteria[index]), item.keywords).hits;
    if (hits > bestHits) {
      bestIndex = index;
      bestHits = hits;
    }
  }
  const match = bestIndex >= 0 ? criteria[bestIndex] : null;
  const disallowedType = Boolean(match && (item.disallowedTypes || []).includes(match.type));
  const verdict = bestHits === item.keywords.length && !disallowedType
    ? "tam"
    : bestHits > 0
      ? "kismi"
      : "eksik";
  if (verdict === "tam") claimedCriteria.add(bestIndex);
  return {
    expected: item.name,
    category: item.category || "gate",
    verdict,
    keywordHits: `${bestHits}/${item.keywords.length}`,
    actual: match?.name || null,
    actualType: match?.type || null,
    actualEffect: match?.effect || null,
    typeViolation: disallowedType,
    matched: verdict === "tam"
  };
});
const humanReviewMatches = expected.humanReviewFindings.map((item) => {
  const match = criteria.find((criterion) => includesAll(criterionText(criterion), item.keywords));
  return {
    expected: item.name,
    actual: match?.name || null,
    method: match?.evaluationMethod || null,
    matched: Boolean(match) && ["human", "hybrid"].includes(match.evaluationMethod)
  };
});

const CATEGORY_LABELS = {
  gate: "Geçiş / uygunluk koşulu",
  threshold: "Baraj",
  penalty: "Ceza",
  elimination: "Eleme / diskalifiye",
  score: "Puan kuralı"
};

// Kategori bazlı kapsam: puan, baraj, ceza ve geçiş ayrı ayrı ölçülür.
const byCategory = {};
for (const item of findingMatches) {
  byCategory[item.category] ??= {
    label: CATEGORY_LABELS[item.category] || item.category,
    total: 0, matched: 0, partial: 0, missing: []
  };
  const bucket = byCategory[item.category];
  bucket.total += 1;
  if (item.verdict === "tam") bucket.matched += 1;
  else if (item.verdict === "kismi") { bucket.partial += 1; bucket.missing.push(`${item.expected} (kısmi ${item.keywordHits})`); }
  else bucket.missing.push(item.expected);
}
for (const bucket of Object.values(byCategory)) {
  bucket.recall = bucket.total ? bucket.matched / bucket.total : 1;
}

// Puan matematiği: grupların toplamı belgede ilan edilen toplamla tutmalı.
const expectedGroupSum = expected.scoreGroups.reduce((sum, item) => sum + item.maxScore, 0);
const actualGroupSum = actualGroups.reduce((sum, group) => sum + (group.maxScore || 0), 0);
const activeCriterionScoreTotal = criteria
  .filter((criterion) => criterion.active && (criterion.effect === "score" || (!criterion.effect && criterion.type === "qualitative_score")))
  .reduce((sum, criterion) => sum + (criterion.maxScore || 0), 0);
const scoreMath = {
  expectedGroupSum,
  expectedDeclaredTotal: expected.declaredTotalScore,
  expectedConsistent: expectedGroupSum === expected.declaredTotalScore,
  actualGroupSum,
  actualDeclaredTotal: analysis.scorePlan?.declaredTotalScore ?? null,
  actualConsistent: actualGroupSum === (analysis.scorePlan?.declaredTotalScore ?? null),
  activeCriterionScoreTotal,
  criteriaConsistent: activeCriterionScoreTotal === actualGroupSum,
  // 100'lük gösterim yalnızca payda doğruysa anlamlıdır.
  normalizationDenominator: analysis.scorePlan?.declaredTotalScore ?? null
};

// Dayanaksız kriter: modelin kaynak alıntı veremediği veya belge dışı sayfaya
// işaret ettiği maddeler. Resmî belgede karşılığı doğrulanamaz.
const pageCount = analysis.pageCount || 0;
const unsupported = (analysis.criteria || []).filter((criterion) => (
  criterion.origin === "document" && (
    !criterion.sourceText
    || /döndürülmedi/i.test(criterion.sourceText)
    || (pageCount > 0 && criterion.sourcePage !== null && criterion.sourcePage > pageCount)
  )
)).map((criterion) => ({ name: criterion.name, sourcePage: criterion.sourcePage }));

// Bağımsız denetim turunun işaretlediği, görevli onayı bekleyen pasif maddeler.
const auditFlagged = (analysis.criteria || [])
  .filter((criterion) => criterion.issue && /denetim turunda bulundu/i.test(criterion.issue))
  .map((criterion) => criterion.name);

// Beklenti dosyasında "olmamalı" diye işaretlenmiş ifadeler (varsa).
const forbiddenHits = (expected.forbiddenFindings || [])
  .filter((item) => includesAll(corpus, item.keywords))
  .map((item) => item.name);

const scoreGroupRecall = groupMatches.filter((item) => item.matched).length / groupMatches.length;
const partialCount = findingMatches.filter((item) => item.verdict === "kismi").length;
const missingCount = findingMatches.filter((item) => item.verdict === "eksik").length;
const requiredFindingRecall = findingMatches.filter((item) => item.matched).length / findingMatches.length;
const humanReviewAccuracy = humanReviewMatches.filter((item) => item.matched).length / humanReviewMatches.length;

const result = {
  generatedAt: new Date().toISOString(),
  model: analysis.model,
  // Süre ve token: performans çalışmasının öncesi/sonrası karşılaştırması için.
  diagnostics: analysis.diagnostics ?? null,
  expected: {
    declaredTotalScore: expected.declaredTotalScore,
    scoreGroupCount: expected.scoreGroups.length,
    requiredFindingCount: expected.requiredFindings.length,
    humanReviewFindingCount: expected.humanReviewFindings.length
  },
  actual: {
    declaredTotalScore: analysis.scorePlan?.declaredTotalScore ?? null,
    scoreGroupCount: actualGroups.length,
    criterionCount: analysis.criteria?.length || 0,
    auditStatus: analysis.scorePlan?.auditStatus,
    auditMessage: analysis.scorePlan?.auditMessage
  },
  comparison: {
    totalScoreMatched: analysis.scorePlan?.declaredTotalScore === expected.declaredTotalScore,
    scoreMath,
    scoreGroups: groupMatches,
    byCategory,
    requiredFindings: findingMatches,
    humanReviewFindings: humanReviewMatches,
    scoreGroupRecall,
    requiredFindingRecall,
    humanReviewAccuracy,
    coverage: {
      tamEslesme: findingMatches.filter((item) => item.verdict === "tam").length,
      kismiEslesme: partialCount,
      eksik: missingCount,
      dayanaksizKriter: unsupported,
      denetimIsaretli: auditFlagged,
      yasakliIfade: forbiddenHits
    }
  },
  analysis
};

if (!reuseLatest) {
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

const pct = (value) => `${Math.round(value * 1000) / 10}%`;
const lines = [
  `Model            : ${analysis.model || "-"}`,
  `Süre             : ${analysis.diagnostics ? `${analysis.diagnostics.totalMs} ms (birincil ${analysis.diagnostics.modelMs} ms, denetim ${analysis.diagnostics.auditMs} ms, yükleme ${analysis.diagnostics.uploadMs ?? 0} ms${analysis.diagnostics.cached ? ", ÖNBELLEKTEN" : ""})` : "-"}`,
  `Token            : ${analysis.diagnostics ? `${analysis.diagnostics.promptTokens} giriş + ${analysis.diagnostics.outputTokens} çıkış` : "-"}`,
  `API çağrısı      : ${analysis.diagnostics?.apiCalls ?? "-"} · belge taşıma ${analysis.diagnostics?.documentTransfers ?? "-"} (${analysis.diagnostics?.documentDelivery ?? "-"})`,
  `Denetim modeli   : ${analysis.diagnostics?.auditModel ?? "-"}`,
  `Toplam puan      : beklenen ${expected.declaredTotalScore} · bulunan ${scoreMath.actualDeclaredTotal} ${result.comparison.totalScoreMatched ? "✓" : "✗"}`,
  `Puan matematiği  : gruplar ${actualGroupSum} / ilan ${scoreMath.actualDeclaredTotal} ${scoreMath.actualConsistent ? "✓ tutarlı" : "✗ TUTARSIZ"}`,
  `Aktif puan ölçeği: kriterler ${activeCriterionScoreTotal} / gruplar ${actualGroupSum} ${scoreMath.criteriaConsistent ? "✓ tutarlı" : "✗ TUTARSIZ"}`,
  `Puan grupları    : ${pct(scoreGroupRecall)}`,
  `Görevli kararı   : ${pct(humanReviewAccuracy)}`,
  `Kural kapsamı    : ${pct(requiredFindingRecall)} · tam ${findingMatches.length - partialCount - missingCount} / kısmi ${partialCount} / eksik ${missingCount}`,
  `Dayanaksız kriter: ${unsupported.length}${unsupported.length ? ` → ${unsupported.slice(0, 5).map((item) => item.name).join(", ")}` : ""}`,
  `Denetim işaretli : ${auditFlagged.length} (pasif, görevli onayı bekliyor)`,
  `Yasaklı ifade    : ${forbiddenHits.length ? forbiddenHits.join(", ") : "yok"}`
];
for (const bucket of Object.values(byCategory)) {
  lines.push(`  ${bucket.label.padEnd(24)} tam ${bucket.matched}/${bucket.total}${bucket.partial ? ` · kısmi ${bucket.partial}` : ""}${bucket.missing.length ? ` · ${bucket.missing.join(", ")}` : ""}`);
}
lines.push(`Çıktı            : ${outputPath}`);
console.log(lines.join("\n"));

// Kritik ölçütlerden biri düşerse çıkış kodu 1: CI veya elle çalıştırmada fark edilir.
const passed = result.comparison.totalScoreMatched
  && scoreMath.actualConsistent
  && scoreMath.criteriaConsistent
  && scoreGroupRecall === 1
  && humanReviewAccuracy === 1
  && requiredFindingRecall === 1
  && forbiddenHits.length === 0;
if (!passed) {
  console.error("\nBENCHMARK DÜŞTÜ: yukarıdaki eksik ölçütleri inceleyin.");
  process.exitCode = 1;
}
