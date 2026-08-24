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

/**
 * Eleme ifadeleri kelime başında aranır: aksi hâlde "inceleme"/"denemeye" içindeki
 * "eleme" ve "100 puan" içindeki "0 puan" yanlışlıkla eleme sayılır. Türkçe ekleri
 * tolere etmek için kökten sonrası serbest bırakılır.
 */
const ELIMINATION_PATTERN = /(?:^|[^a-zçğıöşüâîû0-9])(?:diskalifiye|elen[a-zçğıöşü]*|eleme[a-zçğıöşü]*|yarışma dışı|değerlendirmeye alınma[a-zçğıöşü]*|geçersiz sayıl[a-zçğıöşü]*|sıfır puan|0 puan)/;

/**
 * Kriterin eleme/diskalifiye sonucu doğurup doğurmadığı. Bu maddelerde nihai
 * karar her zaman görevlidedir; rapor değerlendirmesi de aynı testi kullanır.
 */
export function criterionEliminates(item: Criterion): boolean {
  if (item.type === "elimination_review") return true;
  return ELIMINATION_PATTERN.test(` ${item.name} ${item.violationOutcome}`.toLocaleLowerCase("tr-TR"));
}

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
    if (criterionEliminates(item)) {
      // Eleme maddeleri toplam puandan bağımsız olarak ayrıca denetlenir.
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
