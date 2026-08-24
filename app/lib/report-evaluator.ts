import { evaluateReportOffline } from "./demo-report-evaluator";
import {
  buildFileGateChecks,
  buildHeadingsCheck,
  buildLanguageCheck,
  buildSimilarityCheck,
  buildTemplateCheck,
  type SimilarityPeer,
} from "./report-prechecks";
import type { PreCheck, ProfileExport, ReportEvaluation } from "./types";

/**
 * Rapor analizi istemci sarmalayıcısı. Önce sunucudaki AI analiz motorunu
 * (POST /api/evaluate-report) dener; motor henüz bağlı değilse (501) veya uç
 * nokta yoksa (404) çevrimdışı kesin kontrollere düşer. Ağa hiç ulaşılamadığında
 * da çevrimdışı sonuç üretilir ve sonucun uyarı listesine bu durum yazılır.
 * Motorun bildirdiği diğer hatalar gizlenmez; çağırana iletilir.
 *
 * İstek/cevap sözleşmesi: docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md
 */

/** Sunucunun bildirdiği hata; çevrimdışı yedeğe düşülmez, kullanıcıya gösterilir. */
class ReportEngineError extends Error {}

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

    const response = await fetch("/api/evaluate-report", { method: "POST", body: formData });
    const contentType = response.headers.get("content-type") || "";
    // Gövde en fazla bir kez okunur; ikinci okuma her zaman başarısız olurdu.
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null) as (Partial<ReportEvaluation> & { error?: string }) | null
      : null;

    if (response.ok && payload && !payload.error && Array.isArray(payload.findings)) {
      const evaluation = payload as ReportEvaluation;
      // Dosya biçimi/boyutu/adedi istemcide gerçek dosya üzerinden ölçülür;
      // model bu kesin kontrollerin yerine geçmez. Aynı kimlikli sunucu satırı
      // varsa yerel ölçüm önceliklidir.
      const localChecks = [
        ...(gateChecks ?? buildFileGateChecks(file, profile.setup)),
        buildLanguageCheck(pages),
        buildTemplateCheck(profile, pageCount),
        buildHeadingsCheck(profile, pages),
      ];
      const localIds = new Set(localChecks.map((check) => check.id));
      evaluation.preChecks = [
        ...localChecks,
        ...(Array.isArray(evaluation.preChecks) ? evaluation.preChecks : [])
          .filter((check) => check.kind !== "file_gate" && !localIds.has(check.id)),
      ];
      // Benzerlik havuzu sunucuda yoktur; istemci kendi sonucuyla tamamlar.
      const similarity = buildSimilarityCheck(pages.join(" "), peers);
      const checks = evaluation.preChecks;
      const similarityIndex = checks.findIndex((check) => check.kind === "similarity");
      if (similarityIndex >= 0) checks[similarityIndex] = similarity;
      else checks.push(similarity);
      evaluation.preChecks = checks;
      return evaluation;
    }

    if (response.status === 501 || response.status === 404 || response.status === 503) {
      offlineReason = response.status === 503
        ? "AI servis anahtarı bu ortamda kullanılamıyor; yalnızca kesin kontroller çalıştırıldı."
        : "AI analiz motoru bu ortamda bağlı değil; yalnızca kesin kontroller çalıştırıldı.";
    } else {
      throw new ReportEngineError(
        payload?.error || `Analiz motoru beklenmedik bir cevap döndürdü (HTTP ${response.status}).`,
      );
    }
  } catch (error) {
    if (error instanceof ReportEngineError) throw error;
    // Yalnızca ağ/istek hatası buraya düşer; kullanıcı sonucu uyarı listesinden görür.
    offlineReason = "Analiz motoruna ulaşılamadı; yalnızca kesin kontroller çalıştırıldı.";
  }

  const evaluation = evaluateReportOffline({ profile, file, pages, pageCount, peers, gateChecks });
  if (offlineReason) evaluation.analysisWarnings = [offlineReason, ...evaluation.analysisWarnings];
  return evaluation;
}
