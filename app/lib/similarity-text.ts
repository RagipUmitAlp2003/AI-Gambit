import { buildMinHash, cosineSimilarity, hash as fnvHash, minHashSimilarity, normalizedWords } from "./similarity-engine";
import { PDF_STRUCTURE_VERSION } from "./pdf-structure";
import { semanticCandidateAllowed } from "./similarity-candidates";
import { DEFAULT_SIMILARITY_THRESHOLDS, MAX_CHUNKS_PER_DOC, type SimilarityThresholds } from "./similarity-config";
import {
  corroborationOf,
  sharedFeatureCounts,
  type CorroborationSignal,
  type SimilarityChunkFeatures,
} from "./similarity-corroboration";

/**
 * Benzerlik sisteminin metin katmanı: normalizasyon, resmî şablon temizliği,
 * yapısal ayıklama/sınıflandırma (GÖREV 3 · madde 2 ve 4), parçalama
 * (chunking) ve rapor düzeyi yaklaşık oran hesabı.
 *
 * Saf ve ortamdan bağımsızdır (tarayıcı, Cloudflare, Node testi). Mevcut
 * MinHash motoru (similarity-engine.ts) SİLİNMEZ; bu katman onu tamamlar:
 * MinHash birinci (doğrudan kopya) katmandır, embedding ikinci (anlamsal)
 * katmandır.
 *
 * "Rapor dili" ve genel teknik ifadeler için ayrıca bir durak-liste TUTULMAZ:
 * puana yalnızca eşleşen shingle/embedding sinyali girer, ortak dil zaten
 * kendi başına eşleşme üretmez; çoğunlukta birebir görülen parçaları da
 * isTemplateChunkHash karşılaştırma dışına alır.
 *
 * Sürüm etiketi: normalizasyon/parçalama kuralı değişirse artırılır; eski
 * parça kayıtları yeni kayıtlarla KARŞILAŞTIRILMAZ (önbellek doğal düşer).
 * v2: yapısal (başlık/paragraf/liste/tablo satırı/şekil açıklaması temelli)
 * parçalama; PDF yapı sürümü bileşiktir, pdf-structure değişince benzerlik
 * önbelleği de kendiliğinden eskir.
 */
export const SIMILARITY_PIPELINE_VERSION = `sim-v2:${PDF_STRUCTURE_VERSION}`;

/** Anlamsal karşılaştırma modeli ve boyutu; farklı modellerin vektörleri karşılaştırılmaz. */
export const SIMILARITY_EMBEDDING_MODEL = "gemini-embedding-001";
export const SIMILARITY_EMBEDDING_DIM = 768;

/* --------------------------- Eşik değerleri --------------------------- *
 * Otomatik ihlal sınırı DEĞİLDİR; test raporlarıyla kalibre edilebilir
 * başlangıç değerleridir (madde 9.8). Tek doğruluk kaynağı ve ortam
 * değişkeni desteği similarity-config.ts'tedir; buradaki adlar geriye uyum
 * için AYNEN yeniden dışa verilir.
 * ---------------------------------------------------------------------- */
export {
  DIRECT_HIGH_THRESHOLD,
  DIRECT_REVIEW_THRESHOLD,
  SEMANTIC_HIGH_THRESHOLD,
  SEMANTIC_REVIEW_THRESHOLD,
  REPORT_REVIEW_PERCENT,
  REPORT_HIGH_PERCENT,
} from "./similarity-config";

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

/**
 * Parça hedefleri (madde 4): 100–220 kelime, uzun bölümlerde ~30 kelime
 * çakışma; kuyruk birleştirmede yumuşak tavan 250. Çok kısa parçalar atlanır.
 */
export const CHUNK_MAX_WORDS = 220;
export const CHUNK_OVERLAP_WORDS = 30;
export const CHUNK_MIN_WORDS = 30;
export const CHUNK_SOFT_MAX_WORDS = 250;

export type SimilarityChunk = {
  /** submission sürümü + sayfa + sıra ile üretilen kararlı kimlik parçası. */
  index: number;
  pageStart: number;
  pageEnd: number;
  /** Parçanın bulunduğu bölüm başlığı; tespit edilemezse boş. */
  section: string;
  wordCount: number;
  text: string;
  /**
   * Parçanın karşılaştırılabilir belge kelime akışındaki BAŞLANGIÇ konumu
   * (0 tabanlı). Kapsama oranı bu aralıklarla ([wordStart, wordStart+wordCount))
   * hesaplanır: çakışan parçaların ortak kelimeleri İKİ KEZ SAYILMAZ (madde 6).
   * Eski önbellek satırlarında bulunmaz; null okunursa oran hesabı ayrık
   * aralık varsayımına (eski aritmetiğe) döner.
   */
  wordStart: number | null;
  /** Parçayı oluşturan ilk/son yapısal blok sırası; yedek yolda 0. */
  blockStart: number;
  blockEnd: number;
  /** Tablo satırlarından üretilen parçalar ayrı tutulur (madde 4: tablolar atılmaz). */
  kind: "text" | "table";
};

/**
 * YEDEK yol: sayfa metinlerini, sayfa konumu kaybolmadan 100–220 kelimelik
 * parçalara böler. Parçalar arasında ~30 kelime çakışma bulunur; yalnızca
 * başlık veya çok kısa metin taşıyan parçalar atlanır.
 *
 * Asıl yol yapısal parçalamadır (classifyBlocks + chunkStructuredBlocks);
 * bu işlev, PDF metin katmanı yapısal ayrıştırmaya yetmediğinde istemcinin
 * çıkardığı sayfa metinleriyle çalışan geriye uyum yedeğidir.
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
        wordStart: start,
        blockStart: 0,
        blockEnd: 0,
        kind: "text",
      });
    }
    if (end >= words.length) break;
    start = end - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

/* ------------------- Yapısal ayıklama ve sınıflandırma ------------------- *
 * Madde 2 ve 4: kapak, içindekiler, başlıklar, kimlik satırları, kaynakça,
 * açık alıntılar, şartname aktarmaları ve resmî şablon metni benzerlik
 * hesabından AYRILIR ama SİLİNMEZ; denetim için gerekçesiyle saklanır.
 * ------------------------------------------------------------------------- */

export type ExclusionReason =
  | "sablon"
  | "baslik"
  | "kimlik"
  | "kapak-icindekiler"
  | "sartname-alintisi"
  | "kaynakca"
  | "acik-alinti"
  | "cok-kisa"
  | "tavan";

/** Ayıklanan içeriğin denetim etiketi (madde 3). */
export const EXCLUSION_AUDIT_LABEL = "Benzerlik puanına katılmayan ortak/şablon içeriği";

/** Karşılaştırmaya girmeyen ama denetim için saklanan blok/aralık. */
export type ExcludedBlock = {
  page: number;
  section: string;
  reason: ExclusionReason;
  text: string;
};

/**
 * Yapısal parçalamanın girişi; PdfStructureBlock ile yapısal olarak uyumludur
 * (route katmanı dönüştürür) ama bu modül ortamdan bağımsız kalır.
 */
export type SimilarityBlockInput = {
  page: number;
  sectionTitle: string;
  subsectionTitle: string;
  blockType: "HEADING" | "NUMBERED_CLAUSE" | "PARAGRAPH" | "LIST_ITEM" | "TABLE_ROW" | "CAPTION";
  text: string;
  /** Belgedeki blok sırası; parça meta verisinde paragraf/tablo konumudur. */
  ordinal: number;
};

/** Resmî şablon filtresi (madde 3); yüklü şablon yoksa null geçilir. */
export type TemplateFilter = {
  version: number;
  /** Şablon bloklarının katlanmış satırları; birebir eşleşen blok ayıklanır. */
  foldedLines: Set<string>;
  /** Şablon shingle özetleri; parça düzeyi kısmi örtüşme işareti için. */
  shingles: Set<number>;
};

const BIBLIOGRAPHY_HEADINGS = new Set(["kaynakca", "kaynaklar", "referanslar", "bibliography", "references"]);
const FRONT_MATTER_HEADINGS = new Set([
  "icindekiler", "contents", "table of contents", "icindekiler tablosu",
  "tablolar listesi", "sekiller listesi", "resimler listesi",
  "kisaltmalar", "kisaltmalar listesi", "semboller listesi",
]);

/** Şartname alıntısı sayılmak için asgari kelime sayısı. */
const SPEC_QUOTE_MIN_WORDS = 8;
/** Alıntı bloğun bu oranını kaplıyorsa blok bütünüyle ayıklanır. */
const SPEC_QUOTE_BLOCK_COVERAGE = 0.6;
/** Açık alıntı sayılmak için asgari kelime sayısı. */
const EXPLICIT_QUOTE_MIN_WORDS = 12;
const EXPLICIT_QUOTE_PATTERN = /["“«„]([^"“”«»„]{40,}?)["”»]/g;
const CITATION_AFTER = /^[\s.,;:]{0,4}(\[\d{1,3}\]|\([^()]{0,80}?(19|20)\d{2}\))/;
const CITATION_BEFORE = /(\[\d{1,3}\]|\([^()]{0,80}?(19|20)\d{2}\))[\s.,;:]{0,4}$/;

function wordCountOf(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(WORD_SPLIT).length : 0;
}

/** Bölüm anahtarı: parça asla iki farklı anahtarı KARIŞTIRMAZ (madde 4). */
export function sectionKeyOf(block: Pick<SimilarityBlockInput, "sectionTitle" | "subsectionTitle">): string {
  const main = block.sectionTitle.trim();
  const sub = block.subsectionTitle.trim();
  return sub ? (main ? `${main} / ${sub}` : sub) : main;
}

function identityRemovals(competitionName?: string, participantNames?: string[]): string[] {
  return [competitionName ?? "", ...(participantNames ?? [])]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4);
}

/** Yarışma/takım/katılımcı adlarını metinden söker (normalizePages ile aynı kural). */
export function stripIdentity(text: string, removals: string[]): string {
  let cleaned = text;
  for (const removal of removals) {
    cleaned = cleaned.split(new RegExp(escapeRegExp(removal), "gi")).join(" ");
  }
  return cleaned.replace(/[ \t]+/g, " ").trim();
}

/**
 * Blok kelimelerinin katlanmış izdüşümü: katlanmış dizide bulunan alıntının
 * orijinal kelime aralığına geri eşlenebilmesi için indeks haritası tutulur.
 */
function foldedWordsOf(text: string): { words: string[]; folded: string[]; foldedIndex: number[] } {
  const words = text.split(WORD_SPLIT).filter(Boolean);
  const folded: string[] = [];
  const foldedIndex: number[] = [];
  words.forEach((word, index) => {
    for (const piece of foldLine(word).split(" ")) {
      if (!piece) continue;
      folded.push(piece);
      foldedIndex.push(index);
    }
  });
  return { words, folded, foldedIndex };
}

function findFoldedSequence(haystack: string[], needle: string[]): number {
  if (!needle.length || needle.length > haystack.length) return -1;
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

/** Tırnak + atıf işaretli açık alıntı aralıklarını söker; sökülenleri döndürür. */
function stripExplicitQuotes(text: string): { text: string; removed: string[] } {
  const spans: Array<{ start: number; end: number }> = [];
  EXPLICIT_QUOTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPLICIT_QUOTE_PATTERN.exec(text)) !== null) {
    if (wordCountOf(match[1]) < EXPLICIT_QUOTE_MIN_WORDS) continue;
    const afterStart = match.index + match[0].length;
    const after = text.slice(afterStart, afterStart + 24);
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    const citation = CITATION_AFTER.exec(after);
    if (!citation && !CITATION_BEFORE.test(before)) continue;
    spans.push({ start: match.index, end: afterStart + (citation ? citation[0].length : 0) });
  }
  if (!spans.length) return { text, removed: [] };
  const removed: string[] = [];
  const kept: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    kept.push(text.slice(cursor, span.start));
    removed.push(text.slice(span.start, span.end).trim());
    cursor = span.end;
  }
  kept.push(text.slice(cursor));
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}

/**
 * Yapısal blokları karşılaştırılabilir içerik ve denetim için saklanan
 * ayıklanmış içerik olarak sınıflandırır (madde 2 ve 4). Kurallar
 * deterministiktir; hiçbir kural puanı YÜKSELTEMEZ, yalnızca karşılaştırma
 * dışı bırakır. Tablolar tamamen kaldırılmaz: TABLE_ROW ve CAPTION blokları
 * projeye özgü içerik olarak karşılaştırılmaya devam eder.
 */
export function classifyBlocks(
  blocks: SimilarityBlockInput[],
  options: {
    competitionName?: string;
    participantNames?: string[];
    /** Yayımlı profil kriterlerinin kaynak alıntıları (şartname aktarmaları). */
    sartnameQuotes?: string[];
    /** Şablondan gelen zorunlu başlıklar; başlık sayılır ve ayıklanır. */
    mandatoryHeadings?: string[];
    /** Resmî şablon filtresi (madde 3); yoksa null — çoğunluk sezgisi devrede kalır. */
    templateFilter?: TemplateFilter | null;
  } = {},
): { included: SimilarityBlockInput[]; excluded: ExcludedBlock[] } {
  const removals = identityRemovals(options.competitionName, options.participantNames);
  const mandatory = new Set((options.mandatoryHeadings ?? []).map((heading) => foldLine(heading)).filter(Boolean));
  const quotes = (options.sartnameQuotes ?? [])
    .map((quote) => foldLine(quote).split(" ").filter(Boolean))
    .filter((tokens) => tokens.length >= SPEC_QUOTE_MIN_WORDS);
  const included: SimilarityBlockInput[] = [];
  const excluded: ExcludedBlock[] = [];
  let inBibliography = false;
  let inFrontMatter = false;

  for (const block of blocks) {
    const section = sectionKeyOf(block);
    const fold = foldLine(block.text);
    const record = (reason: ExclusionReason, text = block.text) => {
      excluded.push({ page: block.page, section, reason, text });
    };

    // a) Başlıklar bölüm bağlamını taşır ama tek başına parça içeriği DEĞİLDİR.
    if (block.blockType === "HEADING") {
      inBibliography = BIBLIOGRAPHY_HEADINGS.has(fold);
      inFrontMatter = FRONT_MATTER_HEADINGS.has(fold);
      record(inBibliography ? "kaynakca" : inFrontMatter ? "kapak-icindekiler" : "baslik");
      continue;
    }
    // b) Kaynakça: başlıktan bir sonraki başlığa kadar bütün bloklar.
    if (inBibliography) { record("kaynakca"); continue; }
    // c) İçindekiler/listeler bölümü ve kapaktaki kısa kimlik/üst veri satırları.
    if (inFrontMatter) { record("kapak-icindekiler"); continue; }
    if (block.page === 1 && wordCountOf(block.text) < 8) { record("kapak-icindekiler"); continue; }
    // g) Resmî şablonda birebir geçen satır (madde 3). Şablon yokken hiçbir şey
    // yapılmaz; çoğunlukta birebir görülen parçaları isTemplateChunkHash yakalar.
    if (options.templateFilter && fold && options.templateFilter.foldedLines.has(fold)) {
      record("sablon");
      continue;
    }
    // Zorunlu başlık, başlık olarak sınıflanmamış olsa bile başlıktır.
    if (fold && mandatory.has(fold)) { record("baslik"); continue; }

    // d) Kimlik: yarışma/takım/katılımcı adları satır içinden sökülür.
    let text = removals.length ? stripIdentity(block.text, removals) : block.text;
    if (wordCountOf(text) < 3 && wordCountOf(block.text) > wordCountOf(text)) {
      record("kimlik");
      continue;
    }

    // e) Şartname aktarması: kaynak alıntısı bloğun çoğunu kaplıyorsa blok
    // bütünüyle, aksi hâlde yalnızca alıntı aralığı ayıklanır. Aynı alıntı
    // blokta birden çok kez geçebilir; HER geçiş ayıklanır (yalnızca ilki değil).
    let wholeBlockSpec = false;
    for (const quoteTokens of quotes) {
      for (;;) {
        const { words, folded, foldedIndex } = foldedWordsOf(text);
        const at = findFoldedSequence(folded, quoteTokens);
        if (at < 0) break;
        if (quoteTokens.length >= folded.length * SPEC_QUOTE_BLOCK_COVERAGE) { wholeBlockSpec = true; break; }
        const startWord = foldedIndex[at];
        const endWord = foldedIndex[at + quoteTokens.length - 1];
        record("sartname-alintisi", words.slice(startWord, endWord + 1).join(" "));
        // Her turda en az bir kelime söküldüğü için döngü her zaman sonlanır.
        text = [...words.slice(0, startWord), ...words.slice(endWord + 1)].join(" ");
      }
      if (wholeBlockSpec) break;
    }
    if (wholeBlockSpec) { record("sartname-alintisi"); continue; }

    // f) Açık alıntı: tırnaklı ve atıf işaretli aralıklar sökülür.
    const explicit = stripExplicitQuotes(text);
    for (const removedSpan of explicit.removed) record("acik-alinti", removedSpan);
    text = explicit.text;

    // h) Çok kısa kalan metin tek başına anlam taşımaz; tablo satırı korunur.
    if (block.blockType !== "TABLE_ROW" && wordCountOf(text) < 5) {
      record("cok-kisa", block.text);
      continue;
    }
    included.push({ ...block, text });
  }
  return { included, excluded };
}

/* --------------------- Yapı temelli parçalama (madde 4) --------------------- */

type SegmentWord = { word: string; page: number; ordinal: number };
type Segment = { section: string; kind: "text" | "table"; words: SegmentWord[] };

/**
 * Sınıflandırmadan geçen blokları bölüm sınırlarına saygılı parçalara böler:
 *   - Parça asla iki bölümün metnini KARIŞTIRMAZ.
 *   - Çakışma (~30 kelime) yalnızca aynı bölümün ardışık parçaları arasındadır.
 *   - Ardışık tablo satırları (varsa hemen önündeki şekil/tablo açıklamasıyla)
 *     kendi "table" parçalarını oluşturur; tablolar karşılaştırmadan atılmaz.
 *   - 30 kelimeden kısa kuyruk, aynı bölümün önceki parçasına eklenir
 *     (yumuşak tavan 250); tek başına kalan kısa bölüm parça olamaz ve
 *     denetim listesine "cok-kisa" olarak yazılır.
 *   - PARÇA TAVANI (madde 8 · bellek koruması): belge başına en fazla
 *     `maxChunks` parça üretilir (varsayılan 400, env SIMILARITY_MAX_CHUNKS).
 *     Patolojik uzunluktaki rapor binlerce parça üretip havuz okumalarında
 *     Worker belleğini dolduramaz. Tavanı aşan kuyruk SESSİZCE atılmaz:
 *     belge sırası korunur ve atılan metin "tavan" gerekçesiyle denetim
 *     listesine yazılır (rapor + R2 denetim nesnesinde görünür).
 */
export function chunkStructuredBlocks(
  included: SimilarityBlockInput[],
  maxChunks: number = MAX_CHUNKS_PER_DOC,
): { chunks: SimilarityChunk[]; dropped: ExcludedBlock[] } {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (let index = 0; index < included.length; index += 1) {
    const block = included[index];
    const section = sectionKeyOf(block);
    const next = included[index + 1];
    const isTable = block.blockType === "TABLE_ROW"
      || (block.blockType === "CAPTION" && next?.blockType === "TABLE_ROW" && sectionKeyOf(next) === section);
    const kind: "text" | "table" = isTable ? "table" : "text";
    if (!current || current.section !== section || current.kind !== kind) {
      current = { section, kind, words: [] };
      segments.push(current);
    }
    for (const word of block.text.split(WORD_SPLIT)) {
      const trimmed = word.trim();
      if (trimmed) current.words.push({ word: trimmed, page: block.page, ordinal: block.ordinal });
    }
  }

  const chunks: SimilarityChunk[] = [];
  const dropped: ExcludedBlock[] = [];
  // Belge genelinde kelime akışı konumu: kapsama oranı çakışan parçaların
  // ortak kelimelerini bir kez saysın diye her parça mutlak aralığını taşır.
  let segmentBase = 0;
  for (const segment of segments) {
    const words = segment.words;
    if (!words.length) continue;
    // Tavan doldu: kalan bölümler parçalanmaz, "tavan" gerekçesiyle denetime yazılır.
    if (chunks.length >= maxChunks) {
      dropped.push({
        page: words[0].page,
        section: segment.section,
        reason: "tavan",
        text: words.map((item) => item.word).join(" "),
      });
      segmentBase += words.length;
      continue;
    }
    if (words.length < CHUNK_MIN_WORDS) {
      // Kısa bölüm başka bölümle birleştirilMEZ; denetimde görünür kalır.
      dropped.push({
        page: words[0].page,
        section: segment.section,
        reason: "cok-kisa",
        text: words.map((item) => item.word).join(" "),
      });
      segmentBase += words.length;
      continue;
    }
    let start = 0;
    // Tavan kesmesinde denetime yazılacak kuyruk buradan başlar (çakışma
    // kelimeleri iki kez sayılmasın diye üretilen son parçanın SONU izlenir).
    let emittedEnd = 0;
    while (start < words.length) {
      if (chunks.length >= maxChunks) {
        const tail = words.slice(emittedEnd);
        if (tail.length) {
          dropped.push({
            page: tail[0].page,
            section: segment.section,
            reason: "tavan",
            text: tail.map((item) => item.word).join(" "),
          });
        }
        break;
      }
      let end = Math.min(words.length, start + CHUNK_MAX_WORDS);
      const remaining = words.length - end;
      // Kuyruk birleştirme: 30 kelimeden kısa artık öne eklenir (tavan 250).
      if (remaining > 0 && remaining < CHUNK_MIN_WORDS && end - start + remaining <= CHUNK_SOFT_MAX_WORDS) {
        end = words.length;
      }
      const slice = words.slice(start, end);
      chunks.push({
        index: chunks.length,
        pageStart: slice[0].page,
        pageEnd: slice[slice.length - 1].page,
        section: segment.section,
        wordCount: slice.length,
        text: slice.map((item) => item.word).join(" "),
        wordStart: segmentBase + start,
        blockStart: slice[0].ordinal,
        blockEnd: slice[slice.length - 1].ordinal,
        kind: segment.kind,
      });
      emittedEnd = end;
      if (end >= words.length) break;
      // Çakışma yalnızca AYNI bölümün ardışık parçaları arasında kurulur.
      start = end - CHUNK_OVERLAP_WORDS;
    }
    segmentBase += words.length;
  }
  return { chunks, dropped };
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

/* ---------------------- Resmî şablon shingle filtresi ---------------------- *
 * Madde 3: Yarışma Yöneticisinin yüklediği resmî rapor şablonu, parça düzeyinde
 * YETKİLİ ikinci sinyaldir. Şablonla örtüşen parça SİLİNMEZ; yalnızca
 * "karşılaştırmaya girmez" işareti alır (EXCLUSION_AUDIT_LABEL ile denetlenir).
 * Şablonu olmayan havuzlarda çoğunluk sezgisi (isTemplateChunkHash) yedek
 * olarak AYNEN devrede kalır. Bu şablon kriter üretmez ve rapor uygunluğu
 * kararı vermez; types.ts'teki emekli TemplateProfile (kriter akışı) ile
 * İLGİSİZDİR.
 * --------------------------------------------------------------------------- */

/** Şablon shingle kural sürümü; normalizasyon/shingle kuralı değişirse artırılır. */
export const TEMPLATE_FILTER_VERSION = "sablon-v1";
/**
 * Parça shingle'larının bu oranı şablonda birebir bulunuyorsa parça şablon
 * sayılır. Kalibre edilebilir başlangıç değeridir (madde 12); eşik yalnızca
 * parçayı karşılaştırma DIŞI bırakır, hiçbir puanı yükseltemez.
 */
export const TEMPLATE_CHUNK_OVERLAP = 0.6;
/** Şablon shingle kümesi üst sınırı; Worker belleği korunur. */
export const TEMPLATE_SHINGLE_CAP = 50_000;

/** MinHash ile AYNI normalizasyon: 5'li kelime shingle + FNV özeti (seed 0). */
export function shingleHashesOf(text: string, cap: number = TEMPLATE_SHINGLE_CAP): Set<number> {
  const words = normalizedWords(text);
  const width = words.length >= 5 ? 5 : Math.max(1, words.length);
  const hashes = new Set<number>();
  for (let index = 0; index + width <= words.length; index += 1) {
    hashes.add(fnvHash(words.slice(index, index + width).join(" "), 0));
    if (hashes.size >= cap) break;
  }
  return hashes;
}

/** Şablon sayfalarının shingle kümesi; yükleme anında BİR KEZ üretilir ve R2'de saklanır. */
export function templateShingleHashes(pages: string[]): Set<number> {
  return shingleHashesOf(pages.join("\n"));
}

/** Şablon blok/satırlarının katlanmış izdüşümü; classifyBlocks "sablon" kuralını besler. */
export function templateFoldedLines(lines: string[]): Set<string> {
  const folded = new Set<string>();
  for (const line of lines) {
    const key = foldLine(line);
    if (key) folded.add(key);
  }
  return folded;
}

/**
 * Parça shingle'larının şablonda görülme oranı (0–1). Sıfır shingle üreten
 * metin HİÇBİR ZAMAN benzer sayılmaz: iki taraftan biri boşsa 0 döner
 * (madde 5/Katman 1 ile tutarlı).
 */
export function chunkTemplateOverlap(chunkText: string, templateShingles: Set<number>): number {
  if (!templateShingles.size) return 0;
  const chunkShingles = shingleHashesOf(chunkText);
  if (!chunkShingles.size) return 0;
  let seen = 0;
  for (const shingle of chunkShingles) if (templateShingles.has(shingle)) seen += 1;
  return seen / chunkShingles.size;
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
  /** Kelime akışı başlangıcı; eski kayıtlarda yoktur (null → ayrık aralık varsayımı). */
  wordStart?: number | null;
  /** Doğrulama özellikleri (havuz-ortak süzgeci SONRASI); eski kayıtlarda null. */
  features?: SimilarityChunkFeatures | null;
  /** 64 bit işaret izi (madde 8 · CPU koruması); yoksa kosinüs kapısı açık kalır. */
  sketch?: string | null;
};

export type PeerChunk = {
  index: number;
  wordCount: number;
  pageStart: number;
  minHash: number[];
  embedding: number[] | null;
  template: boolean;
  wordStart?: number | null;
  features?: SimilarityChunkFeatures | null;
  /** 64 bit işaret izi (madde 8 · CPU koruması); yoksa kosinüs kapısı açık kalır. */
  sketch?: string | null;
};

export type ChunkMatch = {
  ownIndex: number;
  peerIndex: number;
  kind: "direct" | "semantic";
  /** 0–1 arası eşleşme kuvveti; kapsama bu ağırlıkla sınırlanır. */
  strength: number;
  lexical: number;
  semantic: number | null;
  /** Anlamsal eşleşmeyi ayakta tutan destek sinyalleri; doğrudan eşleşmede boş. */
  corroboration?: CorroborationSignal[];
};

/**
 * Tek parça çifti için ADAY eşleşme kuvveti; eşik altı çift aday bile olamaz.
 * Bu işlev NİHAİ eşleşme kararı DEĞİLDİR: anlamsal adaylar ayrıca doğrulama
 * kapısından (corroborationOf, madde 5 · Katman 2) geçmek zorundadır.
 */
export function chunkMatchStrength(
  lexical: number,
  semantic: number | null,
  thresholds: SimilarityThresholds = DEFAULT_SIMILARITY_THRESHOLDS,
): { kind: "direct" | "semantic"; strength: number } | null {
  const direct = lexical >= thresholds.directHigh ? 1 : lexical >= thresholds.directReview ? 0.6 : 0;
  const semanticScore = semantic === null
    ? 0
    : semantic >= thresholds.semanticHigh ? 1 : semantic >= thresholds.semanticReview ? 0.6 : 0;
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

/** CPU sınırı: parça başına en fazla bu kadar anlamsal aday değerlendirilir. */
const MAX_SEMANTIC_CANDIDATES_PER_CHUNK = 5;
/** CPU sınırı: eş başına toplam aday çift üst sınırı (en güçlüler kalır). */
const MAX_CANDIDATE_PAIRS_PER_PEER = 500;

type WeightedSpan = { start: number; end: number; weight: number };

/**
 * Ağırlıklı aralık birleşimi: çakışan aralıklarda bir kelimenin ağırlığı,
 * onu kapsayan eşleşmelerin EN BÜYÜĞÜDÜR (toplamı değil) — aynı içerik birden
 * fazla eşleşmede TEKRAR SAYILMAZ (madde 6). Sınır noktalı süpürme; aralık
 * sayısı zaten üst sınırlıdır.
 */
function weightedSpanUnion(spans: WeightedSpan[]): number {
  const valid = spans.filter((span) => span.end > span.start);
  if (!valid.length) return 0;
  const bounds = [...new Set(valid.flatMap((span) => [span.start, span.end]))].sort((left, right) => left - right);
  let total = 0;
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const from = bounds[index];
    const to = bounds[index + 1];
    let weight = 0;
    for (const span of valid) {
      if (span.start <= from && span.end >= to) weight = Math.max(weight, span.weight);
    }
    total += (to - from) * weight;
  }
  return total;
}

/**
 * Karşılaştırılabilir özgün içerik miktarı (madde 6'nın PAYDASI): parça
 * aralıklarının birleşimi. Çakışan parçaların ortak kelimeleri BİR kez
 * sayılır. Herhangi bir parçanın konumu bilinmiyorsa (eski önbellek satırı)
 * ayrık aralık varsayımıyla eski aritmetiğe dönülür.
 */
export function comparableWordUnion(
  chunks: Array<{ wordStart?: number | null; wordCount: number }>,
): number {
  const spansKnown = chunks.every((chunk) => typeof chunk.wordStart === "number" && Number.isFinite(chunk.wordStart));
  if (!spansKnown) return chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0);
  return Math.round(weightedSpanUnion(
    chunks.map((chunk) => ({ start: chunk.wordStart as number, end: (chunk.wordStart as number) + chunk.wordCount, weight: 1 })),
  ));
}

/**
 * Rapor düzeyi yaklaşık oran (madde 6):
 *
 *   Oran = eşleşen anlamlı ve özgün içerik / toplam karşılaştırılabilir özgün içerik
 *
 *   A AŞAMASI (adaylar): her şablon dışı parça için eşik üstü doğrudan
 *   (MinHash) ve anlamsal (cosine) adaylar toplanır; CPU için parça başına
 *   anlamsal aday ve eş başına toplam aday sınırlıdır.
 *   B AŞAMASI (doğrulama kapısı, madde 5 · Katman 2): doğrudan adaylar
 *   kendiliğinden geçer; anlamsal aday YALNIZCA destek sinyali (ayırt edici
 *   ifade, özgün sayılar, ardışık paragraflar, anlatım sırası) bulunursa
 *   hayatta kalır — embedding tek başına alarm ÜRETEMEZ.
 *   KAPSAMA: her parçanın hayatta kalan en iyi eşleşmesi, parça aralığını
 *   eşleşme kuvveti ağırlığıyla örter; çakışan aralıklarda ağırlıkların en
 *   büyüğü geçerlidir. Aynı içerik birden fazla eşleşmede tekrar sayılmaz ve
 *   ham cosine değeri ASLA doğrudan "yüzde benzerlik" olamaz.
 */
export function approximateReportSimilarity(
  own: ScoredChunk[],
  peer: PeerChunk[],
  thresholds: SimilarityThresholds = DEFAULT_SIMILARITY_THRESHOLDS,
): PeerSimilarity {
  const comparable = own.filter((chunk) => !chunk.template);
  const peerComparable = peer.filter((chunk) => !chunk.template);
  const comparableWords = comparableWordUnion(comparable);
  if (!comparableWords || !peerComparable.length) {
    return { approxPercent: 0, matches: [], comparableWords, matchedWords: 0 };
  }

  // A AŞAMASI — aday çiftler. Pahalı 768 boyutlu kosinüs yalnızca işaret izi
  // (ucuz sinyal) yeterince yakın olan adaylara uygulanır (madde 8 · CPU
  // koruması); iz eksikse kapı açık kalır ve eski davranış birebir korunur.
  // MinHash (doğrudan kopya) kanalı iz kapısından ETKİLENMEZ.
  let candidates: ChunkMatch[] = [];
  for (const chunk of comparable) {
    const semanticCandidates: ChunkMatch[] = [];
    for (const candidate of peerComparable) {
      const lexical = minHashSimilarity(chunk.minHash, candidate.minHash);
      const semantic = semanticCandidateAllowed(chunk.sketch, candidate.sketch)
        ? cosineSimilarity(chunk.embedding, candidate.embedding)
        : null;
      const scored = chunkMatchStrength(lexical, semantic, thresholds);
      if (!scored) continue;
      const pair: ChunkMatch = {
        ownIndex: chunk.index, peerIndex: candidate.index,
        kind: scored.kind, strength: scored.strength, lexical, semantic,
      };
      if (scored.kind === "direct") candidates.push(pair);
      else semanticCandidates.push(pair);
    }
    semanticCandidates.sort((left, right) => (right.semantic ?? 0) - (left.semantic ?? 0));
    candidates.push(...semanticCandidates.slice(0, MAX_SEMANTIC_CANDIDATES_PER_CHUNK));
  }
  if (candidates.length > MAX_CANDIDATE_PAIRS_PER_PEER) {
    candidates = candidates
      .sort((left, right) => right.strength - left.strength || right.lexical - left.lexical)
      .slice(0, MAX_CANDIDATE_PAIRS_PER_PEER);
  }

  // B AŞAMASI — doğrulama kapısı (yalnızca ELEYEBİLİR, puan yükseltemez).
  const ownByIndex = new Map(comparable.map((chunk) => [chunk.index, chunk]));
  const peerByIndex = new Map(peerComparable.map((chunk) => [chunk.index, chunk]));
  const surviving: ChunkMatch[] = [];
  for (const candidate of candidates) {
    if (candidate.kind === "direct") {
      surviving.push({ ...candidate, corroboration: [] });
      continue;
    }
    const shared = sharedFeatureCounts(
      ownByIndex.get(candidate.ownIndex)?.features,
      peerByIndex.get(candidate.peerIndex)?.features,
    );
    const verdict = corroborationOf(candidate, shared.rare, shared.nums, candidates, thresholds.corroboration);
    if (verdict.ok) surviving.push({ ...candidate, corroboration: verdict.signals });
  }

  // Her parçanın hayatta kalan EN İYİ eşleşmesi (kuvvet, sonra sözlüksel iz).
  const bestByOwn = new Map<number, ChunkMatch>();
  for (const match of surviving) {
    const current = bestByOwn.get(match.ownIndex);
    if (!current || match.strength > current.strength
      || (match.strength === current.strength && match.lexical > current.lexical)) {
      bestByOwn.set(match.ownIndex, match);
    }
  }
  const matches = [...bestByOwn.values()];

  // KAPSAMA — kelime aralığı birleşimi (çift sayım yok, madde 6).
  const spansKnown = comparable.every((chunk) => typeof chunk.wordStart === "number" && Number.isFinite(chunk.wordStart));
  let weightedWords = 0;
  if (spansKnown) {
    weightedWords = weightedSpanUnion(matches.map((match) => {
      const chunk = ownByIndex.get(match.ownIndex)!;
      return { start: chunk.wordStart as number, end: (chunk.wordStart as number) + chunk.wordCount, weight: match.strength };
    }));
  } else {
    // Eski kayıt yedeği: konum bilinmiyorsa parçalar ayrık varsayılır (eski aritmetik).
    for (const match of matches) {
      weightedWords += (ownByIndex.get(match.ownIndex)?.wordCount ?? 0) * match.strength;
    }
  }
  return {
    approxPercent: Math.max(0, Math.min(100, Math.round((weightedWords / comparableWords) * 100))),
    matches: matches.sort((left, right) => right.strength - left.strength || right.lexical - left.lexical),
    comparableWords,
    matchedWords: Math.round(weightedWords),
  };
}

/** Parça metni için MinHash izi; motorla aynı algoritma (minhash-v1). */
export function chunkMinHash(text: string): number[] {
  return buildMinHash(text).signature;
}
