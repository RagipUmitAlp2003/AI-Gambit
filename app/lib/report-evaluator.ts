import { evaluateReportOffline } from "./demo-report-evaluator";
import {
  applySimilarity,
  buildFileGateChecks,
  buildHeadingsCheck,
  buildLanguageCheck,
  buildSimilarityCheck,
  buildTemplateCheck,
  type SimilarityPeer,
} from "./report-prechecks";
import type { EvidenceRef, PreCheck, ProfileExport, ReportEvaluation } from "./types";

/**
 * Rapor analizi istemci sarmalayıcısı. Önce sunucudaki AI analiz motorunu
 * (POST /api/evaluate-report) dener; motor henüz bağlı değilse (501) veya uç
 * nokta yoksa (404) çevrimdışı deterministik kontrollere düşer. Ağa hiç
 * ulaşılamadığında da çevrimdışı sonuç üretilir ve sonucun uyarı listesine bu
 * durum yazılır. Motorun bildirdiği diğer hatalar gizlenmez; çağırana iletilir.
 *
 * İstek/cevap sözleşmesi: docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md
 */

/** Sunucunun bildirdiği hata; çevrimdışı yedeğe düşülmez, kullanıcıya gösterilir. */
class ReportEngineError extends Error {}

/** Sunucuya gönderilen sayfa metni üst sınırı; deterministik kontroller için yeterlidir. */
const MAX_PAGES_TEXT_CHARS = 1_500_000;

function evidenceNeedle(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i").replace(/\s+/g, " ").replace(/[^a-z0-9çğıöşü ]+/gi, "").trim();
}

/**
 * AI alıntısı gerçekten gösterdiği PDF sayfasında yoksa kanıt listesinden
 * düşer. Kural kararı (verdict) DEĞİŞMEZ; bulgunun bütün kanıtı düştüyse
 * evidenceMissing işaretlenir ve hakemin kaynağı kendisinin doğrulaması gerektiği
 * gerekçeye eklenir.
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
  const preChecks = evaluation.preChecks.map((check) => (
    // Şablon kontrolünün kanıtı şartname metnidir; rapor sayfalarında aranmaz.
    check.kind === "template" ? check : { ...check, evidence: validEvidence(check.evidence) }
  ));
  return {
    ...evaluation,
    findings,
    stages,
    preChecks,
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
  profile: ProfileExport;
  file: File;
  pages: string[];
  pageCount: number;
  peers: SimilarityPeer[];
  gateChecks?: PreCheck[];
}): Promise<ReportEvaluation> {
  const { profile, file, pages, pageCount, peers, gateChecks } = input;
  let offlineReason = "";

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("profile", JSON.stringify(profile));
    formData.append("pageCount", String(pageCount));
    // Sayfa metni yalnızca sunucudaki deterministik kontroller (dil, başlık
    // yedeği) için gönderilir; modele PDF'nin kendisi gider.
    const pagesJson = pagesPayload(pages);
    if (pagesJson) formData.append("pages", pagesJson);

    const response = await fetch("/api/evaluate-report", { method: "POST", body: formData });
    const contentType = response.headers.get("content-type") || "";
    // Gövde en fazla bir kez okunur; ikinci okuma her zaman başarısız olurdu.
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null) as (Partial<ReportEvaluation> & { error?: string }) | null
      : null;

    if (response.ok && payload && !payload.error && payload.version === "2.0" && Array.isArray(payload.findings) && Array.isArray(payload.stages)) {
      const verified = verifyEvidenceQuotes(payload as ReportEvaluation, pages);
      // Dosya biçimi/boyutu/adedi istemcide gerçek dosya üzerinden ölçülür;
      // model bu kesin kontrollerin yerine geçmez. Aynı kimlikli sunucu satırı
      // varsa yerel ölçüm önceliklidir.
      const localChecks = [
        ...(gateChecks ?? buildFileGateChecks(file, profile.setup)),
        buildLanguageCheck(pages, profile.setup.reportLanguage),
        buildTemplateCheck(profile, pageCount),
        buildHeadingsCheck(profile, pages),
      ];
      const localIds = new Set(localChecks.map((check) => check.id));
      const merged: ReportEvaluation = {
        ...verified,
        preChecks: [
          ...localChecks,
          ...verified.preChecks.filter((check) => check.kind !== "file_gate" && !localIds.has(check.id)),
        ],
      };
      // Benzerlik havuzu sunucuda yoktur; istemci kendi sonucuyla 3. aşamayı tamamlar.
      return applySimilarity(merged, buildSimilarityCheck(pages.join(" "), peers));
    }

    if (response.status === 501 || response.status === 404 || response.status === 503) {
      offlineReason = response.status === 503
        ? "AI servis anahtarı bu ortamda kullanılamıyor; yalnızca deterministik kontroller çalıştırıldı."
        : "AI analiz motoru bu ortamda bağlı değil; yalnızca deterministik kontroller çalıştırıldı.";
    } else {
      throw new ReportEngineError(
        payload?.error || `Analiz motoru beklenmedik bir cevap döndürdü (HTTP ${response.status}).`,
      );
    }
  } catch (error) {
    if (error instanceof ReportEngineError) throw error;
    // Yalnızca ağ/istek hatası buraya düşer; kullanıcı sonucu uyarı listesinden görür.
    offlineReason = "Analiz motoruna ulaşılamadı; yalnızca deterministik kontroller çalıştırıldı.";
  }

  const evaluation = evaluateReportOffline({ profile, file, pages, pageCount, peers, gateChecks });
  if (offlineReason) evaluation.analysisWarnings = [offlineReason, ...evaluation.analysisWarnings];
  return evaluation;
}
