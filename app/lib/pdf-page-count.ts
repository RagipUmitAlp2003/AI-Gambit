/**
 * Sunucu tarafı PDF sayfa sayımı.
 *
 * PDF.js tarayıcıda kullanılır; Cloudflare sunucu paketinde DOM/canvas
 * bağımlılığı doğurur. Sunucuda sayfa nesneleri (`/Type /Page`) ile sayfa
 * ağacının (`/Type /Pages` · `/Count`) değeri bağımsız olarak çapraz kontrol
 * edilir.
 *
 * NEDEN GEREKLİ: sayfa sayısı yalnızca bir bilgi alanı değil, model çıktısının
 * DOĞRULAMA SINIRIDIR. Kriter çıkarımında modelin verdiği `sourcePage` bu üst
 * sınırla karşılaştırılır. İstemciden gelen sayı eksik veya hatalı geldiğinde
 * (form alanı düşerse `Number(null) === 0` → alt sınır 1) bütün kaynak sayfalar
 * "aralık dışı" sayılıp siliniyor ve ekranda her kriterde "kaynak sayfa
 * girilmedi" yazıyordu. Sınır artık belgenin kendisinden okunur.
 */

import { Buffer } from "node:buffer";

export type PdfPageCount = {
  /** En olası sayfa sayısı; iki ölçüm çelişirse sayfa nesnesi sayımı esas alınır. */
  pages: number;
  /** İki bağımsız ölçüm aynı sonucu verdi mi? Vermediyse sayı tahminidir. */
  trusted: boolean;
  /**
   * Kaynak sayfa doğrulaması için ÜST sınır: bütün ölçümlerin büyüğü.
   *
   * Ölçümler çeliştiğinde `pages` temkinli davranıp sayfa nesnesi sayımını
   * seçer; DOĞRULAMADA ise temkinli olan büyüğüdür. Sınır fazla dar olursa
   * geçerli bir kriter sessizce silinir; fazla geniş olursa yalnızca birkaç
   * sayfa sapmış bir numara kabul edilir ve yönetici bunu ekranda düzeltebilir.
   */
  upperBound: number;
};

export function countPdfPages(bytes: ArrayBuffer, fallback: number): PdfPageCount {
  const source = Buffer.from(bytes).toString("latin1");
  const directPages = source.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
  const treeCounts = [...source.matchAll(/(?:\/Type\s*\/Pages\b[\s\S]{0,500}?\/Count\s+(\d+)|\/Count\s+(\d+)[\s\S]{0,500}?\/Type\s*\/Pages\b)/g)]
    .map((match) => Number(match[1] ?? match[2]))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 1000);
  const treeMax = treeCounts.length ? Math.max(...treeCounts) : 0;
  const upperBound = Math.max(directPages, treeMax, fallback > 0 ? fallback : 0, 1);

  if (directPages > 0 && (!treeMax || treeMax === directPages)) return { pages: directPages, trusted: true, upperBound };
  if (treeMax > 0 && !directPages) return { pages: treeMax, trusted: true, upperBound };
  if (directPages > 0) return { pages: directPages, trusted: false, upperBound };
  return { pages: fallback, trusted: false, upperBound };
}

/**
 * Kaynak sayfa doğrulamasında kullanılacak üst sınır.
 *
 * İstemcinin pdfjs ile saydığı değer ile sunucunun belgeden okuduğu ölçümlerin
 * BÜYÜĞÜ alınır: ölçümlerden biri düşük kalırsa geçerli bir kaynak sayfası
 * yanlışlıkla silinmez. Sıkıştırılmış nesne akışı (object stream) kullanan
 * PDF'lerde sunucu sayımı gerçek sayfa sayısının altında kalabilir.
 */
export function sourcePageLimit(bytes: ArrayBuffer, clientPageCount: number): { limit: number; server: PdfPageCount } {
  const client = Number.isInteger(clientPageCount) && clientPageCount > 0 ? clientPageCount : 0;
  const server = countPdfPages(bytes, client || 1);
  return { limit: Math.min(1000, Math.max(1, server.upperBound, client)), server };
}
