// Analiz çıktısını (dört aşamalı, puansız kriter modeli) beklenti dosyasıyla
// karşılaştıran saf yardımcılar. Ağ yok; hem canlı kalite koşusu hem de
// kayıtlı çıktı doğrulaması bu modülü kullanır.
//
// Beklenti şekli:
//   minCriteria        : en az kriter sayısı
//   requiredFindings[] : { name, keywords, stage?, required? }
//                        stage tek değer ya da kabul edilen aşamalar dizisi olabilir
//   forbiddenCriteria[]: { name, keywords, fields? }
//                        fields verilirse yalnızca o alanlarda aranır (ör. ["name"])

const STAGES = ["language_template", "headings_content", "category_similarity", "criteria_evidence"];

const lower = (value) => String(value || "").toLocaleLowerCase("tr-TR");

export function criterionText(criterion, fields) {
  const keys = Array.isArray(fields) && fields.length ? fields : ["name", "description", "sourceText", "violationOutcome"];
  return keys.map((key) => criterion?.[key]).join(" ");
}

export function includesAll(value, keywords) {
  const text = lower(value);
  return keywords.every((keyword) => text.includes(lower(keyword)));
}

export function findCriterion(criteria, keywords, fields) {
  return (criteria || []).find((criterion) => includesAll(criterionText(criterion, fields), keywords));
}

/** Beklenen aşama tek değer veya dizi olabilir; boşsa her aşama kabul edilir. */
export function stageMatches(expectedStage, actualStage) {
  if (!expectedStage) return true;
  const allowed = Array.isArray(expectedStage) ? expectedStage : [expectedStage];
  return allowed.includes(actualStage);
}

/** Dört aşama için kriter sayısı ve zorunlu/diğer dağılımı. */
export function stageDistribution(criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  const stages = Object.fromEntries(STAGES.map((stage) => [stage, list.filter((criterion) => criterion?.stage === stage).length]));
  const unknown = list.filter((criterion) => !STAGES.includes(criterion?.stage)).length;
  return {
    ...stages,
    ...(unknown ? { unknown } : {}),
    required: list.filter((criterion) => criterion?.required === true).length,
    other: list.filter((criterion) => criterion?.required !== true).length,
  };
}

/**
 * Dayanaksız kriter: belge kaynaklı olduğu hâlde kaynak sayfası boş, alıntısı
 * boş veya sayfası PDF sınırları dışında kalan madde. Resmî belgede karşılığı
 * doğrulanamaz; yönetici elle düzeltmelidir.
 */
export function unsupportedCriteria(analysis) {
  const pageCount = Number(analysis?.pageCount) || 0;
  const criteria = Array.isArray(analysis?.criteria) ? analysis.criteria : [];
  return criteria
    .filter((criterion) => criterion?.origin === "document")
    .map((criterion) => {
      const reasons = [];
      if (!String(criterion.sourceText || "").trim()) reasons.push("alıntı yok");
      if (criterion.sourcePage === null || criterion.sourcePage === undefined) reasons.push("sayfa yok");
      else if (pageCount > 0 && (criterion.sourcePage < 1 || criterion.sourcePage > pageCount)) reasons.push(`sayfa ${criterion.sourcePage} PDF dışında`);
      return reasons.length ? { id: criterion.id, name: criterion.name, sourcePage: criterion.sourcePage ?? null, reasons } : null;
    })
    .filter(Boolean);
}

export function compareAnalysis(analysis, expected) {
  const issues = [];
  const criteria = Array.isArray(analysis?.criteria) ? analysis.criteria : [];

  if (expected.minCriteria && criteria.length < expected.minCriteria) {
    issues.push(`Kriter sayısı ${criteria.length}; en az ${expected.minCriteria} bekleniyordu.`);
  }

  for (const item of expected.requiredFindings || []) {
    const match = findCriterion(criteria, item.keywords);
    if (!match) {
      issues.push(`Kriter bulunamadı: ${item.name}. Anahtarların aynı kriterde olması gerekir.`);
      continue;
    }
    if (!stageMatches(item.stage, match.stage)) {
      const wanted = Array.isArray(item.stage) ? item.stage.join("/") : item.stage;
      issues.push(`${item.name} aşaması ${match.stage ?? "boş"}; ${wanted} bekleniyordu.`);
    }
    if (typeof item.required === "boolean" && match.required !== item.required) {
      issues.push(`${item.name} ${item.required ? "zorunlu" : "diğer"} olmalıydı; ${match.required ? "zorunlu" : "diğer"} geldi.`);
    }
  }

  for (const item of expected.forbiddenCriteria || []) {
    const match = findCriterion(criteria, item.keywords, item.fields);
    if (match) issues.push(`Puan/saha veya belgede dayanağı olmayan kriter üretildi: ${item.name} (${match.name}).`);
  }

  const unsupported = unsupportedCriteria(analysis);
  for (const item of unsupported) {
    issues.push(`Dayanaksız kriter: ${item.name} (${item.reasons.join(", ")}).`);
  }

  return { passed: issues.length === 0, issues, unsupported, stages: stageDistribution(criteria) };
}

export function requireQuality(analysis, expected, label) {
  const comparison = compareAnalysis(analysis, expected);
  if (!comparison.passed) {
    throw new Error(`${label} kalite doğrulaması başarısız:\n- ${comparison.issues.join("\n- ")}`);
  }
  return comparison;
}
