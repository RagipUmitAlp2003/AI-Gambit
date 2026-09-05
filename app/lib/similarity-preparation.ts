import type { AdminAccount } from "./admin-types";
import { buildMinHash } from "./similarity-engine";
import {
 EXCLUSION_AUDIT_LABEL, SIMILARITY_EMBEDDING_DIM, SIMILARITY_EMBEDDING_MODEL,
 SIMILARITY_PIPELINE_VERSION, TEMPLATE_CHUNK_OVERLAP, chunkMinHash, chunkStructuredBlocks,
 chunkTemplateOverlap, chunkTextKey, classifyBlocks, sha256Hex,
 type ExcludedBlock, type SimilarityBlockInput, type SimilarityChunk, type TemplateFilter,
} from "./similarity-text";
import { similarityMaxChunksPerDoc, similarityThresholds } from "./similarity-config";
import { embeddingSketch } from "./similarity-candidates";
import { chunkFeatures, type SimilarityChunkFeatures } from "./similarity-corroboration";
import { PdfTextLayerError, extractPdfStructure } from "./pdf-structure";
import { requiredHeadingsOf } from "./report-prechecks";
import { embedTexts } from "./similarity-embedding";
import {
 findApplication, findCurrentSimilarityTemplate, findLatestProfileForCompetitionKey,
 findStoredSimilarityChunks, reportBucket, resolveSimilarityContext,
 saveSimilarityChunks, saveSimilarityChunkSketches, type StoredSimilarityChunk,
} from "./workflow-db";
import { summarizeChunks } from "./similarity-bulk-engine";
import { assertPreparationLease, claimPreparation, enqueuePreparation, finishPreparation, preparationKey, readPreparations, renewPreparationLease, resetBrokenPreparation } from "./similarity-jobs";

const TEMPLATE_OBJECT_MAX_BYTES = 8 * 1024 * 1024;
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
  sourcePdfHash?: string;
  pipelineVersion: string;
  templateVersion: number | null;
  source: "structure" | "pages";
  auditLabel: string;
  included: StoredChunkText[];
  excluded: Array<{ page: number; section: string; reason: string; text: string }>;
};


/** Only final approval starts preparation. A durable lease protects concurrent retries. */
export async function prepareApprovedSimilarity(applicationId: string, actor: AdminAccount) {
 const application = await findApplication(applicationId, actor);
 if (!application || application.status !== "completed" || application.outcome !== "accepted") {
   throw new Error("Benzerlik hazırlığı yalnızca onaylanmış güncel başvurularda yapılabilir.");
 }
 const resolved = await resolveSimilarityContext(applicationId, actor);
 if (typeof resolved === "string") throw new Error("Başvuruya erişilemiyor.");
 const template = await findCurrentSimilarityTemplate(resolved.competitionKey);
 const key = preparationKey(applicationId, resolved.submissionVersionId!, template?.version ?? null);
 const previous = (await readPreparations([key])).get(key);
 if (previous?.state === "ready" && previous.summary?.textKey && previous.summary?.pdfHash) {
   const [stored, textObject] = await Promise.all([
     findStoredSimilarityChunks({ submissionVersionId: resolved.submissionVersionId!, pdfHash: previous.summary.pdfHash,
       embeddingModel: SIMILARITY_EMBEDDING_MODEL, pipelineVersion: SIMILARITY_PIPELINE_VERSION }),
     reportBucket().get(previous.summary.textKey),
   ]);
   if (stored?.length && textObject) return { state: "ready", apiCalls: 0 };
   await resetBrokenPreparation(key);
 }
 let textStoreKey = previous?.summary?.textKey || chunkStoreKey(applicationId, resolved.submissionVersionId!);
 const lease = await claimPreparation(key, applicationId);
 if (!lease) return { state: "running", apiCalls: 0 };
 try {
   const object = await reportBucket().get(resolved.fileKey);
   if (!object) throw new Error("Başvurunun PDF dosyası bulunamadı.");
   const bytes = await object.arrayBuffer();
   const serverPdfHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2,"0")).join("");
   const thresholds = similarityThresholds();
   const result = await (async () => {
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
        const ownObject = await reportBucket().get(textStoreKey);
        if (ownObject) {
          const parsed = JSON.parse(await ownObject.text()) as Partial<ChunkStoreObject> | StoredChunkText[];
          if (!Array.isArray(parsed) && parsed.v === 2
            && (!parsed.sourcePdfHash || parsed.sourcePdfHash === serverPdfHash)
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
        throw new Error("PDF metin katmanı okunamadı; OCR uygulanmış PDF gerekiyor.");
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
      textStoreKey = `${chunkStoreKey(applicationId, versionId)}.${lease}`;
      await reportBucket().put(textStoreKey, JSON.stringify({
        v: 2, pipelineVersion: SIMILARITY_PIPELINE_VERSION, templateVersion,
        sourcePdfHash: serverPdfHash, auditLabel: EXCLUSION_AUDIT_LABEL, included: [], excluded,
      }));
      const summary = summarizeChunks([], []);
      summary.truncatedBlocks = excluded.filter((block) => block.reason === "tavan").length;
      return { state: "empty", apiCalls: 0, summary };
    }

    /* 5) Embedding önbelleği (madde 9.6–9.7). */
    let embeddings: (number[] | null)[] = chunks.map(() => null);
    let embeddingFailed = false;
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
    const apiKey = process.env.GEMINI_API_KEY;
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
      await renewPreparationLease(key, lease);
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
        sourcePdfHash: serverPdfHash,
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
      textStoreKey = `${chunkStoreKey(applicationId, versionId)}.${lease}`;
      await reportBucket().put(textStoreKey, JSON.stringify(chunkStoreObject), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { applicationId, kind: "similarity-chunks" },
      });
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


     const scored = chunks.map((chunk, index) => ({
       ...chunk, template: ownTemplateFlags[index], minHash: ownMinHashes[index],
       embedding: embeddings[index], features: ownFeatures[index], sketch: ownSketches[index],
     }));
     const summary = summarizeChunks(scored, textHashes);
     summary.truncatedBlocks = excluded.filter((block) => block.reason === "tavan").length;
     return { state: embeddingFailed ? "partial" : "ready", apiCalls: embeddingApiCalls, summary };
   })();
   result.summary.pdfHash = serverPdfHash;
   result.summary.textKey = textStoreKey;
   await assertPreparationLease(key, lease);
   // A revised/reopened/deleted report is never published as current prepared data.
   const current = await findApplication(applicationId, actor);
   if (!current || current.status !== "completed" || current.outcome !== "accepted"
       || current.currentVersionId !== application.currentVersionId) throw new Error("Başvuru hazırlık sırasında değişti; yeniden deneyin.");
   await finishPreparation(key, lease, result.state, result.summary,
      result.state === "partial" ? "Anlamsal veriler hazırlanamadı; yeniden deneyebilirsiniz."
        : result.summary.truncatedBlocks ? `${result.summary.truncatedBlocks} bölüm teknik sınır nedeniyle karşılaştırmaya dahil edilmedi.` : "");
   return { state: result.state, apiCalls: result.apiCalls };
 } catch (error) {
   console.error("[similarity-preparation]", error);
   await finishPreparation(key, lease, "failed", null, "Hazırlık tamamlanamadı. Lütfen yeniden deneyin.");
   throw error;
 }
}

/** Persist intent before returning the approval response. Execution is scheduled with next/server after(). */
export async function queueApprovedSimilarity(applicationId: string, actor: AdminAccount) {
 const application = await findApplication(applicationId, actor);
 if (!application || application.status !== "completed" || application.outcome !== "accepted") return false;
 const template = await findCurrentSimilarityTemplate(application.competitionKey);
 await enqueuePreparation(preparationKey(applicationId,application.currentVersionId!,template?.version??null),applicationId);
 return true;
}
