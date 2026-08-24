import { readFile } from "node:fs/promises";
import path from "node:path";
import { compareAnalysis } from "./quality-assertions.mjs";
import { idaExpectation, syntheticExpectation } from "./quality-expectations.mjs";

const root = process.cwd();
const fixtures = [
  ["sentetik-analiz.json", syntheticExpectation],
  ["ida-analiz.json", idaExpectation],
];

let failed = false;
for (const [name, expected] of fixtures) {
  const analysis = JSON.parse(await readFile(path.join(root, "docs", "corpus", name), "utf8"));
  const comparison = compareAnalysis(analysis, expected);
  console.log(`${name}: ${comparison.passed ? "PASS" : "FAIL"}`);
  for (const issue of comparison.issues) console.log(`  - ${issue}`);
  if (!comparison.passed) failed = true;
}

if (failed) process.exitCode = 1;
