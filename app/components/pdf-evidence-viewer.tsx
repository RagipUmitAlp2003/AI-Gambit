"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * KANITI PDF'DE GÖSTER (madde 6)
 *
 * Eski "Kaynak Satıra Git" düğmesi PDF'i yeni sekmede `#page=N` adres parçasıyla
 * açıyordu. Bu parçayı tarayıcıların yerleşik PDF görüntüleyicileri farklı
 * yorumlar; bazıları tamamen yok sayar. Sonuç: düğme ya raporun ilk sayfasını
 * açıyor ya da hiçbir şey yapmıyordu ve hakem bunu anlamıyordu (sessiz
 * başarısızlık).
 *
 * Bu bileşen kanıtı UYGULAMANIN İÇİNDE gösterir:
 *   - PDF, oturumun yetkili ucundan indirilir ve PDF.js ile canvas'a çizilir.
 *   - İlgili sayfaya DOĞRUDAN gidilir; tarayıcı adres parçasına güvenilmez.
 *   - Alıntı, sayfanın metin katmanında aranıp ÜZERİ VURGULANIR.
 *   - Vurgulama yapılamazsa (alıntı satır/sütun sınırında bölünmüş, metin
 *     katmanı farklı sıralanmış) doğru sayfanın açılması GARANTİLİDİR ve
 *     kullanıcıya vurgulamanın yapılamadığı açıkça söylenir.
 *   - PDF hiç açılamazsa sessizce kapanmaz; hata ve sebebi gösterilir.
 */

type Props = {
  /** PDF'i indiren yetkili uç; oturum çerezi ile çağrılır. */
  fileUrl: string;
  fileName: string;
  /** Açılacak 1 tabanlı sayfa; null ise ilk sayfa açılır. */
  page: number | null;
  /** Vurgulanacak birebir alıntı; boşsa yalnızca sayfa açılır. */
  quote: string;
  /** Kanıtın hangi kriter/bölüm için gösterildiği; başlıkta yazılır. */
  label: string;
  onClose: () => void;
};

type LoadState = "loading" | "ready" | "error";

/** PDF.js metin öğesinin bu bileşende kullanılan alanları. */
type TextItem = { str: string; transform: number[]; width: number; height: number };

type Rect = { left: number; top: number; width: number; height: number };

function lower(value: string): string {
  return value.toLocaleLowerCase("tr-TR");
}

/**
 * Sayfa metnini, her çıktı karakterinin HANGİ metin öğesinden geldiğini
 * kaydederek tek bir normalize dizgeye indirir. Boşluklar teke düşürülür;
 * böylece satır sonu veya çift boşluk yüzünden alıntı kaçmaz.
 */
function flattenItems(items: TextItem[]): { text: string; owners: number[] } {
  let text = "";
  const owners: number[] = [];
  items.forEach((item, index) => {
    const value = lower(item.str ?? "");
    for (const character of value) {
      const isSpace = /\s/.test(character);
      if (isSpace) {
        // Ardışık boşluklar tek boşluğa iner; baştaki boşluk hiç yazılmaz.
        if (!text || text.endsWith(" ")) continue;
        text += " ";
        owners.push(index);
        continue;
      }
      text += character;
      owners.push(index);
    }
    // Öğeler arası örtük boşluk: "Mekanik" + "Tasarım" birleşip bozulmasın.
    if (text && !text.endsWith(" ")) {
      text += " ";
      owners.push(index);
    }
  });
  return { text, owners };
}

function normalizeQuote(quote: string): string {
  return lower(quote).replace(/\s+/g, " ").trim();
}

/**
 * Alıntıyı sayfa metninde arar ve onu KAPSAYAN metin öğelerinin sırasını
 * döndürür. Tam alıntı bulunamazsa (hakem uzun pasajı kısaltmış olabilir)
 * ilk 40 karakterlik dilim denenir. Hiçbiri tutmazsa boş dizi döner ve
 * çağıran "vurgulanamadı" bilgisini gösterir.
 */
function locateQuote(items: TextItem[], quote: string): number[] {
  const needleFull = normalizeQuote(quote);
  if (needleFull.length < 4) return [];
  const { text, owners } = flattenItems(items);
  const candidates = [needleFull, needleFull.slice(0, 40).trim()].filter((value) => value.length >= 4);
  for (const needle of candidates) {
    const at = text.indexOf(needle);
    if (at < 0) continue;
    const found = new Set<number>();
    for (let index = at; index < Math.min(owners.length, at + needle.length); index += 1) {
      found.add(owners[index]);
    }
    return [...found].sort((left, right) => left - right);
  }
  return [];
}

export default function PdfEvidenceViewer({ fileUrl, fileName, page, quote, label, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown>; destroy: () => Promise<void> } | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, page ?? 1));
  const [highlights, setHighlights] = useState<Rect[]>([]);
  const [highlightNote, setHighlightNote] = useState("");
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const requestedPage = useMemo(() => Math.max(1, page ?? 1), [page]);

  // PDF bir kez indirilir ve açılır; sayfa değişimi yeniden indirme yapmaz.
  useEffect(() => {
    let cancelled = false;
    let loaded: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const response = await fetch(fileUrl, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error(response.status === 404
            ? "Başvuru PDF'i saklama alanında bulunamadı."
            : `Rapor indirilemedi (sunucu ${response.status}).`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: bytes });
        // Kaynakları serbest bırakan `destroy` YÜKLEME GÖREVİNDEDİR (belgede değil).
        loaded = task;
        const document = await task.promise;
        if (cancelled) { await task.destroy(); return; }
        documentRef.current = document as unknown as typeof documentRef.current;
        setPageCount(document.numPages);
        setCurrentPage(Math.min(document.numPages, requestedPage));
        setState("ready");
      } catch (caught) {
        if (cancelled) return;
        // Sessiz başarısızlık yok: sebep ekrana yazılır.
        setError(caught instanceof Error ? caught.message : "Rapor PDF'i açılamadı.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
      documentRef.current = null;
      loaded?.destroy().catch(() => undefined);
    };
  }, [fileUrl, requestedPage]);

  const renderPage = useCallback(async (pageNumber: number) => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas) return;
    try {
      const pdfPage = await document.getPage(pageNumber) as unknown as {
        getViewport: (options: { scale: number }) => { width: number; height: number; scale: number; convertToViewportPoint: (x: number, y: number) => number[] };
        render: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
        getTextContent: () => Promise<{ items: unknown[] }>;
        cleanup: () => void;
      };
      // Genişliğe göre ölçek: panel içinde okunur, sabit 1.0 çok küçük kalıyor.
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const targetWidth = Math.min(900, Math.max(480, canvas.parentElement?.clientWidth ?? 720));
      const scale = targetWidth / baseViewport.width;
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      setCanvasSize({ width: canvas.width, height: canvas.height });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Tarayıcı canvas bağlamı vermedi; PDF çizilemedi.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport }).promise;

      // Vurgulama yalnızca istenen sayfada ve alıntı varken denenir.
      if (!quote.trim() || pageNumber !== Math.min(pageCount || pageNumber, requestedPage)) {
        setHighlights([]);
        setHighlightNote("");
        pdfPage.cleanup();
        return;
      }
      const content = await pdfPage.getTextContent();
      const items = (content.items as unknown[]).filter((item): item is TextItem =>
        Boolean(item) && typeof (item as TextItem).str === "string" && Array.isArray((item as TextItem).transform));
      const matched = locateQuote(items, quote);
      if (!matched.length) {
        setHighlights([]);
        setHighlightNote("Alıntı bu sayfanın metin katmanında birebir bulunamadı; vurgulama yapılamadı. Doğru sayfa açıldı.");
        pdfPage.cleanup();
        return;
      }
      const rects: Rect[] = matched.map((index) => {
        const item = items[index];
        const [x, y] = [Number(item.transform[4]) || 0, Number(item.transform[5]) || 0];
        const [vx, vy] = viewport.convertToViewportPoint(x, y);
        const height = (Number(item.height) || 10) * scale;
        return {
          left: vx,
          // convertToViewportPoint taban çizgisini verir; kutu yukarı taşınır.
          top: vy - height,
          width: (Number(item.width) || 20) * scale,
          height,
        };
      }).filter((rect) => rect.width > 0 && rect.height > 0);
      setHighlights(rects);
      setHighlightNote(rects.length ? "" : "Alıntının konumu hesaplanamadı; doğru sayfa açıldı.");
      pdfPage.cleanup();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sayfa çizilemedi.");
      setState("error");
    }
  }, [pageCount, quote, requestedPage]);

  useEffect(() => {
    if (state !== "ready") return;
    void renderPage(currentPage);
  }, [state, currentPage, renderPage]);

  // Esc ile kapatma; odak tuzağı kurmadan da klavye ile çıkılabilir.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pdf-viewer-backdrop" role="dialog" aria-modal="true" aria-label={`${label} · kanıt görüntüleyici`}>
      <div className="pdf-viewer-panel">
        <header className="pdf-viewer-head">
          <div>
            <strong>Kanıt · {label}</strong>
            <small>{fileName}{page ? ` · aranan sayfa ${page}` : ""}</small>
          </div>
          <div className="pdf-viewer-actions">
            {/* Yeni sekmede açma kaldırılmadı: hakem tam ekran okumak isteyebilir. */}
            <a className="text-button" href={fileUrl} target="_blank" rel="noreferrer">Yeni sekmede aç</a>
            <button type="button" className="secondary-button" onClick={onClose}>Kapat</button>
          </div>
        </header>

        {state === "error" ? (
          <div className="inline-error" role="alert">
            <strong>Kanıt PDF&apos;i gösterilemedi.</strong>
            <span>{error} Raporu “Yeni sekmede aç” ile indirip elle kontrol edebilirsiniz.</span>
          </div>
        ) : null}

        {state === "loading" ? <p className="page-note">Rapor PDF&apos;i açılıyor…</p> : null}

        {state === "ready" ? (
          <>
            <div className="pdf-viewer-toolbar">
              <button type="button" className="text-button" disabled={currentPage <= 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}>← Önceki</button>
              <span>{currentPage} / {pageCount}</span>
              <button type="button" className="text-button" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((value) => Math.min(pageCount, value + 1))}>Sonraki →</button>
              {page && currentPage !== Math.min(pageCount, requestedPage) ? (
                <button type="button" className="text-button" onClick={() => setCurrentPage(Math.min(pageCount, requestedPage))}>
                  Kanıt sayfasına dön (s. {Math.min(pageCount, requestedPage)})
                </button>
              ) : null}
            </div>
            {page && requestedPage > pageCount ? (
              <p className="pdf-viewer-note" role="status">
                Kanıtta yazan sayfa ({requestedPage}) raporun sayfa sayısından ({pageCount}) büyük; son sayfa açıldı.
              </p>
            ) : null}
            {highlightNote ? <p className="pdf-viewer-note" role="status">{highlightNote}</p> : null}
            <div className="pdf-viewer-stage">
              <div className="pdf-viewer-canvas-wrap" style={{ width: canvasSize.width || undefined }}>
                <canvas ref={canvasRef} />
                {highlights.map((rect, index) => (
                  <span
                    key={`${rect.left}-${rect.top}-${index}`}
                    className="pdf-viewer-highlight"
                    style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
            {quote.trim() ? <q className="pdf-viewer-quote">{quote}</q> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
