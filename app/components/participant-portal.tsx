"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CompetitionSelect from "./competition-select";
import FileBadge from "./file-badge";
import { COMPETITIONS, type CompetitionEntry } from "../lib/competitions";
import type { AdminAccount } from "../lib/admin-types";
import { formatDateTime } from "../lib/admin-client";
import { WorkflowApiError, workflowApi } from "../lib/workflow-client";
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

/**
 * Dosya boyutu okunabilir birimle gösterilir. Küçük dosyalarda "0.0 MB"
 * yazılması yükleme başarısız sanılmasına yol açıyordu; 1 MB altındaki
 * dosyalar KB, 1 MB üstündekiler iki ondalıklı MB olarak yazılır.
 */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const OUTCOME_LABELS: Record<CompetitionApplication["outcome"], string> = {
  pending: "Sonuç henüz açıklanmadı",
  accepted: "Hakem inceledi ve kabul etti",
  rejected: "Hakem inceledi ve reddetti",
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
  /** Yalnızca gönderme denemesinin hatası; düğmenin hemen altında gösterilir. */
  const [submitError, setSubmitError] = useState("");
  const [notice, setNotice] = useState("");
  /** Başvuruya açık yarışmalar; yüklenene kadar `null`. */
  const [openCompetitions, setOpenCompetitions] = useState<CompetitionEntry[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLDivElement>(null);

  // Seçilen yarışma önce BAŞVURUYA AÇIK listede aranır: yayimlanmis profilin
  // adı şartnameden gelir ve koddaki sabit havuzda bulunmayabilir.
  const selectedCompetition = useMemo(
    () => openCompetitions?.find((item) => item.name === competition)
      ?? COMPETITIONS.find((item) => item.name === competition)
      ?? null,
    [competition, openCompetitions],
  );

  useEffect(() => {
    let active = true;
    workflowApi.applications()
      .then((result) => {
        if (!active) return;
        setApplications(result.applications);
        // Alan hiç gelmediyse kısıtlama uygulanmaz (null): boş dizi "hiçbiri açık
        // değil" demektir ve tüm listeyi yanlışlıkla kapatırdı.
        setOpenCompetitions(Array.isArray(result.openCompetitions) ? result.openCompetitions : null);
        setSubmitError("");
        setError("");
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Başvurular yüklenemedi."); });
    return () => { active = false; };
  }, []);

  /**
   * Gönder düğmesi eskiden eksik alan varken sessizce devre dışı kalıyordu:
   * kullanıcı tıklıyor, hiçbir şey olmuyordu. Artık düğme her zaman tıklanabilir
   * ve eksik olan alan açıkça yazılır.
   */
  function missingRequirements(): string[] {
    const missing: string[] = [];
    if (!applicantFullName.trim()) missing.push("başvuru sahibi adı soyadı");
    if (!teamName.trim()) missing.push("takım adı");
    if (!competition.trim()) missing.push("yarışma seçimi");
    else if (!selectedCompetition) missing.push("listeden geçerli bir yarışma seçimi");
    else if (openCompetitions && !openCompetitions.some((item) => item.name === selectedCompetition.name)) {
      // Sunucu bunu zaten 409 ile reddederdi; sebebi göndermeden önce söylenir.
      missing.push(`başvuruya açık bir yarışma (“${selectedCompetition.name}” henüz başvuruya açılmadı)`);
    }
    if (!file) missing.push("başvuru PDF'i");
    return missing;
  }

  /** Hata formun dibinde de görünmeli: sayfanın tepesindeki şerit kaçıyordu. */
  function fail(message: string) {
    setNotice("");
    setError(message);
    setSubmitError(message);
    requestAnimationFrame(() => submitRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function submit() {
    if (busy) return;
    const missing = missingRequirements();
    if (missing.length) {
      fail(`Başvuru gönderilemedi. Eksik alanlar: ${missing.join(", ")}.`);
      return;
    }
    const members = teamMembers.map((item) => item.trim()).filter(Boolean);
    if (!selectedCompetition || !file) return;
    if (!file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
      fail("Başvuru belgesi PDF biçiminde olmalıdır.");
      return;
    }
    if (file.size <= 0) {
      fail("Seçilen dosya boş görünüyor. PDF'i yeniden dışa aktarıp tekrar deneyin.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      fail(`Seçilen PDF ${formatFileSize(file.size)}. Sistem en fazla 50 MB kabul eder.`);
      return;
    }
    setBusy(true);
    setError("");
    setSubmitError("");
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
      // Sunucunun gerekçesi neyse o yazılır; sessiz başarısızlık bırakılmaz.
      fail(caught instanceof WorkflowApiError
        ? `Başvuru gönderilemedi: ${caught.message}${caught.reference ? ` (Sunucu kaydı: ${caught.reference})` : ""}`
        : caught instanceof TypeError
          ? "Başvuru gönderilemedi: sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin."
          : caught instanceof Error && caught.message
            ? `Başvuru gönderilemedi: ${caught.message}`
            : "Başvuru gönderilemedi; sunucu gerekçe bildirmedi.");
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
            <label className="field">
              <span className="field-label">Yarışma ara</span>
              <CompetitionSelect
                value={competition}
                onChange={setCompetition}
                onPick={setCompetition}
                options={openCompetitions ?? undefined}
                emptyNote="Şu anda başvuruya açık yarışma yok. Yarışma Yöneticisi şartname kriterlerini yayımladığında yarışma burada görünür."
              />
              <span className="field-hint">Yalnızca başvuruya açık yarışmalar listelenir. Türkçe karakter kullanmadan da arama yapabilirsiniz.</span>
            </label>
            {openCompetitions && !openCompetitions.length ? (
              <p className="admin-error" role="status">
                Henüz başvuruya açık yarışma bulunmuyor. Bir yarışma, Yarışma Yöneticisi şartname
                kriterlerini yayımladıktan sonra başvuruya açılır.
              </p>
            ) : null}
            {selectedCompetition ? <div className="chosen-competition"><span>{selectedCompetition.field}</span><strong>{selectedCompetition.name}</strong></div> : null}
            <label className="participant-file-field">
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <span>{file ? <FileBadge fileName={file.name} mimeType={file.type} size="sm" /> : "PDF seç"}</span>
              <strong>{file?.name ?? "Başvuru raporunu yükleyin"}</strong>
              <small>{file ? formatFileSize(file.size) : "PDF · sistem kapasitesi en fazla 50 MB"}</small>
            </label>
            <div className="participant-submit-row" ref={submitRef}>
              <button type="button" className="primary-button participant-submit" disabled={busy} onClick={submit}>{busy ? "Başvuru gönderiliyor…" : "Başvuruyu gönder"}</button>
              {missingRequirements().length ? <small className="participant-submit-hint">Gönderebilmek için eksik: {missingRequirements().join(", ")}.</small> : null}
              {/* Hata sayfanın tepesinde de var; kullanıcı formun dibindeyken görmesi için burada tekrarlanır. */}
              {submitError ? <div className="inline-error participant-submit-error" role="alert"><strong>Başvuru gönderilemedi.</strong><span>{submitError.replace(/^Başvuru gönderilemedi[.:]\s*/, "")}</span></div> : null}
            </div>
          </div>
        </section>
      ) : (
        <section className="participant-workspace" aria-labelledby="my-applications-title">
          <header><span className="section-kicker">İşlemlerim</span><h1 id="my-applications-title">Başvurularım</h1><p>Gönderdiğiniz PDF&apos;leri, başvuru durumunu ve hakem onaylı geri bildirimi burada izleyin.</p></header>
          <div className="participant-application-list">
            {applications.map((application) => (
              <article key={application.id}>
                <div className="application-line"><div><span>{APPLICATION_STATUS_LABELS[application.status]}</span><h2>{application.competitionName}</h2><p>{application.teamName} · {application.fileName ?? "Başvuru PDF'i"} · {application.sizeBytes ? `${formatFileSize(application.sizeBytes)} · ` : ""}{formatDateTime(application.submittedAt)}</p>{application.status === "completed" ? <strong className={`application-outcome ${application.outcome}`}>{OUTCOME_LABELS[application.outcome]}</strong> : null}</div><a href={`/api/applications/${application.id}/file`} target="_blank" rel="noreferrer" className="secondary-button">PDF&apos;i aç</a></div>
                {application.outcome === "rejected" ? (
                  <div className="participant-rejection" role="note">
                    <strong>Başvurunuz reddedildi</strong>
                    <p>{application.outcomeNote || "Hakem ret gerekçesi kaydetmedi. Ayrıntı için yarışma sekretaryasına başvurun."}</p>
                    <small>Bu gerekçe e-posta adresinize de gönderildi.</small>
                  </div>
                ) : application.status === "completed" && application.outcomeNote ? <p className="participant-outcome-note">{application.outcomeNote}</p> : null}
                {application.status === "completed" && application.review?.feedbackApproved ? (
                  <div className="participant-result">
                    <section><strong>Güçlü yönler</strong><ul>{application.review.finalFeedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <section><strong>Gelişime açık alanlar</strong><ul>{application.review.finalFeedback.improvements.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <section><strong>Öneriler</strong><ul>{application.review.finalFeedback.suggestions.map((item) => <li key={item}>{item}</li>)}</ul></section>
                  </div>
                ) : application.outcome === "rejected" ? null : <p className="application-wait-note">Sonuç, hakem nihai değerlendirmeyi tamamlayıp geri bildirimi onayladığında burada açılır. AI ön değerlendirmesi tek başına sonuç değildir.</p>}
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
