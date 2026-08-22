export type ExtractedPdf = {
  pages: string[];
  pageCount: number;
};

async function openPdf(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

export async function getPdfPageCount(file: File): Promise<number> {
  const pdf = await openPdf(file);
  return pdf.numPages;
}

export async function extractPdfText(file: File): Promise<ExtractedPdf> {
  const pdf = await openPdf(file);
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
  }

  return { pages, pageCount: pdf.numPages };
}
