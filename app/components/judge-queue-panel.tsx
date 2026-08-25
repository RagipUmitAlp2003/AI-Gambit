"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { workflowApi } from "../lib/workflow-client";
import { APPLICATION_STATUS_LABELS, type CompetitionApplication } from "../lib/workflow-types";

/**
 * Aşama D · hakem kuyruğu (Rol 02).
 *
 * AI ön değerlendirmesi tamamlanan başvuruları sıraya koyar. Gösterilen puan
 * AI ÖNERİSİDİR; nihai karar Değerlendirme Atölyesi'nde hakem tarafından verilir.
 */
export default function JudgeQueuePanel() {
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    workflowApi.applications()
      .then((result) => { setApplications(result.applications); setError(""); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Başvurular yüklenemedi."))
      .finally(() => setLoading(false));
  }, []);

  const queue = useMemo(
    () => applications.filter((item) => item.status === "awaiting_judge" || item.status === "judge_in_review"),
    [applications],
  );
  const counts = useMemo(() => ({
    pending: applications.filter((item) => item.status === "submitted").length,
    analyzing: applications.filter((item) => item.status === "analyzing").length,
    awaiting: applications.filter((item) => item.status === "awaiting_judge").length,
    inReview: applications.filter((item) => item.status === "judge_in_review").length,
    completed: applications.filter((item) => item.status === "completed").length,
  }), [applications]);

  if (loading) return <p className="page-note">Hakem kuyruğu yükleniyor…</p>;
  return (
    <section className="judge-queue" aria-labelledby="judge-queue-title">
      <header>
        <div>
          <span className="role-code">Aşama D · nihai değerlendirme</span>
          <h2 id="judge-queue-title">Hakem kuyruğu</h2>
          <p>AI ön değerlendirmesi tamamlanan başvurular. AI önerdiği puanı sunar; nihai kararı siz verirsiniz.</p>
        </div>
        <Link href="/degerlendirme" className="secondary-button">Değerlendirme Atölyesi</Link>
      </header>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      <div className="operations-summary">
        <div><strong>{counts.pending}</strong><span>AI ön değerlendirmesi bekliyor</span></div>
        <div><strong>{counts.analyzing}</strong><span>AI ön değerlendirmesinde</span></div>
        <div><strong>{counts.awaiting}</strong><span>hakem bekliyor</span></div>
        <div><strong>{counts.inReview}</strong><span>değerlendirmemde</span></div>
        <div><strong>{counts.completed}</strong><span>nihai karar verildi</span></div>
      </div>

      {queue.length ? (
        <div className="judge-queue-list">
          {queue.map((application) => {
            const proposed = application.evaluation?.proposedTotals;
            return (
              <article key={application.id}>
                <div>
                  <em className={`application-status ${application.status}`}>{APPLICATION_STATUS_LABELS[application.status]}</em>
                  <strong>{application.teamName}</strong>
                  <p>{application.competitionName} · {application.fileName ?? "Başvuru PDF'i"}</p>
                  <small>
                    {proposed
                      ? `AI önerilen ham puan: ${proposed.rawScore ?? "—"} / ${proposed.declaredTotal ?? "—"} · ${proposed.pendingCriteria} kriter hakem kararı bekliyor`
                      : "AI ön değerlendirmesi henüz okunmadı"}
                  </small>
                </div>
                <small>{formatDateTime(application.updatedAt)}</small>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="participant-empty"><strong>Kuyrukta bekleyen başvuru yok</strong><p>AI ön değerlendirmesi tamamlanan başvurular burada listelenir.</p></div>
      )}
    </section>
  );
}
