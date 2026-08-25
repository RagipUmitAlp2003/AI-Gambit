"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { roleLabel } from "../lib/admin-roles";
import { fold } from "../lib/competitions";
import { workflowApi } from "../lib/workflow-client";
import {
  APPLICATION_STATUS_LABELS,
  COMPETITION_STATUS_LABELS,
  PROFILE_STATUS_LABELS,
  type CompetitionApplication,
  type CompetitionProfile,
  type CompetitionStatus,
  type CompetitionWorkflow,
  type JudgeWorkload,
  type OperationsSummary,
  type TimelineEntry,
} from "../lib/workflow-types";

/**
 * Aşama E · Değerlendirme Yöneticisi panosu (Rol 04).
 *
 * Bu rol akışta belgeyi sırayla teslim alan kişi değildir; süreci üstten izler.
 * Kriter, puan veya nihai karar değiştirilemez; operasyonel tıkanıklıklar,
 * atama, hatırlatma, hata kuyruğu ve sonuç yayın aşaması yönetilebilir.
 * Yarışmacı PDF'i ve kanıt metinleri bu role hiç gönderilmez (bkz. workflow-db
 * içindeki `redactEvaluation`).
 */
export default function OperationsPanel({ canInitialAssign = false }: { canInitialAssign?: boolean }) {
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const [profiles, setProfiles] = useState<CompetitionProfile[]>([]);
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [recent, setRecent] = useState<TimelineEntry[]>([]);
  const [judges, setJudges] = useState<JudgeWorkload[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionWorkflow[]>([]);
  const [judgeChoice, setJudgeChoice] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    return Promise.all([workflowApi.applications(), workflowApi.profiles(), workflowApi.operations()])
      .then(([applicationResult, profileResult, operationsResult]) => {
        setApplications(applicationResult.applications);
        setProfiles(profileResult.profiles);
        setSummary(operationsResult.summary);
        setRecent(operationsResult.recent);
        setJudges(operationsResult.judges);
        setCompetitions(operationsResult.competitions);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Süreç bilgileri yüklenemedi."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // İlk yükleme dışında kullanıcı eylemleri `load` ile yeniler.
  }, []);

  async function applicationAction(application: CompetitionApplication, action: string) {
    const judgeId = judgeChoice[application.id] || application.assignedJudgeId || "";
    if (action === "assign_judge" && !judgeId) { setError("Önce bir Hakem seçin."); return; }
    setBusyId(application.id);
    setError("");
    setNotice("");
    try {
      await workflowApi.updateApplication(application.id, action, {
        judgeId,
        note: action === "assign_judge" ? "Operasyon panosundan hakem ataması" : "Operasyon panosu işlemi",
      });
      setNotice(action === "assign_judge" ? "Hakem ataması güncellendi." : "Operasyon işlemi tamamlandı.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "İşlem tamamlanamadı."); }
    finally { setBusyId(""); }
  }

  async function advanceCompetition(competition: CompetitionWorkflow) {
    const next: Partial<Record<CompetitionStatus, CompetitionStatus>> = {
      open: "applications_closed",
      applications_closed: "evaluating",
      evaluating: "decisions_frozen",
      decisions_frozen: "results_published",
      results_published: "archived",
    };
    const nextStatus = next[competition.status];
    if (!nextStatus) return;
    setBusyId(competition.id);
    setError("");
    try {
      await workflowApi.changeCompetitionStage(competition.id, nextStatus, "Operasyon panosundan süreç ilerletildi");
      setNotice("Yarışma süreci güncellendi.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Yarışma süreci güncellenemedi."); }
    finally { setBusyId(""); }
  }

  const filtered = useMemo(() => {
    const search = fold(query.trim());
    if (!search) return applications;
    return applications.filter((item) => fold(`${item.teamName} ${item.competitionName}`).includes(search));
  }, [applications, query]);

  const projectStats = useMemo(() => {
    const groups = new Map<string, CompetitionApplication[]>();
    for (const application of applications) groups.set(application.competitionName, [...(groups.get(application.competitionName) ?? []), application]);
    return [...groups.entries()].map(([competitionName, items]) => ({
      competitionName,
      total: items.length,
      accepted: items.filter((item) => item.outcome === "accepted").length,
      rejected: items.filter((item) => item.outcome === "rejected").length,
      revision: items.filter((item) => item.outcome === "revision_required").length,
    })).sort((left, right) => left.competitionName.localeCompare(right.competitionName, "tr"));
  }, [applications]);

  /** Operasyonel uyarılar: müdahale gerektiren durumlar. */
  const alerts = useMemo(() => {
    const list: string[] = [];
    const failed = applications.filter((item) => item.status === "analysis_failed").length;
    const stuck = applications.filter((item) => item.status === "analyzing").length;

    // Hakem onaylı profili olmayan yarışmalarda AI ön değerlendirmesi hiç başlatılamaz;
    // başvuru kuyrukta sessizce bekler. Bu, operasyonun görmesi gereken tıkanmadır.
    const approvedKeys = new Set(profiles.filter((item) => item.status === "approved").map((item) => item.competitionKey));
    const blocked = new Map<string, number>();
    for (const application of applications) {
      if (application.status !== "submitted" || approvedKeys.has(application.competitionKey)) continue;
      blocked.set(application.competitionName, (blocked.get(application.competitionName) ?? 0) + 1);
    }
    for (const [competition, count] of blocked) {
      list.push(`${competition}: yayımlanmış profil olmadığı için ${count} başvuru başlatılamıyor. Yarışma Yöneticisi kriter profilini yayımlamalı.`);
    }

    if (failed) list.push(`${failed} başvuruda AI analizi başarısız oldu; yeniden analiz kuyruğuna alınabilir.`);
    if (stuck) list.push(`${stuck} başvuru AI ön değerlendirmesinde bekliyor.`);
    return list;
  }, [applications, profiles]);

  if (loading) return <p className="page-note">Süreç görünümü yükleniyor…</p>;
  return (
    <section className="operations-workspace" aria-labelledby="operations-title">
      <header>
        <span className="role-code">Operasyon ve süreç koordinasyonu</span>
        <h1 id="operations-title">Değerlendirme süreci</h1>
        <p>Hakem yüklerini ve analiz hatalarını izleyin; atamaları, hatırlatmaları ve sonuç yayın sırasını yönetin. Teknik karar yalnızca Hakeme aittir.</p>
      </header>
      {error ? <p className="admin-error">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}

      {summary ? (
        <div className="operations-summary">
          <div><strong>{summary.total}</strong><span>toplam başvuru</span></div>
          <div><strong>{summary.aiPending}</strong><span>AI analizi bekliyor</span></div>
          <div><strong>{summary.aiProcessing}</strong><span>AI analizinde</span></div>
          <div><strong>{summary.aiCompleted}</strong><span>AI analizi tamamlandı</span></div>
          <div><strong>{summary.judgePending}</strong><span>hakem bekliyor</span></div>
          <div><strong>{summary.judgeInReview}</strong><span>hakem değerlendirmesinde</span></div>
          <div><strong>{summary.completed}</strong><span>nihai değerlendirme tamamlandı</span></div>
          <div><strong>{summary.failed}</strong><span>hatalı analiz</span></div>
          <div><strong>%{summary.completionRate}</strong><span>tamamlanma oranı</span></div>
        </div>
      ) : null}

      <section className="operations-alerts" aria-label="Operasyonel uyarılar">
        <h2>Operasyonel uyarılar</h2>
        {alerts.length ? <ul>{alerts.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="page-note">Bekleyen operasyonel uyarı yok.</p>}
      </section>

      <section className="operations-control-grid" aria-label="Yarışma ve hakem operasyonları">
        <div className="operations-stage-list">
          <div><h2>Yarışma aşamaları</h2><p>Başvuruyu kapatma, kararları dondurma ve sonuçları yayımlama sırasını buradan yönetin.</p></div>
          {competitions.map((competition) => {
            const nextLabels: Partial<Record<CompetitionStatus, string>> = {
              open: "Başvuruları kapat",
              applications_closed: "Değerlendirmeyi başlat",
              evaluating: "Kararları dondur",
              decisions_frozen: "Sonuçları yayımla",
              results_published: "Arşivle",
            };
            const action = nextLabels[competition.status];
            return (
              <article key={competition.id}>
                <div><strong>{competition.competitionName}</strong><small>{COMPETITION_STATUS_LABELS[competition.status]}</small></div>
                {action ? <button type="button" className="secondary-button" disabled={busyId === competition.id} onClick={() => advanceCompetition(competition)}>{action}</button> : null}
              </article>
            );
          })}
          {!competitions.length ? <p className="participant-empty">Yayımlanmış yarışma akışı yok.</p> : null}
        </div>
        <div className="judge-workloads">
          <div><h2>Hakem iş yükü</h2><p>Geciken veya dengesiz kuyrukları görün; mevcut atamaları gerektiğinde başka hakeme aktarın.</p></div>
          {judges.map((judge) => (
            <article key={judge.judgeId}>
              <div><strong>{judge.judgeName}</strong><small>{judge.active} aktif · {judge.completed} tamamlandı</small></div>
              <span className={judge.failed ? "has-error" : ""}>{judge.failed ? `${judge.failed} hata` : "Hata yok"}</span>
            </article>
          ))}
          {!judges.length ? <p className="participant-empty">Etkin Hakem hesabı yok.</p> : null}
        </div>
      </section>

      <section className="operations-projects">
        <div><h2>Yarışma özeti</h2><p>Her yarışmanın başvuru ve sonuç dağılımı.</p></div>
        <div>
          {projectStats.map((item) => <article key={item.competitionName}><strong>{item.competitionName}</strong><span>{item.total} başvuru</span><small>{item.accepted} kabul · {item.rejected} ret · {item.revision} düzeltme</small></article>)}
          {!projectStats.length ? <p className="participant-empty">Henüz başvuru yok.</p> : null}
        </div>
      </section>

      <label className="search-box operations-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Takım veya yarışma ara" /></label>
      <div className="operations-table" role="table" aria-label="Başvuru durumu">
        <div className="operations-table-head operations-table-head-actions" role="row"><span>Takım / yarışma</span><span>Durum / sonuç</span><span>Hakem</span><span>Operasyon</span></div>
        {filtered.map((item) => {
          const mayAssign = canInitialAssign || Boolean(item.assignedJudgeId);
          return (
            <div key={item.id} className="operations-table-row operations-table-row-actions" role="row">
              <span><strong>{item.teamName}</strong><small>{item.competitionName} · {formatDateTime(item.updatedAt)}</small></span>
              <span><em className={`application-status ${item.status}`}>{APPLICATION_STATUS_LABELS[item.status]}</em><small>{item.outcome === "accepted" ? "Kabul edildi" : item.outcome === "rejected" ? "Reddedildi" : item.outcome === "revision_required" ? "Düzeltme istendi" : "Nihai karar bekliyor"}</small></span>
              <span>
                <select
                  aria-label={`${item.teamName} için hakem`}
                  value={judgeChoice[item.id] ?? item.assignedJudgeId ?? ""}
                  disabled={!mayAssign || busyId === item.id}
                  onChange={(event) => setJudgeChoice((current) => ({ ...current, [item.id]: event.target.value }))}
                >
                  <option value="">Hakem seçin</option>
                  {judges.map((judge) => <option key={judge.judgeId} value={judge.judgeId}>{judge.judgeName} ({judge.active})</option>)}
                </select>
                <button type="button" className="text-button" disabled={!mayAssign || busyId === item.id} onClick={() => applicationAction(item, "assign_judge")}>{item.assignedJudgeId ? "Yeniden ata" : "İlk atamayı yap"}</button>
              </span>
              <span className="operation-actions">
                {item.assignedJudgeId ? <button type="button" className="text-button" disabled={busyId === item.id} onClick={() => applicationAction(item, "remind_judge")}>Hatırlat</button> : null}
                {item.status === "analysis_failed" ? <button type="button" className="text-button" disabled={busyId === item.id} onClick={() => applicationAction(item, "requeue_analysis")}>Analizi yeniden başlat</button> : null}
                {item.status === "analysis_failed" ? <button type="button" className="text-button" disabled={busyId === item.id} onClick={() => applicationAction(item, "request_document")}>Yeni PDF iste</button> : null}
                {!item.assignedJudgeId && !canInitialAssign ? <small>İlk atamayı Admin yapar.</small> : null}
              </span>
            </div>
          );
        })}
        {!filtered.length ? <p className="participant-empty">Aramanızla eşleşen başvuru bulunamadı.</p> : null}
      </div>

      <section className="operations-timeline" aria-label="Son süreç hareketleri">
        <div><h2>Son süreç hareketleri</h2><p>Rollerin gerçekleştirdiği son işlemler; sıralı belge devri değil, olay kaydıdır.</p></div>
        <ol className="timeline-list">
          {recent.map((entry) => (
            <li key={entry.id}>
              <span className="timeline-time">{formatDateTime(entry.createdAt)}</span>
              <div>
                <strong>{entry.label}</strong>
                <small>{entry.actorName} · {roleLabel(entry.actorRole)}</small>
                {entry.detail ? <p>{entry.detail}</p> : null}
              </div>
            </li>
          ))}
          {!recent.length ? <li className="page-note">Henüz süreç hareketi kaydedilmedi.</li> : null}
        </ol>
      </section>

      <section className="published-profile-list">
        <div><h2>Değerlendirme profilleri</h2><p>Yarışma Yöneticisi tarafından yayımlanan yürürlükteki kriter profilleri.</p></div>
        {profiles.map((item) => (
          <details key={item.id}>
            <summary>
              <div><strong>{item.competitionName}</strong><span>{item.sourceDocumentName} · {item.profile.criteria.length} kriter · {PROFILE_STATUS_LABELS[item.status]}</span></div>
              <small>{formatDateTime(item.updatedAt)}</small>
            </summary>
            <ul>{item.profile.criteria.map((criterion) => <li key={criterion.id}><strong>{criterion.name}</strong><span>{criterion.active ? "Etkin" : "Pasif"}</span></li>)}</ul>
          </details>
        ))}
        {!profiles.length ? <p className="participant-empty">Yürürlükte profil yok.</p> : null}
      </section>
    </section>
  );
}
