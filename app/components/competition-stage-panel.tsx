"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { workflowApi } from "../lib/workflow-client";
import { COMPETITION_STATUS_LABELS, type CompetitionStatus, type CompetitionWorkflow } from "../lib/workflow-types";

/**
 * Yarışma süreç kontrolü (Rol 01).
 *
 * Yarışmanın SAHİBİ kriterleri yayımlayan Yarışma Yöneticisidir: başvurunun
 * açık olup olmadığına, kararların dondurulacağına ve sonuçların ne zaman
 * yayımlanacağına o karar verir. Değerlendirme Yöneticisi (04) bu durumu
 * yalnızca izler — sunucu tarafında da öyle (bkz. authorization ·
 * `manage_competition_stage` ve /api/competitions sahiplik kontrolü).
 */

/** Her durumdan gidilebilecek bir sonraki adım ve düğme metni. */
const NEXT_STEP: Partial<Record<CompetitionStatus, { status: CompetitionStatus; label: string; hint: string }>> = {
  open: { status: "applications_closed", label: "Başvuruları kapat", hint: "Yeni başvuru alınmaz; mevcut başvurular değerlendirilmeye devam eder." },
  applications_closed: { status: "evaluating", label: "Değerlendirmeyi başlat", hint: "Yarışma değerlendirme aşamasına geçer." },
  evaluating: { status: "decisions_frozen", label: "Kararları dondur", hint: "Bütün başvurular sonuçlandıktan sonra hakem kararları kilitlenir." },
  decisions_frozen: { status: "results_published", label: "Sonuçları yayımla", hint: "Kabul sonuçları yarışmacılara açılır." },
  results_published: { status: "archived", label: "Arşivle", hint: "Yarışma kapanır ve arşive alınır." },
};

/** Kapalı bir yarışmayı yeniden başvuruya açma. */
const REOPEN: Partial<Record<CompetitionStatus, string>> = {
  applications_closed: "Başvuruları yeniden aç",
};

export default function CompetitionStagePanel() {
  const [competitions, setCompetitions] = useState<CompetitionWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function load() {
    return workflowApi.competitions()
      .then((result) => { setCompetitions(result.competitions); setError(""); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Yarışma durumları yüklenemedi."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function move(competition: CompetitionWorkflow, nextStatus: CompetitionStatus, label: string) {
    setBusyId(competition.id);
    setError("");
    setNotice("");
    try {
      await workflowApi.changeCompetitionStage(competition.id, nextStatus, `Yarışma Yöneticisi: ${label}`);
      setNotice(`“${competition.competitionName}” güncellendi: ${COMPETITION_STATUS_LABELS[nextStatus]}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Yarışma süreci güncellenemedi.");
    } finally { setBusyId(""); }
  }

  if (loading) return <p className="page-note">Yarışma durumları yükleniyor…</p>;
  if (!competitions.length) return null;

  return (
    <section className="stage-panel" aria-labelledby="stage-panel-title">
      <header>
        <span className="role-code">Başvuru durumu</span>
        <h2 id="stage-panel-title">Yarışmalarım</h2>
        <p>
          Başvurunun açık olup olmadığına siz karar verirsiniz. Kapalı bir yarışmada yarışmacı
          portalında seçim listesinde görünmez ve yeni başvuru alınmaz.
        </p>
      </header>
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}

      <div className="stage-panel-list">
        {competitions.map((competition) => {
          const next = NEXT_STEP[competition.status];
          const reopen = REOPEN[competition.status];
          return (
            <article key={competition.id}>
              <div>
                <strong>
                  {/* Değerlendirme Yöneticisi bu yarışmayı acil işaretlemiş olabilir. */}
                  {competition.isPriority ? <span className="priority-badge">🔥 ÖNCELİKLİ</span> : null}
                  {competition.competitionName}
                </strong>
                <small>
                  <span className={`status-chip ${competition.status === "open" ? "success" : "neutral"}`}>
                    Başvuru: {competition.status === "open" ? "Açık" : "Kapalı"}
                  </span>
                  {" "}{COMPETITION_STATUS_LABELS[competition.status]} · {formatDateTime(competition.updatedAt)}
                </small>
                {competition.isPriority && competition.priorityNote ? (
                  <small className="priority-reason">Değerlendirme Yöneticisi notu: {competition.priorityNote}</small>
                ) : null}
                {next ? <small>{next.hint}</small> : null}
              </div>
              <div className="stage-panel-actions">
                {reopen ? (
                  <button type="button" className="secondary-button" disabled={busyId === competition.id} onClick={() => move(competition, "open", reopen)}>
                    {reopen}
                  </button>
                ) : null}
                {next ? (
                  <button type="button" className="secondary-button" disabled={busyId === competition.id} onClick={() => move(competition, next.status, next.label)}>
                    {busyId === competition.id ? "Güncelleniyor…" : next.label}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
