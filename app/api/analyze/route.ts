import { requirePermission } from "../../lib/admin-guard";
import { acquireAnalysisPermit, requestBodyTooLarge } from "../../lib/request-guard";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM_INSTRUCTION,
  buildExtractionPrompt,
  extractionSchemaForCandidates,
  normalizeExtraction,
  type RawExtraction,
} from "../../lib/criteria-extraction";
import { describeGeminiFailure, runSingleGeneration } from "../../lib/gemini-generation";
import { recordUsage } from "../../lib/usage-metrics";
import { pdfIntegrityError } from "../../lib/pdf-integrity";
import { CANDIDATE_SELECTOR_VERSION, formatCandidatesForLlm, selectCriteriaCandidates, type CandidateSelection } from "../../lib/criteria-candidates";
import { DICTIONARY_VERSION } from "../../lib/criteria-dictionary";
import { extractPdfStructure, PDF_STRUCTURE_VERSION, PdfTextLayerError, type StructuredPdf } from "../../lib/pdf-structure";
import { deleteStoredAnalysis, findStoredAnalysis, reportBucket, saveCriteriaExtractionRun, saveStoredAnalysis, touchStoredAnalysis } from "../../lib/workflow-db";
import type { AnalysisDiagnostics, AnalysisResult } from "../../lib/types";

/**
 * Şartname analizi ucu — dört aşamalı prensip, TEK LLM çağrısı.
 *
 * Yarışma Yöneticisi YALNIZCA şartname PDF'sini yükler; ayrı bir resmî rapor
 * şablonu alanı yoktur. PDF sunucuda yapısal bloklara ayrılır; sürümlü sözlük
 * ve deterministik sinyaller güçlü adayları seçer. Modele PDF değil, yalnızca
 * kaynak kimlikli aday metinleri tek çağrıda verilir.
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
// Multipart sınırına dosya dışında başlıklar için küçük pay eklenir.
const MAX_MULTIPART_BYTES = MAX_PDF_BYTES + 768 * 1024;
// Tek çağrı bütün güçlü adayları kapsadığı için uzun belgelerde geniş zaman tanınır.
const GENERATION_TIMEOUT_MS = 150_000;

/**
 * Çıktı token tavanı.
 *
 * 24 576'ya indirilmişti; ölçüm bunun YETMEDİĞİNİ gösterdi. Model her güçlü
 * aday için bir karar satırı üretir: 129 adaylı 29 sayfalık bir şartnamede
 * yanıt tavana dayanıp JSON'un ortasında kesiliyor ve uç "şemaya uygun JSON
 * olarak okunamadı" diyerek 502 döndürüyordu. Tavan, aday sayısıyla birlikte
 * büyüyen cevabı taşıyacak şekilde geri yükseltildi.
 *
 * Tavan yine sonsuz değildir; kesilme olursa `finishReason` okunup kullanıcıya
 * ne olduğu ve ne yapabileceği açıkça söylenir (sessiz veri kaybı yok).
 */
const MAX_OUTPUT_TOKENS = 65_536;

/**
 * Modelin "düşünme" bütçesi — analiz süresinin en büyük belirleyicisi.
 *
 * Aday sayısı arttıkça bağlamı tutmak zorlaştığı için uzun belgelerde kademe
 * yükselir. `GEMINI_THINKING_LEVEL` ile elle sabitlenebilir.
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

/**
 * Model cevabı çıktı tavanına dayanıp KESİLDİ mi?
 *
 * Kesilmiş cevap geçersiz JSON olarak geliyor ve kullanıcı "şemaya uygun JSON
 * olarak okunamadı" gibi sebebi anlaşılmayan bir hata görüyordu. Gerçek sebep
 * belgenin tek cevaba sığmayacak kadar çok kural adayı içermesidir; mesaj bunu
 * söylemeli ve yöneticiye ne yapacağını anlatmalıdır.
 */
function truncatedByTokenLimit(payload: unknown): boolean {
  const candidates = (payload as { candidates?: Array<{ finishReason?: string }> })?.candidates;
  return candidates?.[0]?.finishReason === "MAX_TOKENS";
}

const TRUNCATED_OUTPUT_MESSAGE =
  "Belge tek analiz cevabına sığmadı: model çıktısı token sınırına ulaştığı için kesildi ve "
  + "sonuç kaydedilmedi. Şartname çok sayıda kural adayı içeriyor. Belgeyi bölümler hâlinde "
  + "(ör. yalnızca rapor kuralları içeren bölümler) yükleyerek yeniden deneyin.";

/**
 * Aynı belgenin yeniden analizini önleyen İKİ KATLI önbellek.
 *
 *   1. Süreç belleği (aşağıdaki Map): en hızlı yol; sunucu yeniden başlayınca silinir.
 *   2. D1 `criteria_analysis_cache` tablosu: KALICI kayıt. Daha önce analiz
 *      edilmiş bir şartname, sunucu yeniden başlasa bile modele gitmeden
 *      (0 token, apiCalls: 0) kayıttaki sonuçla yanıtlanır.
 *
 * Model çıktısının ham hali saklanır; normalizasyon her istekte yeniden çalışır.
 */
type CachedExtraction = {
  raw: RawExtraction;
  model: string;
  pageCount: number;
  /** Bu çıktının modelle İLK üretildiği an; önbellek isabetinde kullanıcıya gösterilir. */
  analyzedAt: string;
};

const cacheHost = globalThis as unknown as { __kriterAnalysisCache?: Map<string, CachedExtraction> };

function analysisCache(): Map<string, CachedExtraction> {
  if (!cacheHost.__kriterAnalysisCache) cacheHost.__kriterAnalysisCache = new Map();
  return cacheHost.__kriterAnalysisCache;
}

function rememberExtraction(cacheKey: string, extraction: CachedExtraction) {
  const cache = analysisCache();
  cache.set(cacheKey, extraction);
  if (cache.size > CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

/**
 * Önbelleğe almaya değer mi? Ham çıktı gerçek bir nesne olmalı ve normalizasyon
 * EN AZ BİR kriter üretmeli. Boş/kullanılamaz bir sonucu kalıcılaştırmak,
 * belgeyi sonsuza dek "0 kriter"e kilitlerdi: yönetici yeniden denese bile
 * model bir daha çağrılmazdı (düşünen modeller sıcaklık 0'da bile birebir
 * deterministik değildir; yeniden deneme gerçekten kurtarabilir). Böyle bir
 * sonuç yine istemciye döndürülür ama hiçbir önbellek katmanına yazılmaz.
 */
function cacheableExtraction(extraction: CachedExtraction, structure: StructuredPdf, selection: CandidateSelection): boolean {
  if (!extraction.raw || typeof extraction.raw !== "object") return false;
  try {
    const candidateIds = new Set(selection.candidates.map((candidate) => candidate.block.sourceId));
    return normalizeExtraction(extraction.raw, extraction.pageCount, structure.blocks, candidateIds).criteria.length > 0;
  } catch {
    return false;
  }
}

/**
 * Uçuş içi analizlerin kaydı: aynı belge için ikinci istek, ilk isteğin
 * sonucunu bekler ve modele İKİNCİ bir çağrı yapmaz. İlk istek başarısız
 * biterse söz null ile çözülür ve bekleyen istek kendi analizini başlatır.
 * Kayıt izolat yereldir; izolatlar arası eşzamanlılıkta koruma D1 katmanının
 * ON CONFLICT davranışına düşer (veri bozulmaz, yalnızca çift maliyet olur).
 */
const inflightHost = globalThis as unknown as { __kriterAnalysisInflight?: Map<string, Promise<CachedExtraction | null>> };

function inflightAnalyses(): Map<string, Promise<CachedExtraction | null>> {
  if (!inflightHost.__kriterAnalysisInflight) inflightHost.__kriterAnalysisInflight = new Map();
  return inflightHost.__kriterAnalysisInflight;
}

async function documentHash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
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

function buildResult(
  extraction: CachedExtraction,
  diagnostics: AnalysisDiagnostics,
  structure: StructuredPdf,
  selection: CandidateSelection,
): AnalysisResult {
  const candidateIds = new Set(selection.candidates.map((candidate) => candidate.block.sourceId));
  const normalized = normalizeExtraction(extraction.raw, extraction.pageCount, structure.blocks, candidateIds);
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
    diagnostics: {
      ...diagnostics,
      structureVersion: PDF_STRUCTURE_VERSION,
      dictionaryVersion: DICTIONARY_VERSION,
      selectorVersion: CANDIDATE_SELECTOR_VERSION,
      totalBlocks: selection.diagnostics.totalBlocks,
      selectedBlocks: selection.diagnostics.selectedBlocks,
      unselectedBlocks: selection.diagnostics.unselectedBlocks,
      classifiedCriteria: normalized.stats.classifiedCriteria,
      excludedCandidates: normalized.stats.excludedCandidates,
      rejectedSources: normalized.stats.rejectedSources,
      duplicateCriteria: normalized.stats.duplicateCriteria,
    },
  };
}

function documentContextOf(structure: StructuredPdf): string {
  const selected = structure.blocks.filter((block, index) => (
    index < 10 || block.blockType === "HEADING" || block.pageNumber === structure.pageCount
  )).slice(0, 80);
  return selected.map((block) => (
    `${block.sourceId} | s.${block.pageNumber} | ${block.blockType} | ${block.originalText}`
  )).join("\n");
}

async function saveCoverageArtifact(
  documentHashValue: string,
  structure: StructuredPdf,
  selection: CandidateSelection,
): Promise<string | undefined> {
  const key = `criteria-analysis/${documentHashValue}/${EXTRACTION_PROMPT_VERSION}-${DICTIONARY_VERSION}.json`;
  try {
    await reportBucket().put(key, JSON.stringify({
      createdAt: new Date().toISOString(),
      structureVersion: PDF_STRUCTURE_VERSION,
      dictionaryVersion: DICTIONARY_VERSION,
      selectorVersion: CANDIDATE_SELECTOR_VERSION,
      structure,
      candidates: selection.candidates,
      unselected: selection.unselected,
    }), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    return key;
  } catch (error) {
    console.error("[analyze] kapsam denetim kaydı R2'ye yazılamadı", error);
    return undefined;
  }
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
  // Uçuş içi kaydın her çıkış yolunda (hata dahil) temizlenmesi için dıştaki
  // finally kullanılır; başarıda söz zaten çözülmüştür, ikinci çözüm işlemsizdir.
  // Kayıt açılmadıysa işlemsiz fonksiyon çağrılır ve hiçbir etkisi olmaz.
  let inflightKey = "";
  let settleInflight: (value: CachedExtraction | null) => void = () => {};
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
    const pdfBytes = await file.arrayBuffer();
    const sourceIntegrityError = pdfIntegrityError(pdfBytes);
    if (sourceIntegrityError) return Response.json({ error: sourceIntegrityError }, { status: 422 });
    const structure = await extractPdfStructure(pdfBytes);
    const pageCount = structure.pageCount;
    const selection = selectCriteriaCandidates(structure.blocks);
    if (!selection.candidates.length) {
      return Response.json({
        error: "Belgede kriter adayı oluşturacak açık bir rapor kuralı bulunamadı. PDF metin katmanını ve şartname içeriğini kontrol edin.",
      }, { status: 422 });
    }

    // Aynı belge ve aynı talimat daha önce işlendiğinde modeli hiç çağırma.
    // Önbellek isabetinde `apiCalls: 0` yazılır; sayı uydurulmaz.
    const docHash = structure.pdfHash;
    const cacheContext = JSON.stringify({
      promptVersion: EXTRACTION_PROMPT_VERSION,
      document: docHash,
      model: PRIMARY_MODEL,
      // Çözünürlük, düşünme bütçesi ve çıktı tavanı sonucu değiştirir; ayar
      // değişince eski önbellek kaydı geçersiz olmalı, aksi hâlde yeni ayar
      // hiç denenmez ve eski (hatalı) sonuç kalıcı hâle gelir.
      structureVersion: PDF_STRUCTURE_VERSION,
      dictionaryVersion: DICTIONARY_VERSION,
      selectorVersion: CANDIDATE_SELECTOR_VERSION,
      candidateSourceIds: selection.candidates.map((candidate) => candidate.block.sourceId),
      thinking: thinkingLevelFor(pageCount),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      pageCount,
    });
    const cacheKey = await documentHash(new TextEncoder().encode(cacheContext).buffer);
    const coverageArtifactKey = await saveCoverageArtifact(docHash, structure, selection);

    /*
     * YENİDEN ANALİZ (madde 1)
     *
     * Yarışma Yöneticisi "Yeniden analiz et" dediğinde `refresh=1` gelir:
     * bellek ve D1 kayıtları ATLANIR, model gerçekten yeniden çalışır ve
     * yeni sonuç eski kaydın üzerine yazılır. Böylece eski ama hatalı bir
     * sonuç sistemde sonsuza kadar kalamaz.
     */
    const forceRefresh = String(formData.get("refresh") ?? "") === "1";
    if (forceRefresh) {
      analysisCache().delete(cacheKey);
      await deleteStoredAnalysis(cacheKey).catch((cacheError) =>
        console.error("[analyze] kalıcı analiz kaydı silinemedi", cacheError));
    }

    /** Önbellek isabeti: modele gidilmez, 0 token; kaynağı tanılamaya yazılır. */
    const respondFromCache = async (extraction: CachedExtraction, store: "memory" | "database") => {
      const totalMs = Date.now() - startedAt;
      recordUsage({ model: extraction.model, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: totalMs, cached: true, error: false, apiCalls: 0 });
      // Bellekten sunulan isabet kalıcı kaydın tazeliğini de işaretler; aksi
      // hâlde en sık kullanılan belge D1'de "soğuk" görünür ve satır sınırı
      // budaması tam da onu silerdi. Güncelleme başarısız olsa da yanıt döner.
      if (store === "memory") await touchStoredAnalysis(cacheKey).catch(() => undefined);
      const cachedResult = buildResult(extraction, {
        totalMs, modelMs: 0, promptTokens: 0, outputTokens: 0, cached: true, apiCalls: 0, documentTransfers: 0,
        cacheStore: store, firstAnalyzedAt: extraction.analyzedAt, coverageArtifactKey,
      }, structure, selection);
      await saveCriteriaExtractionRun(cachedResult, file.name, auth.account)
        .catch((historyError) => console.error("[workflow] analiz geçmişi kaydedilemedi", historyError));
      return Response.json(cachedResult);
    };

    const cachedExtraction = forceRefresh ? undefined : analysisCache().get(cacheKey);
    if (cachedExtraction) return await respondFromCache(cachedExtraction, "memory");

    // Süreç belleğinde yoksa kalıcı kayda bakılır: sunucu yeniden başlasa bile
    // daha önce analiz edilmiş şartname modele gitmeden yanıtlanır. Kayıt
    // okunamazsa analiz normal yoldan sürer; önbellek hiçbir isteği düşürmez.
    const storedAnalysis = forceRefresh ? null : await findStoredAnalysis(cacheKey).catch((cacheError) => {
      console.error("[analyze] kalıcı analiz kaydı okunamadı", cacheError);
      return null;
    });
    if (storedAnalysis) {
      let storedExtraction: CachedExtraction | null = null;
      try {
        storedExtraction = {
          raw: JSON.parse(storedAnalysis.rawJson) as RawExtraction,
          model: storedAnalysis.model,
          pageCount: storedAnalysis.pageCount || pageCount,
          analyzedAt: storedAnalysis.createdAt,
        };
      } catch (parseError) {
        console.error("[analyze] kalıcı analiz kaydı çözümlenemedi; belge yeniden analiz edilecek", parseError);
      }
      // Kayıt hem okunabilir hem kullanılabilir olmalı: 0 kriter üreten eski
      // bir satır isabet sayılmaz, belge yeniden analiz edilip üzerine yazılır.
      if (storedExtraction && cacheableExtraction(storedExtraction, structure, selection)) {
        rememberExtraction(cacheKey, storedExtraction);
        return await respondFromCache(storedExtraction, "database");
      }
      if (storedExtraction) {
        console.warn("[analyze] kalıcı analiz kaydı kullanılamaz (0 kriter); belge yeniden analiz edilecek");
      }
    }

    // Aynı belge şu anda başka bir istekte analiz ediliyorsa modele ikinci bir
    // çağrı başlatılmaz; ilk isteğin sonucu beklenir ve önbellek gibi sunulur.
    // (Bekleyiş analiz iznini tutar: en kötü durumda bir eşzamanlılık yuvası
    // ilk istek bitene dek dolu kalır; iki tam model çağrısından ucuzdur.)
    const inflight = forceRefresh ? undefined : inflightAnalyses().get(cacheKey);
    if (inflight) {
      const sharedExtraction = await inflight.catch(() => null);
      if (sharedExtraction) return await respondFromCache(sharedExtraction, "memory");
    }
    inflightKey = cacheKey;
    inflightAnalyses().set(cacheKey, new Promise((resolve) => { settleInflight = resolve; }));

    const candidatesText = formatCandidatesForLlm(selection.candidates);
    const prompt = buildExtractionPrompt({
      pageCount,
      totalBlocks: structure.blocks.length,
      candidateCount: selection.candidates.length,
      documentContext: documentContextOf(structure),
      candidatesText,
    });

    /** TEK üretim çağrısının gövdesi: PDF yerine doğrulanmış aday metinleri. */
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_INSTRUCTION }] },
      contents: [{
        role: "user",
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        // Kural çıkarımı yaratıcı bir görev değil: sıcaklık 0 hem kararlı çıktı
        // verir hem örnekleme adımını kısaltır. Aynı belge aynı kriterleri üretir.
        temperature: 0,
        topP: 1,
        thinkingConfig: { thinkingLevel: thinkingLevelFor(pageCount) },
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: extractionSchemaForCandidates(
          selection.candidates.map((candidate) => candidate.block.sourceId),
        ),
      },
    });

    let modelUsed = PRIMARY_MODEL;
    /** Gerçekten yapılan `generateContent` isteği sayısı; tanılamaya bu yazılır. */
    let apiCalls: 0 | 1 = 0;

    const failWith = (status: number, detail: string, retryableOverride?: boolean) => {
      console.error("AI analiz isteği başarısız:", { status, detail, apiCalls });
      recordUsage({ model: modelUsed, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: Date.now() - startedAt, cached: false, error: true, apiCalls });
      const failure = describeGeminiFailure(status, detail, "AI belge analizi");
      // `retryable` istemciye "Yeniden dene" düğmesini göstermesini söyler;
      // sunucu kendiliğinden ikinci bir çağrı yapmaz.
      return Response.json(
        { error: failure.message, retryable: retryableOverride ?? failure.transient, apiCalls },
        { status: failure.httpStatus },
      );
    };

    const modelStartedAt = Date.now();
    // TEK çağrı: yedek model, tarama turu ve gizli yeniden deneme yoktur.
    const outcome = await runSingleGeneration({
      apiKey,
      body,
      model: PRIMARY_MODEL,
      timeoutMs: GENERATION_TIMEOUT_MS,
      label: "analyze",
    });
    const modelMs = Date.now() - modelStartedAt;
    apiCalls = outcome.apiCalls;
    if (!outcome.ok) return failWith(outcome.status, outcome.detail);
    modelUsed = outcome.model;

    const responseText = extractGeminiText(outcome.payload);
    // Kesilme, boş yanıttan ve bozuk JSON'dan ÖNCE kontrol edilir: sebebi bilinen
    // bir başarısızlığı "geçersiz çıktı" diye raporlamak yanıltıcıydı.
    if (truncatedByTokenLimit(outcome.payload)) return failWith(502, TRUNCATED_OUTPUT_MESSAGE);
    if (!responseText) return failWith(502, "Belge analizi için geçerli yapılandırılmış çıktı alınamadı.");
    let raw: RawExtraction;
    try {
      raw = JSON.parse(responseText) as RawExtraction;
    } catch {
      return failWith(502, "Belge analizi şemaya uygun JSON olarak okunamadı.");
    }
    // JSON.parse "null" gibi nesne olmayan gövdeleri de geçirir; böyle bir
    // gövde normalizasyonda patlar ve önbelleğe girerse her isteği düşürürdü.
    if (!raw || typeof raw !== "object") {
      return failWith(502, "Belge analizi şemaya uygun JSON olarak okunamadı.");
    }

    // Geçerli JSON, eksiksiz analiz demek değildir. Gemini bazı koşularda
    // yalnızca kabul ettiği kriterleri döndürüp adayların büyük bölümünü sessizce
    // atlayabiliyor. Eksik kapsamı başarı diye kaydetmek 129 adaylı bir belgeyi
    // yanıltıcı biçimde 13 kriterle tamamlanmış gösteriyordu. Tek çağrı politikası
    // korunur: sunucu gizlice yeniden denemez; eksik sonucu kaydetmez ve kullanıcıya
    // açık, yeniden denenebilir hata verir.
    const candidateIds = new Set(selection.candidates.map((candidate) => candidate.block.sourceId));
    const coverageCheck = normalizeExtraction(raw, pageCount, structure.blocks, candidateIds);
    if (coverageCheck.stats.unansweredCandidates > 0) {
      return failWith(
        502,
        `Model ${selection.candidates.length} adayın ${coverageCheck.stats.unansweredCandidates} tanesi için karar döndürmedi. `
        + "Eksik sonuç kaydedilmedi; belgeyi yeniden analiz edin.",
        true,
      );
    }

    const extraction: CachedExtraction = { raw, model: modelUsed, pageCount, analyzedAt: new Date().toISOString() };
    if (cacheableExtraction(extraction, structure, selection)) {
      rememberExtraction(cacheKey, extraction);
      // Taze sonuç kalıcı kayda da yazılır; yazılamazsa analiz sonucu yine döner.
      await saveStoredAnalysis({
        cacheKey,
        documentHash: docHash,
        sourceDocumentName: file.name,
        model: modelUsed,
        pageCount,
        rawJson: responseText,
      }).catch((cacheError) => console.error("[analyze] kalıcı analiz kaydı yazılamadı", cacheError));
      // Bekleyen eş istekler sonucu buradan alır; model ikinci kez çağrılmaz.
      settleInflight(extraction);
    } else {
      // 0 kriter üreten sonuç kalıcılaştırılmaz: kullanıcı "Yeniden dene"
      // dediğinde model gerçekten yeniden çalışır ve şansı olur.
      console.warn("[analyze] sonuç önbelleğe alınmadı: normalizasyon hiç kriter üretmedi.");
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
      uploadMs: 0,
      // Gerçek istek sayısı; "1 dedik ama 6 gönderdik" durumu yaşanmaz.
      apiCalls,
      documentTransfers: 0,
      documentDelivery: "structured_text",
      coverageArtifactKey,
    }, structure, selection);
    await saveCriteriaExtractionRun(result, file.name, auth.account)
      .catch((historyError) => console.error("[workflow] analiz geçmişi kaydedilemedi", historyError));
    return Response.json(result);
  } catch (error) {
    if (error instanceof PdfTextLayerError) {
      return Response.json({ error: error.message, code: "OCR_REQUIRED" }, { status: 422 });
    }
    console.error("Beklenmeyen analiz hatası:", error);
    recordUsage({ model: PRIMARY_MODEL, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: Date.now() - startedAt, cached: false, error: true, apiCalls: 0 });
    return Response.json({ error: "Belge analizi sırasında beklenmeyen bir hata oluştu." }, { status: 500 });
  } finally {
    // Hata dahil her çıkışta uçuş içi kayıt temizlenir; başarıda söz zaten
    // çözüldüğü için buradaki null çözümü işlemsizdir.
    settleInflight(null);
    if (inflightKey) inflightAnalyses().delete(inflightKey);
    permit.release();
  }
}
