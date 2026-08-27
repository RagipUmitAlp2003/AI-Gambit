import { buildMinHash, cosineSimilarity, minHashSimilarity } from "./similarity-engine";

/**
 * Benzerlik sisteminin metin katmanı: normalizasyon, resmî şablon temizliği,
 * parçalama (chunking) ve rapor düzeyi yaklaşık oran hesabı.
 *
 * Saf ve ortamdan bağımsızdır (tarayıcı, Cloudflare, Node testi). Mevcut
 * MinHash motoru (similarity-engine.ts) SİLİNMEZ; bu katman onu tamamlar:
 * MinHash birinci (doğrudan kopya) katmandır, embedding ikinci (anlamsal)
 * katmandır.
 *
 * Sürüm etiketi: normalizasyon/parçalama kuralı değişirse artırılır; eski
 * parça kayıtları yeni kayıtlarla KARŞILAŞTIRILMAZ (önbellek doğal düşer).
 */
export const SIMILARITY_PIPELINE_VERSION = "sim-v1";

/** Anlamsal karşılaştırma modeli ve boyutu; farklı modellerin vektörleri karşılaştırılmaz. */
export const SIMILARITY_EMBEDDING_MODEL = "gemini-embedding-001";
export const SIMILARITY_EMBEDDING_DIM = 768;

/* --------------------------- Eşik değerleri --------------------------- *
 * Otomatik ihlal sınırı DEĞİLDİR; test raporlarıyla kalibre edilebilir
 * başlangıç değerleridir (madde 9.8).
 * ---------------------------------------------------------------------- */
export const DIRECT_HIGH_THRESHOLD = 0.55;
export const DIRECT_REVIEW_THRESHOLD = 0.30;
export const SEMANTIC_HIGH_THRESHOLD = 0.90;
export const SEMANTIC_REVIEW_THRESHOLD = 0.82;

/** Rapor düzeyi yaklaşık oranın seviye eşikleri (0-100). */
export const REPORT_REVIEW_PERCENT = 30;
export const REPORT_HIGH_PERCENT = 55;

const WORD_SPLIT = /\s+/;

function lower(value: string): string {
  return value.toLocaleLowerCase("tr-TR");
}

/** Karşılaştırma anahtarı: küçük harf, aksansız, yalnızca harf/rakam. */
export function foldLine(value: string): string {
  return lower(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9çğıöşü]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NormalizeOptions = {
  /** Kapaktaki yarışma adı; bütün sayfalardan silinir. */
  competitionName?: string;
  /** Takım adı ve katılımcı adları; bütün sayfalardan silinir. */
  participantNames?: string[];
};

/**
 * Sayfa metinlerini karşılaştırma öncesi temizler (madde 9.4):
 *   - her sayfada tekrarlanan üstbilgi/altbilgi satırları,
 *   - tek başına sayfa numaraları,
 *   - yarışma adı, takım adı ve katılımcı adları,
 *   - tek başına anlam taşımayan çok kısa satırlar.
 *
 * Satır kavramı PDF metin çıkarımında kaybolabilir; bu yüzden hem satır
 * bazlı (varsa) hem dizge bazlı temizlik uygulanır.
 */
export function normalizePages(pages: string[], options: NormalizeOptions = {}): string[] {
  const removals = [options.competitionName ?? "", ...(options.participantNames ?? [])]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4);

  // 1) Yarışma/takım/katılımcı adları önce silinir; büyük-küçük harf gözetilmez.
  const stripped = pages.map((page) => {
    let cleaned = page;
    for (const removal of removals) {
      cleaned = cleaned.split(new RegExp(escapeRegExp(removal), "gi")).join(" ");
    }
    return cleaned;
  });

  // 2) Ad temizliğinden SONRA sayfaların çoğunda aynen tekrarlanan kısa
  // satırlar üstbilgi/altbilgidir (aksi hâlde "yarışma adı + rapor türü" gibi
  // karışık satırların artığı tespitten kaçardı).
  const lineCounts = new Map<string, number>();
  for (const page of stripped) {
    const lines = page.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const unique = new Set(lines.filter((line) => line.length <= 120).map(foldLine));
    for (const line of unique) {
      if (!line) continue;
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
  }
  const repeatedThreshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const repeated = new Set(
    [...lineCounts.entries()].filter(([, count]) => count >= repeatedThreshold).map(([line]) => line),
  );

  return stripped.map((page) => {
    const kept = page.split(/\n+/).filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // Tek başına sayfa numarası ("12", "Sayfa 12", "12 / 25").
      if (/^(sayfa\s*)?\d{1,4}(\s*[/-]\s*\d{1,4})?$/i.test(trimmed)) return false;
      if (trimmed.length <= 120 && repeated.has(foldLine(trimmed))) return false;
      return true;
    });
    return kept.join("\n").replace(/[ \t]+/g, " ").trim();
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------ Parçalama ------------------------------ */

/** Parça hedefleri: 300–500 kelime, ~50 kelime çakışma, çok kısa parçalar atlanır. */
export const CHUNK_TARGET_WORDS = 400;
export const CHUNK_MAX_WORDS = 500;
export const CHUNK_OVERLAP_WORDS = 50;
export const CHUNK_MIN_WORDS = 40;

export type SimilarityChunk = {
  /** submission sürümü + sayfa + sıra ile üretilen kararlı kimlik parçası. */
  index: number;
  pageStart: number;
  pageEnd: number;
  /** Parçanın bulunduğu bölüm başlığı; tespit edilemezse boş. */
  section: string;
  wordCount: number;
  text: string;
};

/**
 * Sayfa metinlerini, sayfa konumu kaybolmadan 300–500 kelimelik parçalara
 * böler. Parçalar arasında ~50 kelime çakışma bulunur; yalnızca başlık veya
 * çok kısa metin taşıyan parçalar atlanır.
 */
export function chunkPages(pages: string[]): SimilarityChunk[] {
  type Word = { word: string; page: number };
  const words: Word[] = [];
  pages.forEach((page, pageIndex) => {
    for (const word of page.split(WORD_SPLIT)) {
      const trimmed = word.trim();
      if (trimmed) words.push({ word: trimmed, page: pageIndex + 1 });
    }
  });

  const chunks: SimilarityChunk[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(words.length, start + CHUNK_MAX_WORDS);
    const slice = words.slice(start, end);
    if (slice.length >= CHUNK_MIN_WORDS) {
      chunks.push({
        index: chunks.length,
        pageStart: slice[0].page,
        pageEnd: slice[slice.length - 1].page,
        section: "",
        wordCount: slice.length,
        text: slice.map((item) => item.word).join(" "),
      });
    }
    if (end >= words.length) break;
    start = end - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

/** SHA-256 özeti (hex). Tarayıcı, Cloudflare ve Node 22'de aynı API. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Parça metninin karşılaştırma anahtarı: normalize edilmiş metnin özeti. */
export function chunkTextKey(text: string): string {
  return foldLine(text).slice(0, 4000);
}

/* ----------------------- Şablon parça temizliği ----------------------- */

/**
 * Aynı yarışmadaki başvuruların ÇOĞUNDA birebir bulunan parça resmî şablondan
 * gelmiş sayılır ve karşılaştırmadan çıkarılır: sadece ortak başlıkları
 * paylaşan iki rapor yüksek benzerlik almamalıdır (madde 9.4).
 *
 * `peerHashCounts`: parça özet → kaç FARKLI başvuruda görüldüğü.
 */
export function isTemplateChunkHash(
  hash: string,
  peerHashCounts: Map<string, number>,
  peerCount: number,
): boolean {
  if (peerCount < 2) return false;
  const seenIn = peerHashCounts.get(hash) ?? 0;
  return seenIn >= Math.max(2, Math.ceil(peerCount * 0.5));
}

/* -------------------- Rapor düzeyi yaklaşık oran -------------------- */

export type ScoredChunk = {
  index: number;
  wordCount: number;
  pageStart: number;
  text: string;
  minHash: number[];
  embedding: number[] | null;
  /** Şablon parçası: karşılaştırılabilir içerik sayılmaz. */
  template: boolean;
};

export type PeerChunk = {
  index: number;
  wordCount: number;
  pageStart: number;
  minHash: number[];
  embedding: number[] | null;
  template: boolean;
};

export type ChunkMatch = {
  ownIndex: number;
  peerIndex: number;
  kind: "direct" | "semantic";
  /** 0–1 arası eşleşme kuvveti; kapsama bu ağırlıkla sınırlanır. */
  strength: number;
  lexical: number;
  semantic: number | null;
};

/** Tek parça çifti için eşleşme kuvveti; eşik altı eşleşme SAYILMAZ. */
export function chunkMatchStrength(lexical: number, semantic: number | null): { kind: "direct" | "semantic"; strength: number } | null {
  const direct = lexical >= DIRECT_HIGH_THRESHOLD ? 1 : lexical >= DIRECT_REVIEW_THRESHOLD ? 0.6 : 0;
  const semanticScore = semantic === null
    ? 0
    : semantic >= SEMANTIC_HIGH_THRESHOLD ? 1 : semantic >= SEMANTIC_REVIEW_THRESHOLD ? 0.6 : 0;
  if (direct === 0 && semanticScore === 0) return null;
  // Doğrudan kopya izi anlamsal izden önce gelir: tür raporlamasında öncelik onundur.
  return direct >= semanticScore ? { kind: "direct", strength: direct } : { kind: "semantic", strength: semanticScore };
}

export type PeerSimilarity = {
  /** 0–100: eşleşen kelimelerin karşılaştırılabilir kelimelere ağırlıklı oranı. */
  approxPercent: number;
  matches: ChunkMatch[];
  comparableWords: number;
  matchedWords: number;
};

/**
 * Rapor düzeyi yaklaşık oran (madde 9.8):
 *   1. Her parça için diğer rapordaki en yakın parça bulunur.
 *   2. Eşik altında kalan parçalar eşleşme sayılmaz.
 *   3. Eşleşen parçaların kelime sayısı, eşleşme kuvvetiyle ağırlıklanır.
 *   4. Oran = ağırlıklı eşleşen kelime / toplam karşılaştırılabilir kelime.
 *
 * Ham cosine değeri ASLA doğrudan "yüzde benzerlik" olarak dönmez: tek benzer
 * paragraf bütün raporu %90 gösteremez, çünkü oran içerik kapsamasına bağlıdır.
 */
export function approximateReportSimilarity(own: ScoredChunk[], peer: PeerChunk[]): PeerSimilarity {
  const comparable = own.filter((chunk) => !chunk.template);
  const peerComparable = peer.filter((chunk) => !chunk.template);
  const comparableWords = comparable.reduce((sum, chunk) => sum + chunk.wordCount, 0);
  if (!comparableWords || !peerComparable.length) {
    return { approxPercent: 0, matches: [], comparableWords, matchedWords: 0 };
  }
  const matches: ChunkMatch[] = [];
  let weightedWords = 0;
  for (const chunk of comparable) {
    let best: ChunkMatch | null = null;
    for (const candidate of peerComparable) {
      const lexical = minHashSimilarity(chunk.minHash, candidate.minHash);
      const semantic = cosineSimilarity(chunk.embedding, candidate.embedding);
      const scored = chunkMatchStrength(lexical, semantic);
      if (!scored) continue;
      if (!best || scored.strength > best.strength
        || (scored.strength === best.strength && lexical > best.lexical)) {
        best = { ownIndex: chunk.index, peerIndex: candidate.index, kind: scored.kind, strength: scored.strength, lexical, semantic };
      }
    }
    if (best) {
      matches.push(best);
      weightedWords += chunk.wordCount * best.strength;
    }
  }
  return {
    approxPercent: Math.min(100, Math.round((weightedWords / comparableWords) * 100)),
    matches: matches.sort((left, right) => right.strength - left.strength || right.lexical - left.lexical),
    comparableWords,
    matchedWords: Math.round(weightedWords),
  };
}

/** Parça metni için MinHash izi; motorla aynı algoritma (minhash-v1). */
export function chunkMinHash(text: string): number[] {
  return buildMinHash(text).signature;
}
