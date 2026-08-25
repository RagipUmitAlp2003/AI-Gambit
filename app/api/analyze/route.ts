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
import { recordUsage } from "../../lib/usage-metrics";
import { pdfIntegrityError } from "../../lib/pdf-integrity";
import { saveCriteriaExtractionRun } from "../../lib/workflow-db";
import type { AnalysisDiagnostics, AnalysisResult } from "../../lib/types";

/**
 * Şartname analizi ucu — dört aşamalı prensip, TEK LLM çağrısı.
 *
 * PDF'nin tamamı bir kez modele verilir; model dört aşamaya ayrılmış kriterleri
 * (dil/şablon, başlık/içerik, kategori, teknik kural) kaynak sayfası ve birebir
 * alıntıyla döndürür. Sayfa aralığı, bağımsız denetim turu, puan planı veya
 * güven seviyesi yoktur. Model çıktısı sunucuda doğrulanır (sayfa sınırı, tekrar,
 * boş alan); karar yöneticide kalır.
 */

const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
// Birincil ve yedek modelin aynı anda "high demand" (503) döndürdüğü dalgalarda
// analizin tamamen düşmemesi için isteğe bağlı üçüncü kademe.
const THIRD_MODEL = process.env.GEMINI_THIRD_MODEL || "";
// Model listesinin kaç kez baştan taranacağı: geçici 503/429 dalgası tek
// turda bütün kademeleri tüketirse ikinci tur belgeyi kurtarır.
const MODEL_SWEEPS = Math.min(4, Math.max(1, Number(process.env.GEMINI_MODEL_SWEEPS) || 2));
// Yeniden denemeler için toplam duvar saati bütçesi: ek tur, isteği
// süresiz uzatmasın. Bütçe dolduğunda yeni deneme başlatılmaz.
const MODEL_RETRY_BUDGET_MS = Math.max(60_000, Number(process.env.GEMINI_RETRY_BUDGET_MS) || 300_000);

const CACHE_LIMIT = 12;
const MAX_PDF_BYTES = 18 * 1024 * 1024;
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
// Küçük PDF'ler satır içi gönderilir; büyük belgeler bir kez Files API'ye
// yüklenip URI ile verilir ki yeniden deneme çağrılarında PDF tekrar taşınmasın.
const INLINE_PDF_FAST_PATH_BYTES = 512 * 1024;
// Multipart sınırına dosya dışında başlıklar için küçük pay eklenir.
const MAX_MULTIPART_BYTES = MAX_PDF_BYTES + MAX_TEMPLATE_BYTES + 768 * 1024;
// Tek çağrı bütün belgeyi kapsadığı için uzun belgelerde daha geniş zaman tanınır.
const GENERATION_TIMEOUT_MS = 150_000;

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
  /** Devre kesici nedeniyle bu istekte hiç denenmeyen modeller. */
  skippedModels?: string[];
  pageCount: number;
};

/**
 * Model devre kesici. Bir model zaman aşımına uğrar veya 5xx dönerse kısa süre
 * devre dışı bırakılır; sonraki analizler doğrudan çalışan modelle başlar.
 * Süre dolduğunda model kendiliğinden yeniden denenir.
 */
const MODEL_COOLDOWN_MS = Number(process.env.MODEL_COOLDOWN_MS) > 0
  ? Number(process.env.MODEL_COOLDOWN_MS)
  : 10 * 60 * 1000;

const breakerHost = globalThis as unknown as { __kriterModelCooldown?: Map<string, number> };

function modelCooldown(): Map<string, number> {
  if (!breakerHost.__kriterModelCooldown) breakerHost.__kriterModelCooldown = new Map();
  return breakerHost.__kriterModelCooldown;
}

function isModelCooling(model: string): boolean {
  const until = modelCooldown().get(model);
  if (!until) return false;
  if (Date.now() >= until) { modelCooldown().delete(model); return false; }
  return true;
}

function markModelUnavailable(model: string) {
  modelCooldown().set(model, Date.now() + MODEL_COOLDOWN_MS);
}

function markModelHealthy(model: string) {
  modelCooldown().delete(model);
}

/** Denenecek modeller: soğumada olanlar atlanır, hepsi soğumadaysa liste korunur. */
function usableModels(models: string[]): { models: string[]; skipped: string[] } {
  const skipped = models.filter(isModelCooling);
  const usable = models.filter((model) => !isModelCooling(model));
  return usable.length ? { models: usable, skipped } : { models, skipped: [] };
}

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
  const analysisWarnings = [
    ...normalized.warnings,
    ...(extraction.skippedModels?.length
      ? [`Yanıt vermediği için geçici olarak atlanan model: ${extraction.skippedModels.join(", ")}. Analiz yedek modelle tamamlandı.`]
      : []),
  ];
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
    const templateEntry = formData.get("templateFile");
    const templateFile = templateEntry instanceof File && templateEntry.size > 0 ? templateEntry : null;
    if (templateFile && templateFile.type !== "application/pdf" && !templateFile.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
      return Response.json({ error: "Rapor şablonu yalnızca PDF olabilir." }, { status: 415 });
    }
    if (templateFile && templateFile.size > MAX_TEMPLATE_BYTES) {
      return Response.json({ error: "Rapor şablonu en fazla 10 MB olabilir." }, { status: 413 });
    }

    const rawPageCount = Number(formData.get("pageCount"));
    const pageCount = Number.isFinite(rawPageCount)
      ? Math.min(1_000, Math.max(1, Math.round(rawPageCount)))
      : 1;
    const pdfBytes = await file.arrayBuffer();
    const sourceIntegrityError = pdfIntegrityError(pdfBytes);
    if (sourceIntegrityError) return Response.json({ error: sourceIntegrityError }, { status: 422 });
    const templateBytes = templateFile ? await templateFile.arrayBuffer() : null;
    const templateIntegrityError = templateBytes ? pdfIntegrityError(templateBytes) : null;
    if (templateIntegrityError) return Response.json({ error: `Rapor şablonu okunamıyor: ${templateIntegrityError}` }, { status: 422 });
    const rawTemplatePageCount = Number(formData.get("templatePageCount"));
    const templatePageCount = templateFile && Number.isFinite(rawTemplatePageCount)
      ? Math.min(500, Math.max(1, Math.round(rawTemplatePageCount)))
      : templateFile ? 1 : 0;

    // Aynı belge ve aynı talimat daha önce işlendiğinde modeli çağırma.
    const cacheContext = JSON.stringify({
      promptVersion: EXTRACTION_PROMPT_VERSION,
      document: await documentHash(pdfBytes),
      template: templateBytes ? await documentHash(templateBytes) : null,
      models: [PRIMARY_MODEL, FALLBACK_MODEL, THIRD_MODEL],
      pageCount,
    });
    const cacheKey = await documentHash(new TextEncoder().encode(cacheContext).buffer);
    const cachedExtraction = analysisCache().get(cacheKey);
    if (cachedExtraction) {
      const totalMs = Date.now() - startedAt;
      recordUsage({ model: cachedExtraction.model, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: totalMs, cached: true, error: false });
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
      ? { fileData: { mimeType: "application/pdf", fileUri }, mediaResolution: { level: "MEDIA_RESOLUTION_MEDIUM" } }
      : { inlineData: { mimeType: "application/pdf", data: Buffer.from(pdfBytes).toString("base64") }, mediaResolution: { level: "MEDIA_RESOLUTION_MEDIUM" } };
    const templatePart = templateBytes
      ? { inlineData: { mimeType: "application/pdf", data: Buffer.from(templateBytes).toString("base64") }, mediaResolution: { level: "MEDIA_RESOLUTION_MEDIUM" } }
      : null;

    /** TEK üretim çağrısının gövdesi: bütün belge, dört aşamalı şema. */
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_INSTRUCTION }] },
      contents: [{
        role: "user",
        parts: [
          documentPart,
          ...(templatePart ? [{ text: `Aşağıdaki ikinci PDF ayrı RAPOR ŞABLONUDUR: ${templateFile?.name || "rapor-sablonu.pdf"}.` }, templatePart] : []),
          { text: buildExtractionPrompt({ pageCount, templateName: templateFile?.name ?? null, templatePageCount }) },
        ],
      }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: pageCount >= 80 ? "HIGH" : "MEDIUM" },
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
        responseJsonSchema: EXTRACTION_SCHEMA,
      },
    });

    const allModels = [...new Set([PRIMARY_MODEL, FALLBACK_MODEL, THIRD_MODEL].filter(Boolean))];
    const { models: attempts, skipped: skippedModels } = usableModels(allModels);
    let modelUsed = attempts[0];

    const failWith = (status: number, detail: string) => {
      console.error("AI analiz isteği başarısız:", { status, detail });
      recordUsage({ model: modelUsed, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: Date.now() - startedAt, cached: false, error: true });
      const upstreamAuthFailure = status === 401 || status === 403;
      // Google tükenmiş bakiyeyi de 429 ile bildiriyor; "bir dakika sonra
      // dene" yönlendirmesi bu durumda yanlış olduğu için mesaj ayrıştırılır.
      const billingDepleted = /prepayment credits|billing|exceeded your current quota/i.test(detail);
      const publicMessage = status === 504
        ? "AI modeli zaman sınırı içinde yanıt vermedi. Lütfen yeniden deneyin."
        : billingDepleted
          ? "AI servisi isteği bakiye/kota nedeniyle reddetti: Google AI Studio projesinin ön ödemeli kredisi tükenmiş görünüyor. Anahtar geçerli; ai.dev/projects üzerinden faturalama bakiyesini yenileyin."
        : status === 429
          ? "AI servisinin geçici kullanım sınırına ulaşıldı. Yaklaşık bir dakika sonra yeniden deneyin."
        : status === 503
          ? "AI modeli şu anda yoğun ve yedek modeller de yanıt vermedi. Birkaç dakika sonra yeniden deneyin; sorun sürerse GEMINI_MODEL değerini erişilebilir başka bir modele alın."
        : upstreamAuthFailure
          ? "AI servisi anahtarı reddetti (kimlik doğrulama hatası). Bu bir kota sorunu değildir: GEMINI_API_KEY geçersiz, süresi dolmuş ya da Gemini API için yetkili değil. Google AI Studio'dan yeni bir API anahtarı alıp sunucu ortamını güncelleyin."
        : "AI belge analizi tamamlanamadı. Lütfen yeniden deneyin.";
      // Uygulamanın kendi oturum katmanı 401'i "yeniden giriş yap" olarak
      // yorumladığı için yukarı akış kimlik hatası 502 ile iletilir.
      return Response.json({ error: publicMessage }, { status: upstreamAuthFailure || status === 503 ? 502 : status });
    };

    type GenerationOutcome =
      | { ok: true; payload: unknown; model: string }
      | { ok: false; status: number; detail: string };

    /** Tek çağrı; hata ve yedek model politikası korunur. */
    const runGeneration = async (): Promise<GenerationOutcome> => {
      let lastDetail = "AI belge analizi tamamlanamadı.";
      let lastStatus = 502;
      const plan: string[] = [];
      for (let sweep = 0; sweep < MODEL_SWEEPS; sweep += 1) plan.push(...attempts);
      for (let planIndex = 0; planIndex < plan.length; planIndex += 1) {
        const model = plan[planIndex];
        const alternativeAhead = plan.slice(planIndex + 1).some((candidate) => !isModelCooling(candidate));
        if (isModelCooling(model) && alternativeAhead) continue;
        // Bütçe dolduysa yeni model denemesi başlatmak yerine elde edilen
        // en son hatayla dön: istek belirsiz süre askıda kalmasın.
        if (planIndex > 0 && Date.now() - startedAt > MODEL_RETRY_BUDGET_MS) break;
        let response: Response;
        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
              body,
              signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
            },
          );
        } catch {
          markModelUnavailable(model);
          lastDetail = "AI modeli zaman sınırı içinde yanıt vermedi.";
          lastStatus = 504;
          continue;
        }
        if (response.ok) {
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            return { ok: false, status: 502, detail: "AI servisi geçerli JSON taşımayan bir yanıt döndürdü." };
          }
          markModelHealthy(model);
          return { ok: true, payload, model };
        }
        const errorPayload = await response.json().catch(() => ({})) as {
          error?: { message?: string; status?: string; details?: unknown[] };
        };
        // API anahtarı ve PDF içeriği bu kayda dahil edilmez; yalnızca servis
        // hata tanısı geliştirme günlüğüne yazılır.
        console.error("[gemini] generateContent reddedildi", {
          model,
          httpStatus: response.status,
          status: errorPayload.error?.status,
          message: errorPayload.error?.message,
          details: errorPayload.error?.details,
        });
        lastDetail = errorPayload.error?.message || `AI analiz isteği ${response.status} koduyla başarısız oldu.`;
        // Kimlik doğrulama hatası yeniden denemeyle veya yedek modelle
        // çözülmez; durum kodu kotayla karışmasın diye korunur.
        lastStatus = response.status === 429 || response.status === 503
          ? response.status
          : response.status === 401 || response.status === 403
            ? response.status
            : 502;
        const retryable = [429, 500, 502, 503, 504].includes(response.status);
        if (!retryable) return { ok: false, status: lastStatus, detail: lastDetail };
        if ([500, 502, 503, 504].includes(response.status)) markModelUnavailable(model);
        if (planIndex + 1 < plan.length) {
          // Kademe değişiminde kısa, aynı kademenin tekrarında artan bekleme:
          // "high demand" dalgaları genelde saniyeler içinde geçiyor.
          const sweepIndex = Math.floor(planIndex / Math.max(1, attempts.length));
          const base = lastStatus === 429 ? 2_500 : 1_200;
          await delay(Math.min(12_000, base * 2 ** sweepIndex));
        }
      }
      return { ok: false, status: /zaman sınırı/i.test(lastDetail) ? 504 : lastStatus, detail: lastDetail };
    };

    const modelStartedAt = Date.now();
    const outcome = await runGeneration();
    const modelMs = Date.now() - modelStartedAt;
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

    const extraction: CachedExtraction = { raw, model: modelUsed, skippedModels, pageCount };
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
    });

    const result = buildResult(extraction, {
      totalMs,
      modelMs,
      promptTokens: usage.prompt,
      outputTokens: usage.output,
      cached: false,
      uploadMs: fileUri ? uploadMs : 0,
      apiCalls: 1,
      documentTransfers: 1,
      documentDelivery: fileUri ? "file_uri" : "inline",
    });
    await saveCriteriaExtractionRun(result, file.name, auth.account)
      .catch((historyError) => console.error("[workflow] analiz geçmişi kaydedilemedi", historyError));
    return Response.json(result);
  } catch (error) {
    console.error("Beklenmeyen analiz hatası:", error);
    recordUsage({ model: PRIMARY_MODEL, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: Date.now() - startedAt, cached: false, error: true });
    return Response.json({ error: "Belge analizi sırasında beklenmeyen bir hata oluştu." }, { status: 500 });
  } finally {
    if (cleanupApiKey && uploadedGeminiFileName) {
      await deleteGeminiFile(cleanupApiKey, uploadedGeminiFileName);
    }
    permit.release();
  }
}
