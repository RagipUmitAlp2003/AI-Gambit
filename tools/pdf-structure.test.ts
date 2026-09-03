import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPageBlocks, clauseNumberOf, extractPdfStructure, type PositionedLine } from "../app/lib/pdf-structure.ts";

// Örnek satırların tamamı korpus PDF'lerinden alınmıştır (bkz. clauseNumberOf).
test("madde numarası gerçek şartname kalıplarını korur", () => {
  const kept: Array<[string, string]> = [
    ["1. TANIMLAR VE KISALTMALAR", "1"],
    ["4.1. BAŞVURU ONAY KOŞULLARI", "4.1"],
    ["1.1 Yarışma Kapsamı", "1.1"],
    ["3.2.1 Takım Oluşturma", "3.2.1"],
    ["5) Takımlar en az iki üyeden oluşmalıdır.", "5"],
    ["2 YARIŞMA TAKVİMİ", "2"],
    ["8 Ayrılma mekanizması için patlayıcılar ve kimyasallar kullanılmamalıdır.", "8"],
  ];
  for (const [input, expected] of kept) {
    assert.equal(clauseNumberOf(input), expected, `madde korunmalı: ${input}`);
  }
});

test("yıl, tarih, tutar ve sayfa numarası madde sayılmaz", () => {
  const rejected = [
    "2024 yılı için katılım şartları belirtilmiştir.",
    "2250 adet görüntü karesi verilecektir",
    "28.02.2026 Yarışma Son Başvuru Tarihi",
    "05.05.2026 Verilerin Paylaşılması",
    "250.000 TL 20.000 TL",
    "40.790343",
    "17",
    "30 Eylül-4 Ekim 2026 TEKNOFEST",
    "22 - 26 Haziran 2026 PDR Sunumları",
  ];
  for (const input of rejected) {
    assert.equal(clauseNumberOf(input), null, `madde sayılmamalı: ${input}`);
  }
});

test("tek başına sayfa numarası paragrafa karışmaz ve bölüm başlığı olmaz", () => {
  const line = (text: string, y: number): PositionedLine => ({
    text, y, x: 56, fontSize: 10, itemCount: 1, largeGaps: 0,
  });
  const blocks = buildPageBlocks(
    [line("17", 800), line("Rapor kapak sayfası içermelidir.", 780)],
    4,
    "f".repeat(64),
  );
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].clauseNumber, null);
  assert.match(blocks[0].sourceId, /BLOK-/);
  assert.ok(!blocks[1].originalText.startsWith("17"), "sayfa numarası sonraki paragrafa karışmamalı");
  assert.ok(blocks.every((block) => block.sectionTitle !== "17"), "sayfa numarası bölüm başlığı olmamalı");
});

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
