import { criterionEffectOf } from "./evaluation-summary.ts";
import type { Criterion, ScorePlan } from "./types";

const EPSILON = 0.01;

/**
 * Model bazen resmî puan gruplarını doğru çıkarırken, tekrarlı saha görevlerini
 * tek tek `Criterion` kayıtlarına dönüştürmez. Bu durumda profilin resmî puan
 * ölçeği kaybolmasın diye yalnızca tamamen kapsanmayan grup için bütüncül,
 * hakem kontrollü bir puan kriteri oluşturulur.
 *
 * Kısmen yapılandırılmış grupta otomatik tamamlama yapılmaz: kalan puanı
 * uydurmak yerine mevcut tutarsızlık yöneticiye bırakılır.
 */
export function ensureScoreGroupCoverage(
  criteria: Criterion[],
  groups: ScorePlan["groups"],
): Criterion[] {
  const completed = [...criteria];
  const usedIds = new Set(completed.map((criterion) => criterion.id));

  for (const group of groups) {
    if (!group.id || !Number.isFinite(group.maxScore) || group.maxScore <= 0) continue;
    const linked = completed.filter((criterion) => (
      criterion.active
      && criterion.groupId === group.id
      && criterionEffectOf(criterion) === "score"
      && criterion.maxScore !== null
      && criterion.maxScore > 0
    ));
    const linkedTotal = linked.reduce((sum, criterion) => sum + (criterion.maxScore ?? 0), 0);
    if (Math.abs(linkedTotal - group.maxScore) <= EPSILON || linkedTotal > EPSILON) continue;

    const baseId = `score-${group.id}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
    usedIds.add(id);

    completed.push({
      id,
      name: `${group.name} — bütüncül puanlama`,
      type: "qualitative_score",
      maxScore: group.maxScore,
      weight: null,
      required: false,
      violationOutcome: "Puan, resmî grup azamisi içinde hakem tarafından belirlenir.",
      evaluationMethod: "human",
      sourcePage: group.sourcePage,
      sourceText: group.sourceText,
      aiInterpretation: group.breakdown.length
        ? `Hakem bu grubu ${group.maxScore} puan üzerinden değerlendirir. Alt hesaplar: ${group.breakdown.join("; ")}`
        : `Hakem bu grubu belgede ilan edilen ${group.maxScore} puan üzerinden bütüncül olarak değerlendirir.`,
      confidence: "high",
      active: true,
      origin: "document",
      effect: "score",
      scope: group.scope,
      groupId: group.id,
    });
  }

  return completed;
}
