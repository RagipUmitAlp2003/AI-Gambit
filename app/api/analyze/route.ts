import { requirePermission } from "../../lib/admin-guard";
import { PayloadTooLargeError, acquireAnalysisPermit, readFormDataWithLimit, requestBodyTooLarge } from "../../lib/request-guard";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  buildExtractionPrompt,
  normalizeExtraction,
  type RawExtraction,
} from "../../lib/criteria-extraction";
import { describeGeminiFailure, runSingleGeneration } from "../../lib/gemini-generation";
import { recordUsage } from "../../lib/usage-metrics";
import { pdfIntegrityError } from "../../lib/pdf-integrity";
import { CANDIDATE_SELECTOR_VERSION, formatCandidatesForLlm, selectCriteriaCandidates, summarizeUnselectedBlocks, type CandidateSelection } from "../../lib/criteria-candidates";
import { DICTIONARY_VERSION } from "../../lib/criteria-dictionary";
import { extractPdfStructure, PDF_STRUCTURE_OCR_VERSION, PDF_STRUCTURE_VERSION, PdfTextLayerError, type StructuredPdf } from "../../lib/pdf-structure";
import { extractPdfStructureViaOcr, OCR_PROMPT_VERSION } from "../../lib/pdf-ocr";
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
 * TEK İSTİSNA — OCR yedeği: metin katmansız (taranmış) belgede uç önce
 * kontrollü 422 (OCR_REQUIRED) ile durur. Yarışma Yöneticisi OCR'yi arayüzden
 * AÇIKÇA onaylarsa (`ocr=1`) aktarım için tam olarak BİR ek `generateContent`
 * isteği yapılır; bu çağrı da hiç yeniden denenmez ve sayaçlara olduğu gibi
 * yazılır. OCR yapısı belge başına bir kez üretilip R2'de sabitlenir; sonraki
 * yeniden analizler ek çağrı yapmadan sabit yapıyı kullanır.
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
 * 24 576'ya indirilmişti; ancak aday-karar sözleşmesinde model HER aday için
 * bir karar satırı (kaynak alıntısıyla birlikte) döndürür ve düşünme tokenları
 * da bu bütçeden düşer. Yoğun bir şartnamede (ör. 29 sayfa, 200+ aday) çıktı
 * tavana takılıp JSON ortasından kesiliyor ve analiz "şemaya uygun JSON
 * okunamadı" ile düşüyordu. Tavan modelin desteklediği üst sınıra alındı;
 * gerçek maliyet üretilen tokena göre oluşur, tavana göre değil.
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

/** Bu isteğin OCR ayak izi; önbellek isabetinde de sonuç OCR uyarısını taşır. */
type OcrRunInfo = {
  used: boolean;
  /** OCR aktarımı için BU istekte yapılan üretim çağrısı sayısı (sabit yapıda 0). */
  apiCalls: number;
  modelMs: number;
  extraWarnings: string[];
};

const NO_OCR: OcrRunInfo = { used: false, apiCalls: 0, modelMs: 0, extraWarnings: [] };

/**
 * OCR ile çıkarılan metne dayanan HER analizde (taze ya da önbellekten)
 * yöneticiye gösterilen zorunlu uyarı; mevcut analysisWarnings listesinde
 * ek arayüz gerektirmeden görünür.
 */
const OCR_WARNING = "Bu belgede okunabilir metin katmanı bulunamadı; metin yapay zekâ görüntü okumasıyla (OCR) çıkarıldı. "
  + "Kaynak sayfaları ve alıntılar OCR metnine dayanır; yayımlamadan önce kaynakları belge üzerinde doğrulayın.";

function buildResult(
  extraction: CachedExtraction,
  diagnostics: AnalysisDiagnostics,
  structure: StructuredPdf,
  selection: CandidateSelection,
  ocr: OcrRunInfo = NO_OCR,
): AnalysisResult {
  const candidateIds = new Set(selection.candidates.map((candidate) => candidate.block.sourceId));
  const normalized = normalizeExtraction(extraction.raw, extraction.pageCount, structure.blocks, candidateIds);
  const analysisWarnings = [...normalized.warnings];
  if (ocr.used) analysisWarnings.push(OCR_WARNING, ...ocr.extraWarnings);
  return {
    setup: normalized.setup,
    templateProfile: normalized.templateProfile,
    // OCR kökeni kriter üstünde iz olarak taşınır; yayımlanan profil de taşır.
    criteria: ocr.used ? normalized.criteria.map((item) => ({ ...item, ocrDerived: true })) : normalized.criteria,
    pageCount: extraction.pageCount,
    provider: "api",
    model: extraction.model,
    analyzedAt: new Date().toISOString(),
    analysisWarnings,
    // Sessiz eleme yok (Spec §8): otomatik taramanın aday SEÇMEDİĞİ bloklar
    // yalnızca R2 denetim kaydına değil, yanıt gövdesine de yazılır ve
    // Yarışma Yöneticisi inceleme adımında görür. Seçim her istekte yeniden
    // hesaplandığı için önbellek isabetleri de bu özeti sıfır maliyetle taşır.
    unselectedReview: summarizeUnselectedBlocks(selection.unselected),
    diagnostics: {
      ...diagnostics,
      // OCR kullanıldıysa yapı sürümü OCR sürümüdür (pdf-structure-ocr-v1).
      structureVersion: structure.version,
      dictionaryVersion: DICTIONARY_VERSION,
      selectorVersion: CANDIDATE_SELECTOR_VERSION,
      totalBlocks: selection.diagnostics.totalBlocks,
      selectedBlocks: selection.diagnostics.selectedBlocks,
      unselectedBlocks: selection.diagnostics.unselectedBlocks,
      classifiedCriteria: normalized.stats.classifiedCriteria,
      excludedCandidates: normalized.stats.excludedCandidates,
      rejectedSources: normalized.stats.rejectedSources,
      duplicateCriteria: normalized.stats.duplicateCriteria,
      correctedPages: normalized.stats.correctedPages,
      droppedCriteria: normalized.stats.droppedCriteria,
      ...(ocr.used ? { textExtraction: "gemini_ocr" as const, ocrApiCalls: ocr.apiCalls, ocrMs: ocr.modelMs } : {}),
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
  // Anahtar yapı sürümünü de içerir: v1 denetim kayıtları (eski
  // criteria_extraction_runs tanılamalarındaki coverageArtifactKey'in işaret
  // ettiği nesneler) v2 yeniden analiziyle ÜZERİNE YAZILMAZ; her sürüm kendi
  // nesnesine yazar.
  const key = `criteria-analysis/${documentHashValue}/${structure.version}-${EXTRACTION_PROMPT_VERSION}-${DICTIONARY_VERSION}.json`;
  try {
    await reportBucket().put(key, JSON.stringify({
      createdAt: new Date().toISOString(),
      structureVersion: structure.version,
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

/**
 * Belge başına TEK OCR koşusu: aktarılan yapı R2'de bu anahtarla sabitlenir ve
 * sonraki yeniden analizler modele gitmeden sabit yapıyı okur. Kaynak
 * kimlikleri (sourceId) böylece OCR'li belgede de yeniden analizler arasında
 * kararlı kalır. Yalnızca `ocr=1&refresh=1` birlikte gelirse taze OCR yapılır.
 */
function ocrStructureKey(documentHashValue: string): string {
  return `criteria-analysis/${documentHashValue}/ocr-structure-${OCR_PROMPT_VERSION}.json`;
}

async function loadStoredOcrStructure(documentHashValue: string): Promise<StructuredPdf | null> {
  try {
    const stored = await reportBucket().get(ocrStructureKey(documentHashValue));
    if (!stored) return null;
    const parsed = JSON.parse(await stored.text()) as StructuredPdf;
    // Sürüm ve içerik doğrulanır; bozuk/yabancı kayıt sessizce yok sayılır ve
    // yönetici onayı yeniden istenir.
    if (parsed?.version !== PDF_STRUCTURE_OCR_VERSION || parsed.pdfHash !== documentHashValue
      || !Array.isArray(parsed.blocks) || !parsed.blocks.length) return null;
    return parsed;
  } catch (error) {
    console.error("[analyze] sabitlenmiş OCR yapısı okunamadı; OCR onayı yeniden istenecek", error);
    return null;
  }
}

async function saveOcrStructure(documentHashValue: string, structure: StructuredPdf): Promise<void> {
  try {
    await reportBucket().put(ocrStructureKey(documentHashValue), JSON.stringify(structure), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  } catch (error) {
    // Sabitleme başarısız olsa da analiz sonucu döner; D1 önbelleği nihai
    // sonucu zaten içerik özetiyle korur.
    console.error("[analyze] OCR yapısı R2'ye sabitlenemedi", error);
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

    // Gerçek bayt sınırı akış sırasında uygulanır; Content-Length eksik olsa
    // bile 200 MB'lık gövde Worker belleğine alınmaz (madde 9).
    const formData = await readFormDataWithLimit(request, MAX_MULTIPART_BYTES);
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

    const forceRefresh = String(formData.get("refresh") ?? "") === "1";
    /** OCR yalnızca yöneticinin arayüzden verdiği açık onayla (`ocr=1`) çalışır. */
    const ocrRequested = String(formData.get("ocr") ?? "") === "1";
    const docHash = await documentHash(pdfBytes);

    /*
     * METİN ÇIKARIMI — kontrollü durak + yönetici onaylı OCR yedeği.
     *
     * 1. Metin katmanı yeterliyse her şey eskisi gibidir (tek sınıflandırma çağrısı).
     * 2. Yetersizse önce R2'deki SABİTLENMİŞ OCR yapısına bakılır: varsa ek
     *    çağrı yapılmadan kullanılır (kaynak kimlikleri kararlı kalır).
     * 3. Sabit yapı yoksa ve yönetici `ocr=1` ile onayladıysa tam olarak BİR
     *    aktarım çağrısı yapılır ve çıktı R2'ye sabitlenir.
     * 4. Onay yoksa 422 OCR_REQUIRED + `ocrFallbackAvailable` döner; kararı
     *    arayüzdeki düğmeyle yönetici verir. Sunucu kendiliğinden OCR başlatmaz.
     */
    let structure: StructuredPdf;
    let ocr: OcrRunInfo = NO_OCR;
    let ocrUsage = { prompt: 0, output: 0, total: 0 };
    try {
      structure = await extractPdfStructure(pdfBytes);
    } catch (extractionError) {
      if (!(extractionError instanceof PdfTextLayerError)) throw extractionError;
      const pinned = ocrRequested && forceRefresh ? null : await loadStoredOcrStructure(docHash);
      if (pinned) {
        structure = pinned;
        ocr = { used: true, apiCalls: 0, modelMs: 0, extraWarnings: [] };
      } else if (ocrRequested) {
        const ocrOutcome = await extractPdfStructureViaOcr({
          apiKey,
          pdfBytes,
          fileName: file.name,
          pageCount: extractionError.pageCount ?? 0,
          pdfHash: extractionError.pdfHash ?? docHash,
        });
        if (!ocrOutcome.ok) {
          console.error("OCR aktarımı başarısız:", { status: ocrOutcome.status, detail: ocrOutcome.detail, apiCalls: ocrOutcome.apiCalls });
          recordUsage({ model: PRIMARY_MODEL, promptTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: Date.now() - startedAt, cached: false, error: true, apiCalls: ocrOutcome.apiCalls });
          // `retryable` yine kullanıcıya bırakılır; sunucu ikinci OCR denemez.
          return Response.json(
            { error: ocrOutcome.detail, retryable: ocrOutcome.transient, code: "OCR_FAILED", apiCalls: ocrOutcome.apiCalls },
            { status: ocrOutcome.status },
          );
        }
        structure = ocrOutcome.structure;
        ocr = { used: true, apiCalls: ocrOutcome.apiCalls, modelMs: ocrOutcome.modelMs, extraWarnings: ocrOutcome.warnings };
        ocrUsage = ocrOutcome.usage;
        await saveOcrStructure(docHash, ocrOutcome.structure);
      } else {
        return Response.json(
          { error: extractionError.message, code: "OCR_REQUIRED", ocrFallbackAvailable: true },
          { status: 422 },
        );
      }
    }
    const pageCount = structure.pageCount;
    const selection = selectCriteriaCandidates(structure.blocks);
    if (!selection.candidates.length) {
      return Response.json({
        error: "Belgede kriter adayı oluşturacak açık bir rapor kuralı bulunamadı. PDF metin katmanını ve şartname içeriğini kontrol edin.",
      }, { status: 422 });
    }

    // Aynı belge ve aynı talimat daha önce işlendiğinde modeli hiç çağırma.
    // Önbellek isabetinde `apiCalls: 0` yazılır; sayı uydurulmaz.
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
      // OCR alanları YALNIZCA OCR kullanıldığında eklenir: metin katmanlı
      // belgelerin anahtar dizgesi bayt bayt aynı kalır ve mevcut D1/bellek
      // kayıtları geçersizleşmez.
      ...(ocr.used ? { textExtraction: "gemini_ocr", ocrPromptVersion: OCR_PROMPT_VERSION } : {}),
    });
    const cacheKey = await documentHash(new TextEncoder().encode(cacheContext).buffer);
    const coverageArtifactKey = await saveCoverageArtifact(docHash, structure, selection);

    /*
     * YENİDEN ANALİZ (madde 1)
     *
     * Yarışma Yöneticisi "Yeniden analiz et" dediğinde `refresh=1` gelir:
     * bellek ve D1 kayıtları ATLANIR, model gerçekten yeniden çalışır ve
     * yeni sonuç eski kaydın üzerine yazılır. Böylece eski ama hatalı bir
     * sonuç sistemde sonsuza kadar kalamaz. (Bayrak, OCR akışı da okuduğu
     * için yukarıda, metin çıkarımından önce çözülür.)
     */
    if (forceRefresh) {
      analysisCache().delete(cacheKey);
      await deleteStoredAnalysis(cacheKey).catch((cacheError) =>
        console.error("[analyze] kalıcı analiz kaydı silinemedi", cacheError));
    }

    /**
     * Önbellek isabeti: sınıflandırma modeline gidilmez. Sayaçlar uydurulmaz:
     * bu istekte OCR aktarımı yapıldıysa (nadir: sabitleme yazılamamış ama D1
     * kaydı duruyorsa) o çağrı ve tokenları olduğu gibi yazılır; olağan yolda
     * hepsi 0'dır.
     */
    const respondFromCache = async (extraction: CachedExtraction, store: "memory" | "database") => {
      const totalMs = Date.now() - startedAt;
      recordUsage({ model: extraction.model, promptTokens: ocrUsage.prompt, outputTokens: ocrUsage.output, totalTokens: ocrUsage.total, durationMs: totalMs, cached: true, error: false, apiCalls: ocr.apiCalls });
      // Bellekten sunulan isabet kalıcı kaydın tazeliğini de işaretler; aksi
      // hâlde en sık kullanılan belge D1'de "soğuk" görünür ve satır sınırı
      // budaması tam da onu silerdi. Güncelleme başarısız olsa da yanıt döner.
      if (store === "memory") await touchStoredAnalysis(cacheKey).catch(() => undefined);
      const cachedResult = buildResult(extraction, {
        totalMs, modelMs: 0, promptTokens: ocrUsage.prompt, outputTokens: ocrUsage.output, cached: true,
        apiCalls: ocr.apiCalls, documentTransfers: ocr.apiCalls > 0 ? 1 : 0,
        cacheStore: store, firstAnalyzedAt: extraction.analyzedAt, coverageArtifactKey,
      }, structure, selection, ocr);
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
        responseJsonSchema: EXTRACTION_SCHEMA,
      },
    });

    let modelUsed = PRIMARY_MODEL;
    /**
     * Gerçekten yapılan `generateContent` isteği sayısı; tanılamaya bu yazılır.
     * OCR aktarımı yapıldıysa o çağrı da sayılır (dürüst toplam, 2 olabilir).
     */
    let apiCalls: number = ocr.apiCalls;

    const failWith = (status: number, detail: string) => {
      console.error("AI analiz isteği başarısız:", { status, detail, apiCalls });
      // Sınıflandırma düşse bile bu istekte yapılmış OCR çağrısı ve tokenları kayıttan silinmez.
      recordUsage({ model: modelUsed, promptTokens: ocrUsage.prompt, outputTokens: ocrUsage.output, totalTokens: ocrUsage.total, durationMs: Date.now() - startedAt, cached: false, error: true, apiCalls });
      const failure = describeGeminiFailure(status, detail, "AI belge analizi");
      // `retryable` istemciye "Yeniden dene" düğmesini göstermesini söyler;
      // sunucu kendiliğinden ikinci bir çağrı yapmaz.
      return Response.json(
        { error: failure.message, retryable: failure.transient, apiCalls },
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
    apiCalls = ocr.apiCalls + outcome.apiCalls;
    if (!outcome.ok) return failWith(outcome.status, outcome.detail);
    modelUsed = outcome.model;

    const responseText = extractGeminiText(outcome.payload);
    // Çıktı token tavanına takılan yanıt JSON ortasından kesilir; bunu genel
    // "JSON okunamadı" cümlesiyle maskelemek kök nedeni görünmez kılıyordu.
    const finishReason = (outcome.payload as { candidates?: Array<{ finishReason?: string }> })
      ?.candidates?.[0]?.finishReason ?? "";
    if (finishReason === "MAX_TOKENS") {
      return failWith(502, "Model çıktısı izin verilen çıktı token sınırına takılıp kesildi. Belge olağan dışı yoğun olabilir; sorun sürerse GEMINI_MODEL için daha yüksek çıktı kapasiteli bir model seçin.");
    }
    if (!responseText) return failWith(502, `Belge analizi için geçerli yapılandırılmış çıktı alınamadı${finishReason ? ` (finishReason: ${finishReason})` : ""}.`);
    let raw: RawExtraction;
    try {
      raw = JSON.parse(responseText) as RawExtraction;
    } catch {
      return failWith(502, `Belge analizi şemaya uygun JSON olarak okunamadı${finishReason ? ` (finishReason: ${finishReason})` : ""}.`);
    }
    // JSON.parse "null" gibi nesne olmayan gövdeleri de geçirir; böyle bir
    // gövde normalizasyonda patlar ve önbelleğe girerse her isteği düşürürdü.
    if (!raw || typeof raw !== "object") {
      return failWith(502, "Belge analizi şemaya uygun JSON olarak okunamadı.");
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
    // Kullanım kaydı işlem başına tektir ve dürüst toplamı taşır:
    // sınıflandırma + (varsa) OCR aktarım tokenları ve çağrı sayısı.
    recordUsage({
      model: modelUsed,
      promptTokens: usage.prompt + ocrUsage.prompt,
      outputTokens: usage.output + ocrUsage.output,
      totalTokens: usage.total + ocrUsage.total,
      durationMs: totalMs,
      cached: false,
      error: false,
      apiCalls,
    });

    const result = buildResult(extraction, {
      totalMs,
      modelMs,
      promptTokens: usage.prompt + ocrUsage.prompt,
      outputTokens: usage.output + ocrUsage.output,
      cached: false,
      uploadMs: 0,
      // Gerçek istek sayısı; "1 dedik ama 6 gönderdik" durumu yaşanmaz.
      apiCalls,
      // Sınıflandırma çağrısı PDF taşımaz; OCR aktarımı yapıldıysa belge bir kez taşınmıştır.
      documentTransfers: ocr.apiCalls > 0 ? 1 : 0,
      documentDelivery: "structured_text",
      coverageArtifactKey,
    }, structure, selection, ocr);
    await saveCriteriaExtractionRun(result, file.name, auth.account)
      .catch((historyError) => console.error("[workflow] analiz geçmişi kaydedilemedi", historyError));
    return Response.json(result);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      // Akış sınırı: Content-Length beyanı olmayan büyük gövde de 413 alır (madde 9).
      return Response.json({ error: "Gönderilen analiz isteği izin verilen boyutu aşıyor." }, { status: 413 });
    }
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
