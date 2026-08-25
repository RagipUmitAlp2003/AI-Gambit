import assert from "node:assert/strict";
import { test } from "node:test";
import { makePageWindows } from "../app/lib/document-analysis-strategy.ts";

test("çok kısa belge tek ve eksiksiz aralıkta incelenir", () => {
  assert.deepEqual(makePageWindows(12), [{ startPage: 1, endPage: 12 }]);
});

test("25 sayfalık belge üç dengeli ve bir sayfa örtüşmeli aralığa bölünür", () => {
  assert.deepEqual(makePageWindows(25), [
    { startPage: 1, endPage: 9 },
    { startPage: 9, endPage: 17 },
    { startPage: 17, endPage: 25 },
  ]);
});

test("orta belge dört örtüşmeli aralıkta bütün sayfaları kapsar", () => {
  assert.deepEqual(makePageWindows(61), [
    { startPage: 1, endPage: 16 },
    { startPage: 16, endPage: 31 },
    { startPage: 31, endPage: 46 },
    { startPage: 46, endPage: 61 },
  ]);
});

test("çok uzun belgede çağrı sayısı dörtle sınırlanır ve son sayfa korunur", () => {
  const windows = makePageWindows(500);
  assert.equal(windows.length, 4);
  assert.equal(windows[0].startPage, 1);
  assert.equal(windows.at(-1)?.endPage, 500);
  for (let index = 1; index < windows.length; index += 1) {
    assert.equal(windows[index].startPage, windows[index - 1].endPage);
  }
});
