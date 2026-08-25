// İstek koruması (hız ve eşzamanlılık sınırı) regresyon testleri.
// Çalıştırma: npm run test:regressions
import { acquireAnalysisPermit } from "../app/lib/request-guard.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
