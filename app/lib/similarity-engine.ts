export type SimilarityFingerprint = {
  algorithm: "minhash-v1";
  signature: number[];
  tokenCount: number;
  /**
   * İmzayı üreten shingle sayısı. 0 ise metin normalizasyon sonrası boştur ve
   * imza bütünüyle başlangıç değerinden (0xffffffff) oluşur: böyle bir imza
   * HİÇBİR ZAMAN benzerlik kanıtı değildir (madde 5 · Katman 1). Eski kayıtlı
   * fingerprint_json'larda bulunmaz; okunurken eksik kabul edilir.
   */
  shingleCount?: number;
  embedding: number[] | null;
  embeddingModel: string | null;
};

const SIGNATURE_SIZE = 64;

/** buildMinHash'in "bu konumda hiç shingle görülmedi" başlangıç değeri. */
const SIGNATURE_SENTINEL = 0xffffffff;

/** Normalizasyon MinHash ile AYNI kalmalı: şablon shingle'ları da bunu kullanır. */
export function normalizedWords(input: string): string[] {
  return input.toLocaleLowerCase("tr-TR")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/[^a-z0-9çğıöşü]+/gi, " ")
    .trim().split(/\s+/).filter((word) => word.length > 1);
}

/** FNV-1a türevi; şablon shingle kümesi de aynı özeti kullanır (seed 0). */
export function hash(value: string, seed: number): number {
  let result = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619) >>> 0;
  }
  result ^= result >>> 16;
  return result >>> 0;
}

export function buildMinHash(text: string): Omit<SimilarityFingerprint, "embedding" | "embeddingModel"> {
  const words = normalizedWords(text);
  const shingles = new Set<string>();
  const width = words.length >= 5 ? 5 : Math.max(1, words.length);
  for (let index = 0; index + width <= words.length; index += 1) {
    shingles.add(words.slice(index, index + width).join(" "));
    if (shingles.size >= 20_000) break;
  }
  const signature = Array.from({ length: SIGNATURE_SIZE }, () => SIGNATURE_SENTINEL);
  for (const shingle of shingles) {
    for (let seed = 0; seed < SIGNATURE_SIZE; seed += 1) {
      signature[seed] = Math.min(signature[seed], hash(shingle, seed * 0x9e3779b1));
    }
  }
  return { algorithm: "minhash-v1", signature, tokenCount: words.length, shingleCount: shingles.size };
}

/**
 * MinHash imza benzerliği (madde 5 · Katman 1).
 *
 * BAŞLANGIÇ DEĞERİ KORUMASI: iki tarafta da 0xffffffff duran konum "hiç
 * shingle görülmedi" demektir ve bilgi taşımaz; sayıma girmez. Böylece sıfır
 * shingle üreten iki metin (normalizasyon sonrası boş kalan raporlar ve eski
 * kayıtlardaki zehirli tüm-başlangıç imzaları) ASLA 1.0 benzer sayılmaz;
 * bilgi taşıyan hiçbir konum yoksa sonuç 0'dır. Tek tarafı başlangıç değeri
 * olan konum ise gerçek bir AYRIŞMADIR ve sayılmaya devam eder.
 */
export function minHashSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let equal = 0;
  let informative = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === SIGNATURE_SENTINEL && right[index] === SIGNATURE_SENTINEL) continue;
    informative += 1;
    if (left[index] === right[index]) equal += 1;
  }
  return informative ? equal / informative : 0;
}

export function cosineSimilarity(left: number[] | null, right: number[] | null): number | null {
  if (!left?.length || !right?.length || left.length !== right.length) return null;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function hybridSimilarity(left: SimilarityFingerprint, right: SimilarityFingerprint) {
  const lexical = minHashSimilarity(left.signature, right.signature);
  const semantic = cosineSimilarity(left.embedding, right.embedding);
  // Semantik yakınlık tek başına ihlal sayılmaz. Ortak ifade iziyle birlikte
  // sıralamayı güçlendirir; nihai karar her zaman Hakemdedir.
  const combined = semantic === null ? lexical : (lexical * 0.65) + (Math.max(0, semantic) * 0.35);
  return { lexical, semantic, combined };
}
