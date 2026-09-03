/**
 * `pdfjs-dist` paketi çözümleyici (worker) paketi için tür bildirimi
 * yayımlamaz; yalnızca `pdf.mjs` için `.d.mts` vardır. Sunucuda çözümleyici
 * aynı iş parçacığında çalıştırıldığı için bu modül `app/lib/pdfjs-runtime.ts`
 * içinde içe aktarılır ve `globalThis.pdfjsWorker` alanına yerleştirilir.
 *
 * Yalnızca `WorkerMessageHandler` kullanılır; PDF.js bu alanı kendi
 * `#mainThreadWorkerMessageHandler` kaçış kapısından okur.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: {
    setup(handler: unknown, port: unknown): void;
  };
}
