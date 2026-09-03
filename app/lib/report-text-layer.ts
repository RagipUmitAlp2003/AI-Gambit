import { extractPdfStructure, PdfTextLayerError } from "./pdf-structure";
import { normalizeForSearch } from "./turkish-text";

/**
 * Katılımcı raporunun SUNUCUDAN okunan metin katmanı.
 *
 * İki ayrı zorunluluğu karşılar:
 *
 *   1. TARANMIŞ PDF KORUMASI (madde 8): metin katmanı yoksa analiz hiç
 *      başlamaz. Kanıtsız bir analiz hakeme normal sonuç gibi sunulamaz;
 *      alıntı üretilemeyeceği için bütün bulgular sahte olurdu.
 *   2. HAKEM ALINTISI DOĞRULAMA (madde 5): hakemin yazdığı alıntının
 *      belirttiği sayfada gerçekten bulunduğu sunucuda kontrol edilir.
 *      İstemci verisine tek başına güvenilmez.
 *
 * Sayfa metinleri PDF.js ile çıkarılır (GÖREV 1'de sunucuya taşınan
 * `extractPdfStructure` üzerinden); ikinci bir ayrıştırıcı eklenmez.
 */

export const OCR_REQUIRED_MESSAGE =
  "Bu PDF'nin okunabilir metin katmanı bulunmuyor. OCR uygulanmış bir PDF yüklenmelidir.";

export type ReportTextLayer = {
  /** 1 tabanlı sayfa sırasına göre sayfa metinleri. */
  pages: string[];
  pageCount: number;
  /** Bütün sayfaların birleşik karakter uzunluğu. */
  textLength: number;
};

/** Metin katmanı okunamayan (taranmış) rapor; analiz durdurulur. */
export class ReportOcrRequiredError extends Error {
  constructor(message = OCR_REQUIRED_MESSAGE) {
    super(message);
    this.name = "ReportOcrRequiredError";
  }
}

/**
 * Rapordan sayfa bazlı metin çıkarır. Metin katmanı yoksa veya kanıt
 * gösterilemeyecek kadar zayıfsa `ReportOcrRequiredError` fırlatır.
 */
export async function readReportTextLayer(bytes: ArrayBuffer): Promise<ReportTextLayer> {
  let structure;
  try {
    structure = await extractPdfStructure(bytes);
  } catch (error) {
    // `extractPdfStructure` zaten yetersiz metin katmanını ayrı hata ile bildirir.
    if (error instanceof PdfTextLayerError) throw new ReportOcrRequiredError();
    throw error;
  }
  const pages: string[] = Array.from({ length: structure.pageCount }, () => "");
  for (const block of structure.blocks) {
    const index = block.pageNumber - 1;
    if (index < 0 || index >= pages.length) continue;
    pages[index] = pages[index] ? `${pages[index]}\n${block.originalText}` : block.originalText;
  }
  const textLength = pages.reduce((total, page) => total + page.length, 0);
  /*
   * Sayfa başına ortalama 40 karakterin altı, gövdesi görüntü olan bir belgeyi
   * gösterir: PDF.js birkaç kapak/başlık metni bulmuş olabilir ama hiçbir
   * kritere alıntı çıkarılamaz. Böyle bir analiz hakeme sunulmaz.
   */
  if (textLength < Math.max(200, structure.pageCount * 40)) throw new ReportOcrRequiredError();
  return { pages, pageCount: structure.pageCount, textLength };
}

/**
 * Hakemin yazdığı alıntı, belirttiği sayfada gerçekten var mı?
 *
 * Karşılaştırma `normalizeForSearch` ile yapılır: PDF metni satır sonu, çift
 * boşluk ve yazım işaretleri bakımından hakemin kopyaladığı metinden farklı
 * olabilir. Alıntının tamamı bulunamazsa, hakem uzun bir pasajı kısaltmış
 * olabileceği için ilk anlamlı parçası da denenir.
 *
 * Dönüş `null` ise doğrulama YAPILAMADI (sayfa aralık dışında veya sayfa metni
 * yok); bu durumda çağıran karar düşürmez, uyarı üretir.
 */
export function quoteFoundOnPage(layer: ReportTextLayer, page: number, quote: string): boolean | null {
  if (!Number.isInteger(page) || page < 1 || page > layer.pages.length) return null;
  const pageText = normalizeForSearch(layer.pages[page - 1] ?? "");
  if (!pageText) return null;
  const needle = normalizeForSearch(quote);
  // Çok kısa alıntı ("bkz") her sayfada bulunur; doğrulaması anlamlı değildir.
  if (needle.length < 12) return null;
  if (pageText.includes(needle)) return true;
  // Hakem uzun pasajı "…" ile kısaltmış olabilir: ilk 60 karakterlik dilim aranır.
  const head = needle.slice(0, 60).trim();
  return head.length >= 12 ? pageText.includes(head) : false;
}
