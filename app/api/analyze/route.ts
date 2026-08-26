import { Buffer } from "node:buffer";
import { requirePermission } from "../../lib/admin-guard";
import { acquireAnalysisPermit, requestBodyTooLarge } from "../../lib/request-guard";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  buildExtractionPrompt,
  normalizeExtraction,
  type RawExtraction,
} from "../../lib/criteria-extraction";
import { MEDIA_RESOLUTION, describeGeminiFailure, mediaResolutionPart, runSingleGeneration } from "../../lib/gemini-generation";
import { recordUsage } from "../../lib/usage-metrics";
import { pdfIntegrityError } from "../../lib/pdf-integrity";
import { sourcePageLimit } from "../../lib/pdf-page-count";
import { saveCriteriaExtractionRun } from "../../lib/workflow-db";
import type { AnalysisDiagnostics, AnalysisResult } from "../../lib/types";

/**
 * Şartname analizi ucu — dört aşamalı prensip, TEK LLM çağrısı.
 *
 * Yarışma Yöneticisi YALNIZCA şartname PDF'sini yükler; ayrı bir resmî rapor
 * şablonu alanı yoktur. PDF'nin tamamı bir kez modele verilir; model dört
 * aşamaya ayrılmış kriterleri (dil/şablon, başlık/içerik, kategori, teknik
 * kural) kaynak sayfası ve birebir alıntıyla döndürür.
 *
 * TEK ÇAĞRI: bir "Belgeyi analiz et" işlemi için modele tam olarak bir
 * `generateContent` isteği gider. Yedek model kademesi, model taraması ve gizli
 * yeniden deneme döngüsü kaldırıldı; 429/503/zaman aşımında uç açık bir hata ve
 * `retryable: true` döndürür, kullanıcı "Yeniden dene" ile kendisi karar verir.
 * Tanılamadaki `apiCalls` gerçekten yapılan istek sayısıdır.
 *
 * Model çıktısı sunucuda doğrulanır (sayfa sınırı, tekrar, boş alan); karar
 * yöneticide kalır. Puan planı, güven seviyesi ve pasif kriter üretilmez.
 */

/** Analizde kullanılan TEK model. Yedek kademe yoktur. */
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

const CACHE_LIMIT = 12;
const MAX_PDF_BYTES = 18 * 1024 * 1024;
// Küçük PDF'ler satır içi gönderilir; büyük belgeler bir kez Files API'ye
// yüklenip URI ile verilir ki gövde gereksiz büyümesin.
const INLINE_PDF_FAST_PATH_BYTES = 512 * 1024;
// Multipart sınırına dosya dışında başlıklar için küçük pay eklenir.
const MAX_MULTIPART_BYTES = MAX_PDF_BYTES + 768 * 1024;
// Tek çağrı bütün belgeyi kapsadığı için uzun belgelerde geniş zaman tanınır.
const GENERATION_TIMEOUT_MS = 150_000;

/**
 * Çıktı token tavanı. Eskiden 65536'ydı; şema sıkılaştıktan sonra (şablon ve
 * kapsam-dışı listesi çıkarıldı, açıklamalar tek cümleye indi) en yoğun
 * şartname bile bunun çok altında kalıyor. Düşük tavan modelin uzun, dolambaçlı
 * metin üretmesini de caydırır ve yanıt süresini kısaltır.
 */
const MAX_OUTPUT_TOKENS = 24_576;

/**
 * Modelin "düşünme" bütçesi — analiz süresinin en büyük belirleyicisi.
 *
 * Çelikkubbe şartnamesi (25 sayfa · 1,75 MB) üzerinde ölçüm:
 *   LOW    47,6 sn · 13 kriter · 13/13 kaynak sayfa dolu
 *   MEDIUM 73,6 sn · 16 kriter · 16/16 kaynak sayfa dolu
 *
 * Orta boy şartnamelerde LOW, hedeflenen 13 maddelik derinliği kaynak
 * sayfalarıyla birlikte yakalıyor ve süreyi üçte bir kısaltıyor. Uzun
 * belgelerde model bağlamı bir arada tutmak için bütçeye ihtiyaç duyduğundan
 * kademe yükselir. `GEMINI_THINKING_LEVEL` ile elle sabitlenebilir.
 */
const THINKING_OVERRIDE = (process.env.GEMINI_THINKING_LEVEL || "").toUpperCase();
function thinkingLevelFor(pageCount: number): string {
  if (["LOW", "MEDIUM", "HIGH"].includes(THINKING_OVERRIDE)) return THINKING_OVERRIDE;
  if (pageCount >= 80) return "HIGH";
  return pageCount >= 40 ? "MEDIUM" : "LOW";
}

function extractGeminiText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  return candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deleteGeminiFile(apiKey: string, name: string) {
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Geçici dosya temizliği ana analiz sonucunu etkilememelidir.
  }
}

/**
 * Belgeyi Gemini Files API'ye BİR KEZ yükler ve `fileUri` döndürür. Yükleme
 * başarısız olursa null döner ve çağıran satır içi (inlineData) gönderime
 * düşer: yeni bir kırılma noktası eklenmez.
 */
async function uploadPdfOnce(
  apiKey: string,
  bytes: ArrayBuffer,
  displayName: string,
): Promise<{ uri: string; name: string } | null> {
  let uploadedName = "";
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/pdf",
          "X-Goog-Upload-File-Name": encodeURIComponent(displayName),
        },
        body: bytes,
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) {
      const failure = await response.text().catch(() => "");
      console.error("[gemini] files upload reddedildi", { httpStatus: response.status, detail: failure.slice(0, 400) });
      return null;
    }
    const payload = await response.json() as { file?: { uri?: string; name?: string; state?: string } };
    const file = payload.file;
    if (!file?.uri || !file.name) return null;
    uploadedName = file.name;

    // PDF'ler genelde anında ACTIVE olur; değilse kısa süre beklenir.
    let state = file.state ?? "ACTIVE";
    for (let attempt = 0; attempt < 5 && state === "PROCESSING"; attempt += 1) {
      await delay(700);
      const check = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!check.ok) {
        await deleteGeminiFile(apiKey, uploadedName);
        return null;
      }
      state = ((await check.json()) as { state?: string }).state ?? "ACTIVE";
    }
    if (state === "ACTIVE") return { uri: file.uri, name: file.name };
    await deleteGeminiFile(apiKey, uploadedName);
    return null;
  } catch {
    if (uploadedName) await deleteGeminiFile(apiKey, uploadedName);
    return null;
  }
}

/**
 * Aynı belgenin yeniden analizini önleyen sunucu içi önbellek. Model
 * çıktısının ham hali saklanır; normalizasyon her istekte yeniden çalışır.
 */
type CachedExtraction = {
  raw: RawExtraction;
  model: string;
  pageCount: number;
};

const cacheHost = globalThis as unknown as { __kriterAnalysisCache?: Map<string, CachedExtraction> };

function analysisCache(): Map<string, CachedExtraction> {
  if (!cacheHost.__kriterAnalysisCache) cacheHost.__kriterAnalysisCache = new Map();
  return cacheHost.__kriterAnalysisCache;
}

async function documentHash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

function extractUsage(payload: unknown) {
  const usage = (payload as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  })?.usageMetadata;
  return {
    prompt: usage?.promptTokenCount ?? 0,
    output: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    total: usage?.totalTokenCount ?? 0,
  };
}

function buildResult(extraction: CachedExtraction, diagnostics: AnalysisDiagnostics): AnalysisResult {
  const normalized = normalizeExtraction(extraction.raw, extraction.pageCount);
  const analysisWarnings = [...normalized.warnings];
  return {
    setup: normalized.setup,
    templateProfile: normalized.templateProfile,
    criteria: normalized.criteria,
    pageCount: extraction.pageCount,
    provider: "api",
    model: extraction.model,
    analyzedAt: new Date().toISOString(),
    analysisWarnings,
    diagnostics,
  };
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "author_criteria");
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  const permit = acquireAnalysisPermit(request);
  if (!permit.ok) {
    const message = permit.reason === "concurrency"
      ? "Aynı anda çok fazla belge analiz ediliyor. Lütfen birkaç saniye sonra yeniden deneyin."
      : "Analiz istek sınırına ulaşıldı. Lütfen daha sonra yeniden deneyin.";
    return Response.json(
      { error: message },
      { status: 429, headers: { "Retry-After": String(permit.retryAfterSeconds) } },
    );
  }
  let uploadedGeminiFileName = "";
  let cleanupApiKey = "";
  try {
    if (requestBodyTooLarge(request, MAX_MULTIPART_BYTES)) {
      return Response.json({ error: "Gönderilen analiz isteği izin verilen boyutu aşıyor." }, { status: 413 });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "AI servis anahtarı sunucu ortamında bulunamadı." }, { status: 503 });
    }
    // Google AI Studio anahtarları "AIza" ile başlar. OAuth/geçici erişim
    // jetonları bu uçta 401 döndürür; hata yanıltıcı olmasın diye uyarılır.
    if (!apiKey.startsWith("AIza")) {
      console.warn("[gemini] GEMINI_API_KEY beklenen 'AIza' ön ekiyle başlamıyor; Gemini API bu kimlik türünü reddedebilir.");
    }
    cleanupApiKey = apiKey;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Analiz edilecek organizatör PDF'si eksik." }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
      return Response.json({ error: "Yalnızca PDF değerlendirme belgesi analiz edilebilir." }, { status: 415 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return Response.json({ error: "Bu sürümde doğrudan analiz sınırı 18 MB. Daha büyük kaynak belgeler için dosya akışı desteği etkinleştirilmelidir." }, { status: 413 });
    }
    const rawPageCount = Number(formData.get("pageCount"));
    const clientPageCount = Number.isFinite(rawPageCount) ? Math.min(1_000, Math.max(0, Math.round(rawPageCount))) : 0;
    const pdfBytes = await file.arrayBuffer();
    const sourceIntegrityError = pdfIntegrityError(pdfBytes);
    if (sourceIntegrityError) return Response.json({ error: sourceIntegrityError }, { status: 422 });
    // Sayfa sayısı yalnızca bilgi değil, kaynak sayfa DOĞRULAMASININ üst sınırıdır.
    // İstemci değeri eksik/hatalı geldiğinde (form alanı düşerse 0 → eski kodda 1)
    // bütün kriterlerin kaynak sayfası "aralık dışı" sayılıp siliniyordu; bu yüzden
    // sınır belgenin kendisinden okunur ve iki ölçümün büyüğü alınır.
    const { limit: pageCount, server: serverPages } = sourcePageLimit(pdfBytes, clientPageCount);
    if (!serverPages.trusted && !clientPageCount) {
      console.warn("[analyze] sayfa sayısı kesin belirlenemedi; kaynak sayfa sınırı tahmini.", { pageCount });
    }

    // Aynı belge ve aynı talimat daha önce işlendiğinde modeli hiç çağırma.
    // Önbellek isabetinde `apiCalls: 0` yazılır; sayı uydurulmaz.
    const cacheContext = JSON.stringify({
      promptVersion: EXTRACTION_PROMPT_VERSION,
      document: await documentHash(pdfBytes),
      model: PRIMARY_MODEL,
      // Çözünürlük ve düşünme bütçesi çıktıyı değiştirir; ayar değişince eski
      // önbellek kaydı geçersiz olmalı, aksi hâlde yeni ayar hiç denenmez.
      mediaResolution: MEDIA_RESOLUTION,
      thinking: thinkingLevelFor(pageCount),
      pageCount,
    });
    const cacheKey = await documentHash(new TextEncoder().encode(cacheContext).buffer);
    const cachedExtraction = analysisCache().get(cacheKey);
    if (cachedExtraction) {
      const totalMs = Date.now() - startedAt;
      recordUsage({ model: cachedExtraction.model, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: totalMs, cached: true, error: false, apiCalls: 0 });
      const cachedResult = buildResult(cachedExtraction, {
        totalMs, modelMs: 0, promptTokens: 0, outputTokens: 0, cached: true, apiCalls: 0, documentTransfers: 0,
      });
      await saveCriteriaExtractionRun(cachedResult, file.name, auth.account)
        .catch((historyError) => console.error("[workflow] analiz geçmişi kaydedilemedi", historyError));
      return Response.json(cachedResult);
    }

    const uploadStartedAt = Date.now();
    const uploadedFile = pdfBytes.byteLength <= INLINE_PDF_FAST_PATH_BYTES
      ? null
      : await uploadPdfOnce(apiKey, pdfBytes, file.name);
    const fileUri = uploadedFile?.uri ?? null;
    uploadedGeminiFileName = uploadedFile?.name ?? "";
    const uploadMs = Date.now() - uploadStartedAt;
    const documentPart = fileUri
      ? { fileData: { mimeType: "application/pdf", fileUri }, ...mediaResolutionPart() }
      : { inlineData: { mimeType: "application/pdf", data: Buffer.from(pdfBytes).toString("base64") }, ...mediaResolutionPart() };

    /** TEK üretim çağrısının gövdesi: bütün belge, dört aşamalı şema. */
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_INSTRUCTION }] },
      contents: [{
        role: "user",
        parts: [documentPart, { text: buildExtractionPrompt({ pageCount }) }],
      }],
      generationConfig: {
        // Kural çıkarımı yaratıcı bir görev değil: sıcaklık 0 hem kararlı çıktı
        // verir hem örnekleme adımını kısaltır. Aynı belge aynı kriterleri üretir.
        temperature: 0,
        topP: 1,
        thinkingConfig: { thinkingLevel: thinkingLevelFor(pageCount) },
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: EXTRACTION_SCHEMA,
      },
    });

    let modelUsed = PRIMARY_MODEL;
    /** Ücretlendirilen `generateContent` isteği sayısı; tanılamaya bu yazılır. */
    let apiCalls = 0;
    /** Gemini'nin bedelsiz 503/500 reddi; faturalanmaz, `apiCalls` ile toplanmaz. */
    let rejectedAttempts = 0;

    const failWith = (status: number, detail: string) => {
      console.error("AI analiz isteği başarısız:", { status, detail, apiCalls, rejectedAttempts });
      recordUsage({ model: modelUsed, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: Date.now() - startedAt, cached: false, error: true, apiCalls });
      const failure = describeGeminiFailure(status, detail, "AI belge analizi", rejectedAttempts);
      // `retryable` istemciye "Yeniden dene" düğmesini göstermesini söyler;
      // sunucu kendiliğinden ikinci bir ÜCRETLİ çağrı yapmaz.
      return Response.json(
        { error: failure.message, retryable: failure.transient, apiCalls, rejectedAttempts },
        { status: failure.httpStatus },
      );
    };

    const modelStartedAt = Date.now();
    // TEK ÜCRETLİ çağrı: yedek model ve tarama turu yoktur. Yalnızca Gemini'nin
    // bedelsiz 503/500 reddi sınırlı sayıda yeniden denenir (bkz. gemini-generation).
    const outcome = await runSingleGeneration({
      apiKey,
      body,
      model: PRIMARY_MODEL,
      timeoutMs: GENERATION_TIMEOUT_MS,
      label: "analyze",
    });
    const modelMs = Date.now() - modelStartedAt;
    apiCalls = outcome.apiCalls;
    rejectedAttempts = outcome.rejectedAttempts;
    if (!outcome.ok) return failWith(outcome.status, outcome.detail);
    modelUsed = outcome.model;

    const responseText = extractGeminiText(outcome.payload);
    if (!responseText) return failWith(502, "Belge analizi için geçerli yapılandırılmış çıktı alınamadı.");
    let raw: RawExtraction;
    try {
      raw = JSON.parse(responseText) as RawExtraction;
    } catch {
      return failWith(502, "Belge analizi şemaya uygun JSON olarak okunamadı.");
    }

    const extraction: CachedExtraction = { raw, model: modelUsed, pageCount };
    const cache = analysisCache();
    cache.set(cacheKey, extraction);
    if (cache.size > CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    const totalMs = Date.now() - startedAt;
    const usage = extractUsage(outcome.payload);
    recordUsage({
      model: modelUsed,
      promptTokens: usage.prompt,
      outputTokens: usage.output,
      totalTokens: usage.total,
      durationMs: totalMs,
      cached: false,
      error: false,
      apiCalls,
    });

    const result = buildResult(extraction, {
      totalMs,
      modelMs,
      promptTokens: usage.prompt,
      outputTokens: usage.output,
      cached: false,
      uploadMs: fileUri ? uploadMs : 0,
      // Gerçek istek sayısı; "1 dedik ama 6 gönderdik" durumu yaşanmaz.
      apiCalls,
      rejectedAttempts,
      documentTransfers: 1,
      documentDelivery: fileUri ? "file_uri" : "inline",
    });
    await saveCriteriaExtractionRun(result, file.name, auth.account)
      .catch((historyError) => console.error("[workflow] analiz geçmişi kaydedilemedi", historyError));
    return Response.json(result);
  } catch (error) {
    console.error("Beklenmeyen analiz hatası:", error);
    recordUsage({ model: PRIMARY_MODEL, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: Date.now() - startedAt, cached: false, error: true, apiCalls: 0 });
    return Response.json({ error: "Belge analizi sırasında beklenmeyen bir hata oluştu." }, { status: 500 });
  } finally {
    if (cleanupApiKey && uploadedGeminiFileName) {
      await deleteGeminiFile(cleanupApiKey, uploadedGeminiFileName);
    }
    permit.release();
  }
}
