/** Birleştirme regresyonları: gerçek SQL, geçici bellek DB'si; API/simülasyon yok. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = readFileSync("app/lib/workflow-db.ts", "utf8");
const reviewBody = source.slice(source.indexOf("export async function saveApplicationReview"), source.indexOf("export type AttachSimilarityResult"));
const attachBody = source.slice(source.indexOf("export async function attachSimilarityToEvaluation"), source.indexOf("export type DeleteAnalysisResult"));

function sql(body: string, prefix: string): string {
  const query = [...body.matchAll(/`([^`]+)`/g)].map((match) => match[1]).find((value) => value.startsWith(prefix));
  assert.ok(query, `Üretim sorgusu bulunamadı: ${prefix}`);
  return query;
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE competitions (competition_key TEXT PRIMARY KEY, decisions_locked INTEGER);
    INSERT INTO competitions VALUES ('c1', 0);
    CREATE TABLE competition_applications (
      id TEXT PRIMARY KEY, competition_key TEXT, participant_name TEXT, status TEXT,
      review_json TEXT, evaluation_json TEXT, file_key TEXT, assigned_judge_id TEXT,
      evaluation_criteria_version INTEGER, evaluation_pdf_hash TEXT,
      judge_id TEXT, judge_name TEXT, updated_at TEXT, completed_at TEXT
    );
    INSERT INTO competition_applications VALUES
      ('a1', 'c1', 'Takım', 'judge_in_review', NULL, '{"analyzedAt":"t1"}', 'pdf1', 'j1', 1, 'hash1', NULL, NULL, NULL, NULL);
    CREATE TABLE application_submission_details (
      application_id TEXT PRIMARY KEY, applicant_full_name TEXT, team_name TEXT,
      outcome TEXT, outcome_note TEXT, decided_at TEXT
    );
  `);
  return db;
}

test("iki eşzamanlı taslak okumasından yalnızca ilki yazabilir; ikinci sonuç tablosunu da değiştiremez", () => {
  const db = database();
  try {
    const update = db.prepare(sql(reviewBody, "UPDATE competition_applications"));
    const details = db.prepare(sql(reviewBody, "INSERT INTO application_submission_details"));
    const write = (value: string) => update.run("judge_in_review", value, "j1", "Hakem", "t2", null,
      "a1", "judge_in_review", null, "pdf1", "j1", 1, "t1");
    assert.equal(write('{"draftSavedAt":"ilk"}').changes, 1);
    assert.equal(details.run("pending", "", null, "a1", "judge_in_review").changes, 1);
    assert.equal(write('{"draftSavedAt":"eski-sekme"}').changes, 0);
    assert.equal(details.run("rejected", "eski karar", "t3", "a1", "judge_in_review").changes, 0);
    assert.equal(db.prepare("SELECT review_json FROM competition_applications").get()!.review_json, '{"draftSavedAt":"ilk"}');
    assert.equal(db.prepare("SELECT outcome FROM application_submission_details").get()!.outcome, "pending");
  } finally { db.close(); }
});

test("taslak SQL'i yeni analiz, yeni PDF, yeni hakem veya yarışma kilidi üzerine yazamaz", () => {
  for (const mutation of [
    `UPDATE competition_applications SET evaluation_json = '{"analyzedAt":"t2"}'`,
    "UPDATE competition_applications SET file_key = 'pdf2'",
    "UPDATE competition_applications SET assigned_judge_id = 'j2'",
    "UPDATE competitions SET decisions_locked = 1",
  ]) {
    const db = database();
    try {
      db.exec(mutation);
      const result = db.prepare(sql(reviewBody, "UPDATE competition_applications")).run(
        "judge_in_review", "{}", "j1", "Hakem", "t2", null,
        "a1", "judge_in_review", null, "pdf1", "j1", 1, "t1");
      assert.equal(result.changes, 0, mutation);
    } finally { db.close(); }
  }
});

test("geç benzerlik yazımı yalnız aynı analizde çalışır ve hakem taslağını korur", () => {
  for (const mutation of ["", "UPDATE competitions SET decisions_locked = 1",
    "UPDATE competition_applications SET assigned_judge_id = 'j2'",
    "UPDATE competition_applications SET evaluation_pdf_hash = 'hash2'",
    `UPDATE competition_applications SET evaluation_json = '{"analyzedAt":"t2"}'`]) {
    const db = database();
    try {
      db.exec(`UPDATE competition_applications SET review_json = '{"draftSavedAt":"yeni"}'`);
      if (mutation) db.exec(mutation);
      const result = db.prepare(sql(attachBody, "UPDATE competition_applications")).run(
        '{"analyzedAt":"t1","similarityReport":{}}', "t3", "a1", '{"analyzedAt":"t1"}', "j1", "hash1");
      assert.equal(result.changes, mutation ? 0 : 1, mutation);
      assert.equal(db.prepare("SELECT review_json FROM competition_applications").get()!.review_json, '{"draftSavedAt":"yeni"}');
    } finally { db.close(); }
  }
});

test("istemci taslakları sıraya alır; nihai karar kuyruğu bekler; benzerlik yanıtı hakem durumunu ezmez", () => {
  const app = readFileSync("app/components/evaluation-app.tsx", "utf8");
  assert.match(app, /draftQueue\.current\.then\(\(\) => persistDraft\(next\)\)/);
  assert.match(app, /await draftQueue\.current/);
  assert.match(app, /draftSavedAt: draftStamp\.current/);
  const track = app.slice(app.indexOf("async function trackSimilarity("), app.indexOf("async function retrySimilarity("));
  assert.doesNotMatch(track, /replaceApplication\(attached\.application\)/);
  assert.match(track, /evaluation: \{ \.\.\.item\.evaluation, similarityReport:/);
  assert.match(reviewBody, /review\.draftScope\.analyzedAt !== draftScope\.analyzedAt/);
  assert.match(reviewBody, /storedStamp && \(review\.draftSavedAt \?\? null\) !== storedStamp/);
});
