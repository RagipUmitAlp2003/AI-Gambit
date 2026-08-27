import { Buffer } from "node:buffer";
import { handleError, json, jsonError, readJson, requirePermission } from "../../../../lib/admin-guard";
import { buildMinHash, minHashSimilarity, type SimilarityFingerprint } from "../../../../lib/similarity-engine";
import {
  DIRECT_HIGH_THRESHOLD,
  DIRECT_REVIEW_THRESHOLD,
  REPORT_HIGH_PERCENT,
  REPORT_REVIEW_PERCENT,
  SIMILARITY_EMBEDDING_DIM,
  SIMILARITY_EMBEDDING_MODEL,
  SIMILARITY_PIPELINE_VERSION,
  approximateReportSimilarity,
  chunkMinHash,
  chunkPages,
  chunkTextKey,
  isTemplateChunkHash,
  normalizePages,
  sha256Hex,
  type PeerChunk,
  type ScoredChunk,
  type SimilarityChunk,
} from "../../../../lib/similarity-text";
import { embedTexts } from "../../../../lib/similarity-embedding";
import {
  findStoredSimilarityChunks,
  listPeerSimilarityChunks,
  reportBucket,
  resolveSimilarityContext,
  saveAndListSimilarityFingerprints,
  saveSimilarityChunks,
  saveSimilarityResult,
  type SimilarityPeerChunks,
} from "../../../../lib/workflow-db";
import type { PreCheck, SimilarityLevel, SimilarityMatch, SimilarityReport } from "../../../../lib/types";

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
/** Ayrıntıda gösterilen alıntı uzunluğu; rapor içeriği sınırlı tutulur. */
const QUOTE_CHARS = 220;

function quoteOf(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length <= QUOTE_CHARS ? cleaned : `${cleaned.slice(0, QUOTE_CHARS)}…`;
}

/** Parça metinlerinin saklandığı ÖZEL R2 nesnesi; yalnızca sunucu okur. */
function chunkStoreKey(applicationId: string, versionId: string): string {
  return `similarity/${applicationId}/${versionId}.json`;
}

type StoredChunkText = { index: number; page: number; text: string };

function buildNote(input: {
  level: SimilarityLevel;
  comparedCount: number;
  approxPercent: number | null;
  closestLabel: string | null;
  method: "hybrid" | "minhash-only";
}): string {
  if (input.level === "none") {
    return "Aynı yarışmada karşılaştırılabilecek başka güncel başvuru bulunmadığı için benzerlik oranı oluşturulmadı.";
  }
  const methodNote = input.method === "minhash-only"
    ? " Semantik karşılaştırma tamamlanamadı; temel metin karşılaştırması kullanıldı."
    : "";
  const base = `Bu rapor aynı yarışmadaki ${input.comparedCount} güncel başvuruyla karşılaştırıldı.`;
  if (input.level === "high") {
    return `${base} “${input.closestLabel ?? "En yakın rapor"}” başvurusuyla yaklaşık %${input.approxPercent ?? 0} benzerlik bulundu. `
      + `Yüksek benzerlik gösteren bölümler işaretlendi. Bu oran otomatik ihlal, intihal veya ret kararı değildir; hakem tarafından incelenmelidir.${methodNote}`;
  }
  if (input.level === "review") {
    return `${base} “${input.closestLabel ?? "En yakın rapor"}” başvurusuyla yaklaşık %${input.approxPercent ?? 0} benzerlik bulundu. `
      + `Bu oran otomatik ihlal, intihal veya ret kararı değildir; hakem tarafından incelenmelidir.${methodNote}`;
  }
  return `${base} En yakın başvuruyla yaklaşık %${input.approxPercent ?? 0} benzerlik bulundu. `
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
  };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requirePermission(request, "run_ai_prescreen");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(request);
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

    /* 1) Şablon/kimlik temizliği ve parçalama (madde 9.4–9.5). */
    const cleanedPages = normalizePages(rawPages, {
      competitionName: resolved.competitionName,
      participantNames: resolved.participantNames,
    });
    const cleanedText = cleanedPages.join("\n");
    const chunks: SimilarityChunk[] = chunkPages(cleanedPages);

    /* 2) MinHash katmanı (mevcut motor, belge düzeyi) korunur. */
    const docMinHash = buildMinHash(cleanedText);
    const fingerprint: SimilarityFingerprint = { ...docMinHash, embedding: null, embeddingModel: null };
    const peersDoc = await saveAndListSimilarityFingerprints(applicationId, auth.account, fingerprint);
    if (peersDoc === "not_found") return jsonError(404, "Başvuru bulunamadı.");
    if (peersDoc === "forbidden") return jsonError(403, "Bu başvurunun benzerlik analizine erişiminiz yok.");

    /* 3) Parça özetleri + embedding önbelleği (madde 9.6–9.7). */
    const textHashes = await Promise.all(chunks.map((chunk) => sha256Hex(chunkTextKey(chunk.text))));
    // Eski (0005 öncesi) başvurularda current_version_id boş olabilir; sabit
    // "v1" yedeği farklı başvuruların parça anahtarlarını ÇAKIŞTIRIRDI. Yedek
    // başvuru kimliğiyle nitelenir ve her başvuru için benzersiz kalır.
    const versionId = resolved.submissionVersionId ?? `eski-${applicationId}`;
    const cached = await findStoredSimilarityChunks({
      submissionVersionId: versionId,
      pdfHash: serverPdfHash,
      embeddingModel: SIMILARITY_EMBEDDING_MODEL,
      pipelineVersion: SIMILARITY_PIPELINE_VERSION,
    });
    const cacheValid = cached !== null
      && cached.length === chunks.length
      && cached.every((row, index) => row.textHash === textHashes[index]);

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

    /*
     * 4) Parçalar D1'e (embedding önbelleği), metinler özel R2 nesnesine
     * yazılır. GEÇERLİ önbellek gereksiz yere yeniden yazılMAZ (aksi hâlde
     * embedding'siz bir koşu kayıtlı vektörleri yok ederdi); yalnızca metin
     * değiştiğinde ya da yeni embedding üretildiğinde tazelenir.
     */
    if (!cacheValid || freshEmbeddings) {
      await saveSimilarityChunks({
        applicationId,
        submissionVersionId: versionId,
        competitionKey: resolved.competitionKey,
        pdfHash: serverPdfHash,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION,
        embeddingModel: SIMILARITY_EMBEDDING_MODEL,
        embeddingDim: SIMILARITY_EMBEDDING_DIM,
        chunks: chunks.map((chunk, index) => ({
          chunkIndex: chunk.index,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          wordCount: chunk.wordCount,
          textHash: textHashes[index],
          minHash: ownMinHashes[index],
          embedding: embeddings[index],
        })),
      });
      const chunkTexts: StoredChunkText[] = chunks.map((chunk) => ({
        index: chunk.index, page: chunk.pageStart, text: chunk.text,
      }));
      await reportBucket().put(chunkStoreKey(applicationId, versionId), JSON.stringify(chunkTexts), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { applicationId, kind: "similarity-chunks" },
      }).catch((storeError: unknown) => console.error("[similarity] parça metni R2'ye yazılamadı", storeError));
    }

    /*
     * 5) Havuz: aynı yarışma anahtarındaki diğer GÜNCEL başvurular (madde 9.2).
     *
     * İki katman birlikte kullanılır:
     *   - Parça (chunk) katmanı: bu dağıtımdan sonra analiz edilen eşler.
     *   - Belge düzeyi MinHash havuzu (submission_fingerprints): parça kaydı
     *     HENÜZ olmayan eski eşler de karşılaştırma DIŞI kalmaz (geriye uyum);
     *     onlar için yalnızca belge düzeyi doğrudan benzerlik ölçülür.
     */
    const peers: SimilarityPeerChunks[] = await listPeerSimilarityChunks(
      resolved.competitionKey, applicationId, SIMILARITY_PIPELINE_VERSION,
    );
    const chunkPeerIds = new Set(peers.map((peer) => peer.applicationId));
    const fingerprintOnlyPeers = peersDoc.filter((entry) => !chunkPeerIds.has(entry.applicationId));
    const comparedCount = peers.length + fingerprintOnlyPeers.length;
    const analyzedAt = new Date().toISOString();
    const method: "hybrid" | "minhash-only" = embeddingFailed ? "minhash-only" : "hybrid";

    if (!comparedCount) {
      const report: SimilarityReport = {
        level: "none", comparedCount: 0, approxPercent: null, closestLabel: null,
        method, note: buildNote({ level: "none", comparedCount: 0, approxPercent: null, closestLabel: null, method }),
        matches: [], analyzedAt,
      };
      await saveSimilarityResult({
        applicationId, submissionVersionId: resolved.submissionVersionId, pdfHash: serverPdfHash,
        competitionKey: resolved.competitionKey,
        embeddingModel: embeddingFailed ? null : SIMILARITY_EMBEDDING_MODEL,
        embeddingDim: embeddingFailed ? null : SIMILARITY_EMBEDDING_DIM,
        pipelineVersion: SIMILARITY_PIPELINE_VERSION, status: "skipped",
        approxPercent: null, closestApplicationId: null, closestLabel: null,
        reportJson: JSON.stringify(report),
      });
      return json({ similarity: report, check: buildCheck(report), embeddingApiCalls });
    }

    /*
     * 6) Resmî şablon parçaları karşılaştırma dışıdır (madde 9.4): aynı parça
     * özeti havuzdaki başvuruların yarısından fazlasında birebir varsa şablon
     * sayılır; yalnızca ortak başlıkları paylaşan raporlar yüksek benzerlik almaz.
     */
    const hashSeenIn = new Map<string, number>();
    for (const peer of peers) {
      const unique = new Set(peer.chunks.map((chunk) => chunk.textHash));
      for (const hash of unique) hashSeenIn.set(hash, (hashSeenIn.get(hash) ?? 0) + 1);
    }
    const poolSize = peers.length + 1;
    const ownScored: ScoredChunk[] = chunks.map((chunk, index) => ({
      index: chunk.index,
      wordCount: chunk.wordCount,
      pageStart: chunk.pageStart,
      text: chunk.text,
      minHash: ownMinHashes[index],
      embedding: embeddings[index],
      template: isTemplateChunkHash(textHashes[index], hashSeenIn, poolSize),
    }));

    /* 7) Rapor düzeyi yaklaşık oran: kapsamaya dayalı, ham cosine değil (madde 9.8). */
    let best: { peer: SimilarityPeerChunks; percent: number; matches: ReturnType<typeof approximateReportSimilarity>["matches"] } | null = null;
    let bestDocLexical = 0;
    for (const peer of peers) {
      const peerChunks: PeerChunk[] = peer.chunks.map((chunk) => ({
        index: chunk.chunkIndex,
        wordCount: chunk.wordCount,
        pageStart: chunk.pageStart,
        minHash: chunk.minHash,
        embedding: embeddingFailed ? null : chunk.embedding,
        template: isTemplateChunkHash(chunk.textHash, hashSeenIn, poolSize),
      }));
      const result = approximateReportSimilarity(ownScored, peerChunks);
      const docPeer = peersDoc.find((entry) => entry.applicationId === peer.applicationId);
      const docLexical = docPeer ? minHashSimilarity(docMinHash.signature, docPeer.fingerprint.signature) : 0;
      if (!best || result.approxPercent > best.percent) {
        best = { peer, percent: result.approxPercent, matches: result.matches };
        bestDocLexical = docLexical;
      }
    }

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
    const level: SimilarityLevel = percent >= REPORT_HIGH_PERCENT || docEscalation >= DIRECT_HIGH_THRESHOLD
      ? "high"
      : percent >= REPORT_REVIEW_PERCENT || docEscalation >= DIRECT_REVIEW_THRESHOLD
        ? "review"
        : "normal";

    /* 8) En fazla ÜÇ güçlü eşleşme; alıntılar sınırlı uzunlukta (madde 9.10). */
    const matches: SimilarityMatch[] = [];
    if (best && level !== "normal") {
      let peerTexts: StoredChunkText[] = [];
      try {
        const peerObject = await reportBucket().get(chunkStoreKey(best.peer.applicationId, best.peer.submissionVersionId));
        if (peerObject) peerTexts = JSON.parse(await peerObject.text()) as StoredChunkText[];
      } catch (peerError) {
        console.error("[similarity] eş parça metni okunamadı", peerError);
      }
      for (const match of best.matches.slice(0, 3)) {
        const ownChunk = ownScored.find((chunk) => chunk.index === match.ownIndex);
        const peerChunk = best.peer.chunks.find((chunk) => chunk.chunkIndex === match.peerIndex);
        const peerText = peerTexts.find((entry) => entry.index === match.peerIndex);
        matches.push({
          peerLabel: best.peer.participantLabel,
          peerApplicationId: best.peer.applicationId,
          kind: match.kind,
          ownPage: ownChunk?.pageStart ?? null,
          ownQuote: ownChunk ? quoteOf(ownChunk.text) : "",
          peerPage: peerChunk?.pageStart ?? null,
          peerQuote: peerText ? quoteOf(peerText.text) : "",
          peerFileAccessible: best.peer.assignedJudgeId === auth.account.id,
        });
      }
    }

    const closestLabel = fingerprintWins
      ? bestFingerprintOnly?.label ?? null
      : best?.peer.participantLabel ?? bestFingerprintOnly?.label ?? null;
    const closestApplicationId = fingerprintWins
      ? bestFingerprintOnly?.applicationId ?? null
      : best?.peer.applicationId ?? bestFingerprintOnly?.applicationId ?? null;
    const report: SimilarityReport = {
      level,
      comparedCount,
      approxPercent: percent,
      closestLabel,
      method,
      note: buildNote({ level, comparedCount, approxPercent: percent, closestLabel, method }),
      matches,
      analyzedAt,
    };
    await saveSimilarityResult({
      applicationId, submissionVersionId: resolved.submissionVersionId, pdfHash: serverPdfHash,
      competitionKey: resolved.competitionKey,
      embeddingModel: embeddingFailed ? null : SIMILARITY_EMBEDDING_MODEL,
      embeddingDim: embeddingFailed ? null : SIMILARITY_EMBEDDING_DIM,
      pipelineVersion: SIMILARITY_PIPELINE_VERSION,
      status: embeddingFailed ? "partial" : "completed",
      approxPercent: percent,
      closestApplicationId,
      closestLabel,
      reportJson: JSON.stringify(report),
    });
    return json({
      similarity: report,
      check: buildCheck(report),
      embeddingApiCalls,
      // 429: istemci, kriter analizi tamamlandıktan sonra kısa gecikmeyle yeniden deneyebilir.
      ...(embeddingRateLimited ? { embeddingRateLimited: true } : {}),
    });
  } catch (error) { return handleError(error); }
}
