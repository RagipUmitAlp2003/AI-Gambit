const lower = (value) => String(value || "").toLocaleLowerCase("tr-TR");

export function criterionText(criterion) {
  return [
    criterion?.name,
    criterion?.scope,
    criterion?.sourceText,
    criterion?.aiInterpretation,
    criterion?.violationOutcome,
  ].join(" ");
}

export function includesAll(value, keywords) {
  const text = lower(value);
  return keywords.every((keyword) => text.includes(lower(keyword)));
}

export function findCriterion(criteria, keywords) {
  return (criteria || []).find((criterion) => includesAll(criterionText(criterion), keywords));
}

export function compareAnalysis(analysis, expected) {
  const issues = [];
  const criteria = Array.isArray(analysis?.criteria) ? analysis.criteria : [];
  const groups = Array.isArray(analysis?.scorePlan?.groups) ? analysis.scorePlan.groups : [];

  if (expected.minCriteria && criteria.length < expected.minCriteria) {
    issues.push(`Kriter sayısı ${criteria.length}; en az ${expected.minCriteria} bekleniyordu.`);
  }
  if (Object.hasOwn(expected, "declaredTotalScore")
      && analysis?.scorePlan?.declaredTotalScore !== expected.declaredTotalScore) {
    issues.push(`Toplam puan ${analysis?.scorePlan?.declaredTotalScore ?? "null"}; ${expected.declaredTotalScore} bekleniyordu.`);
  }

  for (const item of expected.scoreGroups || []) {
    const match = groups.find((group) => includesAll(`${group.name} ${group.scope}`, item.keywords));
    if (!match) issues.push(`Puan grubu bulunamadı: ${item.name}.`);
    else if (match.maxScore !== item.maxScore) {
      issues.push(`${item.name} puanı ${match.maxScore}; ${item.maxScore} bekleniyordu.`);
    }
  }

  for (const item of expected.requiredFindings || []) {
    const match = findCriterion(criteria, item.keywords);
    if (!match) {
      issues.push(`Kriter bulunamadı: ${item.name}. Anahtarların aynı kriterde olması gerekir.`);
      continue;
    }
    if (item.effect && match.effect !== item.effect) {
      issues.push(`${item.name} etkisi ${match.effect ?? "boş"}; ${item.effect} bekleniyordu.`);
    }
    if (item.maxScore !== undefined && match.maxScore !== item.maxScore) {
      issues.push(`${item.name} azami puanı ${match.maxScore ?? "null"}; ${item.maxScore} bekleniyordu.`);
    }
    if (item.methods && !item.methods.includes(match.evaluationMethod)) {
      issues.push(`${item.name} yöntemi ${match.evaluationMethod}; ${item.methods.join("/")} bekleniyordu.`);
    }
    if (item.disallowedTypes?.includes(match.type)) {
      issues.push(`${item.name} yanlışlıkla ${match.type} olarak sınıflandırıldı.`);
    }
  }

  for (const item of expected.forbiddenCriteria || []) {
    const match = findCriterion(criteria, item.keywords);
    if (match) issues.push(`Belgede dayanağı olmayan kriter üretildi: ${item.name} (${match.name}).`);
  }

  return { passed: issues.length === 0, issues };
}

export function requireQuality(analysis, expected, label) {
  const comparison = compareAnalysis(analysis, expected);
  if (!comparison.passed) {
    throw new Error(`${label} kalite doğrulaması başarısız:\n- ${comparison.issues.join("\n- ")}`);
  }
  return comparison;
}
