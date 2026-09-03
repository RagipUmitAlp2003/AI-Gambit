import { loadPdfJs } from "./pdfjs-runtime";
import { letterRatio, normalizeForSearch, normalizeUnicode } from "./turkish-text";

export const PDF_STRUCTURE_VERSION = "pdf-structure-v2-wrapped-lines";

export type PdfBlockType =
  | "HEADING"
  | "NUMBERED_CLAUSE"
  | "PARAGRAPH"
  | "LIST_ITEM"
  | "TABLE_ROW"
  | "CAPTION";

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
};

export type StructuredPdf = {
  version: typeof PDF_STRUCTURE_VERSION;
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

type PositionedLine = {
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
  constructor(message = "PDF'nin okunabilir metin katmanı yetersiz. Belge taranmış görüntü olabilir; OCR uygulanmış bir PDF yükleyin.") {
    super(message);
    this.name = "PdfTextLayerError";
  }
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

/**
 * Kaydırılmış bir madde/bent en fazla kaç görsel satır ve karakter birleştirir.
 * Sınır, hatalı sınıflandırılmış bir satır yüzünden sayfanın yarısının tek
 * bloğa erimesini engeller.
 */
const MAX_WRAPPED_LINES = 8;
const MAX_WRAPPED_CHARS = 700;

function clauseNumberOf(text: string): string | null {
  return text.match(/^\s*(\d+(?:\.\d+){0,5})(?:[.)])?(?=\s|$)/)?.[1] ?? null;
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

function buildPageBlocks(
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

  for (let index = 0; index < normalizedLines.length; index += 1) {
    const line = normalizedLines[index];
    const type = classifyLine(line, bodyFont);
    if (type === "PARAGRAPH") {
      if (!paragraph) paragraph = { lines: [], start: index };
      paragraph.lines.push(line);
      const length = paragraph.lines.reduce((total, item) => total + item.text.length, 0);
      if (/[.!?;:]$/.test(line.text) || length >= 700) flushParagraph();
      continue;
    }
    flushParagraph();
    /*
     * KAYDIRILMIŞ MADDE/BENT SATIRLARI BİRLEŞTİRİLİR.
     *
     * NEDEN: madde işaretli bir kural PDF'te birden fazla görsel satıra
     * taşındığında her satır ayrı blok oluyordu. Sonuç:
     *
     *   blok A: "• ... her boyutu (E x B x D) 100cm' den"
     *   blok B: "küçük olacaktır."
     *
     * Yani KURALIN KENDİSİ hiçbir blokta tam değildi. Bu iki soruna yol
     * açıyordu: (1) modele yarım cümleler aday olarak gidiyor, model bunlarda
     * uygulanabilir bir kural göremeyip "kapsam dışı" diyordu; (2) model
     * cümleyi yakın bağlamdan tamamlayıp alıntıladığında, alıntı tek bloğun
     * içinde bulunamadığı için doğrulama onu reddediyordu. 25 sayfalık bir
     * şartnameden 5 kriter çıkmasının başlıca nedeni buydu.
     *
     * BİRLEŞTİRME ÖLÇÜTÜ TEMKİNLİDİR: yalnızca madde/bent SÖZDİZİMSEL OLARAK
     * BİTMEMİŞKEN (sonunda . ! ? : ; yok) ve sonraki satır yeni bir yapı
     * başlatmıyorken (düz metin, yeni madde işareti/numarası yok) devam satırı
     * eklenir. Böylece maddeden sonra gelen gerçek bir paragraf yutulmaz.
     */
    const merged = [line];
    if (type === "LIST_ITEM" || type === "NUMBERED_CLAUSE") {
      while (index + 1 < normalizedLines.length && merged.length < MAX_WRAPPED_LINES) {
        const tail = merged.at(-1)!.text.trim();
        // Cümle bitmişse devam satırı aranmaz.
        if (/[.!?;:]$/.test(tail)) break;
        const next = normalizedLines[index + 1];
        if (classifyLine(next, bodyFont) !== "PARAGRAPH") break;
        // Yeni bir madde işareti veya madde numarası: devam değil, yeni kural.
        if (isListItem(next.text) || clauseNumberOf(next.text)) break;
        const total = merged.reduce((sum, item) => sum + item.text.length, 0);
        if (total + next.text.length > MAX_WRAPPED_CHARS) break;
        merged.push(next);
        index += 1;
      }
    }
    emit(merged, type, index - (merged.length - 1));
  }
  flushParagraph();
  return blocks;
}

/**
 * PDF.js yalnızca metin ve konum çıkarımı için kullanılır; canvas/render yoktur.
 * Projede zaten istemci PDF okuyucusu olarak bulunduğu için ikinci bir parser
 * ya da Node'a özel PDF bağımlılığı eklenmez.
 */
export async function extractPdfStructure(bytes: ArrayBuffer): Promise<StructuredPdf> {
  const pdfHash = await sha256(bytes);
  // Sunucuda DOMMatrix/Path2D globalleri yok; PDF.js bunları modül gövdesinde
  // kullandığı için yükleme `loadPdfJs` üzerinden yapılır.
  const pdfjs = await loadPdfJs();
  // PDF.js verilen tamponu çözümleyiciye AKTARIR (transfer) ve özgün
  // `ArrayBuffer` çağıranın elinde boş kalır. Bu fonksiyonun imzası böyle bir
  // yan etkiyi düşündürmediği için kopya üzerinde çalışılır: çağıran aynı
  // baytları analizden sonra (ör. arşivleme, bütünlük kontrolü) yeniden
  // kullanabilir.
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
  const letters = fullText.match(/[\p{L}]/gu)?.length ?? 0;
  if (letters < Math.max(80, pageCount * 20) || letterRatio(fullText) < 0.18) throw new PdfTextLayerError();
  return {
    version: PDF_STRUCTURE_VERSION,
    pdfHash,
    pageCount,
    blocks,
    textLength: fullText.length,
    letterRatio: letterRatio(fullText),
  };
}
