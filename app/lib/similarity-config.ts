/**
 * Benzerlik motorunun eşik yapılandırması (GÖREV 3 · madde 5-6).
 *
 * Bütün eşikler KALİBRE EDİLEBİLİR başlangıç değerleridir; hiçbiri otomatik
 * ihlal sınırı değildir. Ortam değişkeniyle geçersiz kılınabilirler; geçersiz
 * (sayı olmayan, aralık dışı ya da sırası ters) bir değer sessizce varsayılana
 * düşer — yanlış bir yapılandırma benzerlik analizini asla düşürmez ve asla
 * olduğundan sert bir eşik üretmez (fail-safe).
 *
 * Saf ve ortamdan bağımsız modüldür: benzerlik kütüphanesinin başka hiçbir
 * dosyasını içe almaz (döngüsel bağımlılık yasak).
 */

/* --------------------------- Varsayılan eşikler --------------------------- *
 * Otomatik ihlal sınırı DEĞİLDİR; test raporlarıyla kalibre edilebilir
 * başlangıç değerleridir (madde 6 ve 12).
 * -------------------------------------------------------------------------- */
export const DIRECT_HIGH_THRESHOLD = 0.55;
export const DIRECT_REVIEW_THRESHOLD = 0.30;
export const SEMANTIC_HIGH_THRESHOLD = 0.90;
export const SEMANTIC_REVIEW_THRESHOLD = 0.82;

/**
 * Rapor düzeyi yaklaşık oranın seviye bantları (madde 6):
 *   %0-19  → belirgin benzerlik bulunmadı ("normal")
 *   %20-39 → hakem incelemesi önerilir ("review")
 *   %40+   → yüksek metin benzerliği ("high")
 */
export const REPORT_REVIEW_PERCENT = 20;
export const REPORT_HIGH_PERCENT = 40;

/** Embedding eşleşmesinin tek başına alarm ÜRETEMEMESİ için aranan destekler (madde 5 · Katman 2). */
export type SimilarityCorroborationConfig = {
  /** "Ayırt edici teknik ifadeler": ortak nadir terim alt sınırı. */
  minSharedRareTerms: number;
  /** "Aynı özgün sayı ve tasarım ilişkileri": ortak özgün sayı alt sınırı. */
  minSharedNumbers: number;
  /** "Birbirini takip eden birden fazla benzer paragraf": ardışık çift alt sınırı. */
  minConsecutivePairs: number;
  /** "Çözüm mimarisi ve anlatım sırasının birlikte benzemesi": sıralı zincir alt sınırı. */
  minOrderedChain: number;
};

export type SimilarityThresholds = {
  directHigh: number;
  directReview: number;
  semanticHigh: number;
  semanticReview: number;
  reportReviewPercent: number;
  reportHighPercent: number;
  /** LLM açıklama katmanına giden en güçlü eşleşme sayısı (madde 5 · Katman 3). */
  llmTopK: number;
  /** Yalnızca bu rapor yakınlığına ulaşan çiftler toplu LLM yorumuna alınır. */
  llmMinPercent: number;
  /** Bunun altındaki karşılaştırılabilir kelime sayısı MinHash havuzuna alınmaz (madde 5 · Katman 1). */
  minComparableWords: number;
  corroboration: SimilarityCorroborationConfig;
};

export const DEFAULT_SIMILARITY_THRESHOLDS: SimilarityThresholds = Object.freeze({
  directHigh: DIRECT_HIGH_THRESHOLD,
  directReview: DIRECT_REVIEW_THRESHOLD,
  semanticHigh: SEMANTIC_HIGH_THRESHOLD,
  semanticReview: SEMANTIC_REVIEW_THRESHOLD,
  reportReviewPercent: REPORT_REVIEW_PERCENT,
  reportHighPercent: REPORT_HIGH_PERCENT,
  llmTopK: 5,
  llmMinPercent: 85,
  minComparableWords: 40,
  corroboration: Object.freeze({
    minSharedRareTerms: 3,
    minSharedNumbers: 2,
    minConsecutivePairs: 2,
    minOrderedChain: 3,
  }),
});

type EnvSource = Record<string, string | undefined>;

/** Sayı ayrıştırma: boş/geçersiz/aralık dışı değer sessizce varsayılana düşer. */
function boundedNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

/**
 * Ortam değişkenlerinden eşikleri okur (madde 6: "eşikler yapılandırılabilir
 * olmalı"). Sıra tutarlılığı da doğrulanır: inceleme eşiği yüksek eşikten
 * küçük olmalıdır; ters yazılmış bir çift bütünüyle varsayılana döner.
 */
export function similarityThresholds(env: EnvSource = process.env): SimilarityThresholds {
  const defaults = DEFAULT_SIMILARITY_THRESHOLDS;
  let directHigh = boundedNumber(env.SIMILARITY_DIRECT_HIGH, 0, 1, defaults.directHigh);
  let directReview = boundedNumber(env.SIMILARITY_DIRECT_REVIEW, 0, 1, defaults.directReview);
  if (directReview >= directHigh) {
    directHigh = defaults.directHigh;
    directReview = defaults.directReview;
  }
  let semanticHigh = boundedNumber(env.SIMILARITY_SEMANTIC_HIGH, 0, 1, defaults.semanticHigh);
  let semanticReview = boundedNumber(env.SIMILARITY_SEMANTIC_REVIEW, 0, 1, defaults.semanticReview);
  if (semanticReview >= semanticHigh) {
    semanticHigh = defaults.semanticHigh;
    semanticReview = defaults.semanticReview;
  }
  let reportReviewPercent = boundedNumber(env.SIMILARITY_REPORT_REVIEW_PERCENT, 1, 99, defaults.reportReviewPercent);
  let reportHighPercent = boundedNumber(env.SIMILARITY_REPORT_HIGH_PERCENT, 1, 99, defaults.reportHighPercent);
  if (reportReviewPercent >= reportHighPercent) {
    reportReviewPercent = defaults.reportReviewPercent;
    reportHighPercent = defaults.reportHighPercent;
  }
  const llmTopK = Math.round(boundedNumber(env.SIMILARITY_LLM_TOP_K, 1, 5, defaults.llmTopK));
  const llmMinPercent = Math.round(boundedNumber(env.SIMILARITY_LLM_MIN_PERCENT, 1, 100, defaults.llmMinPercent));
  return {
    directHigh,
    directReview,
    semanticHigh,
    semanticReview,
    reportReviewPercent,
    reportHighPercent,
    llmTopK,
    llmMinPercent,
    minComparableWords: defaults.minComparableWords,
    corroboration: defaults.corroboration,
  };
}

/** Yaklaşık oranın seviye bandı (madde 6); belge düzeyi yükseltme buna AYRICA eklenir. */
export function reportBandLevel(
  percent: number,
  thresholds: SimilarityThresholds = DEFAULT_SIMILARITY_THRESHOLDS,
): "normal" | "review" | "high" {
  if (percent >= thresholds.reportHighPercent) return "high";
  if (percent >= thresholds.reportReviewPercent) return "review";
  return "normal";
}

/* ---------------------- Çalışma zamanı sınırları (madde 8) ---------------------- *
 * Worker CPU/bellek koruması: havuz üst sınırı, süre bütçesi ve parti boyutu.
 * Ortam değişkeniyle ayarlanabilir başlangıç değerleridir; geçersiz değer
 * sessizce varsayılana düşer (fail-safe).
 * ------------------------------------------------------------------------------- */

/** Bir koşuda karşılaştırılan en fazla eş başvuru; fazlası `poolTruncated` ile raporlanır. */
export const SIMILARITY_POOL_MAX_APPS = 200;
/** Bir istek çağrısının duvar saati bütçesi; dolunca koşu kalıcılaştırılır ve sürdürülür. */
export const SIMILARITY_TIME_BUDGET_MS = 15_000;
/** Bir partide işlenen eş başvuru sayısı (D1 sorguları daha küçük dilimlerle gider). */
export const SIMILARITY_PEER_BATCH_APPS = 10;
/**
 * Belge başına parça TAVANI (madde 8 · bellek koruması): 2 milyon karakterlik
 * patolojik bir rapor binlerce parça (havuz okumalarında başvuru başına ~20 MB
 * embedding JSON) üretemez. Tavanı aşan kuyruk SESSİZCE atılmaz; "tavan"
 * gerekçesiyle denetim listesine yazılır (similarity-text · chunkStructuredBlocks).
 */
export const MAX_CHUNKS_PER_DOC = 400;

/** Ortam değişkeninden belge başına parça tavanını okur (SIMILARITY_MAX_CHUNKS). */
export function similarityMaxChunksPerDoc(env: EnvSource = process.env): number {
  return Math.round(boundedNumber(env.SIMILARITY_MAX_CHUNKS, 1, 10_000, MAX_CHUNKS_PER_DOC));
}

export type SimilarityRuntimeLimits = {
  poolMaxApps: number;
  timeBudgetMs: number;
  peerBatchApps: number;
};

/** Ortam değişkenlerinden çalışma zamanı sınırlarını okur (madde 8). */
export function similarityRuntimeLimits(env: EnvSource = process.env): SimilarityRuntimeLimits {
  return {
    poolMaxApps: Math.round(boundedNumber(env.SIMILARITY_POOL_MAX_APPS, 1, 5_000, SIMILARITY_POOL_MAX_APPS)),
    timeBudgetMs: Math.round(boundedNumber(env.SIMILARITY_TIME_BUDGET_MS, 1_000, 120_000, SIMILARITY_TIME_BUDGET_MS)),
    peerBatchApps: Math.round(boundedNumber(env.SIMILARITY_PEER_BATCH_APPS, 1, 50, SIMILARITY_PEER_BATCH_APPS)),
  };
}

/**
 * Katman 3 (LLM açıklama kontrolü) kapatma anahtarı: SIMILARITY_LLM_ENABLED
 * tanımsız ya da "on" ise AÇIK; "off" veya "0" kapatır (kullanıcı kararı:
 * varsayılan açık). Kapalıyken deterministik sonuç aynen üretilir; yalnızca
 * açıklama sınıflandırması atlanır.
 */
export function similarityLlmEnabled(env: EnvSource = process.env): boolean {
  const value = (env.SIMILARITY_LLM_ENABLED ?? "").trim().toLowerCase();
  return value !== "off" && value !== "0";
}
