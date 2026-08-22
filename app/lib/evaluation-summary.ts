import type { Criterion, CriterionEffect, ScorePlan } from "./types";

export function criterionEffectOf(item: Criterion): CriterionEffect {
  if (item.effect) return item.effect;
  if (item.type === "qualitative_score") return "score";
  if (item.type === "formula") return "threshold";
  if (["technical_upload", "format_rule", "mandatory_content", "elimination_review"].includes(item.type)) return "gate";
  return "advisory";
}

/** Orijinal puanın 100 ölçeğindeki karşılığı: (puan / toplam) × 100. */
export function normalizeScore(score: number, declaredTotal: number): number {
  if (!declaredTotal || declaredTotal <= 0) return 0;
  return Math.round((score / declaredTotal) * 1000) / 10;
}

export type DecisionRuleItem = {
  name: string;
  detail: string;
  sourcePage: number | null;
};

/**
 * Toplam puanın yanında ayrıca denetlenmesi gereken kritik kurallar:
 * geçiş koşulları, barajlar, cezalar ve eleme/diskalifiye maddeleri.
 */
export type DecisionRules = {
  gates: DecisionRuleItem[];
  thresholds: DecisionRuleItem[];
  penalties: DecisionRuleItem[];
  eliminations: DecisionRuleItem[];
};

const ELIMINATION_PATTERN = /diskalifiye|elenir|eleme|yarışma dışı|değerlendirmeye alınmaz|0 puan|geçersiz sayılır/i;

export function deriveDecisionRules(criteria: Criterion[], scorePlan?: ScorePlan): DecisionRules {
  const active = criteria.filter((item) => item.active);
  const rules: DecisionRules = { gates: [], thresholds: [], penalties: [], eliminations: [] };

  for (const item of active) {
    const effect = criterionEffectOf(item);
    const record: DecisionRuleItem = {
      name: item.name,
      detail: item.violationOutcome,
      sourcePage: item.sourcePage,
    };
    const eliminates = item.type === "elimination_review" || ELIMINATION_PATTERN.test(`${item.name} ${item.violationOutcome}`);
    if (eliminates) {
      rules.eliminations.push(record);
      continue;
    }
    if (effect === "gate") rules.gates.push(record);
    else if (effect === "threshold") rules.thresholds.push(record);
    else if (effect === "penalty") rules.penalties.push(record);
  }

  for (const group of scorePlan?.groups ?? []) {
    if (group.minimumScore !== null) {
      rules.thresholds.push({
        name: group.name,
        detail: `En az ${group.minimumScore} puan gereklidir (azami ${group.maxScore}).`,
        sourcePage: group.sourcePage,
      });
    }
  }

  return rules;
}
