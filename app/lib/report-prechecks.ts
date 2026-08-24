import type { CheckStatus, Criterion, PreCheck, ProfileExport, SetupData } from "./types";

/**
 * Katılımcı raporu üzerinde makine tarafından kesin olarak çalıştırılabilen
 * ön kontroller: dosya kapısı, dil tespiti, başlık/şablon eşleştirmesi ve
 * havuz içi benzerlik. AI gerektiren kontroller burada üretilmez; onlar
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

const TURKISH_STOPWORDS = ["ve", "bir", "bu", "için", "ile", "olarak", "olan", "gibi", "daha", "sistem"];
const ENGLISH_STOPWORDS = ["the", "and", "of", "to", "in", "is", "for", "with", "this", "system"];

/**
 * Sayfa metinlerinden rapor dilini kestirir; kısa metinlerde "unknown" döner.
 * İngilizce sinyalleri kök yerelde küçültülmüş kopyadan sayılır: tr-TR
 * küçültmesi büyük "I" harfini noktasız "ı"ya çevirdiği için hem İngilizce
 * durak sözcüklerini bozar hem de Türkçe harf sayımını şişirir.
 */
export function detectLanguage(pages: string[]): "tr" | "en" | "unknown" {
  const raw = pages.join(" ");
  const turkishText = lower(raw);
  const englishText = raw.toLowerCase();
  const turkishWords = turkishText.split(WORD_SPLIT).filter(Boolean);
  const englishWords = englishText.split(WORD_SPLIT).filter(Boolean);
  if (turkishWords.length < 40) return "unknown";
  const turkishChars = (englishText.match(/[çğıöşü]/g) ?? []).length;
  const turkishHits = turkishWords.filter((word) => TURKISH_STOPWORDS.includes(word)).length;
  const englishHits = englishWords.filter((word) => ENGLISH_STOPWORDS.includes(word)).length;
  // Harf ipucu tek başına dil kararı vermez; yalnızca durak sözcük sinyalini güçlendirir.
  const charBonus = turkishHits === 0 ? 0 : Math.min(turkishChars / 40, turkishHits + 5);
  const turkishScore = turkishHits + charBonus;
  if (turkishScore > englishHits) return "tr";
  if (englishHits > turkishScore) return "en";
  return "unknown";
}

export function buildLanguageCheck(pages: string[]): PreCheck {
  const language = detectLanguage(pages);
  const status: CheckStatus = language === "tr" ? "passed" : language === "en" ? "flagged" : "warning";
  return {
    id: "precheck-language",
    kind: "language",
    name: "Rapor dili",
    status,
    method: "deterministic",
    detail:
      language === "tr"
        ? "Rapor dili Türkçe olarak tespit edildi."
        : language === "en"
          ? "Rapor dili İngilizce görünüyor. Şartname Türkçe rapor bekliyorsa görevli incelemesi gerekir."
          : "Rapor dili güvenilir biçimde tespit edilemedi; metin çok kısa veya taranmış görüntü olabilir.",
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

/* ---------------------- Başlık ve şablon eşleştirmesi ---------------------- */

const KEYWORD_STOPWORDS = new Set([
  "raporu", "rapor", "kontrol", "kontrolü", "kuralı", "şartı", "zorunlu",
  "olması", "olmalı", "bulunması", "gereken", "ilgili", "genel", "asgari", "azami",
]);

/** Kriter adından arama anahtarları çıkarır; kısa ve genel kelimeleri eler. */
export function keywordsOf(criterion: Criterion): string[] {
  return wordsOf(criterion.name).filter((word) => word.length >= 4 && !KEYWORD_STOPWORDS.has(word));
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
  /** Kriter adından arama yapılabilir anahtar çıkmadıysa false; "bulunamadı" denemez. */
  searchable: boolean;
  page: number | null;
  snippet: string;
  matchedKeywords: number;
  totalKeywords: number;
};

/**
 * Kriter adındaki anahtar kelimeleri sayfa metinlerinde arar. Anahtarların en az
 * yarısı aynı sayfada geçiyorsa kriter "bulundu" sayılır ve kanıt alıntısı döner.
 */
export function matchCriterionInPages(criterion: Criterion, pages: string[]): CriterionMatch {
  const keywords = keywordsOf(criterion);
  const empty: CriterionMatch = { found: false, searchable: false, page: null, snippet: "", matchedKeywords: 0, totalKeywords: 0 };
  if (!keywords.length) return empty;

  let best: CriterionMatch = { ...empty, searchable: true, totalKeywords: keywords.length };
  pages.forEach((pageText, index) => {
    const loweredPage = lower(pageText);
    const pageWords = loweredPage.split(WORD_SPLIT).filter((word) => word.length >= 3);
    const hits: string[] = [];
    for (const keyword of keywords) {
      const hit = pageWords.find((word) => wordsMatch(keyword, word));
      if (hit) hits.push(hit);
    }
    if (hits.length > best.matchedKeywords) {
      // Alıntı, eşleşen gerçek kelimenin bulunduğu yerden çıkarılır.
      const anchor = loweredPage.indexOf(hits[0]);
      const start = anchor >= 0 ? Math.max(0, anchor - 60) : -1;
      best = {
        found: hits.length * 2 >= keywords.length,
        searchable: true,
        page: index + 1,
        snippet: start >= 0 ? `…${pageText.slice(start, start + 180).trim()}…` : "",
        matchedKeywords: hits.length,
        totalKeywords: keywords.length,
      };
    }
  });
  return best;
}

/** Zorunlu içerik kriterlerinin kaçının raporda bulunduğunu özetleyen ön kontrol. */
export function buildHeadingsCheck(profile: ProfileExport, pages: string[]): PreCheck {
  const mandatory = profile.criteria.filter((item) => item.active && item.type === "mandatory_content");
  if (!mandatory.length) {
    return {
      id: "precheck-headings",
      kind: "headings",
      name: "Zorunlu başlık ve içerik",
      status: "skipped",
      method: "deterministic",
      detail: "Profilde zorunlu içerik kriteri tanımlı değil; başlık kontrolü çalıştırılmadı.",
      evidence: [],
    };
  }
  const matches = mandatory.map((item) => ({ item, match: matchCriterionInPages(item, pages) }));
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
      detail: `Zorunlu içerik kriterlerinin hiçbiri kelime araması ile denetlenemedi.${unsearchableNote}`,
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
      ? `Denetlenebilen ${searchableCount} zorunlu içerik başlığının tamamı raporda bulundu.`
      : `Denetlenebilen ${searchableCount} zorunlu başlıktan ${missing.length} tanesi bulunamadı: ${missing.map((entry) => entry.item.name).join(", ")}. Kelime eşleşmesine dayalı bu sonucu hakem doğrulamalıdır.`) + unsearchableNote,
    evidence: [],
  };
}

/** Biçim kurallarındaki açık sayfa sınırlarını gerçek sayfa sayısıyla karşılaştırır. */
export function buildTemplateCheck(profile: ProfileExport, pageCount: number): PreCheck {
  const formatRules = profile.criteria.filter((item) => item.active && item.type === "format_rule");
  const pageRules = formatRules
    .map((item) => {
      const limit = parsePageLimit(`${item.name} ${item.sourceText}`);
      return limit === null ? null : { rule: item, limit };
    })
    .filter((entry): entry is { rule: Criterion; limit: number } => entry !== null);
  if (!pageRules.length) {
    return {
      id: "precheck-template",
      kind: "template",
      name: "Şablon ve sayfa düzeni",
      status: formatRules.length ? "warning" : "skipped",
      method: "deterministic",
      detail: formatRules.length
        ? `Profilde ${formatRules.length} biçim kuralı var ancak sayısal sayfa sınırı içermiyor; şablon uyumu hakem tarafından kontrol edilmelidir.`
        : "Profilde biçim kuralı tanımlı değil; şablon kontrolü çalıştırılmadı.",
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
    evidence: violated.map((entry) => ({ page: entry.rule.sourcePage, text: entry.rule.sourceText })),
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
    detail:
      status === "passed"
        ? `Analiz anında havuzdaki ${peers.length} raporla anlamlı metin örtüşmesi bulunmadı (en yüksek %${percent}).`
        : `"${topPeer.label}" ile %${percent} metin örtüşmesi tespit edildi. Sistem intihal kararı vermez; inceleme için işaretlendi.`,
    evidence: [],
  };
}
