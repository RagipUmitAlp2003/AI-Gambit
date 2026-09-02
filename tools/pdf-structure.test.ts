import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { extractPdfStructure } from "../app/lib/pdf-structure.ts";

test("gerçek şartname aynı sürümde kararlı kaynak kimlikleri ve özgün metin üretir", async (context) => {
  const directory = path.resolve("corpus");
  const files = (await readdir(directory).catch(() => []))
    .filter((name) => name.toLocaleLowerCase("tr-TR").endsWith(".pdf"))
    .sort();
  if (!files.length) {
    context.skip("corpus altında doğrulama PDF'i yok");
    return;
  }
  const file = await readFile(path.join(directory, files[0]));
  const bytes = () => Uint8Array.from(file).buffer;
  const first = await extractPdfStructure(bytes());
  const second = await extractPdfStructure(bytes());
  assert.ok(first.pageCount > 0);
  assert.ok(first.blocks.length > 0);
  assert.deepEqual(first.blocks.map((block) => block.sourceId), second.blocks.map((block) => block.sourceId));
  assert.equal(new Set(first.blocks.map((block) => block.sourceId)).size, first.blocks.length);
  assert.ok(first.blocks.every((block) => block.originalText && block.normalizedText && block.pdfHash === first.pdfHash));
  assert.ok(first.blocks.every((block) => block.pageNumber >= 1 && block.pageNumber <= first.pageCount));
});
