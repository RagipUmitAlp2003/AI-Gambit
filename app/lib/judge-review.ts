import {
  AI_CRITERION_VERDICT_LABELS,
  aiVerdictOf,
  JUDGE_EVIDENCE_MODES,
  type AiCriterionVerdict,
  type CriterionFinding,
  type JudgeCriterionDecision,
  type ParticipantFeedback,
  type ReportEvaluation,
} from "./types";

/**
 * Hakemin AI bulgusu doğrulama akışının ortak kuralları.
 *
 * Bu modül saf ve ortamdan bağımsızdır: hem hakem ekranı hem sunucu uçları
 * hem de birim testleri aynı kuralları buradan okur.
 *
 *   - Onayla/Ret, KATILIMCININ kriter sonucunu değil AI BULGUSUNUN kabulünü
 *     ifade eder.
 *   - Onayla → kesin sonuç AI sonucudur (UYGUN da OLUMSUZ da olabilir);
 *     AI'nin kaynağı/gerekçesi korunur, ek açıklama zorunlu değildir.
 *   - Ret → AI bulgusu kesin sonuç olarak KULLANILAMAZ; hakem aynı kriter için
 *     kendi sonucunu (UYGUN/OLUMSUZ), kaynağını (sayfa+bölüm+alıntı ya da
 *     "Raporda bulunamadı" + aranan bölüm) ve gerekçesini girmek zorundadır.
 *   - Kesin sonuç = onaylandıysa aiVerdict, reddedildiyse judgeResult.
 *   - Sayaçlar ve katılımcı geri bildirimi yalnızca KESİNLEŞMİŞ sonuçlardan
 *     üretilir; hakem kararı başlangıçta daima KARAR BEKLİYOR'dur.
 */

/**
 * Hakem ekranında GÖRÜNÜR bulgular: yalnızca PDF'den değerlendirilebilenler.
 * Eski kayıtlardaki DEGERLENDIRILEMEDI bulguları geriye uyum için okunur ama
 * karar listesine ve sayaçlara girmez.
 */
export function visibleFindingsOf(evaluation: Pick<ReportEvaluation, "findings">): CriterionFinding[] {
  return (evaluation.findings ?? []).filter((finding) => finding.verdict !== "DEGERLENDIRILEMEDI");
}

/**
 * Kriterin KESİNLEŞMİŞ sonucu:
 *   approved → AI sonucu · rejected → hakemin yazdığı sonuç · pending → null.
 */
export function effectiveVerdictOf(decision: JudgeCriterionDecision): AiCriterionVerdict | null {
  if (decision.judgeVerdict === "approved") return decision.aiVerdict;
  if (decision.judgeVerdict === "rejected") return decision.judgeResult;
  return null;
}

/** Her görünür kriter için "KARAR BEKLİYOR" durumunda boş karar üretir. */
export function emptyCriterionDecisions(findings: CriterionFinding[]): JudgeCriterionDecision[] {
  return findings.map((finding) => ({
    criterionId: finding.criterionId,
    criterionName: finding.criterionName,
    aiVerdict: aiVerdictOf(finding.verdict),
    judgeVerdict: "pending",
    judgeResult: null,
    rejectionReason: "",
    evidenceMode: null,
    evidencePage: null,
    evidenceSection: "",
    evidenceQuote: "",
    missingContent: "",
    decidedBy: null,
    decidedAt: null,
  }));
}

/**
 * Saklı incelemeden kararları geri yükler; bulgu listesiyle eşleşmeyen veya
 * bozuk kayıtlar "KARAR BEKLİYOR" durumuna döner. AI sonucu her zaman güncel
 * bulgudan yeniden türetilir; saklı kayıt AI sonucunu değiştiremez.
 */
export function restoreCriterionDecisions(
  findings: CriterionFinding[],
  stored: JudgeCriterionDecision[] | undefined | null,
): JudgeCriterionDecision[] {
  const byId = new Map((stored ?? []).map((decision) => [decision.criterionId, decision]));
  return emptyCriterionDecisions(findings).map((base) => {
    const previous = byId.get(base.criterionId);
    if (!previous) return base;
    return {
      ...base,
      judgeVerdict: previous.judgeVerdict === "approved" || previous.judgeVerdict === "rejected"
        ? previous.judgeVerdict
        : "pending",
      judgeResult: previous.judgeResult === "UYGUN" || previous.judgeResult === "OLUMSUZ"
        ? previous.judgeResult
        : null,
      rejectionReason: typeof previous.rejectionReason === "string" ? previous.rejectionReason : "",
      evidenceMode: previous.evidenceMode === "PDF_KONUMU" || previous.evidenceMode === "RAPORDA_BULUNAMADI"
        ? previous.evidenceMode
        : null,
      evidencePage: typeof previous.evidencePage === "number" && Number.isInteger(previous.evidencePage) && previous.evidencePage >= 1
        ? previous.evidencePage
        : null,
      evidenceSection: typeof previous.evidenceSection === "string" ? previous.evidenceSection : "",
      evidenceQuote: typeof previous.evidenceQuote === "string" ? previous.evidenceQuote : "",
      missingContent: typeof previous.missingContent === "string" ? previous.missingContent : "",
      decidedBy: typeof previous.decidedBy === "string" ? previous.decidedBy : null,
      decidedAt: typeof previous.decidedAt === "string" ? previous.decidedAt : null,
    };
  });
}

/**
 * Sayaçlar: uygun/olumsuz yalnızca KESİNLEŞMİŞ sonuçları sayar (madde:
 * "katılımcı geri bildirimi ve kriter sayaçları yalnızca kesinleşmiş
 * sonuçlardan oluşturulmalıdır"). Bulgu kabul/ret sayaçları denetim içindir.
 */
export type JudgeDecisionCounts = {
  /** Kesinleşmiş sonucu UYGUN olan kriterler. */
  uygun: number;
  /** Kesinleşmiş sonucu OLUMSUZ olan kriterler. */
  olumsuz: number;
  /** Henüz kesinleşmemiş (KARAR BEKLİYOR) kriterler. */
  pending: number;
  total: number;
  /** Denetim: hakemce kabul edilen AI bulguları. */
  findingsApproved: number;
  /** Denetim: hakemce reddedilen AI bulguları. */
  findingsRejected: number;
};

export function judgeDecisionCounts(decisions: JudgeCriterionDecision[]): JudgeDecisionCounts {
  let uygun = 0; let olumsuz = 0; let pending = 0; let findingsApproved = 0; let findingsRejected = 0;
  for (const decision of decisions) {
    const effective = effectiveVerdictOf(decision);
    if (effective === "UYGUN") uygun += 1;
    else if (effective === "OLUMSUZ") olumsuz += 1;
    else pending += 1;
    if (decision.judgeVerdict === "approved") findingsApproved += 1;
    if (decision.judgeVerdict === "rejected") findingsRejected += 1;
  }
  return { uygun, olumsuz, pending, total: decisions.length, findingsApproved, findingsRejected };
}

/** Tek kararın kural denetimi; hata yoksa boş dizge döner. */
export function criterionDecisionError(decision: JudgeCriterionDecision): string {
  const name = decision.criterionName || decision.criterionId;
  if (decision.judgeVerdict === "pending") return "";
  // Onay: AI bulgusu kabul edildi; ek açıklama zorunlu değildir.
  if (decision.judgeVerdict === "approved") return "";
  /*
   * AI bulgusu REDDEDİLDİ: bulgu kesin sonuç olarak kullanılamaz. Hakem aynı
   * kriter için KENDİ değerlendirmesini girmek zorundadır.
   */
  if (decision.judgeResult !== "UYGUN" && decision.judgeResult !== "OLUMSUZ") {
    return `“${name}”: AI bulgusu reddedildi; hakemin kendi sonucu (UYGUN veya OLUMSUZ) zorunludur.`;
  }
  if (!decision.rejectionReason.trim()) return `“${name}”: hakem gerekçesi zorunludur.`;
  if (!decision.evidenceMode || !JUDGE_EVIDENCE_MODES.includes(decision.evidenceMode)) {
    return `“${name}”: hakem değerlendirmesi için dayanak türü seçilmelidir (PDF konumu veya raporda bulunamadı).`;
  }
  if (decision.evidenceMode === "PDF_KONUMU") {
    if (!decision.evidencePage || !Number.isInteger(decision.evidencePage) || decision.evidencePage < 1) {
      return `“${name}”: PDF konumlu değerlendirme için katılımcı PDF'indeki sayfa numarası zorunludur.`;
    }
    if (!decision.evidenceQuote.trim()) {
      return `“${name}”: PDF konumlu değerlendirme için doğrudan alıntı zorunludur.`;
    }
  }
  if (decision.evidenceMode === "RAPORDA_BULUNAMADI" && !decision.missingContent.trim()) {
    return `“${name}”: raporda bulunamadı kararı için aranan bölüm/başlık adı zorunludur.`;
  }
  return "";
}

/**
 * Karar listesinin bütününü, saklı AI analizine göre doğrular.
 *
 *   - Her karar, analizde GÖRÜNÜR (PDF) bir kritere ait olmalıdır; hakem başka
 *     kriter hakkında değerlendirme yazamaz (sunucu criterionId ile bağlar).
 *   - `requireComplete` true iken bütün görünür kriterler kesinleşmiş olmalıdır.
 *   - Bulgu retleri zorunlu hakem değerlendirmesi alanlarını taşımalıdır.
 *
 * Hata yoksa boş dizge döner; ilk hata anlaşılır bir Türkçe cümledir.
 */
export function validateCriterionDecisions(
  findings: CriterionFinding[],
  decisions: JudgeCriterionDecision[],
  requireComplete: boolean,
): string {
  const known = new Map(findings.map((finding) => [finding.criterionId, finding]));
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (!known.has(decision.criterionId)) {
      return `Karar, bu başvurunun güncel AI analizinde bulunmayan bir kritere ait: ${decision.criterionId}. `
        + "Kriterler güncellenmiş olabilir; analizi yenileyip yeniden karar verin.";
    }
    if (seen.has(decision.criterionId)) {
      return `Aynı kriter için birden fazla karar gönderildi: ${decision.criterionName || decision.criterionId}.`;
    }
    seen.add(decision.criterionId);
    const error = criterionDecisionError(decision);
    if (error) return error;
  }
  if (requireComplete) {
    const undecided = findings.filter((finding) => {
      const decision = decisions.find((item) => item.criterionId === finding.criterionId);
      return !decision || effectiveVerdictOf(decision) === null;
    });
    if (undecided.length) {
      return `Genel karar için önce bütün kriterler kesinleştirilmeli: ${undecided.length} kriter hâlâ karar bekliyor `
        + `(${undecided.slice(0, 3).map((finding) => finding.criterionName).join(", ")}`
        + `${undecided.length > 3 ? ` ve ${undecided.length - 3} kriter daha` : ""}).`;
    }
  }
  return "";
}

/** Kesin sonucu OLUMSUZ olan kriterin yarışmacıya giden tek satırlık açıklaması. */
export function negativeLineOf(finding: CriterionFinding | undefined, decision: JudgeCriterionDecision): string {
  if (decision.judgeVerdict === "rejected") {
    // Hakemin kendi değerlendirmesi esastır.
    const parts = [`${decision.criterionName} — ${decision.rejectionReason.trim()}`];
    if (decision.evidenceMode === "PDF_KONUMU") {
      if (decision.evidencePage) parts.push(`(rapor s. ${decision.evidencePage}${decision.evidenceSection.trim() ? ` · ${decision.evidenceSection.trim()}` : ""})`);
      if (decision.evidenceQuote.trim()) parts.push(`“${decision.evidenceQuote.trim()}”`);
    } else if (decision.evidenceMode === "RAPORDA_BULUNAMADI") {
      parts.push(`(Raporda bulunamadı: ${decision.missingContent.trim()})`);
    }
    return parts.join(" ");
  }
  // AI bulgusu onaylandı: AI'nin gerekçesi ve kaynağı korunur.
  const evidence = finding?.evidence[0];
  const parts = [`${decision.criterionName} — ${finding?.rationale?.trim() || "Hakem tarafından olumsuz kesinleştirildi."}`];
  if (evidence?.page) parts.push(`(rapor s. ${evidence.page}${evidence.section ? ` · ${evidence.section}` : ""})`);
  if (evidence?.text) parts.push(`“${evidence.text}”`);
  return parts.join(" ");
}

/**
 * Yarışmacı geri bildirimi yalnızca KESİNLEŞMİŞ kriter sonuçlarından üretilir:
 *   Güçlü Yönler         → kesin sonucu UYGUN olan kriterler
 *   Gelişime Açık Yönler → kesin sonucu OLUMSUZ olan kriterler ve gerekçeleri
 *                          (bulgu onaylandıysa AI'nin, reddedildiyse hakemin
 *                          gerekçesi/alıntısı)
 * "Gelişim Önerileri" üretilmez; alan geriye uyum için boş kalır.
 */
export function buildJudgeFeedback(
  findings: CriterionFinding[],
  decisions: JudgeCriterionDecision[],
): ParticipantFeedback {
  const findingById = new Map(findings.map((finding) => [finding.criterionId, finding]));
  return {
    strengths: decisions
      .filter((decision) => effectiveVerdictOf(decision) === "UYGUN")
      .map((decision) => `✓ ${decision.criterionName}`),
    improvements: decisions
      .filter((decision) => effectiveVerdictOf(decision) === "OLUMSUZ")
      .map((decision) => `✕ ${negativeLineOf(findingById.get(decision.criterionId), decision)}`),
    suggestions: [],
  };
}

/**
 * Nihai RET açıklamasının deterministik şablonu: kesin sonucu olumsuz olan
 * kriterler ve gerekçelerinden üretilir; ikinci bir üretken AI çağrısı YAPILMAZ.
 * Sistem nihai kararı ÖNERMEZ; bu metin yalnızca hakem RET'i seçtikten sonra
 * yarışmacıya giden açıklamanın başlangıç taslağıdır.
 */
export function defaultOutcomeNote(
  outcome: "accepted" | "rejected",
  findings: CriterionFinding[],
  decisions: JudgeCriterionDecision[],
): string {
  const counts = judgeDecisionCounts(decisions);
  if (outcome === "accepted") {
    return `Rapor incelendi ve onaylandı. ${counts.uygun} kriter uygun bulundu`
      + `${counts.olumsuz ? `, ${counts.olumsuz} kriter olumsuz kesinleşti` : ""}.`;
  }
  const findingById = new Map(findings.map((finding) => [finding.criterionId, finding]));
  const negatives = decisions.filter((decision) => effectiveVerdictOf(decision) === "OLUMSUZ");
  const lines = negatives.slice(0, 6).map((decision, index) =>
    `${index + 1}) ${negativeLineOf(findingById.get(decision.criterionId), decision)}`);
  return `Rapor reddedildi. ${counts.total} kriterin ${counts.olumsuz} tanesi olumsuz kesinleşti. `
    + `Olumsuz kriterler: ${lines.join(" ")}${negatives.length > 6 ? ` … ve ${negatives.length - 6} kriter daha.` : ""}`;
}

/** Denetim satırı: AI bulgusu reddedilen kriterin kısa özeti. */
export function findingRejectionAuditLine(decision: JudgeCriterionDecision): string {
  const judgeLabel = decision.judgeResult ? AI_CRITERION_VERDICT_LABELS[decision.judgeResult] : "—";
  return `${decision.criterionName} · AI bulgusu (${AI_CRITERION_VERDICT_LABELS[decision.aiVerdict]}) reddedildi`
    + ` → Hakem sonucu: ${judgeLabel}`
    + (decision.rejectionReason.trim() ? ` · Gerekçe: ${decision.rejectionReason.trim().slice(0, 300)}` : "");
}
