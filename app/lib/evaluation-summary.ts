import type { Criterion, CriterionEffect, ScorePlan } from "./types";

export function criterionEffectOf(item: Criterion): CriterionEffect {
  if (item.effect) return item.effect;
  if (item.type === "qualitative_score") return "score";
  if (item.type === "formula") return "threshold";
  if (["technical_upload", "format_rule", "mandatory_content", "elimination_review"].includes(item.type)) return "gate";
  return "advisory";
}

/**
 * Normalizasyon sonucu. `value` her zaman 0–100 aralığındadır; aralık dışına
 * çıkan bir girdi sessizce kırpılmaz, `anomaly` ile işaretlenir.
 */
export type NormalizedScore = {
  /** Kullanıcıya gösterilecek 0–100 arası puan. */
  value: number;
  /** Ham puan. */
  rawScore: number;
  /** Maksimum ham puan (payda). */
  maxRawScore: number;
  /** Girdi geçerli aralığın dışındaysa dolu olur; boşsa sonuç güvenilirdir. */
  anomaly: string | null;
};

/**
 * (ham puan / maksimum ham puan) × 100.
 *
 * Kırpma bir çözüm değil, son emniyet kemeridir: aralık dışı her girdi
 * `anomaly` ile bildirilir ki kaynaktaki hata gizlenmesin. Payda ile payın
 * aynı kriter kümesinden gelmesi çağıranın sorumluluğundadır; profil onayında
 * `evaluationTotal` bu nedenle kriterlerden hesaplanır.
 */
export function normalizeScoreDetailed(rawScore: number, maxRawScore: number): NormalizedScore {
  if (!Number.isFinite(maxRawScore) || maxRawScore <= 0) {
    return {
      value: 0,
      rawScore: Number.isFinite(rawScore) ? rawScore : 0,
      maxRawScore: Number.isFinite(maxRawScore) ? maxRawScore : 0,
      anomaly: "Maksimum ham puan tanımlı değil veya sıfır; normalizasyon yapılamaz.",
    };
  }
  if (!Number.isFinite(rawScore)) {
    return { value: 0, rawScore: 0, maxRawScore, anomaly: "Ham puan sayısal değil; normalizasyon yapılamaz." };
  }
  if (rawScore < 0) {
    return {
      value: 0,
      rawScore,
      maxRawScore,
      anomaly: `Ham puan negatif (${rawScore}). Ceza uygulaması toplamı sıfırın altına indiremez; kural denetimini inceleyin.`,
    };
  }
  if (rawScore > maxRawScore) {
    return {
      value: 100,
      rawScore,
      maxRawScore,
      anomaly: `Ham puan (${rawScore}) maksimum ham puanı (${maxRawScore}) aşıyor. Bu bir veri hatasıdır: puan kriterleri ile normalizasyon paydası aynı kümeden gelmiyor olabilir.`,
    };
  }
  return { value: Math.round((rawScore / maxRawScore) * 1000) / 10, rawScore, maxRawScore, anomaly: null };
}

/** Yalnızca sayısal sonucu döndüren kısayol; ayrıntı için normalizeScoreDetailed. */
export function normalizeScore(score: number, maxRawScore: number): number {
  return normalizeScoreDetailed(score, maxRawScore).value;
}

/**
 * Kapsamdaki puan kriterlerinin azami puan toplamı: normalizasyonun paydası.
 * Yalnızca aktif ve etkisi "score" olan kriterler sayılır; pay da aynı kümeden
 * geldiği için ham puan bu değeri yapısal olarak aşamaz.
 */
export function maxRawScoreOf(criteria: Criterion[]): number {
  return criteria
    .filter((item) => item.active && criterionEffectOf(item) === "score")
    .reduce((sum, item) => sum + (item.maxScore ?? 0), 0);
}

/**
 * Kapsam daraltmasını kriterlere uygular: kapsam dışı bir puan grubuna BAĞLI
 * kriterler pasifleştirilir. Eşleştirme yalnızca `groupId` ile yapılır; grup
 * kimliği olmayan (eski analiz) veya hiçbir gruba bağlı olmayan kriterler
 * kapsamda kalır — sessizce puan düşürmemek için varsayılan dahil etmektir.
 */
export function scopeCriteriaToGroups(
  criteria: Criterion[],
  groups: ScorePlan["groups"],
  includedGroupIds: Set<string | undefined>,
): Criterion[] {
  // Hiç kimlikli grup yoksa (eski analiz) kapsam daraltması uygulanamaz.
  if (!groups.some((group) => group.id)) return criteria;
  return criteria.map((item) => (
    item.groupId && !includedGroupIds.has(item.groupId)
      ? { ...item, active: false }
      : item
  ));
}

/**
 * Ceza puanları toplamdan düşülür ama sonuç sıfırın altına inmez; ayrıca
 * uygulanan ceza miktarı ayrı tutulur ki görevli neyin düşüldüğünü görebilsin.
 */
export function applyPenalties(rawScore: number, penaltyPoints: number): { finalRaw: number; appliedPenalty: number } {
  const penalty = Math.max(0, Number.isFinite(penaltyPoints) ? penaltyPoints : 0);
  const applied = Math.min(penalty, Math.max(0, rawScore));
  return { finalRaw: Math.max(0, rawScore - applied), appliedPenalty: applied };
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
