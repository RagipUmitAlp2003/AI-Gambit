"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { fold } from "../lib/competitions";
import { workflowApi } from "../lib/workflow-client";
import {
  PROFILE_STATUS_LABELS,
  type CompetitionProfile,
  type CriteriaExtractionRun,
} from "../lib/workflow-types";

/**
 * Yarışma yöneticisinin (Rol 01) geçmişi.
 *   extractions  Analiz edilen şartname PDF'leri.
 *   profiles     Hazırladığı profiller ve HAKEM ONAY DURUMU.
 *
 * Profil hazırlanır hazırlanmaz yürürlüğe girmez; hakem onayı beklenir.
 */

const STATUS_CHIP: Record<CompetitionProfile["status"], string> = {
  draft: "neutral",
  judge_review_pending: "warning",
  changes_requested: "danger",
  approved: "success",
};

export default function ManagerProfileHistory({ mode, compact = false }: {
  mode: "extractions" | "profiles";
  compact?: boolean;
}) {
  const [profiles, setProfiles] = useState<CompetitionProfile[]>([]);
  const [extractions, setExtractions] = useState<CriteriaExtractionRun[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const request = mode === "profiles" ? workflowApi.profiles() : workflowApi.extractions();
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
    const list = search
      ? profiles.filter((item) => fold(`${item.competitionName} ${item.sourceDocumentName} ${item.category} ${item.stage}`).includes(search))
      : profiles;
    // Özet görünümde önce karar bekleyenler.
    return compact ? [...list].sort((left, right) => Number(right.status === "changes_requested") - Number(left.status === "changes_requested")).slice(0, 5) : list;
  }, [profiles, query, compact]);
  const filteredExtractions = useMemo(() => {
    const search = fold(query.trim());
    return search ? extractions.filter((item) => fold(`${item.competitionName} ${item.sourceDocumentName} ${item.createdByName}`).includes(search)) : extractions;
  }, [extractions, query]);

  if (loading) return <p className="page-note">Kayıtlar yükleniyor…</p>;
  return (
    <section className="history-workspace" aria-labelledby={compact ? undefined : "history-title"}>
      {compact ? (
        <header><span className="role-code">Hakem onay durumu</span><h2>Hazırladığım profiller</h2></header>
      ) : (
        <header>
          <span className="role-code">{mode === "profiles" ? "Hakem onay durumu" : "Analiz kayıtları"}</span>
          <h1 id="history-title">{mode === "profiles" ? "Hazırladığım değerlendirme profilleri" : "Geçmiş ayıklama işlemleri"}</h1>
          <p>{mode === "profiles"
            ? "Hazırladığınız profillerin hakem doğrulama durumunu izleyin. Düzeltme istenen profili Kriter Atölyesi'nde güncelleyip yeniden gönderebilirsiniz."
            : "Başarıyla analiz edilen şartname PDF'lerini ve onay durumlarını görün."}</p>
        </header>
      )}
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {!compact ? (
        <label className="search-box history-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Yarışma veya kaynak PDF ara" /></label>
      ) : null}

      {mode === "profiles" ? (
        <div className="history-list">
          {filteredProfiles.map((item) => (
            <details key={item.id}>
              <summary>
                <div>
                  <span className={`status-chip ${STATUS_CHIP[item.status]}`}>{PROFILE_STATUS_LABELS[item.status]}</span>
                  <strong>{item.competitionName}</strong>
                  <span>{item.category} · {item.stage} · {item.reportType}</span>
                </div>
                <div>
                  <em>{item.profile.criteria.filter((criterion) => criterion.active).length} etkin kriter</em>
                  <small>{formatDateTime(item.updatedAt)}</small>
                </div>
              </summary>
              <div className="history-detail">
                <p><strong>Kaynak şartname:</strong> {item.sourceDocumentName}</p>
                {item.reviewNote ? (
                  <p className={item.status === "changes_requested" ? "admin-error" : "page-note"}>
                    <strong>Hakem notu{item.reviewedByName ? ` (${item.reviewedByName})` : ""}:</strong> {item.reviewNote}
                  </p>
                ) : null}
                {item.status === "judge_review_pending" ? <p className="page-note">Hakem incelemesi bekleniyor; profil henüz değerlendirmede kullanılamaz.</p> : null}
                <ul>{item.profile.criteria.map((criterion) => <li key={criterion.id}><span>{criterion.active ? "Etkin" : "Pasif"}</span><strong>{criterion.name}</strong><small>{criterion.sourcePage ? `Kaynak s. ${criterion.sourcePage}` : "Kaynak sayfası belirtilmemiş"}</small></li>)}</ul>
              </div>
            </details>
          ))}
          {!filteredProfiles.length ? <div className="participant-empty"><strong>Profil bulunamadı</strong><p>Kriter Atölyesi&apos;nde bir profil hazırlayıp hakem incelemesine gönderdiğinizde burada görünecek.</p></div> : null}
        </div>
      ) : (
        <div className="history-list extraction-history-list">
          {filteredExtractions.map((item) => <article key={item.id}><div><span className={`history-status ${item.status}`}>{item.status === "approved" ? "Hakem onaylı" : "Analiz edildi"}</span><strong>{item.competitionName || "Yarışma adı PDF'de bulunamadı"}</strong><p>{item.sourceDocumentName}</p></div><div><em>{item.criteriaCount} kriter</em><small>{formatDateTime(item.analyzedAt)}</small></div></article>)}
          {!filteredExtractions.length ? <div className="participant-empty"><strong>Ayıklama geçmişi bulunamadı</strong><p>İlk şartname PDF&apos;i analiz edildiğinde kayıt burada oluşacak.</p></div> : null}
        </div>
      )}
    </section>
  );
}
