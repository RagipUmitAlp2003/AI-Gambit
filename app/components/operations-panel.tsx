"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { roleLabel } from "../lib/admin-roles";
import { fold } from "../lib/competitions";
import { workflowApi } from "../lib/workflow-client";
import {
  APPLICATION_STATUS_LABELS,
  PROFILE_STATUS_LABELS,
  type CompetitionApplication,
  type CompetitionProfile,
  type OperationsSummary,
  type TimelineEntry,
} from "../lib/workflow-types";

/**
 * Aşama E · Değerlendirme Yöneticisi panosu (Rol 03).
 *
 * Bu rol akışta belgeyi sırayla teslim alan kişi değildir; süreci üstten izler.
 * Ekran salt okunurdur: buradan kriter, puan veya nihai karar değiştirilemez.
 * Yarışmacı PDF'i ve kanıt metinleri bu role hiç gönderilmez (bkz. workflow-db
 * içindeki `redactEvaluation`).
 */
export default function OperationsPanel() {
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const [profiles, setProfiles] = useState<CompetitionProfile[]>([]);
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [recent, setRecent] = useState<TimelineEntry[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([workflowApi.applications(), workflowApi.profiles(), workflowApi.operations()])
      .then(([applicationResult, profileResult, operationsResult]) => {
        setApplications(applicationResult.applications);
        setProfiles(profileResult.profiles);
        setSummary(operationsResult.summary);
        setRecent(operationsResult.recent);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Süreç bilgileri yüklenemedi."))
      .finally(() => setLoading(false));
  }, []);

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
    const waitingProfile = profiles.filter((item) => item.status === "judge_review_pending").length;
    const rejectedProfile = profiles.filter((item) => item.status === "changes_requested").length;

    // Hakem onaylı profili olmayan yarışmalarda AI ön değerlendirmesi hiç başlatılamaz;
    // başvuru kuyrukta sessizce bekler. Bu, operasyonun görmesi gereken tıkanmadır.
    const approvedKeys = new Set(profiles.filter((item) => item.status === "approved").map((item) => item.competitionKey));
    const blocked = new Map<string, number>();
    for (const application of applications) {
      if (application.status !== "submitted" || approvedKeys.has(application.competitionKey)) continue;
      blocked.set(application.competitionName, (blocked.get(application.competitionName) ?? 0) + 1);
    }
    for (const [competition, count] of blocked) {
      list.push(`${competition}: hakem onaylı profil olmadığı için ${count} başvuru başlatılamıyor. Yarışma yöneticisi profili hazırlamalı, hakem onaylamalı.`);
    }

    if (failed) list.push(`${failed} başvuruda AI analizi başarısız oldu; hakem yeniden başlatmalı.`);
    if (stuck) list.push(`${stuck} başvuru AI ön değerlendirmesinde bekliyor.`);
    if (waitingProfile) list.push(`${waitingProfile} değerlendirme profili hakem onayını bekliyor; o yarışmalarda analiz başlatılamaz.`);
    if (rejectedProfile) list.push(`${rejectedProfile} profil düzeltme için yarışma yöneticisine geri gönderildi.`);
    return list;
  }, [applications, profiles]);

  if (loading) return <p className="page-note">Süreç görünümü yükleniyor…</p>;
  return (
    <section className="operations-workspace" aria-labelledby="operations-title">
      <header>
        <span className="role-code">Salt okunur görünüm</span>
        <h1 id="operations-title">Değerlendirme süreci</h1>
        <p>Başvuruları, AI analiz durumlarını, hakem kuyruğunu ve tamamlanma oranını izleyin. Bu ekrandan kriter, puan veya nihai karar değiştirilemez.</p>
      </header>
      {error ? <p className="admin-error">{error}</p> : null}

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

      <section className="operations-projects">
        <div><h2>Yarışma özeti</h2><p>Her yarışmanın başvuru ve sonuç dağılımı.</p></div>
        <div>
          {projectStats.map((item) => <article key={item.competitionName}><strong>{item.competitionName}</strong><span>{item.total} başvuru</span><small>{item.accepted} kabul · {item.rejected} ret · {item.revision} düzeltme</small></article>)}
          {!projectStats.length ? <p className="participant-empty">Henüz başvuru yok.</p> : null}
        </div>
      </section>

      <label className="search-box operations-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Takım veya yarışma ara" /></label>
      <div className="operations-table" role="table" aria-label="Başvuru durumu">
        <div className="operations-table-head" role="row"><span>Takım</span><span>Yarışma</span><span>Durum / sonuç</span><span>Güncelleme</span></div>
        {filtered.map((item) => <div key={item.id} className="operations-table-row" role="row"><span><strong>{item.teamName}</strong></span><span><strong>{item.competitionName}</strong></span><span><em className={`application-status ${item.status}`}>{APPLICATION_STATUS_LABELS[item.status]}</em><small>{item.outcome === "accepted" ? "Kabul edildi" : item.outcome === "rejected" ? "Reddedildi" : item.outcome === "revision_required" ? "Düzeltme istendi" : "Nihai karar bekliyor"}</small></span><span>{formatDateTime(item.updatedAt)}</span></div>)}
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
        <div><h2>Değerlendirme profilleri</h2><p>Yürürlükteki profiller ve hakem onay durumları.</p></div>
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
