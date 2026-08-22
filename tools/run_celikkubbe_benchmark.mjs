import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const expectedPath = path.join(root, "docs", "benchmarks", "celikkubbe-expected.json");
const pdfPath = path.join(root, "output", "pdf", "official", "2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf");
const outputPath = path.join(root, "output", "benchmarks", "celikkubbe-latest.json");
const endpoint = process.argv.find((argument) => argument.startsWith("http")) || "http://127.0.0.1:3000/api/analyze";
const reuseLatest = process.argv.includes("--reuse");

const expected = JSON.parse(await readFile(expectedPath, "utf8"));
const pdf = await readFile(pdfPath);
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

const criterionCorpus = (analysis.criteria || []).map((criterion) => [
  criterion.name,
  criterion.scope,
  criterion.sourceText,
  criterion.aiInterpretation,
  criterion.violationOutcome
].join(" ")).join("\n");
const corpus = `${criterionCorpus}\n${JSON.stringify(analysis.scorePlan || {})}`;
const findingMatches = expected.requiredFindings.map((item) => ({
  expected: item.name,
  matched: includesAll(corpus, item.keywords)
}));
const humanReviewMatches = expected.humanReviewFindings.map((item) => {
  const match = (analysis.criteria || []).find((criterion) => includesAll([
    criterion.name,
    criterion.scope,
    criterion.sourceText,
    criterion.aiInterpretation,
    criterion.violationOutcome
  ].join(" "), item.keywords));
  return {
    expected: item.name,
    actual: match?.name || null,
    method: match?.evaluationMethod || null,
    matched: Boolean(match) && ["human", "hybrid"].includes(match.evaluationMethod)
  };
});

const result = {
  generatedAt: new Date().toISOString(),
  model: analysis.model,
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
    scoreGroups: groupMatches,
    requiredFindings: findingMatches,
    humanReviewFindings: humanReviewMatches,
    scoreGroupRecall: groupMatches.filter((item) => item.matched).length / groupMatches.length,
    requiredFindingRecall: findingMatches.filter((item) => item.matched).length / findingMatches.length,
    humanReviewAccuracy: humanReviewMatches.filter((item) => item.matched).length / humanReviewMatches.length
  },
  analysis
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...result.actual, ...result.comparison }, null, 2));
