import assert from "node:assert/strict";
import { test } from "node:test";
import { makePageWindows } from "../app/lib/document-analysis-strategy.ts";

test("kısa belge tek ve eksiksiz aralıkta incelenir", () => {
  assert.deepEqual(makePageWindows(25), [{ startPage: 1, endPage: 25 }]);
});

test("orta belge boşluk veya sayfa tekrarı olmadan bölünür", () => {
  assert.deepEqual(makePageWindows(61), [
    { startPage: 1, endPage: 31 },
    { startPage: 32, endPage: 61 },
  ]);
});

test("çok uzun belgede çağrı sayısı dörtle sınırlanır ve son sayfa korunur", () => {
  const windows = makePageWindows(500);
  assert.equal(windows.length, 4);
  assert.equal(windows[0].startPage, 1);
  assert.equal(windows.at(-1)?.endPage, 500);
  for (let index = 1; index < windows.length; index += 1) {
    assert.equal(windows[index].startPage, windows[index - 1].endPage + 1);
  }
});
