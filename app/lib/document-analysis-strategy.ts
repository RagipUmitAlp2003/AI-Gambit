export type PageWindow = {
  startPage: number;
  endPage: number;
};

/**
 * Belge uzunluğuna göre dengeli, bir sayfa örtüşmeli aralıklar üretir.
 * Örtüşme; tablonun, dipnotun veya maddenin pencere sınırında bölünmesi
 * durumunda bağlamın kaybolmasını önler. Çağrı sayısı en fazla dörttür.
 */
export function makePageWindows(pageCount: number): PageWindow[] {
  const pages = Math.min(1_000, Math.max(1, Math.round(pageCount || 1)));
  const windowCount = pages <= 12 ? 1 : Math.min(4, Math.ceil(pages / 9));
  if (windowCount === 1) return [{ startPage: 1, endPage: pages }];
  const overlap = 1;
  const size = Math.ceil((pages + overlap * (windowCount - 1)) / windowCount);
  const windows: PageWindow[] = [];
  let startPage = 1;
  for (let index = 0; index < windowCount; index += 1) {
    const endPage = index === windowCount - 1 ? pages : Math.min(pages, startPage + size - 1);
    windows.push({ startPage, endPage });
    startPage = endPage;
  }
  return windows;
}
