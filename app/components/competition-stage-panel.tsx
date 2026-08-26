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
  /** Arşivleme gerekçesi; gerekçesiz arşivleme sunucu tarafından reddedilir. */
  const [archiveReason, setArchiveReason] = useState<Record<string, string>>({});
  const [archiveOpen, setArchiveOpen] = useState("");

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

  /**
   * AKTİF / PASİF (madde 6).
   *
   * Pasif yarışma yarışmacının listesinde görünmez ve yeni başvuru kabul
   * etmez; hakem geçmiş başvuruları görmeye ve izin verilen karar
   * düzeltmelerini yapmaya devam eder. Süreç aşaması değişmez.
   */
  async function toggleActive(competition: CompetitionWorkflow) {
    setBusyId(competition.id);
    setError("");
    setNotice("");
    try {
      const next = !competition.isActive;
      await workflowApi.setCompetitionActive(competition.id, next);
      setNotice(next
        ? `“${competition.competitionName}” AKTİF edildi; yarışmacı listesinde görünür ve yeni başvuru kabul eder.`
        : `“${competition.competitionName}” PASİF edildi; yeni başvuru alınmaz, geçmiş başvurular hakem panelinde kalır.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Yarışma durumu güncellenemedi.");
    } finally { setBusyId(""); }
  }

  /** Arşivleme = soft delete (madde 11). Kayıt silinmez; gerekçe denetim izine yazılır. */
  async function archive(competition: CompetitionWorkflow) {
    const reason = (archiveReason[competition.id] ?? "").trim();
    if (!reason) { setError("Arşivleme gerekçesi zorunludur."); return; }
    setBusyId(competition.id);
    setError("");
    setNotice("");
    try {
      await workflowApi.archiveCompetition(competition.id, true, reason);
      setNotice(`“${competition.competitionName}” arşivlendi. Kayıt silinmedi; işlem Değerlendirme Yöneticisi panosunda görünür.`);
      setArchiveOpen("");
      setArchiveReason((current) => ({ ...current, [competition.id]: "" }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Yarışma arşivlenemedi.");
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
          Başvurunun açık olup olmadığına siz karar verirsiniz. Pasif ya da başvuruya kapalı bir
          yarışma, yarışmacı portalında seçim listesinde görünmez ve yeni başvuru alınmaz.
          Eski yarışmaları arşivleyebilirsiniz; arşivleme kaydı silmez, yalnızca listelerden
          çıkarır ve işlem denetim izine yazılır.
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
                  <span className={`status-chip ${competition.isActive && !competition.archivedAt ? "success" : "danger"}`}>
                    {competition.archivedAt ? "ARŞİVLENDİ" : competition.isActive ? "AKTİF" : "PASİF"}
                  </span>
                  {" "}
                  <span className={`status-chip ${competition.status === "open" && competition.isActive ? "success" : "neutral"}`}>
                    Başvuru: {competition.status === "open" && competition.isActive && !competition.archivedAt ? "Açık" : "Kapalı"}
                  </span>
                  {" "}{COMPETITION_STATUS_LABELS[competition.status]} · {formatDateTime(competition.updatedAt)}
                </small>
                {competition.archivedAt ? (
                  <small className="archived-reason">
                    {formatDateTime(competition.archivedAt)} · {competition.archivedByName ?? "bilinmiyor"} arşivledi
                    {competition.archivedReason ? ` · gerekçe: ${competition.archivedReason}` : ""}
                  </small>
                ) : null}
                {!competition.isActive && !competition.archivedAt ? (
                  <small className="inactive-note">
                    Pasif: yarışmacı listesinde görünmez ve yeni başvuru alınmaz. Hakem geçmiş
                    başvuruları görmeye devam eder.
                  </small>
                ) : null}
                {competition.isPriority && competition.priorityNote ? (
                  <small className="priority-reason">Değerlendirme Yöneticisi notu: {competition.priorityNote}</small>
                ) : null}
                {next ? <small>{next.hint}</small> : null}
              </div>
              <div className="stage-panel-actions">
                {/* Aktif/pasif anahtarı: süreç aşamasını değiştirmez (madde 6). */}
                {!competition.archivedAt ? (
                  <button
                    type="button"
                    className={competition.isActive ? "danger-button ghost" : "secondary-button"}
                    disabled={busyId === competition.id}
                    onClick={() => toggleActive(competition)}
                  >
                    {competition.isActive ? "Pasife al" : "Aktifleştir"}
                  </button>
                ) : null}
                {/* Arşivleme: fiziksel silme değil (madde 11). */}
                {!competition.archivedAt ? (
                  archiveOpen === competition.id ? (
                    <span className="stage-archive-form">
                      <input
                        value={archiveReason[competition.id] ?? ""}
                        maxLength={400}
                        placeholder="Arşivleme gerekçesi"
                        aria-label={`${competition.competitionName} arşivleme gerekçesi`}
                        onChange={(event) => setArchiveReason((current) => ({ ...current, [competition.id]: event.target.value }))}
                      />
                      <button type="button" className="text-button" onClick={() => setArchiveOpen("")}>Vazgeç</button>
                      <button
                        type="button"
                        className="danger-button ghost"
                        disabled={busyId === competition.id || !(archiveReason[competition.id] ?? "").trim()}
                        onClick={() => archive(competition)}
                      >
                        Arşivle
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="text-button" onClick={() => setArchiveOpen(competition.id)}>Arşivle</button>
                  )
                ) : null}
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
