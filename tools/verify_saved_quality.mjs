// Kayıtlı analiz çıktılarını (docs/corpus/*.json) beklentilerle yeniden
// karşılaştırır; ağ ve sunucu gerekmez. Kayıt yoksa bilgi verip 0 ile çıkar.
// Eski (puanlı, 1.0) biçimdeki kayıtlar karşılaştırılamaz; açıkça bildirilir ve
// koşu başarısız sayılır — kayıtlar korunur, canlı koşu ile yenilenir.
// Çalıştırma: npm run test:quality:saved
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compareAnalysis } from "./quality-assertions.mjs";
import { idaExpectation, syntheticExpectation } from "./quality-expectations.mjs";

const root = process.cwd();
const fixtures = [
  ["sentetik-analiz.json", syntheticExpectation],
  ["ida-analiz.json", idaExpectation],
];

const available = fixtures.filter(([name]) => existsSync(path.join(root, "docs", "corpus", name)));
if (!available.length) {
  console.log("Kayıtlı analiz çıktısı yok. Üretmek için: npm run dev, ardından node tools/run_quality_test.mjs");
  process.exit(0);
}

/** Dört aşamalı (puansız) model çıktısı mı? Eski kayıtlar scorePlan taşır, kriterlerde stage yoktur. */
export function isLegacyAnalysis(analysis) {
  const criteria = Array.isArray(analysis?.criteria) ? analysis.criteria : [];
  return Boolean(analysis?.scorePlan) || (criteria.length > 0 && criteria.some((item) => typeof item?.stage !== "string"));
}

let failed = false;
for (const [name, expected] of available) {
  const analysis = JSON.parse(await readFile(path.join(root, "docs", "corpus", name), "utf8"));
  if (isLegacyAnalysis(analysis)) {
    console.log(`${name}: ESKİ BİÇİM (puanlı 1.0 çıktı) — dört aşamalı beklentilerle karşılaştırılamaz; npm run dev + node tools/run_quality_test.mjs ile yenileyin.`);
    failed = true;
    continue;
  }
  const comparison = compareAnalysis(analysis, expected);
  const stages = Object.entries(comparison.stages).map(([key, value]) => `${key}=${value}`).join(" ");
  console.log(`${name}: ${comparison.passed ? "PASS" : "FAIL"} (${analysis.criteria?.length ?? 0} kriter · ${stages})`);
  for (const issue of comparison.issues) console.log(`  - ${issue}`);
  if (!comparison.passed) failed = true;
}
for (const [name] of fixtures.filter(([entry]) => !available.some(([found]) => found === entry))) {
  console.log(`${name}: kayıt yok (node tools/run_quality_test.mjs ile üretin).`);
}

if (failed) process.exitCode = 1;
