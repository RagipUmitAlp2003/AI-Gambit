import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

function workflowDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("migrations/0002_competition_workflow.sql", "utf8"));
  database.exec(readFileSync("migrations/0003_application_teams_and_history.sql", "utf8"));
  return database;
}

test("iş akışı şeması takım, üye ve hakem sonucunu aynı başvuruya bağlar", () => {
  const database = workflowDatabase();
  database.prepare(`INSERT INTO competition_applications
    (id, participant_id, participant_name, participant_email, competition_key, competition_name,
     profile_id, file_key, file_name, mime_type, size_bytes, status, submitted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'application/pdf', ?, 'submitted', ?, ?)`)
    .run("app-1", "participant-1", "Ada Örnek", "ada@example.test", "roket", "Roket Yarışması", "r2/app-1.pdf", "rapor.pdf", 1024, "2026-08-25", "2026-08-25");
  database.prepare(`INSERT INTO application_submission_details
    (application_id, applicant_full_name, team_name) VALUES (?, ?, ?)`)
    .run("app-1", "Ada Örnek", "Takım Ufuk");
  database.prepare(`INSERT INTO application_team_members
    (id, application_id, member_order, full_name) VALUES (?, ?, ?, ?)`)
    .run("member-1", "app-1", 0, "Deniz Örnek");
  database.prepare(`UPDATE application_submission_details
    SET outcome = 'accepted', outcome_note = 'Kabul edildi.', decided_at = ? WHERE application_id = ?`)
    .run("2026-08-26", "app-1");

  const row = database.prepare(`SELECT d.team_name, d.outcome, d.outcome_note, COUNT(m.id) AS member_count
    FROM competition_applications a
    JOIN application_submission_details d ON d.application_id = a.id
    LEFT JOIN application_team_members m ON m.application_id = a.id
    WHERE a.id = ? GROUP BY a.id`).get("app-1") as Record<string, unknown>;
  assert.deepEqual({ ...row }, { team_name: "Takım Ufuk", outcome: "accepted", outcome_note: "Kabul edildi.", member_count: 1 });
  database.close();
});

test("kriter ayıklama geçmişi onaylanan profile bağlanabilir", () => {
  const database = workflowDatabase();
  database.prepare(`INSERT INTO criteria_extraction_runs
    (id, source_document_name, competition_name, criteria_count, status, created_by, created_by_name, analyzed_at, updated_at)
    VALUES (?, ?, ?, ?, 'analyzed', ?, ?, ?, ?)`)
    .run("run-1", "kriter.pdf", "Roket Yarışması", 24, "manager-1", "Yönetici Örnek", "2026-08-25", "2026-08-25");
  database.prepare(`UPDATE criteria_extraction_runs SET status = 'approved', profile_id = ? WHERE id = ?`)
    .run("profile-1", "run-1");

  const row = database.prepare(`SELECT status, profile_id FROM criteria_extraction_runs WHERE id = ?`).get("run-1");
  assert.deepEqual({ ...(row as Record<string, unknown>) }, { status: "approved", profile_id: "profile-1" });
  database.close();
});
