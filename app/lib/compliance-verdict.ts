import { criterionEliminates, criterionEffectOf } from "./evaluation-summary";
import type { CriterionFinding, PreCheck, ProfileExport, ReportEvaluation } from "./types";

/**
 * AI ön değerlendirmesinden başvurunun UYGUNLUK sonucunu türetir.
 *
 * Bu bir karar değil, gerekçeli bir öneridir: nihai kabul/ret her zaman
 * Hakemdedir (bkz. NIHAI_SISTEM_AKISI.md · "İkinci AI aşaması"). Burada yapılan
 * iş, yayımlanmış kriter profilindeki zorunlu koşulların raporda karşılanıp
 * karşılanmadığını tek yerde toplamak ve Hakemin ret gerekçesi olarak doğrudan
 * kullanabileceği bir metin üretmektir.
 *
 * Yalnızca profildeki kriterler kullanılır; yeni kural uydurulmaz.
 */

export type ComplianceVerdict = "compliant" | "not_compliant" | "needs_human";

export type ComplianceIssue = {
  /** Bulgunun kaynağı: ön kontrol satırı ya da kriter. */
  source: "precheck" | "criterion";
  /** Kriter kimliği; ön kontrolde kontrolün kimliği. */
  id: string;
  name: string;
  detail: string;
  sourcePage: number | null;
  /** Tek başına reddi gerektiren ihlal mi, yoksa insan kararı mı gerekiyor? */
  severity: "blocking" | "review";
};

export type ComplianceAssessment = {
  verdict: ComplianceVerdict;
  /** Reddi gerektiren ihlaller. */
  blocking: ComplianceIssue[];
  /** Hakem kararı bekleyen belirsiz maddeler. */
  review: ComplianceIssue[];
  /** Karşılanmış zorunlu kriter sayısı. */
  metRequired: number;
  /** Denetlenen zorunlu kriter sayısı. */
  totalRequired: number;
  /** Tek cümlelik özet. */
  summary: string;
  /** Hakemin ret gerekçesi alanına aktarabileceği hazır metin; uygunsa boş. */
  rejectionDraft: string;
};

const PRECHECK_LABELS: Record<PreCheck["kind"], string> = {
  file_gate: "Dosya kapısı",
  language: "Rapor dili",
  template: "Resmî şablon",
  headings: "Zorunlu başlıklar",
  category: "Kategori uygunluğu",
  similarity: "Benzerlik işareti",
};

/** Zorunlu kriter: şartnamede "required" işaretli, uygunluk kapısı ya da eleme sebebi olan madde. */
function isMandatory(criterion: ProfileExport["criteria"][number]): boolean {
  const effect = criterionEffectOf(criterion);
  return criterion.required || effect === "gate" || effect === "threshold" || criterionEliminates(criterion);
}

function findingIssue(
  finding: CriterionFinding,
  criterion: ProfileExport["criteria"][number] | undefined,
  severity: ComplianceIssue["severity"],
): ComplianceIssue {
  const page = finding.evidence.find((item) => item.page)?.page ?? criterion?.sourcePage ?? null;
  const expectation = criterion?.violationOutcome?.trim();
  return {
    source: "criterion",
    id: finding.criterionId,
    name: finding.criterionName || criterion?.name || finding.criterionId,
    detail: [finding.rationale?.trim(), expectation ? `Şartnamedeki sonuç: ${expectation}` : ""]
      .filter(Boolean).join(" ") || "Rapor bu kriteri karşılamıyor.",
    sourcePage: page,
    severity,
  };
}

export function assessCompliance(evaluation: ReportEvaluation, profile: ProfileExport | null): ComplianceAssessment {
  const criteriaById = new Map((profile?.criteria ?? []).map((item) => [item.id, item]));
  const blocking: ComplianceIssue[] = [];
  const review: ComplianceIssue[] = [];

  for (const check of evaluation.preChecks) {
    if (check.status === "failed") {
      blocking.push({
        source: "precheck",
        id: check.id,
        name: `${PRECHECK_LABELS[check.kind] ?? check.name}`,
        detail: check.detail || "Ön kontrol başarısız.",
        sourcePage: check.evidence.find((item) => item.page)?.page ?? null,
        severity: "blocking",
      });
    } else if (check.status === "flagged") {
      review.push({
        source: "precheck",
        id: check.id,
        name: `${PRECHECK_LABELS[check.kind] ?? check.name}`,
        detail: check.detail || "Ön kontrol hakem incelemesi istiyor.",
        sourcePage: check.evidence.find((item) => item.page)?.page ?? null,
        severity: "review",
      });
    }
  }

  let metRequired = 0;
  let totalRequired = 0;
  for (const finding of evaluation.findings) {
    const criterion = criteriaById.get(finding.criterionId);
    // Profilde bulunmayan bir kriter kimliği güvenilir değildir; sayıma katılmaz.
    const mandatory = criterion ? isMandatory(criterion) : false;
    if (mandatory) totalRequired += 1;
    if (finding.status === "met") { if (mandatory) metRequired += 1; continue; }
    if (finding.status === "needs_human" || finding.requiresHuman) {
      if (mandatory) review.push(findingIssue(finding, criterion, "review"));
      continue;
    }
    if (!mandatory) continue;
    if (finding.status === "not_met" || finding.status === "not_found") {
      blocking.push(findingIssue(finding, criterion, "blocking"));
    } else if (finding.status === "partially_met") {
      review.push(findingIssue(finding, criterion, "review"));
    }
  }

  const verdict: ComplianceVerdict = blocking.length ? "not_compliant" : review.length ? "needs_human" : "compliant";
  const summary = blocking.length
    ? `Başvuru ${blocking.length} zorunlu koşulu karşılamıyor; şartnameye uygun değil.`
    : review.length
      ? `Engelleyici ihlal bulunmadı ancak ${review.length} madde hakem kararı gerektiriyor.`
      : totalRequired
        ? `Yayımlanmış kriter profilindeki ${totalRequired} zorunlu koşulun tamamı karşılanıyor.`
        : "Profilde zorunlu koşul tanımlı değil; engelleyici ihlal bulunmadı.";

  return {
    verdict,
    blocking,
    review,
    metRequired,
    totalRequired,
    summary,
    rejectionDraft: blocking.length ? buildRejectionDraft(blocking) : "",
  };
}

/** Hakemin düzenleyebileceği, yarışmacıya gidecek ret gerekçesi taslağı. */
export function buildRejectionDraft(issues: ComplianceIssue[]): string {
  const lines = issues.slice(0, 8).map((issue, index) => {
    const page = issue.sourcePage ? ` (raporun ${issue.sourcePage}. sayfası)` : "";
    return `${index + 1}. ${issue.name}${page}: ${issue.detail}`;
  });
  const more = issues.length > lines.length ? `\n… ve ${issues.length - lines.length} ihlal daha.` : "";
  return `Başvurunuz, yarışma yöneticisinin yayımladığı şartname kriterlerini karşılamadığı için reddedilmiştir.\n\n${lines.join("\n")}${more}`
    .slice(0, 1_000);
}
