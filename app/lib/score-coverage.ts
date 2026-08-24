import type { Criterion, ScorePlan } from "./types";

const EPSILON = 0.01;

/**
 * Model bazen resmî puan gruplarını doğru çıkarırken, tekrarlı saha görevlerini
 * tek tek `Criterion` kayıtlarına dönüştürmez. Bu durumda profilin resmî puan
 * ölçeği kaybolmasın diye eksik kalan puan alanı için hakem kontrollü bir
 * tamamlama kriteri oluşturulur. Bu puan uydurmak değildir: azami değer,
 * PDF'deki grup toplamı ile açık alt kalemlerin matematiksel farkıdır.
 *
 * Model aynı puan satırlarını birden fazla kez çıkardıysa ayrıntılar bilgi
 * olarak korunur ve grup, resmî azamisi üzerinden tek bütüncül hakem kriterine
 * dönüştürülür. Böylece çift sayım sessizce toplamı bozmaz.
 */
export function ensureScoreGroupCoverage(
  criteria: Criterion[],
  groups: ScorePlan["groups"],
): Criterion[] {
  const completed = [...criteria];
  const usedIds = new Set(completed.map((criterion) => criterion.id));

  const effectOf = (criterion: Criterion) => (
    criterion.effect
    ?? (criterion.type === "qualitative_score"
      ? "score"
      : criterion.type === "formula"
        ? "threshold"
        : ["technical_upload", "format_rule", "mandatory_content", "elimination_review"].includes(criterion.type)
          ? "gate"
          : "advisory")
  );

  function nextId(baseId: string) {
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
    usedIds.add(id);
    return id;
  }

  function coverageCriterion(group: ScorePlan["groups"][number], maxScore: number, partial: boolean): Criterion {
    return {
      id: nextId(`score-${group.id}`),
      name: partial ? `${group.name} — kalan bütüncül değerlendirme` : `${group.name} — bütüncül puanlama`,
      type: "qualitative_score",
      maxScore,
      weight: null,
      required: false,
      violationOutcome: "Puan, PDF'deki resmî grup azamisi içinde hakem tarafından belirlenir.",
      evaluationMethod: "human",
      sourcePage: group.sourcePage,
      sourceText: group.sourceText,
      aiInterpretation: partial
        ? `Açık alt kalemler dışında kalan ${maxScore} puan, grup açıklaması ve PDF'deki alt hesaplar birlikte değerlendirilerek hakem tarafından verilir.`
        : group.breakdown.length
          ? `Hakem bu grubu ${group.maxScore} puan üzerinden değerlendirir. Alt hesaplar: ${group.breakdown.join("; ")}`
          : `Hakem bu grubu PDF'de ilan edilen ${group.maxScore} puan üzerinden bütüncül olarak değerlendirir.`,
      confidence: "high",
      active: true,
      origin: "document",
      effect: "score",
      scope: group.scope,
      groupId: group.id ?? null,
    };
  }

  for (const group of groups) {
    if (!group.id || !Number.isFinite(group.maxScore) || group.maxScore <= 0) continue;
    const linked = completed.filter((criterion) => (
      criterion.active
      && criterion.groupId === group.id
      && effectOf(criterion) === "score"
      && criterion.maxScore !== null
      && criterion.maxScore > 0
    ));
    const linkedTotal = linked.reduce((sum, criterion) => sum + (criterion.maxScore ?? 0), 0);
    if (Math.abs(linkedTotal - group.maxScore) <= EPSILON) continue;

    if (linkedTotal < group.maxScore) {
      completed.push(coverageCriterion(group, group.maxScore - linkedTotal, linkedTotal > EPSILON));
      continue;
    }

    // Aynı resmî puanın birden fazla çıkarımla tekrar sayılması engellenir.
    for (const item of linked) {
      const index = completed.findIndex((criterion) => criterion.id === item.id);
      if (index < 0) continue;
      completed[index] = {
        ...completed[index],
        maxScore: null,
        weight: null,
        effect: "advisory",
        aiInterpretation: `${completed[index].aiInterpretation} Bu satır grup azamisini tekrar saymamak için açıklayıcı alt kalem olarak tutulur.`,
      };
    }
    completed.push(coverageCriterion(group, group.maxScore, false));
  }

  return completed;
}
