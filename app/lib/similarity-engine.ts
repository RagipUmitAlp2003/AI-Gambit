export type SimilarityFingerprint = {
  algorithm: "minhash-v1";
  signature: number[];
  tokenCount: number;
  embedding: number[] | null;
  embeddingModel: string | null;
};

const SIGNATURE_SIZE = 64;

function normalizedWords(input: string): string[] {
  return input.toLocaleLowerCase("tr-TR")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/[^a-z0-9çğıöşü]+/gi, " ")
    .trim().split(/\s+/).filter((word) => word.length > 1);
}

function hash(value: string, seed: number): number {
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
  const signature = Array.from({ length: SIGNATURE_SIZE }, () => 0xffffffff);
  for (const shingle of shingles) {
    for (let seed = 0; seed < SIGNATURE_SIZE; seed += 1) {
      signature[seed] = Math.min(signature[seed], hash(shingle, seed * 0x9e3779b1));
    }
  }
  return { algorithm: "minhash-v1", signature, tokenCount: words.length };
}

export function minHashSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let equal = 0;
  for (let index = 0; index < length; index += 1) if (left[index] === right[index]) equal += 1;
  return equal / length;
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
