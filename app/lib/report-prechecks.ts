import {
  CHECK_STAGE_IDS,
  RULE_VERDICT_LABELS,
  checkStageOf,
  verifiedOutsidePdf,
  type CategoryFit,
  type CheckStage,
  type CheckStatus,
  type Criterion,
  type CriterionControlType,
  type CriterionFinding,
  type HeadingCheck,
  type ParticipantFeedback,
  type PreCheck,
  type ProfileExport,
  type RuleVerdict,
  type SetupData,
  type SimilarityResult,
  type StageResult,
  type VerdictSummary,
} from "./types";

/**
 * Katılımcı raporu üzerinde makine tarafından kesin olarak çalıştırılabilen
 * ön kontroller: dosya kapısı, dil tespiti, sayfa sınırı, başlık eşleştirmesi ve
 * havuz içi benzerlik. Ayrıca dört aşamalı sonucun sunucu (AI motoru) ve
 * çevrimdışı yedek tarafından ortak kullanılan birleştirme yardımcıları burada
 * tanımlanır: aşama sonucu türetme, sayaçlar ve geri bildirim taslağı.
 *
 * Bu modül tarayıcı ve sunucu (Cloudflare) ortamında çalışır; DOM veya dosya
 * sistemi bağımlılığı taşımaz. AI gerektiren kontroller burada üretilmez; onlar
 * analiz motorunun sözleşmesindedir (docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md).
 */

function lower(value: string): string {
  return value.toLocaleLowerCase("tr-TR");
}

/** Türkçe metinlerde kelime sınırı: düzeltme işaretli harfler kelimeyi bölmez. */
const WORD_SPLIT = /[^a-zçğıöşüâîû0-9]+/i;

function wordsOf(text: string): string[] {
  return lower(text).split(WORD_SPLIT).filter(Boolean);
}

/* ----------------------------- Dosya kapısı ----------------------------- */

/** PDF'den çıkarılan ihlal sonucunu kontrol durumuna çevirir. */
function violationStatus(setup: SetupData): CheckStatus {
  if (setup.defaultViolationAction === "block") return "failed";
  if (setup.defaultViolationAction === "warn") return "warning";
  return "flagged";
}

/**
 * Yükleme anında çalışan kesin dosya kapısı kontrolleri.
 * `existingFileCount`, aynı başvuru için havuzda bulunan dosya sayısıdır.
 */
export function buildFileGateChecks(file: File, setup: SetupData, existingFileCount = 0): PreCheck[] {
  const checks: PreCheck[] = [];
  const isPdf = file.type === "application/pdf" || lower(file.name).endsWith(".pdf");
  const lastDot = file.name.lastIndexOf(".");
  const extension = lastDot > 0 && lastDot < file.name.length - 1
    ? file.name.slice(lastDot + 1).toUpperCase()
    : "";

  // Mevcut değerlendirme motorunun teknik kabul koşulu, yarışma kuralından
  // ayrı gösterilir. Böylece sistem sınırı PDF'deki resmî kurala dönüşmez.
  checks.push({
    id: "engine-format",
    kind: "file_gate",
    name: "Sistemde analiz edilebilir dosya",
    status: isPdf ? "passed" : "failed",
    method: "deterministic",
    detail: isPdf
      ? "Dosya PDF olduğu için bu sürümde içerik analizi yapılabilir."
      : "Bu sürümün içerik analiz motoru yalnızca PDF dosyalarını okuyabilir.",
    evidence: [],
  });

  const sizeMb = file.size / 1024 / 1024;
  const engineSizeOk = sizeMb <= 50;
  checks.push({
    id: "engine-size",
    kind: "file_gate",
    name: "Sistemde analiz edilebilir boyut",
    status: engineSizeOk ? "passed" : "failed",
    method: "deterministic",
    detail: engineSizeOk
      ? `Dosya ${sizeMb.toFixed(1)} MB; sistemin 50 MB teknik analiz sınırının altında.`
      : `Dosya ${sizeMb.toFixed(1)} MB; sistemin 50 MB teknik analiz sınırını aşıyor. Bu sınır yarışma kuralı değil, mevcut analiz motorunun kapasitesidir.`,
    evidence: [],
  });

  if (setup.allowedFormats.length > 0) {
    const formatOk = setup.allowedFormats.map((format) => format.replace(/^\./, "").toUpperCase()).includes(extension);
    checks.push({
      id: "gate-format",
      kind: "file_gate",
      name: "PDF'deki teslim formatı",
      status: formatOk ? "passed" : violationStatus(setup),
      method: "deterministic",
      detail: formatOk
        ? `Dosya ${extension} formatında; PDF'de izin verilen ${setup.allowedFormats.join(", ")} listesine uygun.`
        : `Dosya ${extension || "uzantısız"}; PDF'de izin verilen formatlar: ${setup.allowedFormats.join(", ")}.`,
      evidence: [],
    });
  }

  if (setup.maxFileSizeMb > 0) {
    const sizeOk = sizeMb <= setup.maxFileSizeMb;
    checks.push({
      id: "gate-size",
      kind: "file_gate",
      name: "PDF'deki dosya boyutu sınırı",
      status: sizeOk ? "passed" : violationStatus(setup),
      method: "deterministic",
      detail: sizeOk
        ? `Dosya ${sizeMb.toFixed(1)} MB; PDF'deki ${setup.maxFileSizeMb} MB sınırının altında.`
        : `Dosya ${sizeMb.toFixed(1)} MB; PDF'de yazan ${setup.maxFileSizeMb} MB sınırını aşıyor.`,
      evidence: [],
    });
  }

  const nextCount = existingFileCount + 1;
  if (setup.maxFileCount > 0) {
    const countOk = nextCount <= setup.maxFileCount;
    checks.push({
      id: "gate-count",
      kind: "file_gate",
      name: "PDF'deki dosya sayısı sınırı",
      status: countOk ? "passed" : violationStatus(setup),
      method: "deterministic",
      detail: countOk
        ? `Bu başvuru için ${nextCount}. dosya; PDF en fazla ${setup.maxFileCount} dosyaya izin veriyor.`
        : `Bu başvuru için ${nextCount}. dosya yükleniyor; PDF en fazla ${setup.maxFileCount} dosyaya izin veriyor.`,
      evidence: [],
    });
  }
  return checks;
}

/** "block" ayarlı profilde başarısız kapı kontrolü dosyanın kabul edilmesini engeller. */
export function gateBlocksUpload(checks: PreCheck[]): boolean {
  return checks.some((check) => check.status === "failed");
}

/* ------------------------------ Dil tespiti ----------------------------- */

const TURKISH_STOPWORDS = new Set([
  "ve", "bir", "bu", "için", "ile", "olarak", "olan", "gibi", "daha", "sistem",
  "ise", "ancak", "veya", "ya", "da", "de", "ki", "her", "tüm", "bütün",
  "ayrıca", "böylece", "çünkü", "ile", "kadar", "sonra", "önce", "üzerine",
  "göre", "birlikte", "değil", "yani", "hem", "olup", "olmak", "vardır",
  "bulunmaktadır", "edilmiştir", "yapılmıştır", "kullanılmıştır", "aşağıda",
  "yukarıda", "tarafından", "amacıyla", "şekilde", "durumda", "bunun", "şu",
]);

const ENGLISH_STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "is", "for", "with", "this", "system",
  "are", "was", "were", "that", "which", "from", "have", "has", "been",
  "will", "shall", "not", "but", "also", "these", "those", "their", "there",
  "can", "should", "would", "between", "during", "after", "before", "such",
  "each", "other", "than", "then", "when", "where", "while", "however",
]);

/**
 * Türkçeye ÖZGÜ yaygın ek/son ek kalıpları. Şartname diliyle yazılmış teknik
 * bir raporda durak sözcükler az geçse bile bu ekler yoğun görülür; dil kararı
 * artık tek bir sinyale bağlı değildir.
 */
const TURKISH_SUFFIXES = [
  "lar", "ler", "ları", "leri", "ların", "lerin", "larla", "lerle",
  "dır", "dir", "dur", "dür", "tır", "tir", "tur", "tür",
  "mış", "miş", "muş", "müş", "acak", "ecek", "makta", "mekte",
  "ması", "mesi", "mak", "mek", "nın", "nin", "nun", "nün",
  "ında", "inde", "unda", "ünde", "dan", "den", "tan", "ten",
  "sal", "sel", "lık", "lik", "luk", "lük", "siz", "sız",
];

/** İngilizceye özgü yaygın son ekler; Türkçe metinde neredeyse hiç görülmez. */
const ENGLISH_SUFFIXES = ["tion", "tions", "ing", "ment", "ness", "able", "ible", "ously", "ical"];

export type LanguageCode = "tr" | "en" | "unknown";

/** Dil tespitinin ölçülebilir gerekçesi; hem karar hem ekran metni buradan üretilir. */
export type LanguageSignals = {
  code: LanguageCode;
  /** Karşılaştırmaya giren kelime sayısı. */
  words: number;
  /** 100 kelime başına Türkçe sinyal yoğunluğu (durak sözcük + ek + özel harf). */
  turkishRate: number;
  /** 100 kelime başına İngilizce sinyal yoğunluğu. */
  englishRate: number;
};

/** Kelime, listedeki eklerden biriyle bitiyor mu? Kök en az 3 harf kalmalıdır. */
function endsWithAny(word: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => word.length >= suffix.length + 3 && word.endsWith(suffix));
}

/**
 * Rapor dilini ÇOK SİNYALLİ olarak ölçer.
 *
 * NEDEN: eski sürüm yalnızca 10 sabit durak sözcüğü sayıyordu. Teknik bir
 * Türkçe rapor bu on kelimeyi az kullandığında (tablolar, kısaltmalar, madde
 * listeleri) dil "tespit edilemedi" görünüyor ve hakem ekranı gerçek bir
 * uyuşmazlık yokken uyarı basıyordu. Artık dört sinyal birlikte değerlendirilir:
 *
 *   1. Durak sözcükler (genişletilmiş liste)
 *   2. Türkçeye özgü ekler (-lar/-ler, -dır, -mış, -ması, -nın …)
 *   3. Türkçeye özgü harfler (ç, ğ, ı, ö, ş, ü)
 *   4. Yeterli metin miktarı ve kelime dağılımı
 *
 * "unknown" yalnızca metin gerçekten yetersizken veya İKİ dilin sinyalleri de
 * zayıf/başa başken döner. İngilizce sinyalleri kök yerelde küçültülmüş
 * kopyadan sayılır: tr-TR küçültmesi büyük "I" harfini noktasız "ı"ya çevirip
 * hem İngilizce durak sözcüklerini bozar hem Türkçe harf sayımını şişirir.
 */
export function languageSignals(pages: string[]): LanguageSignals {
  const raw = pages.join(" ");
  const turkishText = lower(raw);
  const englishText = raw.toLowerCase();
  const turkishWords = turkishText.split(WORD_SPLIT).filter(Boolean);
  const englishWords = englishText.split(WORD_SPLIT).filter(Boolean);
  const words = turkishWords.length;
  // Çok kısa metinde hiçbir oran anlamlı değildir (taranmış PDF, kapak sayfası).
  if (words < 25) return { code: "unknown", words, turkishRate: 0, englishRate: 0 };

  const turkishStopHits = turkishWords.filter((word) => TURKISH_STOPWORDS.has(word)).length;
  const turkishSuffixHits = turkishWords.filter((word) => endsWithAny(word, TURKISH_SUFFIXES)).length;
  // Özgün harfler kelime değil karakter sinyalidir; kelime ölçeğine indirilir.
  const turkishCharWords = turkishWords.filter((word) => /[çğıöşü]/.test(word)).length;
  const englishStopHits = englishWords.filter((word) => ENGLISH_STOPWORDS.has(word)).length;
  const englishSuffixHits = englishWords.filter((word) => endsWithAny(word, ENGLISH_SUFFIXES)).length;

  const per100 = (count: number) => (count / words) * 100;
  const turkishRate = per100(turkishStopHits) + per100(turkishSuffixHits) + per100(turkishCharWords) * 0.5;
  const englishRate = per100(englishStopHits) + per100(englishSuffixHits);

  // Eşik: baskın dilin yoğunluğu hem anlamlı (≥ 4/100) hem diğerinin 1,5 katı olmalı.
  const MIN_RATE = 4;
  const DOMINANCE = 1.5;
  if (turkishRate >= MIN_RATE && turkishRate >= englishRate * DOMINANCE) {
    return { code: "tr", words, turkishRate, englishRate };
  }
  if (englishRate >= MIN_RATE && englishRate >= turkishRate * DOMINANCE) {
    return { code: "en", words, turkishRate, englishRate };
  }
  return { code: "unknown", words, turkishRate, englishRate };
}

/** Sayfa metinlerinden rapor dilini kestirir; kararsız kalırsa "unknown" döner. */
export function detectLanguage(pages: string[]): LanguageCode {
  return languageSignals(pages).code;
}

/** Dil kodunun ekranda gösterilen adı; tespit edilemediyse null. */
export function languageLabel(code: LanguageCode): string | null {
  if (code === "tr") return "Türkçe";
  if (code === "en") return "İngilizce";
  return null;
}

/**
 * Şartnamenin beklediği dil metnini ("Türkçe", "Turkish", "İngilizce",
 * "English") karşılaştırılabilir koda çevirir; tanınmayan dilde null döner ve
 * karşılaştırma yapılmaz.
 */
export function expectedLanguageCode(expected: string | null | undefined): Exclude<LanguageCode, "unknown"> | null {
  if (!expected) return null;
  const key = lower(expected);
  if (/türk|turk/.test(key)) return "tr";
  if (/ingiliz|english/.test(key)) return "en";
  return null;
}

/** Tespit edilen dil, beklenen dilden kesin olarak farklıysa true. */
export function languageMismatch(detected: LanguageCode, expected: string | null | undefined): boolean {
  const expectedCode = expectedLanguageCode(expected);
  return expectedCode !== null && detected !== "unknown" && detected !== expectedCode;
}

/**
 * 1. aşama kartında gösterilen TEK CÜMLELİK dil sonucu (madde 3).
 *
 * Teknik ayrıntı (oran, kelime sayısı, model tahmini) kullanıcıya basılmaz;
 * hakem üç durumdan birini görür:
 *
 *   "Rapor dili Türkçe ve beklenen dille uyumlu."
 *   "Rapor dili İngilizce algılandı; beklenen dil Türkçe."
 *   "Rapor dili güvenilir biçimde belirlenemedi."
 */
export function languageSentence(detected: LanguageCode, expected: string | null | undefined): string {
  const detectedLabel = languageLabel(detected);
  if (!detectedLabel) return "Rapor dili güvenilir biçimde belirlenemedi.";
  const expectedCode = expectedLanguageCode(expected);
  const expectedLabel = expectedCode ? languageLabel(expectedCode) : null;
  if (!expectedLabel) return `Rapor dili ${detectedLabel} algılandı; şartname beklenen dili belirtmiyor.`;
  return detected === expectedCode
    ? `Rapor dili ${detectedLabel} ve beklenen dille uyumlu.`
    : `Rapor dili ${detectedLabel} algılandı; beklenen dil ${expectedLabel}.`;
}

export function buildLanguageCheck(pages: string[], expectedLanguage?: string | null): PreCheck {
  const detected = detectLanguage(pages);
  const mismatch = languageMismatch(detected, expectedLanguage);
  const status: CheckStatus = detected === "unknown" ? "warning" : mismatch ? "flagged" : "passed";
  return {
    id: "precheck-language",
    kind: "language",
    name: "Rapor dili",
    status,
    method: "deterministic",
    detail: languageSentence(detected, expectedLanguage),
    evidence: [],
  };
}

/* ------------------------- Sayfa sınırı ayrıştırma ------------------------- */

/**
 * Kural metnindeki açık sayfa üst sınırını çıkarır. Metin önce tr-TR ile
 * küçültülür: büyük harfli "AZAMİ"/"MAKSİMUM" yazımları aksi hâlde eşleşmez.
 * Rakam ile "sayfa" arasındaki parantezli yazı ("20 (yirmi) sayfa") tolere edilir.
 */
export function parsePageLimit(text: string): number | null {
  const match = lower(text).match(/(?:en fazla|azami|maksimum|en çok)\s*(\d{1,3})\s*(?:\([^)]{1,24}\)\s*)?sayfa/);
  return match ? Number(match[1]) : null;
}

/**
 * Kriterin taşıdığı sayfa üst sınırı. Özgün alıntı ve ad önce okunur; belge
 * yabancı dilde ise Türkçe açıklamadaki sınır yedek olarak kullanılır.
 */
export function pageLimitOf(criterion: Criterion): number | null {
  return parsePageLimit(`${criterion.name} ${criterion.sourceText}`) ?? parsePageLimit(criterion.description);
}

export type PageLimitRule = { rule: Criterion; limit: number };

/** Aktif 1. aşama (dil/şablon) kriterlerinden sayısal sayfa sınırı taşıyanlar. */
export function pageLimitRules(profile: ProfileExport): PageLimitRule[] {
  return profile.criteria
    .filter((item) => item.active && item.stage === "language_template")
    .map((rule) => {
      const limit = pageLimitOf(rule);
      return limit === null ? null : { rule, limit };
    })
    .filter((entry): entry is PageLimitRule => entry !== null);
}

/* ---------------------- Başlık ve şablon eşleştirmesi ---------------------- */

const KEYWORD_STOPWORDS = new Set([
  "raporu", "rapor", "kontrol", "kontrolü", "kuralı", "şartı", "zorunlu",
  "olması", "olmalı", "bulunması", "gereken", "ilgili", "genel", "asgari", "azami",
  "başlığı", "başlık", "bölümü", "bölüm",
]);

/** Kriter veya başlık adından arama anahtarları çıkarır; kısa ve genel kelimeleri eler. */
export function keywordsOf(name: string): string[] {
  return wordsOf(name).filter((word) => word.length >= 4 && !KEYWORD_STOPWORDS.has(word));
}

/**
 * Türkçe ekleri tolere etmek için kelimeyi kök öneki üzerinden karşılaştırır.
 * Kök uzunluğu yalnızca anahtar kelimeden türetilir ve sayfadaki kelimenin de
 * bu kökü tam kapsaması istenir; aksi hâlde "s." veya "mi" gibi tek-iki harflik
 * PDF artıkları her anahtarla eşleşir.
 */
function wordsMatch(keyword: string, pageWord: string): boolean {
  const stem = Math.min(5, keyword.length);
  return pageWord.length >= stem && keyword.slice(0, stem) === pageWord.slice(0, stem);
}

export type CriterionMatch = {
  found: boolean;
  /** Addan arama yapılabilir anahtar çıkmadıysa false; "bulunamadı" denemez. */
  searchable: boolean;
  page: number | null;
  snippet: string;
  matchedKeywords: number;
  totalKeywords: number;
  /** Eşleşen noktadan sayfa sonuna kadar kalan karakter sayısı; içerik doluluğu kestirimi. */
  contentLength: number;
  /**
   * Tek eşleşme İÇİNDEKİLER tablosundan, üstbilgiden veya altbilgiden geldi.
   * Böyle bir eşleşme başlığın GERÇEK bölümünün var/dolu olduğunu KANITLAMAZ.
   */
  tableOfContentsOnly: boolean;
};

/** Eşleşmenin altında en az bu kadar metin varsa başlık içeriği dolu sayılır. */
const FILLED_CONTENT_CHARS = 200;

/**
 * Satır bir İÇİNDEKİLER girdisi mi? Nokta öncüsü ("Giriş .......... 4") veya
 * başlıktan hemen sonra gelen yalın sayfa numarası bu kalıbı verir.
 */
function isTableOfContentsLine(line: string): boolean {
  const text = line.trim();
  if (/\.{3,}\s*\d{1,3}$/.test(text)) return true;
  if (/[·•–—-]{2,}\s*\d{1,3}$/.test(text)) return true;
  // "3.2 Mekanik Tasarım 12" — kısa satır + sonda yalın sayfa numarası.
  return text.length <= 90 && /^\s*\d+(?:\.\d+)*\s+\S.*\s+\d{1,3}$/.test(text);
}

/** Metin bloğunun satırları; PDF çıkarımı satır sonlarını korumazsa tek satır sayılır. */
function linesOf(pageText: string): string[] {
  return pageText.split(/\r?\n/);
}

/**
 * Raporun yapısal haritası: içindekiler sayfaları ve her sayfada tekrar eden
 * üstbilgi/altbilgi satırları. Bir başlık ifadesinin YALNIZCA bu bölgelerde
 * geçmesi, ilgili bölümün raporda gerçekten bulunduğunu göstermez (madde 3).
 */
export type ReportLayout = {
  /** 1 tabanlı içindekiler sayfa numaraları. */
  tableOfContentsPages: Set<number>;
  /** Sayfaların çoğunda tekrar ettiği için üstbilgi/altbilgi sayılan normalize satırlar. */
  runningLines: Set<string>;
};

export function analyzeReportLayout(pages: string[]): ReportLayout {
  const tableOfContentsPages = new Set<number>();
  const linePages = new Map<string, Set<number>>();
  pages.forEach((pageText, index) => {
    const pageNumber = index + 1;
    const lines = linesOf(pageText);
    const head = lower(pageText.slice(0, 400));
    const leaderLines = lines.filter(isTableOfContentsLine).length;
    // İçindekiler sayfası: başlığı geçiyor VEYA sayfa nokta öncülü satırlardan oluşuyor.
    if (/i̇çindekiler|icindekiler|contents|tablo listesi|şekil listesi|sekil listesi/.test(head) || leaderLines >= 4) {
      tableOfContentsPages.add(pageNumber);
    }
    for (const line of lines) {
      const key = wordsOf(line).join(" ");
      // Çok kısa satırlar (sayfa numarası) ve çok uzun satırlar (gövde) üstbilgi olamaz.
      if (!key || key.length < 8 || key.length > 120) continue;
      if (!linePages.has(key)) linePages.set(key, new Set());
      linePages.get(key)!.add(pageNumber);
    }
  });
  const runningLines = new Set<string>();
  // Tek sayfalık belgede "her sayfada tekrar" ölçütü anlamsızdır.
  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  if (pages.length >= 4) {
    for (const [key, seenPages] of linePages) if (seenPages.size >= threshold) runningLines.add(key);
  }
  return { tableOfContentsPages, runningLines };
}

/**
 * Kriter (veya başlık) adındaki anahtar kelimeleri sayfa metinlerinde arar.
 * Anahtarların en az yarısı aynı sayfada geçiyorsa "bulundu" sayılır ve kanıt
 * alıntısı döner. Sunucu tarafında model başlık listesi vermediğinde 2. aşama
 * başlık tablosunun yedeği olarak da kullanılır.
 *
 * KONUM FARKINDALIĞI (madde 3): içindekiler tablosundaki, üstbilgideki veya
 * altbilgideki eşleşme GERÇEK BÖLÜM sayılmaz. Böyle bir eşleşme bulunursa
 * arama devam eder; gövdede karşılığı yoksa sonuç `tableOfContentsOnly` ile
 * işaretlenir ve içerik ASLA "dolu" gösterilmez. İçerik doluluğu, eşleşmenin
 * bulunduğu NOKTADAN SONRAKİ metinden ölçülür; başlığın önündeki gövde
 * doluluk sayılmaz.
 */
export function matchCriterionInPages(
  criterion: Pick<Criterion, "name">,
  pages: string[],
  layout: ReportLayout = analyzeReportLayout(pages),
): CriterionMatch {
  const keywords = keywordsOf(criterion.name);
  const empty: CriterionMatch = {
    found: false, searchable: false, page: null, snippet: "",
    matchedKeywords: 0, totalKeywords: 0, contentLength: 0, tableOfContentsOnly: false,
  };
  if (!keywords.length) return empty;

  const base: CriterionMatch = { ...empty, searchable: true, totalKeywords: keywords.length };
  let best = base;
  /** Yalnızca içindekiler/üstbilgi bölgesinde bulunan en iyi eşleşme. */
  let bestDecorative = base;

  pages.forEach((pageText, index) => {
    const pageNumber = index + 1;
    const loweredPage = lower(pageText);
    const pageWords = loweredPage.split(WORD_SPLIT).filter((word) => word.length >= 3);
    const hits: string[] = [];
    for (const keyword of keywords) {
      const hit = pageWords.find((word) => wordsMatch(keyword, word));
      if (hit) hits.push(hit);
    }
    if (!hits.length) return;
    const anchor = loweredPage.indexOf(hits[0]);
    // Eşleşmenin bulunduğu satır: içindekiler girdisi veya tekrar eden üstbilgi mi?
    const lineStart = anchor >= 0 ? loweredPage.lastIndexOf("\n", anchor) + 1 : 0;
    const lineEnd = anchor >= 0 ? (loweredPage.indexOf("\n", anchor) + 1 || pageText.length) : pageText.length;
    const matchedLine = pageText.slice(lineStart, lineEnd);
    const decorative = layout.tableOfContentsPages.has(pageNumber)
      || isTableOfContentsLine(matchedLine)
      || layout.runningLines.has(wordsOf(matchedLine).join(" "));
    const start = anchor >= 0 ? Math.max(0, anchor - 60) : -1;
    const candidate: CriterionMatch = {
      found: hits.length * 2 >= keywords.length,
      searchable: true,
      page: pageNumber,
      snippet: start >= 0 ? `…${pageText.slice(start, start + 180).trim()}…` : "",
      matchedKeywords: hits.length,
      totalKeywords: keywords.length,
      // Doluluk yalnızca eşleşme NOKTASINDAN SONRAKİ metinden ölçülür.
      contentLength: anchor >= 0 ? Math.max(0, pageText.length - anchor) : 0,
      tableOfContentsOnly: false,
    };
    if (decorative) {
      if (hits.length > bestDecorative.matchedKeywords) bestDecorative = { ...candidate, contentLength: 0 };
      return;
    }
    if (hits.length > best.matchedKeywords) best = candidate;
  });

  /*
   * İçindekiler/üstbilgi eşleşmesi gövdedekinden GÜÇLÜ ve gövdede bölüm
   * bulunamadıysa sonuç "yalnızca içindekilerde" olarak işaretlenir.
   *
   * Yalnızca "gövdede sıfır eşleşme" koşuluna bakmak yetmez: içindekilerde
   * başlığın tamamı geçerken gövdede tek bir genel kelimenin ("sonuçları")
   * rastgele bulunması, bölümün raporda var olduğunu göstermez ama işareti
   * düşürüyordu. Gövde eşleşmesi bölümü KANITLIYORSA (found=true) bu yol hiç
   * çalışmaz; gerçek bölüm her zaman içindekiler satırına yeğ tutulur.
   */
  if (!best.found && bestDecorative.matchedKeywords > best.matchedKeywords) {
    return { ...bestDecorative, found: false, contentLength: 0, tableOfContentsOnly: true };
  }
  return best;
}

/**
 * Kriterin kontrol türü; eski kayıtlarda alan bulunmadığında aşamaya göre
 * makul varsayılan seçilir (2. aşama → içerik varlığı).
 */
export function controlTypeOf(criterion: Pick<Criterion, "stage" | "controlType">): CriterionControlType {
  if (criterion.controlType) return criterion.controlType;
  if (criterion.stage === "category_similarity") return "ANLAMSAL_UYGUNLUK";
  if (criterion.stage === "headings_content") return "ICERIK_VARLIGI";
  return "KANIT_KONTROLU";
}

/**
 * GERÇEK ZORUNLU BAŞLIKLAR (madde 3).
 *
 * Her içerik kriteri zorunlu başlık DEĞİLDİR. Yalnızca `BIREBIR_BASLIK`
 * kontrol türündeki kriterler ve resmî şablonun istediği başlıklar "raporda
 * şu başlık bulunmalı" anlamına gelir. `ICERIK_VARLIGI`, `ANLAMSAL_UYGUNLUK`
 * ve `KANIT_KONTROLU` kriterleri BİLGİNİN varlığını arar; adları rapora
 * başlık olarak yazılmak zorunda değildir ve bu listeye alınmaz — aksi hâlde
 * "12 zorunlu başlıktan 9'u eksik" gibi yanlış bir tablo doğuyordu.
 */
export function requiredHeadingsOf(profile: ProfileExport): string[] {
  const seen = new Set<string>();
  const headings: string[] = [];
  const push = (heading: string) => {
    const key = wordsOf(heading).join(" ");
    if (!key || seen.has(key)) return;
    seen.add(key);
    headings.push(heading.trim());
  };
  for (const item of profile.criteria) {
    if (item.active && item.stage === "headings_content" && controlTypeOf(item) === "BIREBIR_BASLIK") push(item.name);
  }
  for (const heading of profile.templateProfile?.requiredHeadings ?? []) push(heading);
  return headings;
}

/** 2. aşama içerik kriterleri: başlık konumunda değil, bilgi düzeyinde aranır. */
export function contentPresenceCriteria(profile: ProfileExport): Criterion[] {
  return profile.criteria.filter((item) => item.active
    && item.stage === "headings_content"
    && controlTypeOf(item) !== "BIREBIR_BASLIK");
}

/**
 * Tek bir aranan ifadenin (başlık ya da içerik) rapordaki durumu.
 *
 * KONUM KURALI (madde 3): eşleşme yalnızca içindekiler tablosunda, üstbilgide
 * veya altbilgide bulunduysa bölüm VAR sayılmaz ve içerik ASLA "dolu"
 * gösterilmez; not bunu açıkça söyler. İçerik doluluğu, eşleşmenin bulunduğu
 * NOKTADAN SONRAKİ metinden ölçülür.
 */
function headingCheckOf(
  heading: string,
  controlType: CriterionControlType,
  pages: string[],
  layout: ReportLayout,
): HeadingCheck {
  const match = matchCriterionInPages({ name: heading }, pages, layout);
  const label = controlType === "BIREBIR_BASLIK" ? "Başlık" : "Beklenen içerik";
  if (!match.searchable) {
    return {
      heading, controlType, present: false, contentFilled: false, page: null,
      note: `${label} adından arama anahtarı çıkmadı; hakem kontrol etmeli.`,
    };
  }
  if (match.tableOfContentsOnly) {
    return {
      heading, controlType, present: false, contentFilled: false,
      page: match.page, tableOfContentsOnly: true,
      note: `Bu ifade yalnızca içindekiler tablosunda veya üstbilgide geçiyor (s. ${match.page}); `
        + "raporda karşılık gelen dolu bir bölüm bulunamadı. Hakem doğrulamalı.",
    };
  }
  const contentFilled = match.found && match.contentLength >= FILLED_CONTENT_CHARS;
  return {
    heading,
    controlType,
    present: match.found,
    contentFilled,
    page: match.found ? match.page : null,
    note: match.found
      ? contentFilled
        ? `${label} ${match.page}. sayfada bulundu (${match.matchedKeywords}/${match.totalKeywords} anahtar); eşleşmeden sonra içerik var.`
        : `${label} ${match.page}. sayfada bulundu; eşleşmeden sonraki içerik kısa görünüyor, hakem doğrulamalı.`
      : `${label} kelime aramasıyla bulunamadı; hakem doğrulamalı.`,
  };
}

/**
 * 2. aşama kontrol tablosu: `BIREBIR_BASLIK` kriterleri ve şablon başlıkları
 * başlık konumunda, diğer içerik kriterleri bilgi düzeyinde aranır. Model
 * başlık tablosu üretemediğinde ve çevrimdışı yedekte kullanılır.
 */
export function buildHeadingChecks(profile: ProfileExport, pages: string[]): HeadingCheck[] {
  const layout = analyzeReportLayout(pages);
  return [
    ...requiredHeadingsOf(profile).map((heading) => headingCheckOf(heading, "BIREBIR_BASLIK", pages, layout)),
    ...contentPresenceCriteria(profile).map((item) => headingCheckOf(item.name, controlTypeOf(item), pages, layout)),
  ];
}

/** Aktif 2. aşama kriterlerinin kaçının raporda bulunduğunu özetleyen ön kontrol. */
export function buildHeadingsCheck(profile: ProfileExport, pages: string[]): PreCheck {
  const mandatory = profile.criteria.filter((item) => item.active && item.stage === "headings_content");
  if (!mandatory.length) {
    return {
      id: "precheck-headings",
      kind: "headings",
      name: "Zorunlu başlık ve içerik",
      status: "skipped",
      method: "deterministic",
      detail: "Profilde başlık/içerik (2. aşama) kriteri tanımlı değil; başlık kontrolü çalıştırılmadı.",
      evidence: [],
    };
  }
  const layout = analyzeReportLayout(pages);
  const matches = mandatory.map((item) => ({ item, match: matchCriterionInPages(item, pages, layout) }));
  const unsearchable = matches.filter((entry) => !entry.match.searchable);
  const missing = matches.filter((entry) => entry.match.searchable && !entry.match.found);
  const searchableCount = mandatory.length - unsearchable.length;

  const unsearchableNote = unsearchable.length
    ? ` ${unsearchable.length} kriterin adından arama yapılabilir anahtar kelime çıkmadı (${unsearchable.map((entry) => entry.item.name).join(", ")}); bu başlıklar hakem tarafından kontrol edilmelidir.`
    : "";

  if (!searchableCount) {
    return {
      id: "precheck-headings",
      kind: "headings",
      name: "Zorunlu başlık ve içerik",
      status: "warning",
      method: "deterministic",
      detail: `Başlık kriterlerinin hiçbiri kelime araması ile denetlenemedi.${unsearchableNote}`,
      evidence: [],
    };
  }

  const status: CheckStatus = missing.length === 0
    ? (unsearchable.length ? "warning" : "passed")
    : missing.length < searchableCount ? "warning" : "flagged";
  return {
    id: "precheck-headings",
    kind: "headings",
    name: "Zorunlu başlık ve içerik",
    status,
    method: "deterministic",
    detail: (missing.length === 0
      ? `Denetlenebilen ${searchableCount} başlığın tamamı raporda bulundu.`
      : `Denetlenebilen ${searchableCount} başlıktan ${missing.length} tanesi bulunamadı: ${missing.map((entry) => entry.item.name).join(", ")}. Kelime eşleşmesine dayalı bu sonucu hakem doğrulamalıdır.`) + unsearchableNote,
    evidence: [],
  };
}

/** 1. aşama kriterlerindeki açık sayfa sınırlarını gerçek sayfa sayısıyla karşılaştırır. */
export function buildTemplateCheck(profile: ProfileExport, pageCount: number): PreCheck {
  const formatRules = profile.criteria.filter((item) => item.active && item.stage === "language_template");
  const pageRules = pageLimitRules(profile);
  if (!pageRules.length) {
    return {
      id: "precheck-template",
      kind: "template",
      name: "Şablon ve sayfa düzeni",
      status: formatRules.length ? "warning" : "skipped",
      method: "deterministic",
      detail: formatRules.length
        ? `Profilde ${formatRules.length} dil/şablon kuralı var ancak sayısal sayfa sınırı içermiyor; şablon uyumu hakem tarafından kontrol edilmelidir.`
        : "Profilde dil/şablon kuralı tanımlı değil; şablon kontrolü çalıştırılmadı.",
      evidence: [],
    };
  }
  const violated = pageRules.filter((entry) => pageCount > entry.limit);
  return {
    id: "precheck-template",
    kind: "template",
    name: "Şablon ve sayfa düzeni",
    status: violated.length ? "flagged" : "passed",
    method: "deterministic",
    detail: violated.length
      ? `Rapor ${pageCount} sayfa; ${violated.map((entry) => `"${entry.rule.name}" en fazla ${entry.limit} sayfaya izin veriyor`).join(", ")}.`
      : `Rapor ${pageCount} sayfa; belgedeki sayfa sınırlarına uygun (${pageRules.map((entry) => entry.limit).join(", ")} sayfa).`,
    // Kanıt ölçümün kendisidir; alıntı şartnamedeki kural metnidir.
    evidence: violated.map((entry) => ({ page: entry.rule.sourcePage, paragraph: null, section: "Şartname", text: entry.rule.sourceText })),
  };
}

/* ------------------------------- Benzerlik ------------------------------- */

/** Metni 5 kelimelik kayan pencerelere (shingle) böler. */
function shinglesOf(text: string): Set<string> {
  const words = wordsOf(text).filter((word) => word.length >= 3);
  const shingles = new Set<string>();
  for (let index = 0; index + 5 <= words.length; index += 1) {
    shingles.add(words.slice(index, index + 5).join(" "));
  }
  return shingles;
}

/** İki rapor metni arasındaki Jaccard benzerliği (0-1). */
export function textSimilarity(textA: string, textB: string): number {
  const setA = shinglesOf(textA);
  const setB = shinglesOf(textB);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const shingle of setA) if (setB.has(shingle)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

export type SimilarityPeer = { label: string; text: string };

/** Havuzdaki diğer raporlarla karşılaştırıp en yüksek benzerliği raporlar. */
export function buildSimilarityCheck(reportText: string, peers: SimilarityPeer[]): PreCheck {
  if (!peers.length) {
    return {
      id: "precheck-similarity",
      kind: "similarity",
      name: "Başvurular arası benzerlik",
      status: "skipped",
      method: "deterministic",
      detail: "Havuzda karşılaştırılacak başka analiz edilmiş rapor yok. Karşılaştırma her analizde o anki havuza göre yapılır; sonradan eklenen raporlarla karşılaştırmak için bu raporu yeniden analiz edin.",
      evidence: [],
      similarity: { percent: null, closestTeam: null },
    };
  }
  let topPeer = peers[0];
  let topScore = 0;
  for (const peer of peers) {
    const score = textSimilarity(reportText, peer.text);
    if (score > topScore) {
      topScore = score;
      topPeer = peer;
    }
  }
  const percent = Math.round(topScore * 100);
  const status: CheckStatus = topScore >= 0.35 ? "flagged" : topScore >= 0.2 ? "warning" : "passed";
  return {
    id: "precheck-similarity",
    kind: "similarity",
    name: "Başvurular arası benzerlik",
    status,
    method: "deterministic",
    detail: `${peers.length} raporla karşılaştırıldı. En yakın eşleşme: ${topPeer.label} (%${percent}). `
      + (status === "passed"
        ? "Anlamlı metin örtüşmesi bulunmadı."
        : "Sistem intihal kararı vermez; inceleme için işaretlendi."),
    evidence: [],
    // Yapılandırılmış sonuç (madde 6): oran/takım buradan okunur, cümleden değil.
    similarity: { percent, closestTeam: topPeer.label },
  };
}

/**
 * Benzerlik ön kontrolünü 3. aşama sonucuna çevirir (madde 6).
 *
 * Yüzde ve en yakın takım YAPILANDIRILMIŞ `check.similarity` alanından okunur;
 * gösterim cümlesi ASLA yeniden ayrıştırılmaz — "Takım %98 Vizyon" gibi bir
 * takım adı oranı bozamaz. Yalnızca bu alanı taşımayan ESKİ kayıtlar için
 * cümle sonundaki kurallı "(%NN)" kuyruğunu okuyan sertleştirilmiş bir yedek
 * bulunur (SON parantezli yüzde; takım adındaki serbest "%" işaretleri değil).
 * Benzerlik hiçbir zaman tek başına KRİTİK_HATA doğurmaz.
 */
export function similarityResultOf(check: PreCheck | null | undefined): SimilarityResult | null {
  if (!check || check.kind !== "similarity") return null;
  if (check.similarity !== undefined) {
    return {
      status: check.status,
      percent: check.status !== "skipped" ? check.similarity?.percent ?? null : null,
      closestTeam: check.similarity?.closestTeam ?? null,
      detail: check.detail,
    };
  }
  // GERİYE UYUM YEDEĞİ: eski kayıtların iki üreticisi de yüzdeyi her zaman
  // "(%NN)" biçimli parantezli kuyrukla yazar; SON eşleşme alınır ki takım
  // adının içindeki "(%7)" gibi bir dizge bile yanlış okunamaz.
  const percentTail = [...check.detail.matchAll(/\(%(\d{1,3})\)/g)].pop() ?? null;
  let closestTeam: string | null = null;
  const labelMarker = "En yakın eşleşme:";
  const labelStart = check.detail.indexOf(labelMarker);
  if (percentTail && labelStart >= 0 && (percentTail.index ?? 0) > labelStart) {
    closestTeam = check.detail.slice(labelStart + labelMarker.length, percentTail.index).trim() || null;
  }
  if (!closestTeam) {
    const legacyTeam = check.detail.match(/"(.+?)"\s+ile\s+%/);
    closestTeam = legacyTeam ? legacyTeam[1].trim() : null;
  }
  return {
    status: check.status,
    percent: percentTail && check.status !== "skipped" ? Math.min(100, Number(percentTail[1])) : null,
    closestTeam,
    detail: check.detail,
  };
}

/* ------------------------ Dört aşamalı sonuç birleştirme ------------------------ */

/**
 * `DEGERLENDIRILEMEDI` bir İHLAL DEĞİLDİR: PDF'den doğrulanamayan kural
 * (video, saha teslimi, kurul kararı) hiçbir aşamayı kötüleştirmez ve genel
 * durumu belirlemez. Bu yüzden sıralamada BAŞARILI'nın da altındadır.
 */
const VERDICT_RANK: Record<RuleVerdict, number> = {
  DEGERLENDIRILEMEDI: -1, BASARILI: 0, REVIZYON: 1, KRITIK_HATA: 2,
};

/** Listedeki en kötü durum; boş listede BAŞARILI. */
export function worstVerdict(verdicts: readonly RuleVerdict[]): RuleVerdict {
  let worst: RuleVerdict = "BASARILI";
  for (const verdict of verdicts) if (VERDICT_RANK[verdict] > VERDICT_RANK[worst]) worst = verdict;
  return worst;
}

/** PDF'den değerlendirilemeyen (harici kanıt / hakem kontrolü) bulgu mu? */
export function isOutsidePdfFinding(finding: Pick<CriterionFinding, "verdict">): boolean {
  return finding.verdict === "DEGERLENDIRILEMEDI";
}

/**
 * Sayaçlar bulgulardan; genel durum bulgular ve aşama sonuçlarının en kötüsünden.
 * PDF'den değerlendirilemeyen kurallar ayrı sayılır ve hata sayaçlarına girmez.
 */
export function summarizeFindings(findings: CriterionFinding[], stages: StageResult[] = []): VerdictSummary {
  return {
    total: findings.length,
    basarili: findings.filter((item) => item.verdict === "BASARILI").length,
    revizyon: findings.filter((item) => item.verdict === "REVIZYON").length,
    kritikHata: findings.filter((item) => item.verdict === "KRITIK_HATA").length,
    disiKanit: findings.filter(isOutsidePdfFinding).length,
    overall: worstVerdict([...findings.map((item) => item.verdict), ...stages.map((item) => item.verdict)]),
  };
}

/**
 * YAYIMLI kriter kümesinin kapsam sayaçları (madde 2).
 *
 * Hakem ekranı "12 yayımlı kriterden 9'u katılımcı PDF'si üzerinden
 * değerlendirildi; 3 kriter video, portal veya fiziksel aşama gerektirdiği
 * için rapor analizine katılmadı" cümlesini bu sayılardan kurar.
 */
export function criteriaScopeOf(profile: ProfileExport): {
  published: number;
  pdfEvaluable: number;
  outsidePdf: number;
  outsideNames: string[];
} {
  const active = profile.criteria.filter((item) => item.active);
  const outside = active.filter((item) => verifiedOutsidePdf(item.verifiability));
  return {
    published: active.length,
    pdfEvaluable: active.length - outside.length,
    outsidePdf: outside.length,
    outsideNames: outside.map((item) => item.name),
  };
}

/**
 * Kategori uygunluğunun kullanıcıya gösterilen durumu (madde 3).
 *
 * Modelin ham skoru YAPAY bir kesinliktir ("%100 uyumlu" gibi bir ifade
 * hakemi yanıltır); bu yüzden skor yalnızca bant seçmek için okunur ve ekranda
 * hiçbir yüzde gösterilmez. Skor yoksa ya da o aşamada hiç kanıt üretilmediyse
 * sonuç "Yeterli kanıt bulunamadı"dır — "uyumsuz" DEĞİLDİR.
 */
export function categoryFitOf(score: number | null | undefined): CategoryFit {
  if (score === null || score === undefined || !Number.isFinite(score)) return "KANIT_YOK";
  if (score >= 70) return "UYUMLU";
  if (score >= 40) return "KISMEN_UYUMLU";
  return "UYUMSUZ";
}

/**
 * 2. aşama özeti (madde 3): sade sayı, uzun başlık listesi değil.
 * Başlık kriterleri ile içerik kriterleri ayrı sayılır çünkü ikisi aynı şey
 * değildir: biri başlığın kendisini, diğeri bilginin varlığını arar.
 */
export function headingsStageSummary(checks: HeadingCheck[]): string {
  if (!checks.length) return "Profilde başlık veya içerik kriteri tanımlı değil.";
  const headings = checks.filter((item) => (item.controlType ?? "BIREBIR_BASLIK") === "BIREBIR_BASLIK");
  const contents = checks.filter((item) => (item.controlType ?? "BIREBIR_BASLIK") !== "BIREBIR_BASLIK");
  const filled = (list: HeadingCheck[]) => list.filter((item) => item.present && item.contentFilled).length;
  const parts: string[] = [];
  if (headings.length) parts.push(`${filled(headings)}/${headings.length} zorunlu başlık yerinde ve dolu`);
  if (contents.length) parts.push(`${filled(contents)}/${contents.length} beklenen içerik bulundu`);
  const decorative = checks.filter((item) => item.tableOfContentsOnly).length;
  if (decorative) parts.push(`${decorative} ifade yalnızca içindekilerde geçiyor`);
  return parts.join(" · ");
}

/**
 * 4. aşama özeti (madde 3): hakem iki durumlu ön değerlendirmeyi okur.
 * "9 kriter incelendi · 8 uygun · 1 olumsuz" — uzun kriter adı veya teknik
 * açıklama özet satırına sıkıştırılmaz.
 */
export function evidenceStageSummary(findings: CriterionFinding[]): string {
  const own = findings.filter((item) => !isOutsidePdfFinding(item));
  if (!own.length) return "Katılımcı PDF'si üzerinden değerlendirilebilen kriter yok.";
  const uygun = own.filter((item) => item.verdict === "BASARILI").length;
  return `${own.length} kriter incelendi · ${uygun} uygun · ${own.length - uygun} olumsuz`;
}

/** Bir aşamanın bulgularından kısa, sayısal özet cümlesi. */
export function stageSummaryOf(stage: CheckStage, findings: CriterionFinding[]): string {
  const own = findings.filter((item) => item.stage === stage);
  if (!own.length) return `${checkStageOf(stage).title}: bu aşamaya bağlı aktif kriter yok.`;
  // 4. aşama hakemin karar verdiği aşamadır: özet iki durumlu okunur.
  if (stage === "criteria_evidence") return evidenceStageSummary(own);
  const counts = summarizeFindings(own);
  const outside = counts.disiKanit ?? 0;
  return `${own.length} kural kontrol edildi: ${counts.basarili} ${RULE_VERDICT_LABELS.BASARILI}, ${counts.revizyon} ${RULE_VERDICT_LABELS.REVIZYON}, ${counts.kritikHata} ${RULE_VERDICT_LABELS.KRITIK_HATA}`
    + `${outside ? `, ${outside} kural PDF dışı kanıt gerektiriyor` : ""}.`;
}

/**
 * Aşama sonucunu yalnızca bulgulardan türetir (model o aşamayı döndürmediğinde
 * veya AI hiç yokken). Zorunlu kriteri olmayan aşama KRİTİK_HATA olamaz.
 */
export function deriveStageResult(stage: CheckStage, findings: CriterionFinding[]): StageResult {
  const own = findings.filter((item) => item.stage === stage);
  return {
    stage,
    verdict: capStageVerdict(stage, worstVerdict(own.map((item) => item.verdict)), findings),
    summary: stageSummaryOf(stage, findings),
    evidence: [],
    ...(stage === "category_similarity" ? { categoryScore: null, categoryFit: "KANIT_YOK" as const, similarity: null } : {}),
  };
}

/** Aşamada zorunlu kural yoksa aşama en fazla REVİZYON olur ("diğer" kurallar kritik hata doğurmaz). */
export function capStageVerdict(stage: CheckStage, verdict: RuleVerdict, findings: CriterionFinding[]): RuleVerdict {
  // PDF'den değerlendirilemeyen kurallar zorunlu olsalar bile aşamayı kritik
  // hataya çeviremez; kanıtları raporun dışındadır.
  const hasRequired = findings.some((item) => item.stage === stage && item.required && !isOutsidePdfFinding(item));
  return verdict === "KRITIK_HATA" && !hasRequired ? "REVIZYON" : verdict;
}

/**
 * Verilen aşama sonuçlarını her zaman dört kayıt olacak şekilde aşama sırasına
 * dizer; eksik aşama bulgulardan türetilir. 3. aşamada benzerlik alanı
 * korunur (istemci doldurur), yoksa null kalır.
 */
export function orderStages(provided: StageResult[], findings: CriterionFinding[]): StageResult[] {
  return CHECK_STAGE_IDS.map((stage) => {
    const existing = provided.find((item) => item.stage === stage);
    if (!existing) return deriveStageResult(stage, findings);
    const result: StageResult = { ...existing, verdict: capStageVerdict(stage, existing.verdict, findings) };
    if (stage === "category_similarity") {
      result.categoryScore = existing.categoryScore ?? null;
      // Etiket her zaman skordan yeniden türetilir; eski kayıt da doğru okunur.
      result.categoryFit = existing.categoryFit ?? categoryFitOf(result.categoryScore);
      result.similarity = existing.similarity ?? null;
    }
    return result;
  });
}

/** Benzerlik ön kontrolünü hem preChecks listesine hem 3. aşama sonucuna yazar. */
export function applySimilarity<T extends { preChecks: PreCheck[]; stages: StageResult[] }>(evaluation: T, check: PreCheck): T {
  const preChecks = [...evaluation.preChecks.filter((item) => item.kind !== "similarity"), check];
  const stages = evaluation.stages.map((stage) => stage.stage === "category_similarity"
    ? { ...stage, similarity: similarityResultOf(check) }
    : stage);
  return { ...evaluation, preChecks, stages };
}

/**
 * Yarışmacı geri bildirim taslağı yalnızca doğrulanmış bulgulardan türetilir;
 * bulgu dışı iddia sızmaz. Hakem onayından geçmeden yarışmacıya gösterilmez.
 */
export function feedbackOf(findings: CriterionFinding[]): ParticipantFeedback {
  const strengths = findings
    .filter((item) => item.verdict === "BASARILI")
    .slice(0, 6)
    .map((item) => `${item.criterionName}: ${item.rationale}`);
  // PDF'den doğrulanamayan kurallar "gelişime açık yön" olarak yazılmaz:
  // yarışmacı raporda olmayan bir eksikle suçlanmamalıdır.
  const improvements = findings
    .filter((item) => item.verdict !== "BASARILI" && !isOutsidePdfFinding(item))
    .slice(0, 8)
    .map((item) => `${item.criterionName} (${RULE_VERDICT_LABELS[item.verdict]}): ${item.rationale}`);
  const suggestions = findings
    .filter((item) => item.verdict !== "BASARILI" && !isOutsidePdfFinding(item))
    .slice(0, 6)
    .map((item) => item.verdict === "KRITIK_HATA"
      ? `“${item.criterionName}” zorunlu kuralı için şartnamedeki koşulu karşılayan, kanıtlanabilir bir bölüm ekleyin.`
      : `“${item.criterionName}” bölümündeki eksik kanıtları ölçüm, tablo veya doğrulama sonucu ile tamamlayın.`);
  return { strengths, improvements, suggestions };
}
