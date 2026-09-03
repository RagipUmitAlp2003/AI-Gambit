/**
 * pdfjs-dist worker modülü tip bildirimi yayımlamaz; modül yüklendiğinde
 * kendini `globalThis.pdfjsWorker` olarak kaydeder (bkz. pdf-structure.ts ·
 * ensurePdfJsFakeWorker). Yalnızca yan etkisi için import edilir.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
