import { letterRatio, normalizeForSearch, normalizeUnicode } from "./turkish-text";

/**
 * Blok çıktısını değiştiren her davranış değişikliğinde artırılır; analiz
 * önbellek anahtarı bu sürümü içerdiği için eski ham model çıktıları yeni
 * bloklara karşı asla yeniden oynatılmaz.
 *
 * v2: madde numarası makullük sınırları (yıl/tarih/tutar/sayfa numarası artık
 * madde sayılmaz) ve salt rakam satırlarının paragrafa karışmaması.
 */
export const PDF_STRUCTURE_VERSION = "pdf-structure-v2";

/**
 * OCR (görüntü okuma) yedeğiyle üretilen yapının sürümü. Metin katmanı
 * sürümünden ayrı tutulur: OCR yapısı belge başına bir kez üretilip R2'de
 * sabitlenir ve bu sürüm damgasıyla doğrulanarak geri okunur.
 */
export const PDF_STRUCTURE_OCR_VERSION = "pdf-structure-ocr-v1";

export const PDF_BLOCK_TYPES = [
  "HEADING",
  "NUMBERED_CLAUSE",
  "PARAGRAPH",
  "LIST_ITEM",
  "TABLE_ROW",
  "CAPTION",
] as const;

export type PdfBlockType = (typeof PDF_BLOCK_TYPES)[number];

export type PdfStructureBlock = {
  sourceId: string;
  pdfHash: string;
  pdfVersion: string;
  pageNumber: number;
  sectionTitle: string;
  subsectionTitle: string;
  clauseNumber: string | null;
  blockType: PdfBlockType;
  originalText: string;
  normalizedText: string;
  approximatePosition: { top: number; left: number; lineStart: number; lineEnd: number };
  /** Metin OCR (görüntü okuma) ile çıkarıldıysa "ocr"; metin katmanı bloklarında alan bulunmaz. */
  extraction?: "ocr";
};

export type StructuredPdf = {
  version: typeof PDF_STRUCTURE_VERSION | typeof PDF_STRUCTURE_OCR_VERSION;
  pdfHash: string;
  pageCount: number;
  blocks: PdfStructureBlock[];
  textLength: number;
  letterRatio: number;
};

type TextItem = {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
};

export type PositionedLine = {
  text: string;
  y: number;
  x: number;
  fontSize: number;
  itemCount: number;
  largeGaps: number;
  sourceLineStart?: number;
  sourceLineEnd?: number;
};

export class PdfTextLayerError extends Error {
  /** pdf.js'in belgeden ölçtüğü sayfa sayısı; OCR yedeği bunu üst sınır olarak kullanır. */
  readonly pageCount?: number;
  /** Belgenin SHA-256 özeti; OCR yapısının R2'de sabitlenmesi bu anahtarla yapılır. */
  readonly pdfHash?: string;
  constructor(
    message = "PDF'nin okunabilir metin katmanı yetersiz. Belge taranmış görüntü olabilir; OCR uygulanmış bir PDF yükleyin.",
    details: { pageCount?: number; pdfHash?: string } = {},
  ) {
    super(message);
    this.name = "PdfTextLayerError";
    this.pageCount = details.pageCount;
    this.pdfHash = details.pdfHash;
  }
}

/**
 * pdfjs-dist, modül yüklemesi sırasında `DOMMatrix` globalini ister. Node'da
 * bunu isteğe bağlı `@napi-rs/canvas` paketinden alır; Cloudflare workerd'de
 * ise ne DOM API'si ne de native modül vardır ve yükleme
 * "ReferenceError: DOMMatrix is not defined" ile çöker (analiz ucunda genel
 * 500'ün kök nedeni). Metin çıkarımı hiçbir çizim yapmadığı için tam bir DOM
 * uygulaması gerekmez; modül değerlendirmesini ayakta tutan asgari 2B afin
 * matris yeterlidir. Yalnızca global tanımsızsa devreye girer.
 */
class WorkerSafeDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: number[]) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init.map((value) => Number(value) || 0);
    }
  }
  translate(tx = 0, ty = 0): WorkerSafeDOMMatrix {
    const next = new WorkerSafeDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
    next.e += tx * this.a + ty * this.c;
    next.f += tx * this.b + ty * this.d;
    return next;
  }
  scale(sx = 1, sy = sx): WorkerSafeDOMMatrix {
    return new WorkerSafeDOMMatrix([this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f]);
  }
  multiply(other?: { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }): WorkerSafeDOMMatrix {
    const o = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, ...(other ?? {}) };
    return new WorkerSafeDOMMatrix([
      this.a * o.a + this.c * o.b,
      this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d,
      this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e,
      this.b * o.e + this.d * o.f + this.f,
    ]);
  }
}

/** Çizim API'si hiç kullanılmadığı için boş gövde yeterlidir. */
class WorkerSafePath2D {
  addPath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  rect() {}
  closePath() {}
}

function ensurePdfJsRuntimeGlobals(): void {
  const host = globalThis as { DOMMatrix?: unknown; Path2D?: unknown };
  if (typeof host.DOMMatrix === "undefined") host.DOMMatrix = WorkerSafeDOMMatrix;
  if (typeof host.Path2D === "undefined") host.Path2D = WorkerSafePath2D;
}

/**
 * pdf.js, tarayıcı Worker'ı olmayan ortamlarda "fake worker" kurar ve worker
 * modülünü çalışma anında `import(workerSrc)` ile yüklemeye çalışır. Vite ve
 * workerd altında bu dinamik yol çözülemez ("Setting up fake worker failed:
 * pdf.worker.mjs does not exist"). Worker modülü burada statik belirteçle
 * önceden yüklenir; modül kendini `globalThis.pdfjsWorker` olarak kaydeder ve
 * pdf.js dinamik importu hiç denemez. Yükleme bir kez yapılır.
 */
async function ensurePdfJsFakeWorker(): Promise<void> {
  const host = globalThis as { pdfjsWorker?: unknown };
  if (!host.pdfjsWorker) await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function uppercaseRatio(text: string): number {
  const letters = text.match(/[\p{L}]/gu) ?? [];
  if (!letters.length) return 0;
  const uppercase = text.match(/[\p{Lu}]/gu)?.length ?? 0;
  return uppercase / letters.length;
}

function joinItems(items: Array<{ item: TextItem; x: number }>): { text: string; largeGaps: number } {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = "";
  let previousEnd = 0;
  let largeGaps = 0;
  for (const current of sorted) {
    const value = normalizeUnicode(current.item.str ?? "").trim();
    if (!value) continue;
    const width = Number(current.item.width) || Math.max(4, value.length * 4);
    const gap = text ? current.x - previousEnd : 0;
    if (text && gap > 3) text += gap > 24 ? "\t" : " ";
    if (gap > 24) largeGaps += 1;
    text += value;
    previousEnd = current.x + width;
  }
  return { text: text.replace(/[ \t]+/g, (value) => value.includes("\t") ? "\t" : " ").trim(), largeGaps };
}

function linesFromItems(rawItems: unknown[]): PositionedLine[] {
  const groups: Array<{ y: number; items: Array<{ item: TextItem; x: number }> }> = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as TextItem;
    if (!item.str?.trim()) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    let group = groups.find((entry) => Math.abs(entry.y - y) <= 2.5);
    if (!group) {
      group = { y, items: [] };
      groups.push(group);
    }
    group.items.push({ item, x });
  }
  return groups
    .sort((a, b) => b.y - a.y)
    .map((group) => {
      const joined = joinItems(group.items);
      return {
        text: joined.text,
        y: group.y,
        x: Math.min(...group.items.map((entry) => entry.x)),
        fontSize: Math.max(...group.items.map((entry) => Math.abs(Number(entry.item.transform?.[3])) || Number(entry.item.height) || 0)),
        itemCount: group.items.length,
        largeGaps: joined.largeGaps,
      };
    })
    .filter((line) => line.text.length > 0);
}

/** Türkçe ay adları (arama biçimi): "22 - 26 Haziran 2026" gibi tarih satırları madde değildir. */
const TURKISH_MONTHS = new Set([
  "ocak", "subat", "mart", "nisan", "mayis", "haziran",
  "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik",
]);

/**
 * Nokta bölütleri bir madde numarası için makul mü?
 * Bölüt en çok 3 haneli olabilir ve ("0" hariç) öndeki sıfırla yazılamaz:
 * "2024" (yıl), "28.02.2026" (tarih), "250.000" (tutar), "40.790343"
 * (koordinat) bu sınırlara takılır; "1", "4.1", "3.2.1" geçer.
 */
function plausibleClauseValue(value: string): boolean {
  return value.split(".").every((segment) => segment.length <= 3 && (segment.length === 1 || !segment.startsWith("0")));
}

/**
 * Satır başındaki sayının GERÇEK madde numarası olup olmadığına karar verir.
 *
 * Eski hâli her rakam dizisini madde sayıyordu; 40 şartnamelik korpus
 * ölçümünde madde numarası verilen blokların %27'si yıl, tarih, para,
 * koordinat, adet veya sayfa numarası çıktı. Korpusla doğrulanan kurallar
 * (3.577 gerçek madde korundu, 1.306 sahte numara elendi, gerçek madde kaybı yok):
 *   - Bölüt makullüğü: bkz. plausibleClauseValue.
 *   - Ayraçsız tek sayı, satırda başka içerik yoksa madde değildir (sayfa numarası "17").
 *   - Ayraçsız tek sayı ≤ 31 ise ve hemen ardından Türkçe ay adı geliyorsa
 *     tarih aralığıdır ("30 Eylül-4 Ekim 2026"), madde değildir.
 * Ayraç ZORUNLU TUTULMAZ: TEKNOFEST şartnamelerinde "2 YARIŞMA TAKVİMİ" gibi
 * çıplak numaralı başlıklar ve "8 Ayrılma mekanizması ..." gibi çıplak
 * numaralı ister satırları gerçektir; "1.1 Yarışma Kapsamı" da öyle. Birim
 * kelimesi sözlüğü de BİLİNÇLİ olarak yoktur: ön ek eşleşmesi "10.7 Kişisel
 * Veri ..." gibi gerçek maddeleri ("kişi") yanlışlıkla elerdi.
 */
export function clauseNumberOf(text: string): string | null {
  const match = text.match(/^\s*(\d+(?:\.\d+){0,5})([.)])?(?=\s|$)/);
  if (!match) return null;
  const [matched, value, delimiter] = match;
  if (!plausibleClauseValue(value)) return null;
  if (!value.includes(".") && !delimiter) {
    const rest = text.slice(matched.length);
    if (!rest.trim()) return null;
    if (Number(value) <= 31) {
      const firstWord = normalizeForSearch(rest).slice(0, 20).match(/[a-z]+/)?.[0] ?? "";
      if (TURKISH_MONTHS.has(firstWord)) return null;
    }
  }
  return value;
}

function isCaption(text: string): boolean {
  return /^(?:şekil|sekil|tablo|çizelge|cizelge|grafik)\s*\d+/i.test(text.trim());
}

function isListItem(text: string): boolean {
  return /^\s*(?:[-•●▪◦]|[a-zA-ZçğıöşüÇĞİÖŞÜ][.)])\s+/.test(text);
}

function classifyLine(line: PositionedLine, bodyFont: number): PdfBlockType {
  const text = line.text.trim();
  if (isCaption(text)) return "CAPTION";
  if (line.largeGaps >= 2 && line.itemCount >= 3) return "TABLE_ROW";
  if (isListItem(text)) return "LIST_ITEM";
  const clause = clauseNumberOf(text);
  if (clause && (text.length > 90 || /[.!?;:]$/.test(text))) return "NUMBERED_CLAUSE";
  const headingByFont = bodyFont > 0 && line.fontSize >= bodyFont * 1.14;
  const headingByShape = text.length <= 120 && !/[.!?;]$/.test(text)
    && (uppercaseRatio(text) >= 0.72 || Boolean(clause));
  if (headingByFont || headingByShape) return "HEADING";
  if (clause) return "NUMBERED_CLAUSE";
  return "PARAGRAPH";
}

function safeIdPart(value: string): string {
  return normalizeForSearch(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, 48);
}

function repairHyphenatedPageLines(lines: PositionedLine[]): PositionedLine[] {
  const repaired: PositionedLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index];
    let current = { ...first, sourceLineStart: index + 1, sourceLineEnd: index + 1 };
    while (
      /[\p{L}]-$/u.test(current.text.trim())
      && index + 1 < lines.length
      && /^\s*[\p{Ll}]/u.test(lines[index + 1].text)
    ) {
      index += 1;
      current = {
        ...current,
        text: `${current.text.trim().slice(0, -1)}${lines[index].text.trim()}`,
        sourceLineEnd: index + 1,
      };
    }
    repaired.push(current);
  }
  return repaired;
}

export function buildPageBlocks(
  lines: PositionedLine[],
  pageNumber: number,
  pdfHash: string,
): PdfStructureBlock[] {
  const bodyFont = median(lines.map((line) => line.fontSize).filter((size) => size > 0));
  const normalizedLines = repairHyphenatedPageLines(lines);
  const blocks: PdfStructureBlock[] = [];
  const sourceIdCounts = new Map<string, number>();
  let sectionTitle = "";
  let subsectionTitle = "";
  let paragraph: { lines: PositionedLine[]; start: number } | null = null;

  const emit = (sourceLines: PositionedLine[], type: PdfBlockType, start: number) => {
    const originalText = sourceLines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    if (!originalText) return;
    const clauseNumber = clauseNumberOf(originalText);
    const ordinal = blocks.length + 1;
    const baseClausePart = clauseNumber ? `MADDE-${safeIdPart(clauseNumber)}` : `BLOK-${String(ordinal).padStart(3, "0")}`;
    const seenCount = (sourceIdCounts.get(baseClausePart) ?? 0) + 1;
    sourceIdCounts.set(baseClausePart, seenCount);
    const clausePart = seenCount === 1 ? baseClausePart : `${baseClausePart}-${seenCount}`;
    blocks.push({
      sourceId: `SAYFA-${String(pageNumber).padStart(2, "0")}-${clausePart}`,
      pdfHash,
      pdfVersion: pdfHash.slice(0, 16),
      pageNumber,
      sectionTitle,
      subsectionTitle,
      clauseNumber,
      blockType: type,
      originalText,
      normalizedText: normalizeForSearch(originalText),
      approximatePosition: {
        top: Math.round(Math.max(...sourceLines.map((line) => line.y))),
        left: Math.round(Math.min(...sourceLines.map((line) => line.x))),
        lineStart: sourceLines[0]?.sourceLineStart ?? start + 1,
        lineEnd: sourceLines.at(-1)?.sourceLineEnd ?? start + sourceLines.length,
      },
    });
    if (type === "HEADING") {
      if (clauseNumber?.includes(".")) subsectionTitle = originalText;
      else {
        sectionTitle = originalText;
        subsectionTitle = "";
      }
    }
  };

  const flushParagraph = () => {
    if (!paragraph) return;
    emit(paragraph.lines, "PARAGRAPH", paragraph.start);
    paragraph = null;
  };

  normalizedLines.forEach((line, index) => {
    const type = classifyLine(line, bodyFont);
    if (type === "PARAGRAPH") {
      // Yalnızca rakam/nokta içeren satır (sayfa numarası "17", üstbilgi
      // tarihi "28.02.2026") paragrafa KARIŞTIRILMAZ: birleşen metin
      // "17 Rapor ..." olur ve emit içindeki ikinci clauseNumberOf çağrısı
      // sahte madde numarasını geri getirirdi. Satır kendi başına blok olur
      // ve kapsam denetim kaydında (Spec §8) aynen korunur.
      if (/^\d[\d.]*$/.test(line.text.trim())) {
        flushParagraph();
        emit([line], "PARAGRAPH", index);
        return;
      }
      if (!paragraph) paragraph = { lines: [], start: index };
      paragraph.lines.push(line);
      const length = paragraph.lines.reduce((total, item) => total + item.text.length, 0);
      if (/[.!?;:]$/.test(line.text) || length >= 700) flushParagraph();
      return;
    }
    flushParagraph();
    emit([line], type, index);
  });
  flushParagraph();
  return blocks;
}

/**
 * Metin yeterlilik kapısı: pdf.js metin katmanı da OCR aktarımı da AYNI
 * eşikle ölçülür (sayfa başına ~20, en az 80 harf ve %18 harf yoğunluğu).
 * Kapıyı geçemeyen metin katmanı PdfTextLayerError'a, geçemeyen OCR çıktısı
 * kontrollü OCR hatasına dönüşür.
 */
export function hasSufficientText(fullText: string, pageCount: number): boolean {
  const letters = fullText.match(/[\p{L}]/gu)?.length ?? 0;
  return letters >= Math.max(80, pageCount * 20) && letterRatio(fullText) >= 0.18;
}

export type OcrPageBlock = {
  blockType: PdfBlockType;
  text: string;
  sectionTitle?: string;
  clauseNumber?: string | null;
};

export type OcrPage = {
  pageNumber: number;
  blocks: OcrPageBlock[];
};

/** OCR aktarımında tek blok metni için üst sınır; taşan model çıktısına fren. */
const OCR_BLOCK_TEXT_LIMIT = 2000;

/**
 * Gemini görüntü okumasından (OCR) dönen sayfa bloklarını, metin katmanıyla
 * AYNI kaynak kimliği şemasına sahip yapıya çevirir. Kimlik şeması bilinçli
 * olarak TEK modülde (burada) kalır: SAYFA-XX-MADDE-… / SAYFA-XX-BLOK-NNN,
 * sayfa içi tekrar sayacı dahil (bkz. buildPageBlocks · emit).
 *
 * Sunucu doğrulaması (şartname §9'un OCR yolunda tutabildiği çapa):
 *   - Sayfa numarası pdf.js'in ölçtüğü 1..pageCount aralığının dışındaysa blok
 *     DÜŞER; model belgeye sayfa uyduramaz.
 *   - Boş metin düşer, blok metni sınırlanır, sayfalar artan sırada işlenir.
 * Aynı model çıktısı her çalıştırmada aynı kimlikleri üretir (deterministik).
 */
export function buildStructureFromOcrPages(pages: OcrPage[], pdfHash: string, pageCount: number): StructuredPdf {
  const blocks: PdfStructureBlock[] = [];
  const orderedPages = [...pages]
    .filter((page) => (
      page && Number.isInteger(page.pageNumber) && page.pageNumber >= 1
      && page.pageNumber <= pageCount && Array.isArray(page.blocks)
    ))
    .sort((left, right) => left.pageNumber - right.pageNumber);
  for (const page of orderedPages) {
    const sourceIdCounts = new Map<string, number>();
    let ordinal = 0;
    let sectionTitle = "";
    let subsectionTitle = "";
    for (const rawBlock of page.blocks) {
      const originalText = normalizeUnicode(String(rawBlock?.text ?? "")).replace(/\s+/g, " ").trim().slice(0, OCR_BLOCK_TEXT_LIMIT);
      if (!originalText) continue;
      const blockType: PdfBlockType = PDF_BLOCK_TYPES.includes(rawBlock.blockType) ? rawBlock.blockType : "PARAGRAPH";
      // Metinden türetilen numara önceliklidir (v2 makullük sınırları OCR'de de
      // geçerli); modelin ayrıca bildirdiği numara ancak aynı sınırlardan
      // geçerse kullanılır.
      const providedClause = typeof rawBlock.clauseNumber === "string" ? rawBlock.clauseNumber.trim() : "";
      const clauseNumber = clauseNumberOf(originalText)
        ?? (providedClause && /^\d+(?:\.\d+){0,5}$/.test(providedClause) && plausibleClauseValue(providedClause) ? providedClause : null);
      ordinal += 1;
      const baseClausePart = clauseNumber ? `MADDE-${safeIdPart(clauseNumber)}` : `BLOK-${String(ordinal).padStart(3, "0")}`;
      const seenCount = (sourceIdCounts.get(baseClausePart) ?? 0) + 1;
      sourceIdCounts.set(baseClausePart, seenCount);
      const clausePart = seenCount === 1 ? baseClausePart : `${baseClausePart}-${seenCount}`;
      const providedSection = normalizeUnicode(String(rawBlock?.sectionTitle ?? "")).replace(/\s+/g, " ").trim().slice(0, 240);
      blocks.push({
        sourceId: `SAYFA-${String(page.pageNumber).padStart(2, "0")}-${clausePart}`,
        pdfHash,
        pdfVersion: pdfHash.slice(0, 16),
        pageNumber: page.pageNumber,
        // Başlık izleme emit ile aynıdır; model ayrıca bölüm adı bildirdiyse
        // yalnızca akış başlığı boşken kullanılır.
        sectionTitle: sectionTitle || providedSection,
        subsectionTitle,
        clauseNumber,
        blockType,
        originalText,
        normalizedText: normalizeForSearch(originalText),
        approximatePosition: { top: 0, left: 0, lineStart: ordinal, lineEnd: ordinal },
        extraction: "ocr",
      });
      if (blockType === "HEADING") {
        if (clauseNumber?.includes(".")) subsectionTitle = originalText;
        else {
          sectionTitle = originalText;
          subsectionTitle = "";
        }
      }
    }
  }
  const fullText = blocks.map((block) => block.originalText).join("\n");
  return {
    version: PDF_STRUCTURE_OCR_VERSION,
    pdfHash,
    pageCount,
    blocks,
    textLength: fullText.length,
    letterRatio: letterRatio(fullText),
  };
}

/**
 * PDF.js yalnızca metin ve konum çıkarımı için kullanılır; canvas/render yoktur.
 * Projede zaten istemci PDF okuyucusu olarak bulunduğu için ikinci bir parser
 * ya da Node'a özel PDF bağımlılığı eklenmez.
 */
export async function extractPdfStructure(bytes: ArrayBuffer): Promise<StructuredPdf> {
  const pdfHash = await sha256(bytes);
  ensurePdfJsRuntimeGlobals();
  await ensurePdfJsFakeWorker();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js, verilen görünümün ALTINDAKİ ArrayBuffer'ı worker'a transfer edip
  // KOPARIR (structuredClone + transfer; fake worker'da da aynı). Çağıranın
  // tamponu bozulmasın diye pdf.js'e her zaman KOPYA verilir — aksi hâlde
  // metin katmanı yetersiz çıkıp OCR yedeğine geçildiğinde aynı bayt dizisi
  // sıfır uzunlukta kalır ve OCR yolu daha başlamadan çökerdi.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes.slice(0)),
  });
  const blocks: PdfStructureBlock[] = [];
  let pageCount = 0;
  try {
    const document = await loadingTask.promise;
    pageCount = document.numPages;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: true });
      blocks.push(...buildPageBlocks(linesFromItems(content.items as unknown[]), pageNumber, pdfHash));
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  const fullText = blocks.map((block) => block.originalText).join("\n");
  // Hata, OCR yedeğinin ihtiyaç duyduğu ölçümleri (sayfa sayısı, belge özeti)
  // taşır; mesaj ve kontrollü durak davranışı değişmez.
  if (!hasSufficientText(fullText, pageCount)) throw new PdfTextLayerError(undefined, { pageCount, pdfHash });
  return {
    version: PDF_STRUCTURE_VERSION,
    pdfHash,
    pageCount,
    blocks,
    textLength: fullText.length,
    letterRatio: letterRatio(fullText),
  };
}
