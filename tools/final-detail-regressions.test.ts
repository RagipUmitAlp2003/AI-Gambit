import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { competitionReadOnly, type CompetitionWorkflow } from "../app/lib/workflow-types.ts";

const base = {
  id: "c1", competitionKey: "k", competitionName: "Yarışma", status: "evaluating",
  currentProfileId: "p", decisionsLocked: false, resultsPublishedAt: null,
  isPriority: false, priorityNote: "", prioritySetAt: null, isActive: true,
  activationNote: "", activationChangedAt: null, activationChangedByName: null,
  archivedAt: null, archivedByName: null, archivedReason: "", createdAt: "", updatedAt: "",
} satisfies CompetitionWorkflow;

test("pasif yarışma hakemin geçmiş değerlendirmesini tek başına kilitlemez", () => {
  assert.equal(competitionReadOnly({ ...base, isActive: false }), false);
});

test("dondurulmuş, sonuçlanmış, arşivli ve doğrulanamayan yarışma salt okunurdur", () => {
  assert.equal(competitionReadOnly({ ...base, decisionsLocked: true }), true);
  assert.equal(competitionReadOnly({ ...base, status: "results_published" }), true);
  assert.equal(competitionReadOnly({ ...base, archivedAt: "2026-09-04" }), true);
  assert.equal(competitionReadOnly(null), true);
});

test("uzun geçerli hakem gerekçesi API geri bildirim sınırında reddedilmez", () => {
  const route = readFileSync("app/api/applications/[id]/route.ts", "utf8");
  assert.match(route, /item\.length > 6_000/);
});

test("otomatik benzerlik ve toplu hazırlık iki ayrı uçtur", () => {
  const prep=readFileSync("app/api/applications/[id]/similarity/route.ts","utf8");
  const bulk=readFileSync("app/lib/similarity-bulk.ts","utf8");
  assert.match(prep,/prepareApprovedSimilarity/);
  assert.doesNotMatch(prep,/saveSimilarityResult/);
  assert.doesNotMatch(prep,/GEMINI_API_KEY|explainSimilarityPairs|embedTexts\(/);
  assert.match(bulk,/explainSimilarityPairs/);
  assert.doesNotMatch(bulk,/embedTexts\(/);
  assert.match(bulk,/candidatePairs/);
  const database=readFileSync("app/lib/workflow-db.ts","utf8");
  assert.match(database,/a\.status = 'completed' AND d\.outcome = 'accepted'/);
});
