// Sentetik kılavuz ile İDA şartnamesini yerel analiz API'sine gönderir,
// beklentilerle karşılaştırır ve sonuçları docs/corpus altına yazar.
// Sunucu çalışırken kullanılır:
//   node tools/run_quality_test.mjs [http://localhost:3000/api/analyze]
//
// Analiz çıktısı (dört aşamalı, puansız model):
//   { setup, templateProfile, criteria[], pageCount, analysisWarnings, diagnostics, model }
// Yarışma bilgileri yalnızca PDF'den çıkarılır; sunucu ayrıca gönderilen form
// alanlarını yok sayar, bu yüzden istekte sadece dosya ve sayfa sayısı vardır.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireQuality, stageDistribution, unsupportedCriteria } from "./quality-assertions.mjs";
import { idaExpectation, syntheticExpectation } from "./quality-expectations.mjs";

const root = process.cwd();
const endpoint = process.argv.find((argument) => argument.startsWith("http")) || "http://localhost:3000/api/analyze";

async function developmentSessionCookie(target) {
  const targetUrl = new URL(target);
  if (targetUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(targetUrl.hostname)) {
    throw new Error("Otomatik kalite testi oturumu yalnızca yerel HTTP sunucusunda kullanılabilir.");
  }
  const response = await fetch(new URL("/api/admin/dev-session", targetUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roleCode: "01" }),
  });
  if (!response.ok) throw new Error("Kalite testi için yerel Yarışma Yöneticisi oturumu açılamadı.");
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

const jobs = [
  {
    pdf: path.join(root, "output", "pdf", "Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf"),
    out: path.join(root, "docs", "corpus", "sentetik-analiz.json"),
    pageCount: "3",
    expected: syntheticExpectation,
  },
  {
    pdf: path.join(root, "output", "pdf", "official", "2026_Insansiz_Deniz_Araci_Sartnamesi.pdf"),
    out: path.join(root, "docs", "corpus", "ida-analiz.json"),
    pageCount: "29",
    expected: idaExpectation,
  },
];

for (const job of jobs) {
  const started = Date.now();
  const pdf = await readFile(job.pdf);
  const form = new FormData();
  form.append("file", new Blob([pdf], { type: "application/pdf" }), path.basename(job.pdf));
  form.append("pageCount", job.pageCount);
  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
    headers: { cookie: await developmentSessionCookie(endpoint) },
  });
  const analysis = await response.json();
  if (!response.ok) throw new Error(`${path.basename(job.out)}: ${analysis.error || response.status}`);
  // Çıktı önce yazılır: beklenti düşse bile kayıt incelenebilir.
  await writeFile(job.out, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  const criteria = Array.isArray(analysis.criteria) ? analysis.criteria : [];
  console.log(JSON.stringify({
    out: path.basename(job.out),
    seconds: Math.round((Date.now() - started) / 1000),
    criteria: criteria.length,
    stages: stageDistribution(criteria),
    unsupported: unsupportedCriteria(analysis).length,
    warnings: Array.isArray(analysis.analysisWarnings) ? analysis.analysisWarnings.length : 0,
    apiCalls: analysis.diagnostics?.apiCalls ?? null,
    totalMs: analysis.diagnostics?.totalMs ?? null,
  }));
  requireQuality(analysis, job.expected, path.basename(job.out));
}
