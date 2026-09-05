import assert from "node:assert/strict";
import test from "node:test";
import { candidatePairs, type DocumentSummary, type ScreeningDocument } from "../app/lib/similarity-bulk-engine.ts";

function document(id: string, participantId = id, centroid = [1, 0], hash = id): ScreeningDocument {
  const summary: DocumentSummary = {
    pdfHash: `pdf-${id}`, textKey: `text-${id}`, centroid, signatures: [[1, 2, 3, 4]],
    hashes: [hash], features: [], words: 100, truncatedBlocks: 0,
  };
  return { id, participantId, summary };
}

test("küçük onaylı havuzda aynı katılımcı hariç bütün çiftler karşılaştırılır", () => {
  const plan = candidatePairs([
    document("a", "participant-1"),
    document("b", "participant-1"),
    document("c", "participant-2"),
  ]);
  assert.equal(plan.screened, false);
  assert.equal(plan.possiblePairs, 2);
  assert.deepEqual(plan.pairs, [["a", "c"], ["b", "c"]]);
});

test("büyük havuz bütün çiftleri çalıştırmadan en yakın adayları ve kesin metin eşini korur", () => {
  const documents = Array.from({ length: 13 }, (_, index) =>
    document(`d${String(index).padStart(2, "0")}`, undefined, [1, index / 100], `hash-${index}`));
  documents[0].summary.hashes = ["exact-copy"];
  documents[12].summary.hashes = ["exact-copy"];
  const plan = candidatePairs(documents, 2);
  assert.equal(plan.screened, true);
  assert.equal(plan.possiblePairs, 78);
  assert.ok(plan.pairs.length < plan.possiblePairs);
  assert.ok(plan.pairs.some(([left, right]) => left === "d00" && right === "d12"));
});
