// Sentetik kılavuz ile İDA şartnamesini yerel analiz API'sine gönderir ve
// sonuçları docs/corpus altına yazar. Sunucu çalışırken kullanılır:
//   node tools/run_quality_test.mjs [http://localhost:3000/api/analyze]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const endpoint = process.argv.find((argument) => argument.startsWith("http")) || "http://localhost:3000/api/analyze";

const jobs = [
  {
    pdf: path.join(root, "output", "pdf", "Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf"),
    out: path.join(root, "docs", "corpus", "sentetik-analiz.json"),
    pageCount: "3",
    setup: {
      competition: "Akıllı Ulaşım Sistemleri Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Ön değerlendirme",
      reportType: "Ön Tasarım Raporu (ÖTR)",
      year: "2026",
      allowedFormats: ["PDF"],
      maxFileSizeMb: 25,
      maxFileCount: 1,
      defaultViolationAction: "block",
    },
  },
  {
    pdf: path.join(root, "output", "pdf", "official", "2026_Insansiz_Deniz_Araci_Sartnamesi.pdf"),
    out: path.join(root, "docs", "corpus", "ida-analiz.json"),
    pageCount: "29",
    setup: {
      competition: "İnsansız Deniz Aracı Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Kritik tasarım değerlendirmesi",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
      allowedFormats: ["PDF"],
      maxFileSizeMb: 25,
      maxFileCount: 1,
      defaultViolationAction: "jury",
    },
  },
];

for (const job of jobs) {
  const started = Date.now();
  const pdf = await readFile(job.pdf);
  const form = new FormData();
  form.append("file", new Blob([pdf], { type: "application/pdf" }), path.basename(job.pdf));
  form.append("setup", JSON.stringify(job.setup));
  form.append("pageCount", job.pageCount);
  const response = await fetch(endpoint, { method: "POST", body: form });
  const analysis = await response.json();
  if (!response.ok) throw new Error(`${path.basename(job.out)}: ${analysis.error || response.status}`);
  await writeFile(job.out, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.basename(job.out),
    seconds: Math.round((Date.now() - started) / 1000),
    criteria: analysis.criteria.length,
    declaredTotal: analysis.scorePlan?.declaredTotalScore ?? null,
    groups: analysis.scorePlan?.groups.length ?? 0,
    audit: analysis.scorePlan?.auditStatus,
  }));
}
