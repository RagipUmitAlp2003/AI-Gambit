import type { EvidenceRef, ReportEvaluation } from "./types";

/**
 * Rapor analizi istemci sarmalayıcısı.
 *
 * BÜTÜNLÜK (madde 3): istemci artık modele profil ya da PDF GÖNDERMEZ.
 * Sunucuya yalnızca `applicationId` gider; kriter seti (son yayımlanan sürüm)
 * ve rapor PDF'i (R2'deki geçerli sürüm) sunucuda çözülür. Böylece istemci
 * başka bir belge veya eski bir kriter seti göndererek sonucu yanlış
 * başvuruya yazdıramaz.
 *
 * `pages` alanı YARDIMCIDIR: sunucudaki deterministik dil tespiti ve başlık
 * yedeği için gönderilir. Sunucu, sayfa sayısı kendi ölçümüyle tutmuyorsa bu
 * metni tamamen yok sayar.
 *
 * İstek/cevap sözleşmesi: docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md
 */

/** Sunucunun bildirdiği hata; `retryable` "Yeniden dene" düğmesini açar. */
export class ReportEngineError extends Error {
  retryable: boolean;
  /** Motor bu ortamda hiç yapılandırılmamış (anahtar yok). */
  engineUnavailable: boolean;
  constructor(message: string, retryable = false, engineUnavailable = false) {
    super(message);
    this.name = "ReportEngineError";
    this.retryable = retryable;
    this.engineUnavailable = engineUnavailable;
  }
}

/** Sunucuya gönderilen sayfa metni üst sınırı; deterministik kontroller için yeterlidir. */
const MAX_PAGES_TEXT_CHARS = 1_500_000;

function evidenceNeedle(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i").replace(/\s+/g, " ").replace(/[^a-z0-9çğıöşü ]+/gi, "").trim();
}

/**
 * AI alıntısı gerçekten gösterdiği PDF sayfasında yoksa kanıt listesinden
 * düşer. Kural kararı (verdict) DEĞİŞMEZ; bulgunun bütün kanıtı düştüyse
 * evidenceMissing işaretlenir ve hakemin kaynağı kendisinin doğrulaması
 * gerektiği gerekçeye eklenir.
 *
 * PDF'den değerlendirilemeyen kurallarda zaten kanıt aranmaz; bu kontrol
 * onlara dokunmaz.
 */
function verifyEvidenceQuotes(evaluation: ReportEvaluation, pages: string[]): ReportEvaluation {
  let removed = 0;
  const validEvidence = (evidence: EvidenceRef[]) => evidence.filter((item) => {
    if (!item.page || !pages[item.page - 1]) { removed += 1; return false; }
    const needle = evidenceNeedle(item.text);
    const page = evidenceNeedle(pages[item.page - 1]);
    const valid = needle.length >= 12 && page.includes(needle);
    if (!valid) removed += 1;
    return valid;
  });
  const findings = evaluation.findings.map((finding) => {
    if (finding.verdict === "DEGERLENDIRILEMEDI") return finding;
    const evidence = validEvidence(finding.evidence);
    if (evidence.length === finding.evidence.length) return { ...finding, evidence };
    const lost = evidence.length === 0;
    return {
      ...finding,
      evidence,
      evidenceMissing: finding.evidenceMissing || lost,
      rationale: lost
        ? `${finding.rationale} AI alıntısı kaynak sayfada birebir doğrulanamadı; hakem kaynağı kendisi doğrulamalı.`
        : finding.rationale,
    };
  });
  const stages = evaluation.stages.map((stage) => ({ ...stage, evidence: validEvidence(stage.evidence) }));
  return {
    ...evaluation,
    findings,
    stages,
    analysisWarnings: removed
      ? [...evaluation.analysisWarnings, `${removed} AI alıntısı belirtilen PDF sayfasında birebir doğrulanamadı ve kanıt listesinden çıkarıldı.`]
      : evaluation.analysisWarnings,
  };
}

function pagesPayload(pages: string[]): string | null {
  const payload = JSON.stringify(pages);
  return payload.length <= MAX_PAGES_TEXT_CHARS ? payload : null;
}

export async function evaluateReport(input: {
  /** Değerlendirilecek başvuru. Kriter ve PDF sunucuda buradan çözülür. */
  applicationId: string;
  /** Kanıt doğrulaması için istemcide çıkarılmış sayfa metinleri. */
  pages: string[];
  pageCount: number;
  /** "Analizi yenile": kayıtlı sonuç atlanır, model yeniden çalışır. */
  force?: boolean;
}): Promise<ReportEvaluation> {
  const { applicationId, pages, pageCount, force } = input;

  const formData = new FormData();
  formData.append("applicationId", applicationId);
  formData.append("pageCount", String(pageCount));
  if (force) formData.append("force", "1");
  const pagesJson = pagesPayload(pages);
  if (pagesJson) formData.append("pages", pagesJson);

  let response: Response;
  try {
    response = await fetch("/api/evaluate-report", { method: "POST", body: formData, credentials: "same-origin" });
  } catch {
    throw new ReportEngineError(
      "Analiz motoruna ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.",
      true,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  // Gövde en fazla bir kez okunur; ikinci okuma her zaman başarısız olurdu.
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null) as (Partial<ReportEvaluation> & { error?: string; retryable?: boolean; engineUnavailable?: boolean }) | null
    : null;

  if (response.ok && payload && !payload.error && payload.version === "2.0"
    && Array.isArray(payload.findings) && Array.isArray(payload.stages)) {
    return verifyEvidenceQuotes(payload as ReportEvaluation, pages);
  }

  throw new ReportEngineError(
    payload?.error || `Analiz motoru beklenmedik bir cevap döndürdü (HTTP ${response.status}).`,
    payload?.retryable === true,
    payload?.engineUnavailable === true,
  );
}
