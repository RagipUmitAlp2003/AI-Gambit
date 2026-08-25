export type PageWindow = {
  startPage: number;
  endPage: number;
};

/**
 * Belge uzunluğuna göre dengeli sayfa aralıkları üretir. Aralıklar paralel
 * incelenerek kapsam artırılır; çağrı sayısı gecikme ve maliyet için sınırlıdır.
 */
export function makePageWindows(pageCount: number): PageWindow[] {
  const pages = Math.min(1_000, Math.max(1, Math.round(pageCount || 1)));
  const windowCount = pages <= 30 ? 1 : pages <= 80 ? 2 : pages <= 160 ? 3 : 4;
  const size = Math.ceil(pages / windowCount);
  const windows: PageWindow[] = [];
  for (let startPage = 1; startPage <= pages; startPage += size) {
    windows.push({ startPage, endPage: Math.min(pages, startPage + size - 1) });
  }
  return windows;
}
