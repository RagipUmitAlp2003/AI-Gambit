import { criterionEffectOf, criterionEliminates, maxRawScoreOf } from "./evaluation-summary";
import {
  buildFileGateChecks,
  buildHeadingsCheck,
  buildLanguageCheck,
  buildSimilarityCheck,
  buildTemplateCheck,
  matchCriterionInPages,
  parsePageLimit,
  type SimilarityPeer,
} from "./report-prechecks";
import type {
  Criterion,
  CriterionFinding,
  ParticipantFeedback,
  PreCheck,
  ProfileExport,
  ReportEvaluation,
} from "./types";

/**
 * Çevrimdışı rapor değerlendirici: yalnızca kesin (deterministik) kontrolleri
 * çalıştırır. Anlamsal kriterlerde puan uydurmaz; bu kriterleri açık biçimde
 * "insan kararı bekliyor" olarak işaretler. AI analiz motoru bağlandığında aynı
 * sözleşmeyi (ReportEvaluation) provider: "api" ile doldurur.
 */

/**
 * İnsan yetkisi gerektiren kriterler: yöntemi insan/hibrit olanlar, yalnızca
 * jüriye ait olanlar ve eleme sonucu doğuranlar (sözleşme kuralı 3).
 */
function requiresHumanDecision(criterion: Criterion): boolean {
  return (
    criterion.evaluationMethod === "human" ||
    criterion.evaluationMethod === "hybrid" ||
    criterion.type === "human_only" ||
    criterionEliminates(criterion)
  );
}

function buildFinding(criterion: Criterion, pages: string[], pageCount: number, gateChecks: PreCheck[]): CriterionFinding {
  const base = {
    criterionId: criterion.id,
    criterionName: criterion.name,
    // Geçiş/baraj/ceza kriterlerinde eski veya hatalı maxScore değeri bulunsa
    // bile görevliye puan alanı gösterilmez; yalnızca score etkisi puanlanır.
    maxScore: criterionEffectOf(criterion) === "score" ? criterion.maxScore : null,
    requiresHuman: requiresHumanDecision(criterion),
  };

  if (criterion.evaluationMethod === "deterministic" && criterion.type === "mandatory_content") {
    const match = matchCriterionInPages(criterion, pages);
    if (!match.searchable) {
      return {
        ...base,
        status: "needs_human",
        proposedScore: null,
        rationale: "Kriter adından arama yapılabilir anahtar kelime çıkarılamadı; bu başlığın raporda bulunup bulunmadığı hakem tarafından kontrol edilmelidir.",
        evidence: [],
        confidence: "low",
      };
    }
    const snippet = match.snippet.trim();
    return {
      ...base,
      status: match.found ? "met" : "not_found",
      proposedScore: null,
      rationale: match.found
        ? `"${criterion.name}" başlığıyla eşleşen içerik ${match.page}. sayfada bulundu (${match.matchedKeywords}/${match.totalKeywords} anahtar kelime).`
        : `"${criterion.name}" ile eşleşen bir bölüm raporda bulunamadı. Kelime eşleşmesine dayalı bu bulguyu hakem doğrulamalıdır.`,
      evidence: match.found && match.page && snippet ? [{ page: match.page, text: snippet }] : [],
      confidence: match.found && snippet ? "medium" : "low",
    };
  }

  if (criterion.evaluationMethod === "deterministic" && criterion.type === "format_rule") {
    const limit = parsePageLimit(`${criterion.name} ${criterion.sourceText}`);
    if (limit !== null) {
      const withinLimit = pageCount <= limit;
      return {
        ...base,
        status: withinLimit ? "met" : "not_met",
        proposedScore: null,
        rationale: withinLimit
          ? `Rapor ${pageCount} sayfa; kuralın izin verdiği en fazla ${limit} sayfa sınırına uygun.`
          : `Rapor ${pageCount} sayfa; kural en fazla ${limit} sayfaya izin veriyor. İhlal sonucu: ${criterion.violationOutcome}`,
        // Ölçüme dayalı kontrol: kanıt, raporun sayfa sayısının kendisidir.
        evidence: criterion.sourcePage !== null ? [{ page: criterion.sourcePage, text: criterion.sourceText }] : [],
        confidence: "high",
      };
    }
    return {
      ...base,
      status: "needs_human",
      proposedScore: null,
      rationale: "Bu biçim kuralı sayısal bir sınır içermiyor; uygunluk hakem tarafından görsel olarak kontrol edilmelidir.",
      evidence: [],
      confidence: "low",
    };
  }

  if (criterion.evaluationMethod === "deterministic" && criterion.type === "technical_upload") {
    const failed = gateChecks.filter((check) => check.status === "failed" || check.status === "flagged" || check.status === "warning");
    if (failed.length) {
      return {
        ...base,
        status: "not_met",
        proposedScore: null,
        rationale: `Dosya kapısı kontrolleri uyarı üretti: ${failed.map((check) => check.detail).join(" ")} İhlal sonucu: ${criterion.violationOutcome}`,
        evidence: [],
        confidence: "high",
        requiresHuman: true,
      };
    }
    return {
      ...base,
      status: "met",
      proposedScore: null,
      rationale: `Teknik yükleme kuralları dosya kapısında kontrol edildi ve tümü uygun bulundu (${gateChecks.map((check) => check.name).join(", ")}).`,
      evidence: [],
      confidence: "high",
    };
  }

  return {
    ...base,
    status: "needs_human",
    proposedScore: null,
    rationale: base.requiresHuman
      ? "Bu kriterde nihai karar hakem, jüri veya sorumlu görevlidedir; sistem yalnızca bulgu sunar."
      : "Anlamsal değerlendirme, AI analiz motoru bu prototipe bağlandığında gerekçeli puan önerisiyle doldurulacak. Hakem puanı elle verebilir.",
    evidence: [],
    confidence: "low",
  };
}

function buildFeedbackDraft(findings: CriterionFinding[]): ParticipantFeedback {
  const strengths = findings
    .filter((finding) => finding.status === "met")
    .slice(0, 6)
    .map((finding) => `${finding.criterionName}: raporda karşılandı.`);
  const improvements = findings
    .filter((finding) => finding.status === "not_found" || finding.status === "not_met")
    .slice(0, 6)
    .map((finding) => `${finding.criterionName}: ${finding.rationale}`);
  const suggestions = findings
    .filter((finding) => finding.status === "not_found")
    .slice(0, 4)
    .map((finding) => `"${finding.criterionName}" bölümünü şartnamedeki başlık adıyla birebir kullanarak ekleyin.`);
  return { strengths, improvements, suggestions };
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
  const startedAt = performance.now();
  const gateChecks = input.gateChecks ?? buildFileGateChecks(file, profile.setup);
  const activeCriteria = profile.criteria.filter((item) => item.active);
  const findings = activeCriteria.map((criterion) => buildFinding(criterion, pages, pageCount, gateChecks));

  const preChecks: PreCheck[] = [
    ...gateChecks,
    buildLanguageCheck(pages),
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
    buildSimilarityCheck(pages.join(" "), peers),
  ];

  const scoreCriteria = activeCriteria.filter((item) => criterionEffectOf(item) === "score");
  const proposals = findings.filter((finding) => finding.proposedScore !== null);
  /**
   * MAKSİMUM HAM PUAN: profildeki AKTİF puan kriterlerinin azami toplamı.
   * Belgede ilan edilen genel toplama düşülmez — pay bu kriterlerden geldiği
   * için payda da aynı kümeden gelmelidir, aksi hâlde normalize puan 100'ü
   * aşabilir. Eski profillerde normalization yoksa buradan hesaplanır.
   */
  const maxRawScore = profile.normalization?.evaluationTotal ?? maxRawScoreOf(profile.criteria);
  const declaredTotal = maxRawScore > 0 ? maxRawScore : null;
  // Her öneri kendi kriterinin azamisiyle sınırlanır; toplam yapısal olarak taşamaz.
  const rawScore = proposals.length
    ? proposals.reduce((sum, finding) => {
      const proposed = Math.max(0, finding.proposedScore ?? 0);
      return sum + (finding.maxScore !== null ? Math.min(proposed, finding.maxScore) : proposed);
    }, 0)
    : null;

  return {
    version: "1.0",
    profileRef: {
      profileId: profile.profileId ?? null,
      competition: profile.setup.competition,
      year: profile.setup.year,
      stage: profile.setup.stage,
      reportType: profile.setup.reportType,
    },
    report: { name: file.name, pages: pageCount, sizeBytes: file.size },
    preChecks,
    findings,
    proposedTotals: {
      rawScore,
      declaredTotal,
      scoredCriteria: proposals.length,
      pendingCriteria: Math.max(0, scoreCriteria.length - proposals.length),
    },
    feedbackDraft: buildFeedbackDraft(findings),
    analysisWarnings: [
      "Bu sonuç çevrimdışı kesin kontrollerle üretildi; anlamsal kriter analizi AI motoru bağlandığında eklenecek.",
      ...(file.size > 50 * 1024 * 1024
        ? ["Dosya 50 MB'den büyük; mevcut sunucu analiz sınırı için sıkıştırılması gerekecek."]
        : []),
    ],
    provider: "demo",
    analyzedAt: new Date().toISOString(),
    diagnostics: {
      totalMs: Math.round(performance.now() - startedAt),
      modelMs: 0,
      auditMs: 0,
      promptTokens: 0,
      outputTokens: 0,
      cached: false,
    },
  };
}
