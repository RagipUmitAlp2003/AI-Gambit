// BİR KERELİK DOĞRULUK BENCHMARKI — normal kullanıcı akışında çalışmaz.
//
// Resmî şartnameden ELLE çıkarılmış yer gerçeğini (docs/benchmarks/*.json)
// analiz motorunun dört aşamalı, puansız çıktısıyla karşılaştırır:
//   - requiredFindings : raporda kontrol edilecek her kural bulunmalı; aşama ve
//                        zorunluluk beklentisi varsa eşleşmeli (%100 kapsam gerekir)
//   - forbiddenFindings: puan tablosu, baraj/ceza ve saha maddeleri kriter olmamalı (0 gerekir)
//   - dayanaksız kriter: kaynak sayfası/alıntısı olmayan belge kaynaklı madde (bilgi)
//   - aşama dağılımı ve diagnostics (süre, token, çağrı sayısı) (bilgi)
//
// Kullanım (sunucu çalışırken):
//   node tools/run_celikkubbe_benchmark.mjs [http://127.0.0.1:3000/api/analyze]
//   node tools/run_celikkubbe_benchmark.mjs --reuse            (son çıktıyı yeniden ölçer)
//   node tools/run_celikkubbe_benchmark.mjs --benchmark ida    (İDA yer gerçeğiyle ölçer)

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { criterionText, includesAll, stageDistribution, stageMatches, unsupportedCriteria } from "./quality-assertions.mjs";

const root = process.cwd();
const BENCHMARKS = {
  celikkubbe: {
    expected: path.join(root, "docs", "benchmarks", "celikkubbe-expected.json"),
    pdf: path.join(root, "output", "pdf", "official", "2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf"),
    output: path.join(root, "output", "benchmarks", "celikkubbe-latest.json"),
  },
  ida: {
    expected: path.join(root, "docs", "benchmarks", "ida-ground-truth.json"),
    pdf: path.join(root, "output", "pdf", "official", "2026_Insansiz_Deniz_Araci_Sartnamesi.pdf"),
    output: path.join(root, "output", "benchmarks", "ida-latest.json"),
  },
};

const argv = process.argv.slice(2);
const benchmarkFlag = argv.indexOf("--benchmark");
const benchmarkName = benchmarkFlag >= 0 ? argv[benchmarkFlag + 1] : "celikkubbe";
const benchmark = BENCHMARKS[benchmarkName];
if (!benchmark) {
  console.error(`Tanınmayan benchmark: ${benchmarkName}. Seçenekler: ${Object.keys(BENCHMARKS).join(", ")}`);
  process.exit(1);
}
const endpoint = argv.find((argument) => argument.startsWith("http")) || "http://127.0.0.1:3000/api/analyze";
const reuseLatest = argv.includes("--reuse");

async function developmentSessionCookie(target) {
  const targetUrl = new URL(target);
  if (targetUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(targetUrl.hostname)) {
    throw new Error("Otomatik benchmark oturumu yalnızca yerel HTTP sunucusunda kullanılabilir.");
  }
  const response = await fetch(new URL("/api/admin/dev-session", targetUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roleCode: "01" }),
  });
  if (!response.ok) throw new Error("Benchmark için yerel Yarışma Yöneticisi oturumu açılamadı.");
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

const expected = JSON.parse(await readFile(benchmark.expected, "utf8"));
const requiredFindings = Array.isArray(expected.requiredFindings) ? expected.requiredFindings : [];
const forbiddenFindings = Array.isArray(expected.forbiddenFindings) ? expected.forbiddenFindings : [];

let analysis;
if (reuseLatest) {
  if (!existsSync(benchmark.output)) {
    console.log(`Kayıtlı benchmark çıktısı yok (${benchmark.output}). Önce sunucu açıkken canlı koşu yapın:\n  node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze`);
    process.exit(0);
  }
  const latest = JSON.parse(await readFile(benchmark.output, "utf8"));
  analysis = latest.analysis;
  const legacy = Boolean(analysis?.scorePlan) || (Array.isArray(analysis?.criteria) && analysis.criteria.some((item) => typeof item?.stage !== "string"));
  if (legacy) {
    console.log(`Kayıtlı çıktı eski (puanlı 1.0) biçimde: ${benchmark.output}. Dört aşamalı beklentilerle karşılaştırılamaz; sunucu açıkken canlı koşu yapın:
  node tools/run_celikkubbe_benchmark.mjs http://localhost:3000/api/analyze`);
    process.exit(1);
  }
} else {
  const pdf = await readFile(benchmark.pdf);
  const form = new FormData();
  form.append("file", new Blob([pdf], { type: "application/pdf" }), expected.document || path.basename(benchmark.pdf));
  form.append("pageCount", String(expected.pageCount || 0));
  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
    headers: { cookie: await developmentSessionCookie(endpoint) },
  });
  analysis = await response.json();
  if (!response.ok) throw new Error(analysis.error || `HTTP ${response.status}`);
}

const lower = (value) => String(value || "").toLocaleLowerCase("tr-TR");
const criteria = Array.isArray(analysis.criteria) ? analysis.criteria : [];

/** Tam / kısmi / eksik ayrımı: anahtar kelimelerin kaçının tuttuğuna bakılır. */
const hitCount = (text, keywords) => keywords.filter((keyword) => lower(text).includes(lower(keyword))).length;

// Her beklenen bulgu tek bir gerçek kriterle eşleşir. Bütün kriterleri tek bir
// metne birleştirmek, anahtar sözcüklerin farklı maddelerden toplanıp yanlış
// bir "tam eşleşme" üretmesine yol açıyordu.
const claimedCriteria = new Set();
const findingMatches = requiredFindings.map((item) => {
  let bestIndex = -1;
  let bestHits = 0;
  for (let index = 0; index < criteria.length; index += 1) {
    if (claimedCriteria.has(index)) continue;
    const hits = hitCount(criterionText(criteria[index]), item.keywords);
    if (hits > bestHits) {
      bestIndex = index;
      bestHits = hits;
    }
  }
  const match = bestIndex >= 0 ? criteria[bestIndex] : null;
  const verdict = bestHits === item.keywords.length ? "tam" : bestHits > 0 ? "kismi" : "eksik";
  if (verdict === "tam") claimedCriteria.add(bestIndex);
  const stageOk = verdict === "tam" && stageMatches(item.stage, match?.stage);
  const requiredOk = verdict === "tam" && (typeof item.required !== "boolean" || match?.required === item.required);
  const pageOk = verdict === "tam" && (item.sourcePage == null || match?.sourcePage === item.sourcePage);
  return {
    expected: item.name,
    expectedStage: item.stage ?? null,
    expectedRequired: typeof item.required === "boolean" ? item.required : null,
    expectedSourcePage: item.sourcePage ?? null,
    verdict,
    keywordHits: `${bestHits}/${item.keywords.length}`,
    actual: match?.name || null,
    actualStage: match?.stage || null,
    actualRequired: match?.required ?? null,
    actualSourcePage: match?.sourcePage ?? null,
    stageOk,
    requiredOk,
    // Sayfa uyumu bilgi amaçlıdır; geçme koşuluna girmez.
    pageOk,
    matched: verdict === "tam" && stageOk && requiredOk,
  };
});

// Yasaklı ifadeler kriter kriter aranır; `fields` verilirse yalnızca o alanlara bakılır.
const forbiddenHits = forbiddenFindings
  .map((item) => {
    const hit = criteria.find((criterion) => includesAll(criterionText(criterion, item.fields), item.keywords));
    return hit ? { expected: item.name, actual: hit.name, stage: hit.stage, sourcePage: hit.sourcePage ?? null } : null;
  })
  .filter(Boolean);

const unsupported = unsupportedCriteria(analysis);
const stages = stageDistribution(criteria);

const partialCount = findingMatches.filter((item) => item.verdict === "kismi").length;
const missingCount = findingMatches.filter((item) => item.verdict === "eksik").length;
const stageMismatchCount = findingMatches.filter((item) => item.verdict === "tam" && !item.stageOk).length;
const requiredMismatchCount = findingMatches.filter((item) => item.verdict === "tam" && !item.requiredOk).length;
const requiredFindingRecall = findingMatches.length
  ? findingMatches.filter((item) => item.matched).length / findingMatches.length
  : 1;
const minCriteriaOk = !expected.minCriteria || criteria.length >= expected.minCriteria;

const result = {
  generatedAt: new Date().toISOString(),
  benchmark: benchmarkName,
  model: analysis.model,
  // Süre, token ve çağrı sayısı: performans çalışmasının öncesi/sonrası karşılaştırması için.
  diagnostics: analysis.diagnostics ?? null,
  expected: {
    document: expected.document,
    pageCount: expected.pageCount ?? null,
    minCriteria: expected.minCriteria ?? null,
    requiredFindingCount: findingMatches.length,
    forbiddenFindingCount: forbiddenFindings.length,
  },
  actual: {
    criterionCount: criteria.length,
    pageCount: analysis.pageCount ?? null,
    stages,
    analysisWarnings: analysis.analysisWarnings ?? [],
  },
  comparison: {
    requiredFindings: findingMatches,
    requiredFindingRecall,
    coverage: {
      tamEslesme: findingMatches.length - partialCount - missingCount,
      kismiEslesme: partialCount,
      eksik: missingCount,
      asamaUyusmazligi: stageMismatchCount,
      zorunlulukUyusmazligi: requiredMismatchCount,
    },
    forbiddenHits,
    unsupportedCriteria: unsupported,
    minCriteriaOk,
  },
  analysis,
};

if (!reuseLatest) {
  await mkdir(path.dirname(benchmark.output), { recursive: true });
  await writeFile(benchmark.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

const pct = (value) => `${Math.round(value * 1000) / 10}%`;
const diagnostics = analysis.diagnostics;
const lines = [
  `Benchmark        : ${benchmarkName} · ${expected.document || "-"}`,
  `Model            : ${analysis.model || "-"}`,
  `Süre             : ${diagnostics ? `${diagnostics.totalMs} ms (model ${diagnostics.modelMs} ms, yükleme ${diagnostics.uploadMs ?? 0} ms${diagnostics.cached ? ", ÖNBELLEKTEN" : ""})` : "-"}`,
  `Token            : ${diagnostics ? `${diagnostics.promptTokens} giriş + ${diagnostics.outputTokens} çıkış` : "-"}`,
  `API çağrısı      : ${diagnostics?.apiCalls ?? "-"} · belge taşıma ${diagnostics?.documentTransfers ?? "-"} (${diagnostics?.documentDelivery ?? "-"})`,
  `Kriter sayısı    : ${criteria.length}${expected.minCriteria ? ` (en az ${expected.minCriteria} ${minCriteriaOk ? "✓" : "✗"})` : ""}`,
  `Aşama dağılımı   : dil/şablon ${stages.language_template} · başlık/içerik ${stages.headings_content} · kategori/benzerlik ${stages.category_similarity} · teknik kural ${stages.criteria_evidence}${stages.unknown ? ` · tanımsız ${stages.unknown}` : ""}`,
  `Zorunlu / diğer  : ${stages.required} / ${stages.other}`,
  `Kural kapsamı    : ${pct(requiredFindingRecall)} · tam ${findingMatches.length - partialCount - missingCount} / kısmi ${partialCount} / eksik ${missingCount}${stageMismatchCount ? ` · aşama uyuşmazlığı ${stageMismatchCount}` : ""}${requiredMismatchCount ? ` · zorunluluk uyuşmazlığı ${requiredMismatchCount}` : ""}`,
  `Yasaklı ifade    : ${forbiddenHits.length ? forbiddenHits.map((item) => `${item.expected} → ${item.actual}`).join("; ") : "yok"}`,
  `Dayanaksız kriter: ${unsupported.length}${unsupported.length ? ` → ${unsupported.slice(0, 5).map((item) => `${item.name} (${item.reasons.join(", ")})`).join(", ")}` : ""}`,
  `Analiz uyarısı   : ${Array.isArray(analysis.analysisWarnings) && analysis.analysisWarnings.length ? analysis.analysisWarnings.join(" | ") : "yok"}`,
];
for (const item of findingMatches.filter((entry) => !entry.matched)) {
  const detail = item.verdict !== "tam"
    ? `${item.verdict} ${item.keywordHits}`
    : !item.stageOk
      ? `aşama ${item.actualStage} (beklenen ${Array.isArray(item.expectedStage) ? item.expectedStage.join("/") : item.expectedStage})`
      : `zorunluluk ${item.actualRequired} (beklenen ${item.expectedRequired})`;
  lines.push(`  ✗ ${item.expected.padEnd(40)} ${detail}${item.actual ? ` · en yakın: ${item.actual}` : ""}`);
}
if (!findingMatches.length) {
  lines.push("  (yer gerçeği dosyasında requiredFindings boş; kapsam ölçülmedi — docs/benchmarks altındaki şablonu doldurun)");
}
lines.push(`Çıktı            : ${reuseLatest ? "(--reuse, yazılmadı)" : benchmark.output}`);
console.log(lines.join("\n"));

// Geçme koşulu: %100 kural kapsamı + 0 yasaklı ifade (+ varsa asgari kriter sayısı).
const passed = requiredFindingRecall === 1 && forbiddenHits.length === 0 && minCriteriaOk;
if (!passed) {
  console.error("\nBENCHMARK DÜŞTÜ: yukarıdaki eksik ölçütleri inceleyin.");
  process.exitCode = 1;
}
