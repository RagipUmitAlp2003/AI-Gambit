import { Buffer } from "node:buffer";
import { handleError, json, jsonError, readJson, requirePermission } from "../../../../lib/admin-guard";
import { buildMinHash, minHashSimilarity, type SimilarityFingerprint } from "../../../../lib/similarity-engine";
import {
  EXCLUSION_AUDIT_LABEL,
  SIMILARITY_EMBEDDING_DIM,
  SIMILARITY_EMBEDDING_MODEL,
  SIMILARITY_PIPELINE_VERSION,
  TEMPLATE_CHUNK_OVERLAP,
  approximateReportSimilarity,
  chunkMinHash,
  chunkPages,
  chunkStructuredBlocks,
  chunkTemplateOverlap,
  chunkTextKey,
  classifyBlocks,
  comparableWordUnion,
  isTemplateChunkHash,
  normalizePages,
  sha256Hex,
  type ExcludedBlock,
  type PeerChunk,
  type ScoredChunk,
  type SimilarityBlockInput,
  type SimilarityChunk,
  type TemplateFilter,
} from "../../../../lib/similarity-text";
import { similarityLlmEnabled, similarityMaxChunksPerDoc, similarityRuntimeLimits, similarityThresholds } from "../../../../lib/similarity-config";
import { embeddingSketch, planBatches } from "../../../../lib/similarity-candidates";
import { configuredByteLimit } from "../../../../lib/request-guard";
import {
  chunkFeatures,
  poolFeatureCounts,
  stripPoolCommonFeatures,
  type SimilarityChunkFeatures,
} from "../../../../lib/similarity-corroboration";
import {
  SIMILARITY_LLM_CLASSES,
  explainSimilarityMatches,
  type SimilarityLlmMatchInput,
} from "../../../../lib/similarity-llm";
import { PdfTextLayerError, extractPdfStructure } from "../../../../lib/pdf-structure";
import { requiredHeadingsOf } from "../../../../lib/report-prechecks";
import { embedTexts } from "../../../../lib/similarity-embedding";
import {
  deleteSimilarityRun,
  findCurrentSimilarityTemplate,
  findLatestProfileForCompetitionKey,
  findSimilarityRun,
  findStoredSimilarityChunks,
  listSimilarityChunkBatch,
  listSimilarityPeerApps,
  listSimilarityPoolStats,
  reportBucket,
  resolveSimilarityContext,
  saveAndListSimilarityFingerprints,
  saveSimilarityChunks,
  saveSimilarityChunkSketches,
  saveSimilarityResult,
  upsertSimilarityRun,
  type StoredSimilarityChunk,
} from "../../../../lib/workflow-db";
import type { PreCheck, SimilarityExclusionReason, SimilarityLevel, SimilarityMatch, SimilarityReport } from "../../../../lib/types";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/applications/{id}/similarity — katılımcı PDF analiziyle birlikte
 * çalışan hibrit benzerlik kontrolü (madde 9).
 *
 * BÜTÜNLÜK (madde 9.12): işlem YALNIZCA başvuru kimliğiyle başlatılır.
 * Karşılaştırma kapsamı istemcinin bildirdiği yarışma adına göre DEĞİL,
 * sunucunun kendisinin çözdüğü zincire göre belirlenir:
 *
 *   applicationId → competitionKey (ad + yıl + aşama) → currentSubmissionVersion
 *   → currentPdfHash → similarity fingerprint/chunks/embedding → result
 *
 * İstemcinin tarayıcıda çıkardığı sayfa metni yardımcıdır ve gönderilen
 * `pdfHash` sunucunun R2'den okuduğu GEÇERLİ PDF'in özetiyle eşleşmezse istek
 * reddedilir: başka bir belgenin metni bu başvuruya benzerlik izi yazamaz.
 *
 * İKİ KATMAN:
 *   1. MinHash (minhash-v1, mevcut motor) — kelimesi kelimesine kopyalar.
 *   2. Embedding (gemini-embedding-001 · SEMANTIC_SIMILARITY · 768) — farklı
 *      kelimelerle yazılmış benzer bölümler. Embedding başarısız olursa işlem
 *      MinHash katmanıyla tamamlanır; kriter analizi HİÇBİR koşulda etkilenmez.
 *
 * Sonuç otomatik ihlal, intihal veya ret kararı DEĞİLDİR; hakem sayaçlarına
 * ve genel karara katılmaz (madde 9.9).
 */

const MAX_PAGES_TEXT_CHARS = 2_000_000;
/** Şablon shingle nesnesi için R2 okuma tavanı; aşan nesne ŞABLONSUZ koşuya düşürür. */
const TEMPLATE_OBJECT_MAX_BYTES = 8 * 1024 * 1024;
/** Ayrıntıda gösterilen alıntı uzunluğu; rapor içeriği sınırlı tutulur. */
const QUOTE_CHARS = 220;

function quoteOf(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length <= QUOTE_CHARS ? cleaned : `${cleaned.slice(0, QUOTE_CHARS)}…`;
}

/** Katman 3'e giden alıntı (~600 karakter); ekrandaki alıntı 220 ile sınırlı kalır. */
const LLM_EXCERPT_CHARS = 600;

function excerptOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, LLM_EXCERPT_CHARS);
}

/** Parça metinlerinin saklandığı ÖZEL R2 nesnesi; yalnızca sunucu okur. */
function chunkStoreKey(applicationId: string, versionId: string): string {
  return `similarity/${applicationId}/${versionId}.json`;
}

type StoredChunkText = { index: number; page: number; section?: string; text: string };

/**
 * R2 parça nesnesi v2 (GÖREV 3 · madde 3-4): karşılaştırmaya giren parçalarla
 * birlikte AYIKLANAN içerik de gerekçesiyle saklanır — bu, "benzerlik puanına
 * katılmayan ortak/şablon içeriği" denetim kaydıdır. Ham metin D1'e yazılmaz.
 * Eski (v1) nesneler düz dizidir; okuma her iki biçimi de tanır.
 */
type ChunkStoreObject = {
  v: 2;
  pipelineVersion: string;
  templateVersion: number | null;
  source: "structure" | "pages";
  auditLabel: string;
  included: StoredChunkText[];
  excluded: Array<{ page: number; section: string; reason: string; text: string }>;
};

/** v1 (düz dizi) ve v2 (nesne) R2 parça kayıtlarını aynı biçimde okur. */
function parseChunkStore(raw: unknown): StoredChunkText[] {
  if (Array.isArray(raw)) return raw as StoredChunkText[];
  const included = (raw as Partial<ChunkStoreObject> | null)?.included;
  return Array.isArray(included) ? included : [];
}

function wordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function buildNote(input: {
  level: SimilarityLevel;
  comparedCount: number;
  approxPercent: number | null;
  closestLabel: string | null;
  method: "hybrid" | "minhash-only";
}): string {
  if (input.level === "none") {
    // Madde 7: havuz boşken tam bu cümle gösterilir; "Çalıştırılmadı" DENMEZ.
    return "Karşılaştırılabilecek başka güncel rapor henüz bulunmuyor.";
  }
  const methodNote = input.method === "minhash-only"
    ? " Semantik karşılaştırma tamamlanamadı; temel metin karşılaştırması kullanıldı."
    : "";
  const base = `Bu rapor aynı yarışmadaki ${input.comparedCount} güncel başvuruyla karşılaştırıldı.`;
  const ratio = `Şablon ve ortak ifadeler çıkarıldıktan sonra anlamlı içeriğin yaklaşık %${input.approxPercent ?? 0} kadarı `
    + `“${input.closestLabel ?? "en yakın rapor"}” raporuyla benzer bulundu.`;
  if (input.level === "high") {
    return `${base} ${ratio} `
      + `Yüksek benzerlik gösteren bölümler işaretlendi. Bu oran otomatik ihlal, intihal veya ret kararı değildir; hakem tarafından incelenmelidir.${methodNote}`;
  }
  if (input.level === "review") {
    return `${base} ${ratio} `
      + `Bu oran otomatik ihlal, intihal veya ret kararı değildir; hakem tarafından incelenmelidir.${methodNote}`;
  }
  return `${base} ${ratio} `
    + `Bu oran otomatik ihlal, intihal veya ret kararı değildir.${methodNote}`;
}

/** Geriye uyum: 3. aşama şeridinin okuduğu PreCheck kaydı. */
function buildCheck(report: SimilarityReport): PreCheck {
  const status = report.level === "none" ? "skipped"
    : report.level === "high" ? "flagged"
    : report.level === "review" ? "warning"
    : "passed";
  return {
    id: "precheck-similarity",
    kind: "similarity",
    name: "Aynı yarışma havuzunda benzerlik",
    status,
    method: "deterministic",
    detail: report.level === "none"
      ? report.note
      : `${report.comparedCount} raporla karşılaştırıldı. En yakın eşleşme: ${report.closestLabel ?? "—"} (%${report.approxPercent ?? 0}). `
        + "Bu yalnızca Hakemin incelemesi için bir işarettir; otomatik ihlal veya diskalifiye kararı verilmez.",
    evidence: [],
    // Yapılandırılmış sonuç (madde 6): oran ve takım BURADAN okunur; gösterim
    // cümlesindeki "%" hiçbir zaman geri ayrıştırılmaz ("%98'li takım adı" bozamaz).
    similarity: report.level === "none"
      ? { percent: null, closestTeam: null }
      : { percent: report.approxPercent ?? null, closestTeam: report.closestLabel },
  };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "run_ai_prescreen");
  if (!auth.ok) return auth.response;
  try {
    // Eşikler: ortam değişkeniyle kalibre edilebilir başlangıç değerleri (madde 6).
    const thresholds = similarityThresholds();
    /*
     * BOYUT KAPISI (madde 9): gerçek baytlar AKIŞ sırasında sayılır ve sınır
     * JSON ayrıştırmasından ÖNCE uygulanır (readJson → readBodyWithLimit).
     * Content-Length beyanı olmayan istek otomatik güvenli sayılmaz; 8 MB tavan
     * 2 milyon karakterlik sayfa metninin UTF-8/JSON kaçışlı hâline bol pay
     * bırakır ve ortam değişkeniyle ayarlanabilir (kullanıcı kararı).
     */
    const body = await readJson(request, configuredByteLimit("SIMILARITY_MAX_BODY_BYTES", 8 * 1024 * 1024));
    // Sayfa metinleri: benzerlik parçaları sayfa konumu kaybolmadan üretilir.
    const rawPages = Array.isArray(body.pages)
      ? (body.pages as unknown[]).slice(0, 1000).map((page) => typeof page === "string" ? page : "")
      : typeof body.text === "string" ? [body.text] : null;
    if (!rawPages || rawPages.join("").trim().length < 100) {
      return jsonError(400, "Benzerlik analizi için rapordan yeterli metin çıkarılamadı.");
    }
    if (rawPages.join("").length > MAX_PAGES_TEXT_CHARS) {
      return jsonError(413, "Benzerlik analizi metni izin verilen sınırı aşıyor.");
    }
    const claimedPdfHash = typeof body.pdfHash === "string" ? body.pdfHash.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{64}$/.test(claimedPdfHash)) {
      return jsonError(400, "Benzerlik isteği, analiz edilen PDF'in SHA-256 özetini taşımalıdır.");
    }

    const applicationId = (await context.params).id;
    const resolved = await resolveSimilarityContext(applicationId, auth.account);
    if (resolved === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    if (resolved === "forbidden") return jsonError(403, "Bu başvurunun benzerlik analizine erişiminiz yok.");

    /*
     * PDF BAĞLAMA (madde 9.12): istemcinin çıkardığı metnin, başvurunun R2'deki
     * GEÇERLİ PDF sürümünden geldiği doğrulanır. Özet uyuşmazsa katılımcı yeni
     * sürüm yüklemiş ya da istemci başka bir belge okumuş demektir; sonuç
     * reddedilir ve hiçbir iz yazılmaz.
     */
    const object = await reportBucket().get(resolved.fileKey);
    if (!object) return jsonError(409, "Başvurunun geçerli PDF sürümü saklama alanında bulunamadı.");
    const bytes = await object.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const serverPdfHash = Buffer.from(digest).toString("hex");
    if (serverPdfHash !== claimedPdfHash) {
      return jsonError(409,
        "Benzerlik metni bu başvurunun geçerli PDF sürümüne ait değil; katılımcı yeni sürüm yüklemiş olabilir. Analizi yenileyin.");
    }

    /*
     * 1) Resmî şablon filtresi (madde 3): yüklü şablon varsa R2'deki
     * metin/shingle nesnesi okunur. Şablon okunamazsa koşu ŞABLONSUZ devam
     * eder (çoğunluk sezgisi devrede kalır); hiçbir benzerlik analizi şablon
     * yüzünden düşmez.
     */
    let templateFilter: TemplateFilter | null = null;
    try {
      const template = await findCurrentSimilarityTemplate(resolved.competitionKey);
      if (template) {
        const templateObject = await reportBucket().get(template.textKey);
        // BOYUT KAPISI: beklenmedik büyüklükte şablon nesnesi Worker belleğini
        // dolduramaz; koşu mevcut uyarı yoluyla ŞABLONSUZ devam eder (madde 8).
        if (templateObject && templateObject.size > TEMPLATE_OBJECT_MAX_BYTES) {
          console.error("[similarity] resmî şablon nesnesi boyut tavanını aşıyor; şablonsuz devam ediliyor",
            { size: templateObject.size, cap: TEMPLATE_OBJECT_MAX_BYTES });
        } else if (templateObject) {
          const parsed = JSON.parse(await templateObject.text()) as {
            foldedLines?: unknown[]; shingles?: unknown[];
          };
          templateFilter = {
            version: template.version,
            foldedLines: new Set((parsed.foldedLines ?? []).filter((line): line is string => typeof line === "string")),
            shingles: new Set((parsed.shingles ?? []).filter((value): value is number => Number.isFinite(value))),
          };
        }
      }
    } catch (templateError) {
      console.error("[similarity] resmî şablon okunamadı; şablonsuz devam ediliyor", templateError);
    }
    const templateVersion = templateFilter?.version ?? null;

    /*
     * 2) ÖNBELLEK ÖNCE (CPU koruması): aynı sürüm + özet + boru hattı için
     * parça kayıtları varsa yapısal ayrıştırma ve parçalama TAMAMEN atlanır.
     * Önbellek anahtarına ŞABLON SÜRÜMÜ GİRMEZ (kullanıcı kararı): şablon
     * değişimi ücretli embedding'i tekrarlatmaz; parça şablon işaretleri
     * aşağıda güncel şablonla YENİDEN hesaplanır, gerekirse yalnızca damga
     * yenilenir.
     *
     * Eski (0005 öncesi) başvurularda current_version_id boş olabilir; sabit
     * "v1" yedeği farklı başvuruların parça anahtarlarını ÇAKIŞTIRIRDI. Yedek
     * başvuru kimliğiyle nitelenir ve her başvuru için benzersiz kalır.
     */
    const versionId = resolved.submissionVersionId ?? `eski-${applicationId}`;
    const cached = await findStoredSimilarityChunks({
      submissionVersionId: versionId,
      pdfHash: serverPdfHash,
      embeddingModel: SIMILARITY_EMBEDDING_MODEL,
      pipelineVersion: SIMILARITY_PIPELINE_VERSION,
    });

    let chunks: SimilarityChunk[] = [];
    let excluded: ExcludedBlock[] = [];
    let structureSource: "structure" | "pages" = "structure";
    let textHashes: string[] = [];
    let cacheValid = false;
    let cachedTemplateVersion: number | null = null;
    if (cached?.length) {
      // Parça metinleri kendi R2 nesnesinden geri okunur: alıntılar ve şablon
      // örtüşme işaretleri metin ister. Nesne bozuksa önbellek geçersiz sayılır.
      try {
        const ownObject = await reportBucket().get(chunkStoreKey(applicationId, versionId));
        if (ownObject) {
          const parsed = JSON.parse(await ownObject.text()) as Partial<ChunkStoreObject> | StoredChunkText[];
          if (!Array.isArray(parsed) && parsed.v === 2
            && parsed.pipelineVersion === SIMILARITY_PIPELINE_VERSION
            && Array.isArray(parsed.included) && parsed.included.length === cached.length) {
            chunks = cached.map((row, index) => ({
              index: row.chunkIndex,
              pageStart: row.pageStart,
              pageEnd: row.pageEnd,
              section: row.section,
              wordCount: row.wordCount,
              text: parsed.included![index].text,
              // Eski satırda konum yoktur (null): oran hesabı ayrık aralık
              // varsayımına döner, sonuç asla şişmez.
              wordStart: row.wordStart,
              blockStart: row.blockStart,
              blockEnd: row.blockEnd,
              kind: row.kind,
            }));
            excluded = (parsed.excluded ?? []) as ExcludedBlock[];
            structureSource = parsed.source === "pages" ? "pages" : "structure";
            textHashes = cached.map((row) => row.textHash);
            cachedTemplateVersion = cached[0]?.templateVersion ?? null;
            cacheValid = true;
          }
        }
      } catch (cacheReadError) {
        console.error("[similarity] önbellek parça metni okunamadı; parçalar yeniden üretilecek", cacheReadError);
      }
    }

    if (!cacheValid) {
      /*
       * 3) Yapısal ayrıştırma (madde 4): sunucu, R2'den doğruladığı PDF
       * baytlarını KENDİSİ ayrıştırır; başlık/paragraf/liste/tablo satırı/şekil
       * açıklaması temelli bloklar üretir. Taranmış PDF'te (PdfTextLayerError)
       * OCR ÇAĞRILMAZ (benzerlik için ücretli yol yoktur); istemcinin sayfa
       * metinleriyle çalışan yedek yol devreye girer.
       */
      let structuredBlocks: SimilarityBlockInput[] | null = null;
      try {
        const structured = await extractPdfStructure(bytes);
        structuredBlocks = structured.blocks.map((block, ordinal) => ({
          page: block.pageNumber,
          sectionTitle: block.sectionTitle,
          subsectionTitle: block.subsectionTitle,
          blockType: block.blockType,
          text: block.originalText,
          ordinal,
        }));
      } catch (structureError) {
        if (!(structureError instanceof PdfTextLayerError)) throw structureError;
        structuredBlocks = null;
      }
      if (structuredBlocks) {
        // Şartname aktarmaları ve zorunlu başlıklar yayımlı profilden gelir;
        // profil yoksa bu filtreler boş çalışır (aşırı ayıklama yapılmaz).
        let sartnameQuotes: string[] = [];
        let mandatoryHeadings: string[] = [];
        try {
          const profile = await findLatestProfileForCompetitionKey(resolved.competitionKey);
          if (profile) {
            sartnameQuotes = profile.profile.criteria
              .map((criterion) => criterion.sourceText)
              .filter((text) => typeof text === "string" && text.trim().length > 0);
            mandatoryHeadings = requiredHeadingsOf(profile.profile);
          }
        } catch (profileError) {
          console.error("[similarity] profil okunamadı; şartname filtresi boş çalışıyor", profileError);
        }
        const classified = classifyBlocks(structuredBlocks, {
          competitionName: resolved.competitionName,
          participantNames: resolved.participantNames,
          sartnameQuotes,
          mandatoryHeadings,
          templateFilter,
        });
        // Parça tavanı (madde 8): tavanı aşan kuyruk "tavan" gerekçesiyle
        // dropped[] içine düşer ve aşağıda excluded ile birlikte hem rapora
        // (excludedWords) hem R2 denetim nesnesine yazılır — asla sessiz değil.
        const structuredChunks = chunkStructuredBlocks(classified.included, similarityMaxChunksPerDoc());
        chunks = structuredChunks.chunks;
        excluded = [...classified.excluded, ...structuredChunks.dropped];
        structureSource = "structure";
      } else {
        // YEDEK yol: istemcinin çıkardığı sayfa metinleri, mevcut temizlik ve
        // sabit pencereli parçalama ile (geriye uyum; sonuç "pages" etiketlenir).
        const cleanedPages = normalizePages(rawPages, {
          competitionName: resolved.competitionName,
          participantNames: resolved.participantNames,
        });
        chunks = chunkPages(cleanedPages);
        excluded = [];
        structureSource = "pages";
      }
      textHashes = await Promise.all(chunks.map((chunk) => sha256Hex(chunkTextKey(chunk.text))));
    }

    /* 4) MinHash katmanı (mevcut motor, belge düzeyi) korunur; belge izi
     * KARŞILAŞTIRILABİLİR (ayıklama sonrası) metinden üretilir. */
    const comparableText = chunks.map((chunk) => chunk.text).join("\n");
    const docMinHash = buildMinHash(comparableText);

    /*
     * 4a) KATMAN 1 KAPISI (madde 5): normalizasyon/ayıklama sonrası boş kalan
     * metin MinHash havuzuna ALINMAZ. Sıfır shingle üreten bir imza havuzda
     * dursaydı başka boş raporlarla %100 eşleşme uydururdu; ayrıca embedding
     * ÜCRETİ boş belge için ödenmez. Sonuç "karşılaştırılabilir içerik yok"
     * olarak yapılandırılmış alanlarla kaydedilir; havuza hiçbir iz (D1 parça
     * satırı / MinHash parmak izi) yazılmaz — yalnızca R2 denetim kaydı saklanır.
     */
    if (!chunks.length || docMinHash.tokenCount < thresholds.minComparableWords) {
      const analyzedAtEmpty = new Date().toISOString();
      const excludedWordsEmpty: Partial<Record<SimilarityExclusionReason, number>> = {};
      for (const block of excluded) {
        const reason = block.reason as SimilarityExclusionReason;
        excludedWordsEmpty[reason] = (excludedWordsEmpty[reason] ?? 0) + wordsIn(block.text);
      }
      /*
       * DENETİM KAYDI (madde 12 · durum 11): her şey ayıklandığında bile
       * "benzerlik puanına katılmayan ortak/şablon içeriği" METİNLERİYLE
       * saklanmak zorundadır — en ayıklama-yoğun durum kayıtsız kalamaz.
       * Yalnızca R2 denetim nesnesi yazılır (sıfır parça); D1 parça satırı ve
       * MinHash parmak izi YAZILMAZ: boş belge havuzu zehirleyemez.
       */
      const emptyAudit: ChunkStoreObject = {
        v: 2,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION,
        templateVersion,
        source: structureSource,
        auditLabel: EXCLUSION_AUDIT_LABEL,
        included: [],
        excluded: excluded.map((block) => ({
          page: block.page, section: block.section, reason: block.reason, text: block.text,
        })),
      };
      await reportBucket().put(chunkStoreKey(applicationId, versionId), JSON.stringify(emptyAudit), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { applicationId, kind: "similarity-chunks" },
      }).catch((auditError: unknown) => console.error("[similarity] ayıklama denetim kaydı R2'ye yazılamadı", auditError));
      const report: SimilarityReport = {
        level: "none", comparedCount: 0, approxPercent: null, closestLabel: null,
        method: "minhash-only",
        note: "Şablon ve kimlik temizliği sonrası raporda karşılaştırılabilir özgün içerik kalmadı; benzerlik oranı hesaplanmadı.",
        matches: [], analyzedAt: analyzedAtEmpty,
        comparableWords: comparableWordUnion(chunks),
        noComparableContent: true,
        excludedWords: excludedWordsEmpty,
        structureSource,
        templateVersion,
        llmStatus: "skipped",
      };
      await saveSimilarityResult({
        applicationId, submissionVersionId: resolved.submissionVersionId, pdfHash: serverPdfHash,
        competitionKey: resolved.competitionKey,
        embeddingModel: null, embeddingDim: null,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION, status: "skipped",
        approxPercent: null, closestApplicationId: null, closestLabel: null,
        templateVersion,
        reportJson: JSON.stringify(report),
      });
      return json({ similarity: report, check: buildCheck(report), embeddingApiCalls: 0 });
    }
    const fingerprint: SimilarityFingerprint = { ...docMinHash, embedding: null, embeddingModel: null };
    const peersDoc = await saveAndListSimilarityFingerprints(applicationId, auth.account, fingerprint);
    if (peersDoc === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    if (peersDoc === "forbidden") return jsonError(403, "Bu başvurunun benzerlik analizine erişiminiz yok.");

    /* 5) Embedding önbelleği (madde 9.6–9.7). */
    let embeddings: (number[] | null)[] = chunks.map(() => null);
    let embeddingFailed = false;
    let embeddingRateLimited = false;
    let embeddingApiCalls = 0;
    let freshEmbeddings = false;
    /*
     * MALİYET KAPISI: `skipEmbedding` yalnızca test/geliştirme koşuları
     * içindir (ör. tools/e2e_scenario.mjs ücretli Gemini çağrısı YAPMAZ) ve
     * yalnızca YENİ API çağrısını engeller: geçerli önbellekteki embeddingler
     * ücretsiz olduğu için yine kullanılır ve ASLA silinmez. Embedding'siz
     * sonuç "minhash-only" olarak işaretlenir; hiçbir sonuç olduğundan daha
     * güçlü sunulmaz.
     */
    const skipEmbedding = body.skipEmbedding === true;
    const apiKey = skipEmbedding ? undefined : process.env.GEMINI_API_KEY;
    if (cacheValid && cached!.every((row) => row.embedding)) {
      // Aynı PDF için embedding yalnızca BİR KEZ üretilir; API yeniden çağrılmaz.
      embeddings = cached!.map((row) => row.embedding);
    } else if (apiKey && chunks.length) {
      const outcome = await embedTexts(apiKey, chunks.map((chunk) => chunk.text));
      embeddingApiCalls = outcome.apiCalls;
      if (outcome.ok) {
        embeddings = outcome.embeddings;
        freshEmbeddings = true;
      } else {
        embeddingFailed = true;
        embeddingRateLimited = outcome.rateLimited;
        console.error("[similarity] embedding üretilemedi", { status: outcome.status, detail: outcome.detail });
      }
    } else {
      embeddingFailed = true;
    }

    // MinHash izleri: önbellek geçerliyse kayıttan, değilse metinden üretilir.
    const ownMinHashes = cacheValid
      ? cached!.map((row) => row.minHash)
      : chunks.map((chunk) => chunkMinHash(chunk.text));

    // Doğrulama özellikleri (madde 5 · Katman 2): parça metni her koşuda elde
    // olduğu için saf işlevle üretilir; eşlerin okuyabilmesi için D1'e yazılır.
    const ownFeatures: SimilarityChunkFeatures[] = chunks.map((chunk) => chunkFeatures(chunk.text));

    // İşaret izleri (madde 8 · CPU koruması): vektörden YEREL üretilir, API
    // çağrısı gerektirmez; kosinüs yalnızca iz uzaklığı geçen adaylara uygulanır.
    const ownSketches: (string | null)[] = embeddings.map((embedding) => embeddingSketch(embedding));

    // Parça düzeyi şablon işareti: yüklü şablonla shingle örtüşmesi YETKİLİ
    // sinyaldir ve her koşuda GÜNCEL şablonla hesaplanır. Parça silinmez;
    // yalnızca karşılaştırma dışı işaretlenir (denetim: EXCLUSION_AUDIT_LABEL).
    const ownTemplateFlags = chunks.map((chunk) =>
      templateFilter ? chunkTemplateOverlap(chunk.text, templateFilter.shingles) >= TEMPLATE_CHUNK_OVERLAP : false);

    /*
     * 6) Parçalar D1'e (embedding önbelleği), metinler + ayıklanan içerik özel
     * R2 nesnesine yazılır. GEÇERLİ önbellek gereksiz yere yeniden yazılMAZ
     * (aksi hâlde embedding'siz bir koşu kayıtlı vektörleri yok ederdi);
     * yalnızca metin değiştiğinde, yeni embedding üretildiğinde ya da şablon
     * sürümü damgası eskidiğinde tazelenir. Damga yenilemede kayıtlı vektörler
     * satır satır KORUNUR.
     */
    const templateStampChanged = cacheValid && cachedTemplateVersion !== templateVersion;
    if (!cacheValid || freshEmbeddings || templateStampChanged) {
      const persistEmbeddings = cacheValid && !freshEmbeddings
        ? cached!.map((row) => row.embedding)
        : embeddings;
      const storedChunks: StoredSimilarityChunk[] = chunks.map((chunk, index) => ({
        chunkIndex: chunk.index,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        section: chunk.section,
        wordCount: chunk.wordCount,
        textHash: textHashes[index],
        minHash: ownMinHashes[index],
        embedding: persistEmbeddings[index],
        blockStart: chunk.blockStart,
        blockEnd: chunk.blockEnd,
        kind: chunk.kind,
        isTemplate: ownTemplateFlags[index],
        templateVersion,
        wordStart: chunk.wordStart,
        features: ownFeatures[index],
        sketch: ownSketches[index] ?? (cacheValid ? cached![index]?.sketch ?? null : null),
      }));
      await saveSimilarityChunks({
        applicationId,
        submissionVersionId: versionId,
        competitionKey: resolved.competitionKey,
        pdfHash: serverPdfHash,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION,
        embeddingModel: SIMILARITY_EMBEDDING_MODEL,
        embeddingDim: SIMILARITY_EMBEDDING_DIM,
        templateVersion,
        chunks: storedChunks,
      });
      const chunkStoreObject: ChunkStoreObject = {
        v: 2,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION,
        templateVersion,
        source: structureSource,
        auditLabel: EXCLUSION_AUDIT_LABEL,
        included: chunks.map((chunk) => ({
          index: chunk.index, page: chunk.pageStart, section: chunk.section, text: chunk.text,
        })),
        excluded: excluded.map((block) => ({
          page: block.page, section: block.section, reason: block.reason, text: block.text,
        })),
      };
      await reportBucket().put(chunkStoreKey(applicationId, versionId), JSON.stringify(chunkStoreObject), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { applicationId, kind: "similarity-chunks" },
      }).catch((storeError: unknown) => console.error("[similarity] parça metni R2'ye yazılamadı", storeError));
    } else {
      // GEÇERLİ önbellek yeniden yazılmadı; eksik işaret izleri satır satır
      // tamamlanır (yalnızca embedding_sketch dolar, vektörlere DOKUNULMAZ).
      const missingSketches = cached!.flatMap((row, index) =>
        !row.sketch && row.rowId && ownSketches[index] ? [{ rowId: row.rowId, sketch: ownSketches[index]! }] : []);
      if (missingSketches.length) {
        await saveSimilarityChunkSketches(missingSketches)
          .catch((sketchError: unknown) => console.error("[similarity] işaret izi geri yazılamadı", sketchError));
      }
    }

    // Denetim toplamları (madde 3): ayıklanan içerik gerekçe bazında sayılır.
    const excludedWords: Partial<Record<SimilarityExclusionReason, number>> = {};
    for (const block of excluded) {
      const reason = block.reason as SimilarityExclusionReason;
      excludedWords[reason] = (excludedWords[reason] ?? 0) + wordsIn(block.text);
    }
    for (const [index, flagged] of ownTemplateFlags.entries()) {
      if (flagged) excludedWords.sablon = (excludedWords.sablon ?? 0) + chunks[index].wordCount;
    }

    /*
     * RAPOR NOTU EKLERİ — hiçbir kısıt sessiz kalmaz:
     *   - Parça tavanı kesmesi (madde 8): tavanı aşan kuyruk karşılaştırma
     *     dışı kaldıysa hakem bunu kartta okur (denetim kaydı R2'de durur).
     *   - ŞABLON DÜRÜSTLÜĞÜ: önbellekteki parçalar ESKİ şablon sürümüyle
     *     üretildiyse şablon değişikliği yalnızca parça düzeyinde (shingle
     *     işaretleri) uygulanmıştır; blok düzeyi ayıklama ancak raporun
     *     yeniden analizinde tam uygulanır. Sonuç bu sınırı açıkça söyler
     *     (templateStampChanged yukarıda, damga yenileme kararında hesaplanır).
     */
    const noteSuffix = (excludedWords.tavan
      ? " Rapor olağandışı uzunlukta: parça tavanını aşan bölümler karşılaştırma dışı kaldı ve denetim kaydında saklandı."
      : "")
      + (templateStampChanged
        ? " Şablon değişikliği parça düzeyinde uygulandı; blok düzeyi ayıklama raporun yeniden analizinde tam uygulanır."
        : "");

    /*
     * 7) Havuz: aynı yarışma anahtarındaki diğer GÜNCEL başvurular (madde 8-9.2).
     *
     * İki katman birlikte kullanılır:
     *   - Parça (chunk) katmanı: bu dağıtımdan sonra analiz edilen eşler.
     *   - Belge düzeyi MinHash havuzu (submission_fingerprints): parça kaydı
     *     HENÜZ olmayan eski eşler de karşılaştırma DIŞI kalmaz (geriye uyum);
     *     onlar için yalnızca belge düzeyi doğrudan benzerlik ölçülür. Havuz
     *     üst sınırını aşan eşler de bu ucuz katmanla ölçülür.
     *
     * CPU KORUMASI (madde 8): havuz üst sınırı + parti döngüsü + süre bütçesi.
     * Bütçe dolarsa ilerleme `similarity_runs` satırına yazılır ve istemci aynı
     * koşuyu `resumeRunId` ile sürdürür; ödenen embedding maliyeti yukarıda
     * ZATEN kalıcı olduğu için hiçbir kesinti sonucu kaybettirmez.
     */
    const limits = similarityRuntimeLimits();
    const requestStartedAt = Date.now();

    // Yarım kalan koşu: kimliği, PDF özeti ve boru hattı uymayan koşu yok sayılır.
    const resumeRequestId = typeof body.resumeRunId === "string" ? body.resumeRunId.trim() : "";
    let run = resumeRequestId ? await findSimilarityRun(applicationId) : null;
    if (run && (run.id !== resumeRequestId || run.pdfHash !== serverPdfHash
      || run.pipelineVersion !== SIMILARITY_PIPELINE_VERSION
      || run.competitionKey !== resolved.competitionKey)) {
      run = null;
    }
    // Taze analiz eski koşuyu geçersiz kılar (yeni sonuç her zaman baştan kurulur).
    if (!run) await deleteSimilarityRun(applicationId).catch(() => undefined);

    // Eş künyeleri: kararlı application_id sırası, üst sınır + 1 (kesilme tespiti).
    const peerApps = await listSimilarityPeerApps(
      resolved.competitionKey, applicationId, resolved.participantId,
      SIMILARITY_PIPELINE_VERSION, limits.poolMaxApps + 1,
    );
    const poolTruncated = (run?.poolTruncated ?? false) || peerApps.length > limits.poolMaxApps;
    const pool = peerApps.slice(0, limits.poolMaxApps);
    const poolIds = new Set(pool.map((peer) => peer.applicationId));
    const fingerprintOnlyPeers = peersDoc.filter((entry) => !poolIds.has(entry.applicationId));
    const comparedCount = pool.length + fingerprintOnlyPeers.length;
    const analyzedAt = new Date().toISOString();
    const method: "hybrid" | "minhash-only" = embeddingFailed ? "minhash-only" : "hybrid";

    if (!comparedCount) {
      const report: SimilarityReport = {
        level: "none", comparedCount: 0, approxPercent: null, closestLabel: null,
        method, note: buildNote({ level: "none", comparedCount: 0, approxPercent: null, closestLabel: null, method }) + noteSuffix,
        matches: [], analyzedAt,
        comparableWords: comparableWordUnion(chunks.filter((_, index) => !ownTemplateFlags[index])),
        excludedWords,
        structureSource,
        templateVersion,
      };
      await saveSimilarityResult({
        applicationId, submissionVersionId: resolved.submissionVersionId, pdfHash: serverPdfHash,
        competitionKey: resolved.competitionKey,
        embeddingModel: embeddingFailed ? null : SIMILARITY_EMBEDDING_MODEL,
        embeddingDim: embeddingFailed ? null : SIMILARITY_EMBEDDING_DIM,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION, status: "skipped",
        approxPercent: null, closestApplicationId: null, closestLabel: null,
        templateVersion,
        reportJson: JSON.stringify(report),
      });
      return json({ similarity: report, check: buildCheck(report), embeddingApiCalls });
    }

    /*
     * 8) Havuz istatistik geçişi (madde 3 ve 9.4): Resmî şablon parçaları
     * karşılaştırma dışıdır; İKİ sinyal OR'lanır — (a) yüklü şablonla shingle
     * örtüşmesi (yetkili sinyal, yukarıda hesaplandı), (b) parça özetinin
     * havuzdaki başvuruların yarısından fazlasında birebir bulunması (çoğunluk
     * sezgisi; şablon yüklenmemiş havuzların yedeği). Salt ortak başlık/şablon
     * paylaşan raporlar yüksek benzerlik almaz; parçalar SİLİNMEZ, yalnızca
     * işaretlenir (denetim). Sayımlar embedding YÜKLENMEDEN, META geçişiyle
     * üretilir (madde 8 · bellek koruması).
     */
    const poolStats = await listSimilarityPoolStats(
      pool.map((peer) => peer.applicationId), SIMILARITY_PIPELINE_VERSION,
    );
    const hashSeenIn = new Map<string, number>();
    for (const stats of poolStats.values()) {
      const unique = new Set(stats.map((chunk) => chunk.textHash));
      for (const hash of unique) hashSeenIn.set(hash, (hashSeenIn.get(hash) ?? 0) + 1);
    }
    const poolSize = pool.length + 1;
    // Havuz-ortak özellik süzgeci (madde 5 · Katman 2): havuzun yarısından
    // fazlasında görülen nadir terim/sayı ortak dildir (şablon/şartname/tür
    // ölçüsü) ve anlamsal eşleşmeye doğrulama desteği OLAMAZ. Sayım
    // isTemplateChunkHash ile AYNI kuraldadır: yalnızca EŞ başvurular sayılır
    // (aksi hâlde iki raporluk küçük havuzda paylaşılan her özellik "ortak"
    // sayılır ve doğrulama sinyali hiç çalışamazdı).
    const featureCounts = poolFeatureCounts(
      [...poolStats.values()].map((stats) => stats.map((chunk) => chunk.features)),
    );
    const ownScored: ScoredChunk[] = chunks.map((chunk, index) => ({
      index: chunk.index,
      wordCount: chunk.wordCount,
      pageStart: chunk.pageStart,
      text: chunk.text,
      minHash: ownMinHashes[index],
      embedding: embeddings[index],
      template: ownTemplateFlags[index] || isTemplateChunkHash(textHashes[index], hashSeenIn, poolSize),
      wordStart: chunk.wordStart,
      features: stripPoolCommonFeatures(ownFeatures[index], featureCounts, poolSize),
      sketch: ownSketches[index] ?? (cacheValid ? cached![index]?.sketch ?? null : null),
    }));

    /*
     * 9) PARTİ DÖNGÜSÜ (madde 8): rapor düzeyi yaklaşık oran kapsamaya dayalıdır,
     * ham cosine değil (madde 9.8). Anlamsal adaylar doğrulama kapısından
     * (madde 5 · Katman 2) geçmek zorundadır; kapsama, kelime aralığı
     * birleşimiyle çift sayım yapılmadan ölçülür (madde 6). Eşler kontrollü
     * partilerle taranır; süre bütçesi dolarsa ilerleme koşu satırına yazılır
     * ve istemci `resumeRunId` ile sürdürür.
     */
    type BestPeerState = {
      applicationId: string;
      percent: number;
      matches: ReturnType<typeof approximateReportSimilarity>["matches"];
      matchedWords: number;
    };
    let best: BestPeerState | null = null;
    if (run) {
      try {
        const parsed = JSON.parse(run.bestJson) as BestPeerState | null;
        if (parsed && typeof parsed.applicationId === "string" && Array.isArray(parsed.matches)
          && poolIds.has(parsed.applicationId)) {
          best = parsed;
        }
      } catch { /* Bozuk koşu durumu: en iyi eş sıfırdan aranır. */ }
    }
    let reportComparableWords: number | null = null;
    let processed = run?.processedPeers ?? 0;
    const totalPeers = Math.max(run?.totalPeers ?? 0, pool.length);
    let cursor = run?.cursorApplicationId ?? "";
    const remaining = cursor ? pool.filter((peer) => peer.applicationId > cursor) : [...pool];
    const runId = run?.id ?? crypto.randomUUID();
    let budgetExhausted = false;

    const batches = planBatches(remaining, limits.peerBatchApps);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const batchChunks = await listSimilarityChunkBatch(
        resolved.competitionKey, batch.map((peer) => peer.applicationId), SIMILARITY_PIPELINE_VERSION,
      );
      const chunksByApp = new Map(batchChunks.map((peer) => [peer.applicationId, peer] as const));
      const sketchBackfill: Array<{ rowId: string; sketch: string }> = [];
      for (const peerApp of batch) {
        cursor = peerApp.applicationId;
        processed += 1;
        const peer = chunksByApp.get(peerApp.applicationId);
        if (!peer) continue; // Eş bu arada arşivlenmiş/yenilenmiş olabilir.
        const peerChunks: PeerChunk[] = peer.chunks.map((chunk) => {
          // Eksik işaret izi kayıtlı vektörden ÜCRETSİZ üretilir ve geri yazılır.
          let sketch = chunk.sketch;
          if (!sketch && chunk.embedding) {
            sketch = embeddingSketch(chunk.embedding);
            if (sketch && chunk.rowId) sketchBackfill.push({ rowId: chunk.rowId, sketch });
          }
          return {
            index: chunk.chunkIndex,
            wordCount: chunk.wordCount,
            pageStart: chunk.pageStart,
            minHash: chunk.minHash,
            embedding: embeddingFailed ? null : chunk.embedding,
            // Eşin kendi koşusunda damgalanan şablon işareti + çoğunluk sezgisi:
            // eş, şablon güncellemesinden sonra yeniden analiz edilene kadar
            // kayıtlı işaretiyle katılır (metni okunmadan yeniden hesaplanamaz).
            template: chunk.isTemplate || isTemplateChunkHash(chunk.textHash, hashSeenIn, poolSize),
            wordStart: chunk.wordStart,
            features: stripPoolCommonFeatures(chunk.features, featureCounts, poolSize),
            sketch,
          };
        });
        const result = approximateReportSimilarity(ownScored, peerChunks, thresholds);
        // Payda (karşılaştırılabilir özgün içerik) kendi rapora aittir; her eşte aynıdır.
        reportComparableWords = result.comparableWords;
        if (!best || result.approxPercent > best.percent) {
          best = {
            applicationId: peer.applicationId,
            percent: result.approxPercent,
            matches: result.matches,
            matchedWords: result.matchedWords,
          };
        }
      }
      if (sketchBackfill.length) {
        await saveSimilarityChunkSketches(sketchBackfill)
          .catch((sketchError: unknown) => console.error("[similarity] eş işaret izi geri yazılamadı", sketchError));
      }
      // Bütçe kontrolü PARTİLER ARASINDA yapılır: yarım parti yazılmaz.
      if (batchIndex + 1 < batches.length && Date.now() - requestStartedAt > limits.timeBudgetMs) {
        budgetExhausted = true;
        break;
      }
    }

    if (budgetExhausted) {
      /*
       * Süre bütçesi doldu (madde 8): ilerleme kalıcılaştırılır ve istemciye
       * "partial" döner. Embedding maliyeti yukarıda ZATEN ödendi ve kalıcı;
       * bu dönüş HİÇBİR sonucu kaybettirmez, yalnızca taramayı erteler.
       */
      await upsertSimilarityRun({
        id: runId,
        applicationId,
        pdfHash: serverPdfHash,
        competitionKey: resolved.competitionKey,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION,
        cursorApplicationId: cursor,
        processedPeers: processed,
        totalPeers,
        poolTruncated,
        bestJson: JSON.stringify(best),
      });
      return json({
        status: "partial",
        resumeRunId: runId,
        progress: { processed, total: totalPeers },
        embeddingApiCalls,
        ...(embeddingRateLimited ? { embeddingRateLimited: true } : {}),
      });
    }
    if (run) await deleteSimilarityRun(applicationId).catch(() => undefined);

    // En iyi eşin künyesi ve belge düzeyi izi (seviye yükseltme sinyali).
    const bestPeerApp = best ? pool.find((peer) => peer.applicationId === best!.applicationId) ?? null : null;
    const bestDocLexical = best
      ? (() => {
        const docPeer = peersDoc.find((entry) => entry.applicationId === best!.applicationId);
        return docPeer ? minHashSimilarity(docMinHash.signature, docPeer.fingerprint.signature) : 0;
      })()
      : 0;

    // Parça kaydı olmayan eski eşler: yalnızca belge düzeyi doğrudan benzerlik.
    let bestFingerprintOnly: { applicationId: string; label: string; lexical: number } | null = null;
    for (const entry of fingerprintOnlyPeers) {
      const lexical = minHashSimilarity(docMinHash.signature, entry.fingerprint.signature);
      if (!bestFingerprintOnly || lexical > bestFingerprintOnly.lexical) {
        bestFingerprintOnly = { applicationId: entry.applicationId, label: entry.participantLabel, lexical };
      }
    }

    /*
     * SEVİYE:
     *   - Parça katmanında kapsama oranı esas alınır. Belge düzeyi MinHash
     *     yalnızca ŞABLON DIŞI en az bir parça eşleşmesi varken seviyeyi
     *     yükseltebilir; salt resmî şablonu paylaşan raporlar belge düzeyi
     *     benzerlik yüksek diye işaretlenMEZ (madde 9.4).
     *   - Parça kaydı olmayan eski eşlerde şablon bilgisi yoktur; onlar için
     *     belge düzeyi doğrudan benzerlik olduğu gibi kullanılır (geriye uyum).
     */
    const chunkPercent = best?.percent ?? 0;
    const chunkHasMatches = (best?.matches.length ?? 0) > 0;
    const fingerprintPercent = bestFingerprintOnly ? Math.round(bestFingerprintOnly.lexical * 100) : 0;
    const fingerprintWins = fingerprintPercent > chunkPercent;
    const percent = Math.max(chunkPercent, fingerprintPercent);
    const docEscalation = chunkHasMatches ? bestDocLexical : (bestFingerprintOnly?.lexical ?? 0);
    const level: SimilarityLevel = percent >= thresholds.reportHighPercent || docEscalation >= thresholds.directHigh
      ? "high"
      : percent >= thresholds.reportReviewPercent || docEscalation >= thresholds.directReview
        ? "review"
        : "normal";

    /* 10) En fazla ÜÇ güçlü eşleşme; alıntılar sınırlı uzunlukta (madde 9.10).
     * Katman 3 girdileri de BURADA, aynı deterministik eşleşme verisinden
     * hazırlanır: model sayfa/alıntı üretmez, sunucu yankılar (madde 5). */
    const matches: SimilarityMatch[] = [];
    const llmInputs: SimilarityLlmMatchInput[] = [];
    if (best && bestPeerApp && level !== "normal") {
      // Eşleşme sayfaları için en iyi eşin parça satırları yeniden okunur:
      // parti döngüsü belleğinde tutulmazlar (koşu sürdürülmüş olabilir).
      const [bestPeer] = await listSimilarityChunkBatch(
        resolved.competitionKey, [bestPeerApp.applicationId], SIMILARITY_PIPELINE_VERSION,
      );
      let peerTexts: StoredChunkText[] = [];
      try {
        const peerObject = await reportBucket().get(chunkStoreKey(bestPeerApp.applicationId, bestPeerApp.submissionVersionId));
        // v1 (düz dizi) ve v2 ({included, excluded}) nesneleri birlikte tanınır.
        if (peerObject) peerTexts = parseChunkStore(JSON.parse(await peerObject.text()));
      } catch (peerError) {
        console.error("[similarity] eş parça metni okunamadı", peerError);
      }
      for (const match of best.matches.slice(0, 3)) {
        const ownChunk = ownScored.find((chunk) => chunk.index === match.ownIndex);
        const peerChunk = bestPeer?.chunks.find((chunk) => chunk.chunkIndex === match.peerIndex);
        const peerText = peerTexts.find((entry) => entry.index === match.peerIndex);
        const corroboration = match.corroboration ?? [];
        llmInputs.push({
          index: matches.length,
          kind: match.kind,
          ownPage: ownChunk?.pageStart ?? null,
          peerPage: peerChunk?.pageStart ?? null,
          ownExcerpt: ownChunk ? excerptOf(ownChunk.text) : "",
          peerExcerpt: peerText ? excerptOf(peerText.text) : "",
          corroboration,
        });
        matches.push({
          peerLabel: bestPeerApp.participantLabel,
          peerApplicationId: bestPeerApp.applicationId,
          kind: match.kind,
          ownPage: ownChunk?.pageStart ?? null,
          ownQuote: ownChunk ? quoteOf(ownChunk.text) : "",
          peerPage: peerChunk?.pageStart ?? null,
          peerQuote: peerText ? quoteOf(peerText.text) : "",
          peerFileAccessible: bestPeerApp.assignedJudgeId === auth.account.id,
          corroboration,
        });
      }
    }

    const closestLabel = fingerprintWins
      ? bestFingerprintOnly?.label ?? null
      : bestPeerApp?.participantLabel ?? bestFingerprintOnly?.label ?? null;
    const closestApplicationId = fingerprintWins
      ? bestFingerprintOnly?.applicationId ?? null
      : bestPeerApp?.applicationId ?? bestFingerprintOnly?.applicationId ?? null;
    const report: SimilarityReport = {
      level,
      comparedCount,
      approxPercent: percent,
      closestLabel,
      method,
      note: buildNote({ level, comparedCount, approxPercent: percent, closestLabel, method }) + noteSuffix,
      matches,
      analyzedAt,
      // Denetim alanları (madde 3-4 ve 6): oran ve kelime sayıları
      // yapılandırılmış alanda taşınır, gösterim cümlesinden asla geri okunmaz.
      comparableWords: reportComparableWords
        ?? comparableWordUnion(ownScored.filter((chunk) => !chunk.template)),
      ...(best ? { matchedWords: best.matchedWords } : {}),
      // MinHash/anlamsal eşleşme ayrımı (madde 7): en yakın raporla eşleşme
      // sayıları, en fazla üç eşleşmelik gösterim kesiminden ÖNCE sayılır.
      directMatchCount: best ? best.matches.filter((match) => match.kind === "direct").length : 0,
      semanticMatchCount: best ? best.matches.filter((match) => match.kind === "semantic").length : 0,
      ...(poolTruncated ? { poolTruncated: true } : {}),
      excludedWords,
      structureSource,
      templateVersion,
    };

    /*
     * 11) KATMAN 3 — LLM açıklama kontrolü (madde 5): İKİ AŞAMALI KAYIT.
     * Deterministik sonuç ÖNCE kaydedilir; ödenen MinHash/embedding emeği LLM
     * arızasıyla ASLA kaybolmaz. Model yalnızca yukarıda belirlenen eşleşme
     * çiftlerini alır ve yalnızca sınıf + açıklama döndürür; yüzde, seviye,
     * sayfa ve alıntılar bu çağrıdan ÖNCE hesaplanmıştır ve değişmez.
     *
     * Kapatma anahtarı SIMILARITY_LLM_ENABLED=off|0 (varsayılan AÇIK).
     * `skipLlm` maliyet kapısı test/geliştirme içindir (skipEmbedding gibi);
     * skipEmbedding'li koşular da ücretli LLM çağrısı YAPMAZ (e2e ücretsizdir).
     */
    const llmApiKey = process.env.GEMINI_API_KEY;
    const llmActive = level !== "normal" && matches.length > 0 && llmInputs.length > 0
      && similarityLlmEnabled() && body.skipLlm !== true && !skipEmbedding && !!llmApiKey;
    if (!llmActive) report.llmStatus = "skipped";
    const saveInput = {
      applicationId, submissionVersionId: resolved.submissionVersionId, pdfHash: serverPdfHash,
      competitionKey: resolved.competitionKey,
      embeddingModel: embeddingFailed ? null : SIMILARITY_EMBEDDING_MODEL,
      embeddingDim: embeddingFailed ? null : SIMILARITY_EMBEDDING_DIM,
      pipelineVersion: SIMILARITY_PIPELINE_VERSION,
      status: (embeddingFailed ? "partial" : "completed") as "partial" | "completed",
      approxPercent: percent,
      closestApplicationId,
      closestLabel,
      templateVersion,
    };
    await saveSimilarityResult({ ...saveInput, reportJson: JSON.stringify(report) });

    let llmApiCalls = 0;
    if (llmActive) {
      const outcome = await explainSimilarityMatches({
        apiKey: llmApiKey!,
        competitionName: resolved.competitionName,
        matches: llmInputs.slice(0, thresholds.llmTopK),
      });
      llmApiCalls = outcome.apiCalls;
      if (outcome.ok) {
        // Birleştirme YALNIZCA açıklama alanlarını yazar: yüzde/seviye/sayfa/
        // alıntı deterministik verisinin üzerine hiçbir model metni yazılmaz.
        for (const annotation of outcome.annotations) {
          const target = matches[annotation.index];
          if (!target) continue;
          target.llmClass = annotation.sinif;
          target.llmClassLabel = SIMILARITY_LLM_CLASSES[annotation.sinif];
          target.llmExplanation = annotation.aciklama;
          target.llmAssessment = annotation.degerlendirme;
        }
        report.llmStatus = "completed";
      } else {
        // Arıza deterministik sonucu KAYBETTİRMEZ (madde 5).
        report.llmStatus = "failed";
        report.note = `${report.note} Açıklama kontrolü tamamlanamadı.`;
        console.error("[similarity] LLM açıklama kontrolü tamamlanamadı", { detail: outcome.detail });
      }
      // İkinci kayıt idempotenttir (sil + yaz); ilk kayıt zaten geçerli sonucu taşır.
      await saveSimilarityResult({ ...saveInput, reportJson: JSON.stringify(report) });
    }
    return json({
      similarity: report,
      check: buildCheck(report),
      embeddingApiCalls,
      llmApiCalls,
      // 429: istemci, kriter analizi tamamlandıktan sonra kısa gecikmeyle yeniden deneyebilir.
      ...(embeddingRateLimited ? { embeddingRateLimited: true } : {}),
    });
  } catch (error) { return handleError(error); }
}
