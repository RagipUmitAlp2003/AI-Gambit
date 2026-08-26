import {
  buildFileGateChecks,
  buildHeadingChecks,
  buildHeadingsCheck,
  buildLanguageCheck,
  buildSimilarityCheck,
  buildTemplateCheck,
  detectLanguage,
  feedbackOf,
  languageLabel,
  languageMismatch,
  orderStages,
  pageLimitRules,
  similarityResultOf,
  stageSummaryOf,
  summarizeFindings,
  worstVerdict,
  type PageLimitRule,
  type SimilarityPeer,
} from "./report-prechecks";
import { verifiedOutsidePdf } from "./types";
import type { Criterion, CriterionFinding, PreCheck, ProfileExport, ReportEvaluation, StageResult } from "./types";

/**
 * Çevrimdışı rapor değerlendirici: AI motoru olmadan yalnızca deterministik
 * kontrolleri çalıştırır (dosya kapısı, dil tespiti, sayfa sınırı, başlık
 * eşleşmesi, havuz benzerliği). Anlamsal kural bulgusu üretmez; her aktif
 * kriter REVİZYON + "kanıt yok" olarak hakeme bırakılır. Sayfa sınırı kuralları
 * ölçüme dayandığı için kesin sonuçla doldurulur. Aynı sözleşmeyi
 * (ReportEvaluation 2.0) provider: "demo" ile üretir.
 */

const OFFLINE_RATIONALE = "AI motoru bağlı değil; hakem kontrolü gerekli.";

function buildFinding(criterion: Criterion, pageCount: number, pageLimits: PageLimitRule[]): CriterionFinding {
  const base = {
    criterionId: criterion.id,
    criterionName: criterion.name,
    stage: criterion.stage,
    required: criterion.required,
    verifiability: criterion.verifiability,
  };
  // PDF dışı kanıt gerektiren kural çevrimdışı yedekte de ihlal sayılmaz.
  if (verifiedOutsidePdf(criterion.verifiability)) {
    return {
      ...base,
      verdict: "DEGERLENDIRILEMEDI",
      rationale: "PDF üzerinden değerlendirilemez; harici kanıt veya hakem kontrolü gerekli.",
      evidence: [],
      evidenceMissing: false,
    };
  }
  const pageRule = pageLimits.find((entry) => entry.rule.id === criterion.id);
  if (pageRule) {
    const withinLimit = pageCount <= pageRule.limit;
    return {
      ...base,
      verdict: withinLimit ? "BASARILI" : criterion.required ? "KRITIK_HATA" : "REVIZYON",
      rationale: withinLimit
        ? `Rapor ${pageCount} sayfa; kuralın izin verdiği en fazla ${pageRule.limit} sayfa sınırına uygun (deterministik sayım).`
        : `Rapor ${pageCount} sayfa; kural en fazla ${pageRule.limit} sayfaya izin veriyor (deterministik sayım). İhlal sonucu: ${criterion.violationOutcome}`,
      // Ölçüme dayalı kontrol: kanıt, raporun sayfa sayısının kendisidir.
      evidence: [],
      evidenceMissing: false,
    };
  }
  return {
    ...base,
    verdict: "REVIZYON",
    rationale: OFFLINE_RATIONALE,
    evidence: [],
    evidenceMissing: true,
  };
}

export function evaluateReportOffline(input: {
  profile: ProfileExport;
  file: File;
  pages: string[];
  pageCount: number;
  peers: SimilarityPeer[];
  /** Yükleme anında üretilmiş kapı kontrolleri; verilmezse yeniden hesaplanır. */
  gateChecks?: PreCheck[];
}): ReportEvaluation {
  const { profile, file, pages, pageCount, peers } = input;
  const startedAt = Date.now();
  const gateChecks = input.gateChecks ?? buildFileGateChecks(file, profile.setup);
  const activeCriteria = profile.criteria.filter((item) => item.active);
  const pageLimits = pageLimitRules(profile);
  const findings = activeCriteria.map((criterion) => buildFinding(criterion, pageCount, pageLimits));

  const expectedLanguage = profile.setup.reportLanguage ?? null;
  const detected = detectLanguage(pages);
  const mismatch = languageMismatch(detected, expectedLanguage);
  const similarityCheck = buildSimilarityCheck(pages.join(" "), peers);
  const headings = buildHeadingChecks(profile, pages);
  const missingHeadings = headings.filter((item) => !item.present).length;

  const stage1Verdict = worstVerdict([
    ...findings.filter((item) => item.stage === "language_template").map((item) => item.verdict),
    ...(mismatch ? ["REVIZYON" as const] : []),
  ]);
  const stages: StageResult[] = [
    {
      stage: "language_template",
      verdict: stage1Verdict,
      summary: `${mismatch ? `Dil uyuşmazlığı: rapor ${languageLabel(detected)}, şartname ${expectedLanguage} bekliyor. ` : ""}${stageSummaryOf("language_template", findings)}`,
      detectedLanguage: languageLabel(detected),
      expectedLanguage,
      evidence: [],
    },
    {
      stage: "headings_content",
      verdict: worstVerdict([
        ...findings.filter((item) => item.stage === "headings_content").map((item) => item.verdict),
        ...(missingHeadings ? ["REVIZYON" as const] : []),
      ]),
      summary: headings.length
        ? `${headings.length} zorunlu başlıktan ${headings.length - missingHeadings} tanesi kelime eşleşmesiyle bulundu; ${missingHeadings} tanesi bulunamadı. ${stageSummaryOf("headings_content", findings)}`
        : stageSummaryOf("headings_content", findings),
      headings,
      evidence: [],
    },
    {
      stage: "category_similarity",
      verdict: worstVerdict(findings.filter((item) => item.stage === "category_similarity").map((item) => item.verdict)),
      summary: `Kategori uygunluğu anlamsal analiz gerektirir; AI motoru bağlı olmadığı için skor üretilmedi. ${similarityCheck.detail}`,
      categoryScore: null,
      similarity: similarityResultOf(similarityCheck),
      evidence: [],
    },
  ];
  const orderedStages = orderStages(stages, findings);

  const preChecks: PreCheck[] = [
    ...gateChecks,
    buildLanguageCheck(pages, expectedLanguage),
    buildTemplateCheck(profile, pageCount),
    buildHeadingsCheck(profile, pages),
    {
      id: "precheck-category",
      kind: "category",
      name: "Kategori uygunluğu",
      status: "skipped",
      method: "ai",
      detail: "Kategori uygunluğu anlamsal analiz gerektirir; AI analiz motoru bağlandığında çalışacak.",
      evidence: [],
    },
    similarityCheck,
  ];

  return {
    version: "2.0",
    profileRef: {
      profileId: profile.profileId ?? null,
      competition: profile.setup.competition,
      year: profile.setup.year,
      stage: profile.setup.stage,
      reportType: profile.setup.reportType,
    },
    report: { name: file.name, pages: pageCount, sizeBytes: file.size },
    preChecks,
    stages: orderedStages,
    findings,
    summary: summarizeFindings(findings, orderedStages),
    feedbackDraft: feedbackOf(findings),
    analysisWarnings: [
      "Bu sonuç çevrimdışı deterministik kontrollerle üretildi; kural bazlı kanıt çıkarma AI motoru bağlandığında eklenecek.",
      ...(file.size > 50 * 1024 * 1024
        ? ["Dosya 50 MB'den büyük; mevcut sunucu analiz sınırı için sıkıştırılması gerekecek."]
        : []),
    ],
    provider: "demo",
    analyzedAt: new Date().toISOString(),
    diagnostics: {
      totalMs: Date.now() - startedAt,
      modelMs: 0,
      promptTokens: 0,
      outputTokens: 0,
      cached: false,
      apiCalls: 0,
    },
  };
}
