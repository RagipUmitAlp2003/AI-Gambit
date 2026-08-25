import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { pdfIntegrityError } from "../app/lib/pdf-integrity.ts";

function bytesOf(value: string): ArrayBuffer {
  const bytes = Buffer.from(value, "latin1");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function minimalPdf(startxref?: number): ArrayBuffer {
  const prefix = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n";
  const xrefOffset = Buffer.byteLength(prefix, "latin1");
  return bytesOf(`${prefix}xref\n0 0\ntrailer\n<<>>\nstartxref\n${startxref ?? xrefOffset}\n%%EOF\n`);
}

test("PDF bütünlüğü: geçerli startxref kabul edilir", () => {
  assert.equal(pdfIntegrityError(minimalPdf()), null);
});

test("PDF bütünlüğü: bozuk startxref Gemini çağrısından önce reddedilir", () => {
  assert.match(pdfIntegrityError(minimalPdf(1)) ?? "", /çapraz başvuru adresi geçersiz/i);
});

test("PDF bütünlüğü: tamamlanmamış dosya açık mesajla reddedilir", () => {
  assert.match(pdfIntegrityError(bytesOf("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")) ?? "", /dosya sonu/i);
});
