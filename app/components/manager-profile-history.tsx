"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { fold } from "../lib/competitions";
import { workflowApi } from "../lib/workflow-client";
import type { CriteriaExtractionRun, PublishedProfile } from "../lib/workflow-types";

export default function ManagerProfileHistory({ mode }: { mode: "extractions" | "approved" }) {
  const [profiles, setProfiles] = useState<PublishedProfile[]>([]);
  const [extractions, setExtractions] = useState<CriteriaExtractionRun[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const request = mode === "approved" ? workflowApi.profiles() : workflowApi.extractions();
    request
      .then((result) => {
        if ("profiles" in result) setProfiles(result.profiles);
        else setExtractions(result.extractions);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Geçmiş işlemler yüklenemedi."))
      .finally(() => setLoading(false));
  }, [mode]);

  const filteredProfiles = useMemo(() => {
    const search = fold(query.trim());
    return search ? profiles.filter((item) => fold(`${item.competitionName} ${item.sourceDocumentName} ${item.category} ${item.stage}`).includes(search)) : profiles;
  }, [profiles, query]);
  const filteredExtractions = useMemo(() => {
    const search = fold(query.trim());
    return search ? extractions.filter((item) => fold(`${item.competitionName} ${item.sourceDocumentName} ${item.createdByName}`).includes(search)) : extractions;
  }, [extractions, query]);

  if (loading) return <p className="page-note">Kayıtlar yükleniyor…</p>;
  return (
    <section className="history-workspace" aria-labelledby="history-title">
      <header>
        <span className="role-code">{mode === "approved" ? "Kesinleşen profiller" : "Analiz kayıtları"}</span>
        <h1 id="history-title">{mode === "approved" ? "Onayladığı projeler" : "Geçmiş ayıklama işlemleri"}</h1>
        <p>{mode === "approved" ? "Kriterleri kesinleştirilip hakem değerlendirmesine açılan yarışmaları topluca görün." : "Başarıyla analiz edilen resmî kriter PDF'lerini ve onay durumlarını görün."}</p>
      </header>
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      <label className="search-box history-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Yarışma veya kaynak PDF ara" /></label>
      {mode === "approved" ? (
        <div className="history-list">
          {filteredProfiles.map((item) => (
            <details key={item.id}>
              <summary><div><strong>{item.competitionName}</strong><span>{item.category} · {item.stage} · {item.reportType}</span></div><div><em>{item.profile.criteria.filter((criterion) => criterion.active).length} aktif kriter</em><small>{formatDateTime(item.updatedAt)}</small></div></summary>
              <div className="history-detail"><p><strong>Kaynak PDF:</strong> {item.sourceDocumentName}</p><ul>{item.profile.criteria.map((criterion) => <li key={criterion.id}><span>{criterion.active ? "Etkin" : "Pasif"}</span><strong>{criterion.name}</strong><small>{criterion.sourcePage ? `Kaynak s. ${criterion.sourcePage}` : "Kaynak sayfası belirtilmemiş"}</small></li>)}</ul></div>
            </details>
          ))}
          {!filteredProfiles.length ? <div className="participant-empty"><strong>Onaylanmış proje bulunamadı</strong><p>Kriter Atölyesi&apos;nde profil kesinleştirildiğinde burada görünecek.</p></div> : null}
        </div>
      ) : (
        <div className="history-list extraction-history-list">
          {filteredExtractions.map((item) => <article key={item.id}><div><span className={`history-status ${item.status}`}>{item.status === "approved" ? "Onaylandı" : "İnceleniyor"}</span><strong>{item.competitionName || "Yarışma adı PDF'de bulunamadı"}</strong><p>{item.sourceDocumentName}</p></div><div><em>{item.criteriaCount} kriter</em><small>{formatDateTime(item.analyzedAt)}</small></div></article>)}
          {!filteredExtractions.length ? <div className="participant-empty"><strong>Ayıklama geçmişi bulunamadı</strong><p>İlk kriter PDF&apos;i analiz edildiğinde kayıt burada oluşacak.</p></div> : null}
        </div>
      )}
    </section>
  );
}
