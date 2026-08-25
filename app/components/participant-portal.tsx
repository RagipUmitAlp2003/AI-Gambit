"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CompetitionSelect from "./competition-select";
import FileBadge from "./file-badge";
import { COMPETITIONS } from "../lib/competitions";
import type { AdminAccount } from "../lib/admin-types";
import { formatDateTime } from "../lib/admin-client";
import { workflowApi } from "../lib/workflow-client";
import { APPLICATION_STATUS_LABELS, type CompetitionApplication } from "../lib/workflow-types";

type ParticipantView = "competitions" | "applications";

/**
 * Yarışmacı (Rol 03) portalı.
 *
 * Yapabileceği tek işlem: yarışmayı seçmek, raporunu yüklemek, başvurmak ve
 * kendi başvurusunun durumunu izlemek. Kriter, şartname, AI ön değerlendirmesi
 * ve hakem kararı bu ekrandan değiştirilemez; başka yarışmacının başvurusu
 * sunucu tarafında da bu hesaba hiç gönderilmez.
 */

const OUTCOME_LABELS: Record<CompetitionApplication["outcome"], string> = {
  pending: "Sonuç henüz açıklanmadı",
  accepted: "ONAY — hakem inceledi ve onayladı",
  rejected: "RED — hakem inceledi ve reddetti",
  revision_required: "Hakem inceledi; hatalar düzeltilmeli",
};

export default function ParticipantPortal({ account, onSignOut }: { account: AdminAccount; onSignOut: () => void | Promise<void> }) {
  const [view, setView] = useState<ParticipantView>("competitions");
  const [competition, setCompetition] = useState("");
  const [applicantFullName, setApplicantFullName] = useState(account.fullName);
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState<string[]>([""]);
  const [file, setFile] = useState<File | null>(null);
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const [busy, setBusy] = useState(false);
  const [revisionFiles, setRevisionFiles] = useState<Record<string, File | null>>({});
  const [uploadingRevisionId, setUploadingRevisionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedCompetition = useMemo(() => COMPETITIONS.find((item) => item.name === competition) ?? null, [competition]);

  useEffect(() => {
    let active = true;
    workflowApi.applications()
      .then((result) => { if (active) { setApplications(result.applications); setError(""); } })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Başvurular yüklenemedi."); });
    return () => { active = false; };
  }, []);

  async function submit() {
    const members = teamMembers.map((item) => item.trim()).filter(Boolean);
    if (!selectedCompetition || !file || !applicantFullName.trim() || !teamName.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await workflowApi.submitApplication({
        competitionName: selectedCompetition.name,
        applicantFullName: applicantFullName.trim(),
        teamName: teamName.trim(),
        teamMembers: members,
        file,
      });
      setApplications((current) => [result.application, ...current]);
      setCompetition("");
      setTeamName("");
      setTeamMembers([""]);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setNotice("Başvurunuz alındı. AI ön değerlendirmesi hakem tarafından başlatılır; nihai kararı hakem verir.");
      setView("applications");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Başvuru gönderilemedi.");
    } finally { setBusy(false); }
  }

  async function submitRevision(application: CompetitionApplication) {
    const revisionFile = revisionFiles[application.id];
    if (!revisionFile || uploadingRevisionId) return;
    setUploadingRevisionId(application.id);
    setError("");
    setNotice("");
    try {
      const result = await workflowApi.submitRevision(application.id, revisionFile);
      setApplications((current) => current.map((item) => item.id === application.id ? result.application : item));
      setRevisionFiles((current) => ({ ...current, [application.id]: null }));
      setNotice(`Yeni rapor sürümü alındı. Sürüm ${result.application.currentVersionNumber} değerlendirme akışına gönderildi.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Yeni rapor sürümü gönderilemedi.");
    } finally { setUploadingRevisionId(""); }
  }

  return (
    <main className="participant-shell">
      <header className="participant-topbar">
        <div className="management-brand"><span>T3</span><div><strong>Yarışmacı Portalı</strong><small>Başvuru ve sonuç takibi</small></div></div>
        <div className="participant-account"><span>{account.fullName}</span><button type="button" className="text-button" onClick={onSignOut}>Çıkış yap</button></div>
      </header>
      <nav className="participant-tabs" aria-label="Yarışmacı bölümleri">
        <button type="button" className={view === "competitions" ? "active" : ""} onClick={() => setView("competitions")}>Yarışmalar</button>
        <button type="button" className={view === "applications" ? "active" : ""} onClick={() => setView("applications")}>Başvurularım <span>{applications.length}</span></button>
      </nav>

      {error ? <p className="admin-error participant-feedback" role="alert">{error}</p> : null}
      {notice ? <p className="success-note participant-feedback" role="status">{notice}</p> : null}

      {view === "competitions" ? (
        <section className="participant-workspace" aria-labelledby="competition-apply-title">
          <header><span className="section-kicker">Yeni başvuru</span><h1 id="competition-apply-title">Yarışmanı seç, raporunu gönder</h1><p>PDF yalnızca başvuru havuzuna alınır. AI ön değerlendirmesini hakem başlatır, nihai kararı yine hakem verir.</p></header>
          <div className="participant-apply-form">
            <div className="participant-identity-grid">
              <label className="field"><span className="field-label">Başvuru sahibi adı soyadı</span><input value={applicantFullName} maxLength={120} onChange={(event) => setApplicantFullName(event.target.value)} autoComplete="name" /></label>
              <label className="field"><span className="field-label">Takım adı</span><input value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} placeholder="Takımınızın adı" /></label>
            </div>
            <fieldset className="participant-members">
              <legend>Ekip üyeleri</legend>
              <p>Başvuru sahibi dışındaki üyeleri ekleyin. Bireysel başvuruda boş bırakabilirsiniz.</p>
              {teamMembers.map((member, index) => (
                <div key={`member-${index}`}>
                  <label><span>{index + 1}. ekip üyesi adı soyadı</span><input value={member} maxLength={120} onChange={(event) => setTeamMembers((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>
                  {teamMembers.length > 1 || member ? <button type="button" className="text-button" onClick={() => setTeamMembers((current) => current.length === 1 ? [""] : current.filter((_, itemIndex) => itemIndex !== index))}>Kaldır</button> : null}
                </div>
              ))}
              <button type="button" className="secondary-button" disabled={teamMembers.length >= 30} onClick={() => setTeamMembers((current) => [...current, ""])}>Ekip üyesi ekle</button>
            </fieldset>
            <label className="field"><span className="field-label">Yarışma ara</span><CompetitionSelect value={competition} onChange={setCompetition} onPick={setCompetition} /><span className="field-hint">Kayıtlı yarışma adlarında Türkçe karakter kullanmadan da arama yapabilirsiniz.</span></label>
            {selectedCompetition ? <div className="chosen-competition"><span>{selectedCompetition.field}</span><strong>{selectedCompetition.name}</strong></div> : null}
            <label className="participant-file-field">
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <span>{file ? <FileBadge fileName={file.name} mimeType={file.type} size="sm" /> : "PDF seç"}</span>
              <strong>{file?.name ?? "Başvuru raporunu yükleyin"}</strong>
              <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "PDF · sistem kapasitesi en fazla 50 MB"}</small>
            </label>
            <button type="button" className="primary-button participant-submit" disabled={!selectedCompetition || !file || !applicantFullName.trim() || !teamName.trim() || busy} onClick={submit}>{busy ? "Başvuru gönderiliyor…" : "Başvuruyu gönder"}</button>
          </div>
        </section>
      ) : (
        <section className="participant-workspace" aria-labelledby="my-applications-title">
          <header><span className="section-kicker">İşlemlerim</span><h1 id="my-applications-title">Başvurularım</h1><p>Gönderdiğiniz PDF&apos;leri, başvuru durumunu ve hakem onaylı geri bildirimi burada izleyin.</p></header>
          <div className="participant-application-list">
            {applications.map((application) => (
              <article key={application.id}>
                <div className="application-line"><div><span>{APPLICATION_STATUS_LABELS[application.status]}</span><h2>{application.competitionName}</h2><p>{application.teamName} · {application.fileName ?? "Başvuru PDF'i"} · {formatDateTime(application.submittedAt)}</p>{application.status === "completed" ? <strong className={`application-outcome ${application.outcome}`}>{OUTCOME_LABELS[application.outcome]}</strong> : null}</div><a href={`/api/applications/${application.id}/file`} target="_blank" rel="noreferrer" className="secondary-button">PDF&apos;i aç</a></div>
                {application.status === "completed" && application.outcomeNote ? <p className="participant-outcome-note">{application.outcomeNote}</p> : null}
                {application.status === "completed" && application.review?.feedbackApproved ? (
                  <div className="participant-result">
                    <section><strong>Karşılanan kriterler</strong><ul>{application.review.finalFeedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <section><strong>Hatalı kriterler ve sebepleri</strong><ul>{application.review.finalFeedback.improvements.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <section><strong>Revizyon önerileri</strong><ul>{application.review.finalFeedback.suggestions.map((item) => <li key={item}>{item}</li>)}</ul></section>
                  </div>
                ) : <p className="application-wait-note">Sonuç, hakem nihai değerlendirmeyi tamamlayıp geri bildirimi onayladığında burada açılır. AI ön değerlendirmesi tek başına sonuç değildir.</p>}
                {(application.status === "document_reupload_requested" || (application.status === "completed" && application.outcome === "revision_required")) ? (
                  <div className="participant-revision-box">
                    <div><strong>Yeni rapor sürümü gerekli</strong><p>Eski dosyanız korunur. Düzeltilmiş PDF yeni sürüm olarak aynı başvuruya eklenir.</p></div>
                    <label className="secondary-button">
                      <input type="file" accept="application/pdf,.pdf" onChange={(event) => setRevisionFiles((current) => ({ ...current, [application.id]: event.target.files?.[0] ?? null }))} />
                      {revisionFiles[application.id]?.name ?? "Yeni PDF seç"}
                    </label>
                    <button type="button" className="primary-button" disabled={!revisionFiles[application.id] || uploadingRevisionId === application.id} onClick={() => submitRevision(application)}>
                      {uploadingRevisionId === application.id ? "Yükleniyor…" : "Yeni sürümü gönder"}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!applications.length ? <div className="participant-empty"><strong>Henüz başvurunuz yok</strong><p>Yarışmalar sekmesinden ilk başvurunuzu oluşturabilirsiniz.</p></div> : null}
          </div>
        </section>
      )}
    </main>
  );
}
