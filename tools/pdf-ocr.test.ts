import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { extractPdfStructureViaOcr } from "../app/lib/pdf-ocr.ts";
import { buildStructureFromOcrPages, extractPdfStructure, PDF_STRUCTURE_OCR_VERSION, type OcrPage } from "../app/lib/pdf-structure.ts";

/**
 * OCR yedeği testleri — HİÇBİR canlı Gemini çağrısı yapılmaz: `globalThis.fetch`
 * her testte sahte generateContent yanıtıyla değiştirilir (aynı kalıp
 * tools/regression-tests.mjs · runSingleGeneration bloğunda kullanılır).
 */

/** Satır içi (inline) hızlı yolu tetikleyen küçük sahte PDF gövdesi. */
function smallPdf(): ArrayBuffer {
  return new TextEncoder().encode("%PDF-1.4 sahte taranmis belge").buffer as ArrayBuffer;
}

function geminiResponse(payloadText: string): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: payloadText }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

/** 2 sayfalık, yeterlilik kapısını geçen tipik aktarım çıktısı. */
const cannedPages: OcrPage[] = [
  {
    pageNumber: 1,
    blocks: [
      { blockType: "HEADING", text: "4.1. BAŞVURU ONAY KOŞULLARI", clauseNumber: "4.1" },
      { blockType: "NUMBERED_CLAUSE", text: "4.1.1 Takımlar başvuru formunu eksiksiz doldurmalıdır." },
      { blockType: "PARAGRAPH", text: "Başvuru sırasında takım adı ve danışman bilgisi açıkça yazılmalıdır." },
    ],
  },
  {
    pageNumber: 2,
    blocks: [
      { blockType: "NUMBERED_CLAUSE", text: "5.2 Rapor en fazla yirmi beş sayfa olmalıdır." },
      { blockType: "PARAGRAPH", text: "Raporun her bölümü Türkçe hazırlanmalı ve kaynakça içermelidir." },
    ],
  },
];

test("OCR yanıtı aynı sourceId şemasıyla deterministik yapı üretir", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiResponse(JSON.stringify({ pages: cannedPages }));
    const run = () => extractPdfStructureViaOcr({
      apiKey: "test", pdfBytes: smallPdf(), fileName: "taranmis.pdf", pageCount: 2, pdfHash: "a".repeat(64),
    });
    const first = await run();
    const second = await run();
    if (!first.ok || !second.ok) assert.fail("OCR koşuları başarılı olmalıydı");
    assert.equal(first.structure.version, PDF_STRUCTURE_OCR_VERSION);
    assert.equal(first.structure.version, "pdf-structure-ocr-v1");
    assert.ok(first.structure.blocks.some((block) => block.sourceId === "SAYFA-01-MADDE-4-1"));
    assert.ok(first.structure.blocks.some((block) => block.sourceId === "SAYFA-02-MADDE-5-2"));
    assert.ok(first.structure.blocks.every((block) => block.extraction === "ocr"));
    assert.equal(first.apiCalls, 1);
    // Aynı model çıktısı iki koşuda birebir aynı kimlikleri üretmelidir.
    assert.deepEqual(
      first.structure.blocks.map((block) => block.sourceId),
      second.structure.blocks.map((block) => block.sourceId),
    );
    assert.equal(new Set(first.structure.blocks.map((block) => block.sourceId)).size, first.structure.blocks.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sayfa sınırı dışındaki OCR blokları sunucuda düşer", () => {
  // Şartname §9: sayfa sayısı pdf.js ölçümüdür; model sayfa uyduramaz.
  const structure = buildStructureFromOcrPages([
    { pageNumber: 2, blocks: [{ blockType: "PARAGRAPH", text: "Rapor kapak sayfası içermelidir." }] },
    { pageNumber: 99, blocks: [{ blockType: "PARAGRAPH", text: "Bu blok belge sınırının dışındadır." }] },
  ], "b".repeat(64), 3);
  assert.equal(structure.blocks.length, 1);
  assert.ok(structure.blocks.every((block) => block.pageNumber >= 1 && block.pageNumber <= 3));
  assert.ok(!structure.blocks.some((block) => block.originalText.includes("sınırının dışında")));
});

test("yetersiz OCR metni kontrollü hatayla durur", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiResponse(JSON.stringify({
      pages: [{ pageNumber: 1, blocks: [{ blockType: "PARAGRAPH", text: "kısa" }] }],
    }));
    const outcome = await extractPdfStructureViaOcr({
      apiKey: "test", pdfBytes: smallPdf(), fileName: "taranmis.pdf", pageCount: 5, pdfHash: "c".repeat(64),
    });
    if (outcome.ok) assert.fail("yetersiz metin başarı sayılmamalıydı");
    assert.equal(outcome.transient, true);
    assert.match(outcome.detail, /yeterli metin çıkarılamadı/);
    assert.equal(outcome.apiCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route sırası: extractPdfStructure aynı tamponu koparmaz, OCR yedeği çalışır kalır", async () => {
  /*
   * Gerçek analiz ucu sırası: pdfBytes önce extractPdfStructure'a girer;
   * metin katmanı yetersiz çıkarsa AYNI tampon OCR yedeğine verilir.
   * pdf.js tamponu worker'a transfer edip KOPARIRDI (byteLength 0) ve OCR
   * yolu "Cannot perform Construct on a detached ArrayBuffer" ile çökerdi;
   * extractPdfStructure artık pdf.js'e kopya verir (bkz. pdf-structure.ts).
   */
  const nodeBuffer = readFileSync("public/ornek-degerlendirme-kilavuzu.pdf");
  const pdfBytes = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength) as ArrayBuffer;
  const originalLength = pdfBytes.byteLength;
  assert.ok(originalLength > 0);

  await extractPdfStructure(pdfBytes).catch(() => undefined);
  assert.equal(pdfBytes.byteLength, originalLength, "extractPdfStructure çağıranın tamponunu koparmamalıdır");

  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return geminiResponse(JSON.stringify({ pages: cannedPages }));
    };
    const outcome = await extractPdfStructureViaOcr({
      apiKey: "test", pdfBytes, fileName: "taranmis.pdf", pageCount: 2, pdfHash: "f".repeat(64),
    });
    assert.ok(outcome.ok, "aynı tamponla OCR yedeği başarıyla koşmalıdır");
    assert.equal(calls, 1, "OCR isteği gerçekten gönderilmelidir (tampon kopmuş olsaydı hiç ulaşmazdı)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OCR tek generateContent isteği gönderir ve sayfa tavanını aşan belgeyi reddeder", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return geminiResponse(JSON.stringify({ pages: cannedPages }));
    };
    const success = await extractPdfStructureViaOcr({
      apiKey: "test", pdfBytes: smallPdf(), fileName: "taranmis.pdf", pageCount: 2, pdfHash: "d".repeat(64),
    });
    assert.ok(success.ok, "başarılı aktarım bekleniyordu");
    assert.equal(calls, 1, "tam olarak BİR üretim isteği gönderilmelidir");

    calls = 0;
    const capped = await extractPdfStructureViaOcr({
      apiKey: "test", pdfBytes: smallPdf(), fileName: "taranmis.pdf", pageCount: 10_000, pdfHash: "e".repeat(64),
    });
    if (capped.ok) assert.fail("sayfa tavanı aşımı reddedilmeliydi");
    assert.equal(calls, 0, "tavan aşımında hiç istek gönderilmemelidir");
    assert.equal(capped.apiCalls, 0);
    assert.match(capped.detail, /en fazla/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
