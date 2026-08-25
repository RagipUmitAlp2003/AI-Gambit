"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { fold } from "../lib/competitions";
import { workflowApi } from "../lib/workflow-client";
import type { CompetitionApplication, CriteriaExtractionRun, PublishedProfile } from "../lib/workflow-types";

const STATUS_LABELS: Record<CompetitionApplication["status"], string> = {
  submitted: "Analiz bekliyor", analyzing: "Analiz ediliyor", awaiting_judge: "Hakem bekliyor",
  completed: "Tamamlandı", analysis_failed: "Analiz hatası",
};

export default function OperationsPanel() {
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const [profiles, setProfiles] = useState<PublishedProfile[]>([]);
  const [extractions, setExtractions] = useState<CriteriaExtractionRun[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([workflowApi.applications(), workflowApi.profiles(), workflowApi.extractions()])
      .then(([applicationResult, profileResult, extractionResult]) => {
        setApplications(applicationResult.applications);
        setProfiles(profileResult.profiles);
        setExtractions(extractionResult.extractions);
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

  if (loading) return <p className="page-note">Süreç görünümü yükleniyor…</p>;
  return (
    <section className="operations-workspace" aria-labelledby="operations-title">
      <header><span className="role-code">Salt okunur görünüm</span><h1 id="operations-title">Değerlendirme süreci</h1><p>Başvuruları, onaylı kriter profillerini ve bekleyen işleri izleyin. Bu ekrandan puan veya karar değiştirilemez.</p></header>
      {error ? <p className="admin-error">{error}</p> : null}
      <div className="operations-summary">
        <div><strong>{applications.length}</strong><span>toplam başvuru</span></div>
        <div><strong>{applications.filter((item) => item.status === "submitted").length}</strong><span>analiz bekleyen</span></div>
        <div><strong>{applications.filter((item) => item.status === "awaiting_judge").length}</strong><span>hakem bekleyen</span></div>
        <div><strong>{applications.filter((item) => item.outcome === "accepted").length}</strong><span>kabul edilen</span></div>
        <div><strong>{applications.filter((item) => item.outcome === "rejected").length}</strong><span>reddedilen</span></div>
        <div><strong>{profiles.length}</strong><span>yayınlı profil</span></div>
      </div>
      <section className="operations-projects"><div><h2>Yarışma özeti</h2><p>Her yarışmanın başvuru ve sonuç dağılımı.</p></div><div>{projectStats.map((item) => <article key={item.competitionName}><strong>{item.competitionName}</strong><span>{item.total} başvuru</span><small>{item.accepted} kabul · {item.rejected} ret · {item.revision} düzeltme</small></article>)}{!projectStats.length ? <p className="participant-empty">Henüz başvuru yok.</p> : null}</div></section>
      <label className="search-box operations-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Takım veya yarışma ara" /></label>
      <div className="operations-table" role="table" aria-label="Başvuru durumu">
        <div className="operations-table-head" role="row"><span>Takım</span><span>Yarışma</span><span>Durum / sonuç</span><span>Güncelleme</span></div>
        {filtered.map((item) => <div key={item.id} className="operations-table-row" role="row"><span><strong>{item.teamName}</strong></span><span><strong>{item.competitionName}</strong></span><span><em className={`application-status ${item.status}`}>{STATUS_LABELS[item.status]}</em><small>{item.outcome === "accepted" ? "Kabul edildi" : item.outcome === "rejected" ? "Reddedildi" : item.outcome === "revision_required" ? "Düzeltme istendi" : "Sonuç bekliyor"}</small></span><span>{formatDateTime(item.updatedAt)}</span></div>)}
        {!filtered.length ? <p className="participant-empty">Aramanızla eşleşen başvuru bulunamadı.</p> : null}
      </div>
      <section className="published-profile-list"><div><h2>Yayınlanan kriter profilleri</h2><p>Yarışma yöneticisinin onayladığı PDF ve oluşturduğu kriterler.</p></div>{profiles.map((item) => <details key={item.id}><summary><div><strong>{item.competitionName}</strong><span>{item.sourceDocumentName} · {item.profile.criteria.length} kriter</span></div><small>{formatDateTime(item.updatedAt)}</small></summary><ul>{item.profile.criteria.map((criterion) => <li key={criterion.id}><strong>{criterion.name}</strong><span>{criterion.active ? "Etkin" : "Pasif"}</span></li>)}</ul></details>)}</section>
      <section className="published-profile-list"><div><h2>Ayıklama geçmişi</h2><p>Analiz edilen kaynak PDF&apos;ler ve onay durumları.</p></div>{extractions.map((item) => <article key={item.id}><div><strong>{item.competitionName || "Yarışma adı bulunamadı"}</strong><span>{item.sourceDocumentName} · {item.criteriaCount} kriter</span></div><small>{item.status === "approved" ? "Onaylandı" : "Analiz edildi"} · {formatDateTime(item.analyzedAt)}</small></article>)}</section>
    </section>
  );
}
