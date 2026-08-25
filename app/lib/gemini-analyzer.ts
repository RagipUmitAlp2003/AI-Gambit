import type { AnalysisResult } from "./types";

export async function analyzeWithGemini(
  file: File,
  pageCount: number,
  templateFile?: File | null,
  templatePageCount?: number,
): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pageCount", String(pageCount));
  if (templateFile) {
    formData.append("templateFile", templateFile);
    formData.append("templatePageCount", String(templatePageCount || 1));
  }

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json() as AnalysisResult & { error?: string }
    : { error: (await response.text()).trim() || `Sunucu ${response.status} hatası döndürdü.` };
  if (!response.ok || "error" in payload) {
    throw new Error(("error" in payload && payload.error) || "AI belge analizi tamamlanamadı.");
  }
  return payload;
}
