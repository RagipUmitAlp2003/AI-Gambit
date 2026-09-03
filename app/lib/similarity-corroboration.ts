import { hash as fnvHash, normalizedWords } from "./similarity-engine";
import type { SimilarityCorroborationConfig } from "./similarity-config";

/**
 * Katman 2 doğrulama destekleri (GÖREV 3 · madde 5 · Katman 2).
 *
 * Embedding (anlamsal) eşleşmesi TEK BAŞINA alarm üretemez: dikkate alınması
 * için şu desteklerden en az biri aranır —
 *
 *   1. "ayirt-edici-ifade"     Ayırt edici teknik ifadeler (ortak nadir terim)
 *   2. "ozgun-sayilar"         Aynı özgün sayı ve tasarım ilişkileri
 *   3. "ardisik-paragraflar"   Birbirini takip eden birden fazla benzer paragraf
 *   4. "mimari-anlati-sirasi"  Çözüm mimarisi ve anlatım sırasının birlikte benzemesi
 *
 * MinHash (doğrudan) eşleşmeleri bu kapıdan GEÇMEZ: birebir kelime örtüşmesi
 * zaten kendi kanıtıdır. Kapı yalnızca eşleşmeyi ELEYEBİLİR, hiçbir puanı
 * yükseltemez ("yanlış suçlama üretmemek önceliklidir", madde 12).
 *
 * Modül saf ve ortamdan bağımsızdır; yalnız similarity-engine'in normalizasyon
 * ve özet işlevlerini kullanır (döngüsel bağımlılık yoktur).
 */

/** Parçadan çıkarılan doğrulama özellikleri; D1'de feature_json olarak saklanır. */
export type SimilarityChunkFeatures = {
  /** Nadir/teknik terimlerin 32-bit FNV özetleri (ham kelime saklanmaz). */
  rare: number[];
  /** Özgün sayısal ifadeler ("450newton", "3.2saniye", "98%" gibi), katlanmış. */
  nums: string[];
};

export type CorroborationSignal =
  | "ayirt-edici-ifade"
  | "ozgun-sayilar"
  | "ardisik-paragraflar"
  | "mimari-anlati-sirasi";

/** Aday çiftin konumu: kendi parça sırası + eş parça sırası. */
export type CandidatePair = { ownIndex: number; peerIndex: number };

/** Nadir terim sayılmak için asgari uzunluk (katlanmış kelime). */
const RARE_TERM_MIN_LENGTH = 8;
const RARE_TERM_CAP = 30;
const NUM_TOKEN_CAP = 20;
/** Sayı + isteğe bağlı kısa birim/yüzde eki: "450 newton", "3.2 s", "98%". */
const NUM_TOKEN_PATTERN = /\d+(?:[.,]\d+)?\s*(?:%|[a-zçğıöşü]{1,6})?/gi;

/**
 * Parça metninin doğrulama özellikleri.
 *
 *   - nums: sayısal ifadeler; 0-10 arası çıplak sayılar ve çıplak yıllar
 *     (19xx/20xx) ATILIR — madde numarası ve tarih özgün tasarım verisi değildir.
 *   - rare: 8+ karakterli ya da rakam içeren normalize kelimelerin özetleri
 *     ("ayırt edici teknik ifadeler"); ham kelime yerine 32-bit özet saklanır.
 */
export function chunkFeatures(text: string): SimilarityChunkFeatures {
  const nums = new Set<string>();
  NUM_TOKEN_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(NUM_TOKEN_PATTERN)) {
    const token = match[0].toLocaleLowerCase("tr-TR").replace(/\s+/g, "");
    if (/^\d+$/.test(token)) {
      if (Number(token) <= 10) continue;
      if (/^(19|20)\d{2}$/.test(token)) continue;
    }
    nums.add(token);
    if (nums.size >= NUM_TOKEN_CAP) break;
  }
  const rare = new Set<number>();
  for (const word of normalizedWords(text)) {
    if (word.length < RARE_TERM_MIN_LENGTH && !/\d/.test(word)) continue;
    rare.add(fnvHash(word, 0));
    if (rare.size >= RARE_TERM_CAP) break;
  }
  return { rare: [...rare], nums: [...nums] };
}

/**
 * Havuz genelinde özellik sayımı: her nadir terim / sayı, kaç FARKLI EŞ
 * başvurunun parçalarında görüldüğüyle sayılır (isTemplateChunkHash mantığının
 * özellik düzeyindeki karşılığı: kendi başvuru SAYILMAZ, aksi hâlde iki
 * raporluk havuzda paylaşılan her özellik "ortak" görünürdü). Girdi: eş
 * başvuru başına parça özellik listesi.
 */
export function poolFeatureCounts(
  applications: Array<Array<SimilarityChunkFeatures | null | undefined>>,
): { rare: Map<number, number>; nums: Map<string, number> } {
  const rare = new Map<number, number>();
  const nums = new Map<string, number>();
  for (const chunkList of applications) {
    const seenRare = new Set<number>();
    const seenNums = new Set<string>();
    for (const features of chunkList) {
      if (!features) continue;
      for (const value of features.rare) seenRare.add(value);
      for (const value of features.nums) seenNums.add(value);
    }
    for (const value of seenRare) rare.set(value, (rare.get(value) ?? 0) + 1);
    for (const value of seenNums) nums.set(value, (nums.get(value) ?? 0) + 1);
  }
  return { rare, nums };
}

/**
 * Havuzun yarısından fazlasında görülen özellik ORTAKTIR (şablon/şartname/tür
 * dili) ve doğrulama desteği OLAMAZ; özellik listesinden düşülür. Parça
 * silinmez, yalnızca ortak sinyaller desteğe sayılmaz.
 */
export function stripPoolCommonFeatures(
  features: SimilarityChunkFeatures | null | undefined,
  counts: { rare: Map<number, number>; nums: Map<string, number> },
  poolSize: number,
): SimilarityChunkFeatures | null {
  if (!features) return null;
  if (poolSize < 2) return features;
  const commonLimit = Math.max(2, Math.ceil(poolSize * 0.5));
  return {
    rare: features.rare.filter((value) => (counts.rare.get(value) ?? 0) < commonLimit),
    nums: features.nums.filter((value) => (counts.nums.get(value) ?? 0) < commonLimit),
  };
}

/** İki özellik listesinin ortak eleman sayıları (havuz-ortak süzgeci SONRASI çağrılır). */
export function sharedFeatureCounts(
  own: SimilarityChunkFeatures | null | undefined,
  peer: SimilarityChunkFeatures | null | undefined,
): { rare: number; nums: number } {
  if (!own || !peer) return { rare: 0, nums: 0 };
  const peerRare = new Set(peer.rare);
  const peerNums = new Set(peer.nums);
  return {
    rare: own.rare.filter((value) => peerRare.has(value)).length,
    nums: own.nums.filter((value) => peerNums.has(value)).length,
  };
}

/* ------------------- Ardışıklık ve anlatım sırası ölçümü ------------------- */

type PairMetrics = { consecutiveGroup: number; orderedChain: number };

/**
 * Aynı aday listesi için ölçümler BİR KEZ hesaplanır ve liste örneğine bağlı
 * olarak önbelleğe alınır: corroborationOf her aday için çağrılsa da maliyet
 * O(n²)'de kalır (adaylar zaten üst sınırlıdır).
 */
const metricsCache = new WeakMap<ReadonlyArray<CandidatePair>, Map<string, PairMetrics>>();

function pairKey(pair: CandidatePair): string {
  return `${pair.ownIndex}:${pair.peerIndex}`;
}

function computeMetrics(pairs: ReadonlyArray<CandidatePair>): Map<string, PairMetrics> {
  const unique = new Map<string, CandidatePair>();
  for (const pair of pairs) unique.set(pairKey(pair), pair);
  const list = [...unique.values()];
  const metrics = new Map<string, PairMetrics>();

  // 1) Ardışık paragraf grubu: her iki dizide de ±1 komşuluk üzerinden bağlı bileşen.
  const visited = new Set<string>();
  for (const start of list) {
    const startKey = pairKey(start);
    if (visited.has(startKey)) continue;
    const component: string[] = [];
    const queue: CandidatePair[] = [start];
    visited.add(startKey);
    while (queue.length) {
      const current = queue.pop()!;
      component.push(pairKey(current));
      for (const deltaOwn of [-1, 1]) {
        for (const deltaPeer of [-1, 1]) {
          const nextKey = `${current.ownIndex + deltaOwn}:${current.peerIndex + deltaPeer}`;
          const next = unique.get(nextKey);
          if (next && !visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push(next);
          }
        }
      }
    }
    for (const key of component) metrics.set(key, { consecutiveGroup: component.length, orderedChain: 1 });
  }

  // 2) Anlatım sırası zinciri: her iki dizide de KESİN artan en uzun zincir
  //    (bu çiftin içinden geçen); klasik O(n²) LIS bileşimi.
  const sorted = [...list].sort((left, right) => left.ownIndex - right.ownIndex || left.peerIndex - right.peerIndex);
  const endingAt = sorted.map(() => 1);
  for (let index = 0; index < sorted.length; index += 1) {
    for (let prev = 0; prev < index; prev += 1) {
      if (sorted[prev].ownIndex < sorted[index].ownIndex && sorted[prev].peerIndex < sorted[index].peerIndex) {
        endingAt[index] = Math.max(endingAt[index], endingAt[prev] + 1);
      }
    }
  }
  const startingAt = sorted.map(() => 1);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    for (let next = sorted.length - 1; next > index; next -= 1) {
      if (sorted[next].ownIndex > sorted[index].ownIndex && sorted[next].peerIndex > sorted[index].peerIndex) {
        startingAt[index] = Math.max(startingAt[index], startingAt[next] + 1);
      }
    }
  }
  for (let index = 0; index < sorted.length; index += 1) {
    const key = pairKey(sorted[index]);
    const entry = metrics.get(key) ?? { consecutiveGroup: 1, orderedChain: 1 };
    entry.orderedChain = endingAt[index] + startingAt[index] - 1;
    metrics.set(key, entry);
  }
  return metrics;
}

function metricsOf(pairs: ReadonlyArray<CandidatePair>): Map<string, PairMetrics> {
  let cached = metricsCache.get(pairs);
  if (!cached) {
    cached = computeMetrics(pairs);
    metricsCache.set(pairs, cached);
  }
  return cached;
}

/**
 * Anlamsal aday çiftin doğrulama kararı (madde 5 · Katman 2). `ok` yalnızca en
 * az bir destek sinyali bulunduğunda true olur; sinyaller hakem kartında
 * eşleşmenin NEDEN dikkate alındığını açıklamak için saklanır.
 *
 * `sharedRareCount` / `sharedNumberCount` havuz-ortak süzgecinden geçmiş
 * özellik kesişimleridir; `allCandidatePairs` aynı eş için Katman 1+2 aday
 * çiftlerinin TAMAMIDIR (doğrudan adaylar da komşuluk/sıra kanıtı sayılır).
 */
export function corroborationOf(
  pair: CandidatePair,
  sharedRareCount: number,
  sharedNumberCount: number,
  allCandidatePairs: ReadonlyArray<CandidatePair>,
  config: SimilarityCorroborationConfig,
): { ok: boolean; signals: CorroborationSignal[] } {
  const signals: CorroborationSignal[] = [];
  if (sharedRareCount >= config.minSharedRareTerms) signals.push("ayirt-edici-ifade");
  if (sharedNumberCount >= config.minSharedNumbers) signals.push("ozgun-sayilar");
  const metrics = metricsOf(allCandidatePairs).get(pairKey(pair));
  if ((metrics?.consecutiveGroup ?? 1) >= config.minConsecutivePairs) signals.push("ardisik-paragraflar");
  if ((metrics?.orderedChain ?? 1) >= config.minOrderedChain) signals.push("mimari-anlati-sirasi");
  return { ok: signals.length > 0, signals };
}
