// PDF metnini sayfa sayfa düz metne çıkarır (kalite testi korpusu üretmek için).
// Kullanım: node tools/extract_pdf_text.mjs <girdi.pdf> <cikti.txt>
import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("Kullanım: node tools/extract_pdf_text.mjs <girdi.pdf> <cikti.txt>");
  process.exit(1);
}

const data = new Uint8Array(await readFile(input));
const pdf = await getDocument({ data, useSystemFonts: true }).promise;
let text = "";
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  text += `\n===== SAYFA ${pageNumber} =====\n`;
  text += content.items.map((item) => item.str).join(" ").replace(/\s+/g, " ");
  text += "\n";
}
await writeFile(output, text, "utf8");
console.log(`${pdf.numPages} sayfa -> ${output}`);
