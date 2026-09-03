import type { AnalysisResult } from "./types";

/**
 * Şartname analizi istemci sarmalayıcısı.
 *
 * Yalnızca şartname PDF'si gönderilir; ayrı bir resmî rapor şablonu alanı
 * yoktur. Sunucu tek `generateContent` çağrısı yapar (bkz. api/analyze).
 */

/** Sunucunun bildirdiği analiz hatası; `retryable` "Yeniden dene" düğmesini açar. */
export class AnalysisRequestError extends Error {
  retryable: boolean;
  /** Sunucunun hata kodu (ör. OCR_REQUIRED / OCR_FAILED); yoksa tanımsız. */
  code?: string;
  /** Sunucu, yönetici onayıyla OCR yedeğinin denenebileceğini bildirdi. */
  ocrFallbackAvailable?: boolean;
  constructor(message: string, retryable = false, options: { code?: string; ocrFallbackAvailable?: boolean } = {}) {
    super(message);
    this.name = "AnalysisRequestError";
    this.retryable = retryable;
    this.code = options.code;
    this.ocrFallbackAvailable = options.ocrFallbackAvailable;
  }
}

/**
 * @param forceRefresh "Yeniden analiz et": kayıtlı sonuç atlanır, model
 * gerçekten yeniden çalışır ve eski kayıt yeni sonuçla değiştirilir.
 * @param useOcr Yöneticinin açık OCR onayı: sunucu, metin katmansız belge için
 * BİR ek görüntü okuma (OCR) çağrısı yapabilir. Kendiliğinden gönderilmez.
 */
export async function analyzeWithGemini(file: File, pageCount: number, forceRefresh = false, useOcr = false): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pageCount", String(pageCount));
  if (forceRefresh) formData.append("refresh", "1");
  if (useOcr) formData.append("ocr", "1");

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json() as AnalysisResult & { error?: string; retryable?: boolean; code?: string; ocrFallbackAvailable?: boolean }
    : { error: (await response.text()).trim() || `Sunucu ${response.status} hatası döndürdü.` };
  if (!response.ok || "error" in payload) {
    throw new AnalysisRequestError(
      ("error" in payload && payload.error) || "AI belge analizi tamamlanamadı.",
      "retryable" in payload && payload.retryable === true,
      {
        code: "code" in payload && typeof payload.code === "string" ? payload.code : undefined,
        ocrFallbackAvailable: "ocrFallbackAvailable" in payload && payload.ocrFallbackAvailable === true,
      },
    );
  }
  return payload;
}
