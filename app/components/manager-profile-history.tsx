"use client";

import Link from "next/link";
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
 * Kriter Geçmişi — Yarışma Yöneticisinin (Rol 01) TEK geçmiş ekranı.
 *
 * Daha önce "Geçmiş ayıklamalar" ve "Yayımlanan profiller" iki ayrı bölümdü ve
 * yayımlanmış bir profil hiçbirinden düzenlenemiyordu. Artık ikisi tek ekranda:
 *
 *   Yayımlanan profiller  Her kayıt Kriter Atölyesi'nde AÇILIP düzenlenebilir ve
 *                         yeniden yayımlanabilir (aynı profil kimliğiyle).
 *   Geçmiş ayıklamalar    Analiz edilen şartname PDF'leri ve yayın durumları.
 *
 * Profil yayımlandığı anda yürürlüğe girer; ayrı bir hakem onayı yoktur.
 */

const STATUS_CHIP: Record<CompetitionProfile["status"], string> = {
  draft: "neutral",
  judge_review_pending: "warning",
  changes_requested: "danger",
  approved: "success",
};

type Tab = "profiles" | "extractions";

export default function ManagerProfileHistory({ compact = false }: { compact?: boolean }) {
  const [tab, setTab] = useState<Tab>("profiles");
  const [profiles, setProfiles] = useState<CompetitionProfile[]>([]);
  const [extractions, setExtractions] = useState<CriteriaExtractionRun[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Özet görünümde yalnızca profiller gerekir; tam ekranda iki liste birlikte gelir.
    const requests: [Promise<{ profiles: CompetitionProfile[] }>, Promise<{ extractions: CriteriaExtractionRun[] }> | null] = [
      workflowApi.profiles(),
      compact ? null : workflowApi.extractions(),
    ];
    Promise.allSettled([requests[0], requests[1] ?? Promise.resolve({ extractions: [] })])
      .then(([profileResult, extractionResult]) => {
        if (!active) return;
        if (profileResult.status === "fulfilled") setProfiles(profileResult.value.profiles);
        if (extractionResult.status === "fulfilled") setExtractions(extractionResult.value.extractions);
        const failure = [profileResult, extractionResult].find((item) => item.status === "rejected");
        setError(failure && failure.status === "rejected"
          ? (failure.reason instanceof Error ? failure.reason.message : "Geçmiş işlemler yüklenemedi.")
          : "");
        setLoading(false);
      });
    return () => { active = false; };
  }, [compact]);

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
        <header><span className="role-code">Yayın durumu</span><h2>Hazırladığım profiller</h2></header>
      ) : (
        <header>
          <span className="role-code">Kriter geçmişi</span>
          <h1 id="history-title">Analiz ettiğim şartnameler ve yayımladığım profiller</h1>
          <p>
            Yayımladığınız dört aşamalı kriter profillerini buradan açıp Kriter Atölyesi&apos;nde
            düzenleyebilir ve yeniden yayımlayabilirsiniz. Yeniden yayımlanan profil aynı kimliği
            korur; mevcut başvurular güncel kriter setine bağlı kalır.
          </p>
        </header>
      )}
      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      {!compact ? (
        <>
          <div className="history-tabs" role="tablist" aria-label="Kriter geçmişi bölümleri">
            <button type="button" role="tab" aria-selected={tab === "profiles"} className={tab === "profiles" ? "active" : ""} onClick={() => setTab("profiles")}>
              Yayımlanan profiller <span>{profiles.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === "extractions"} className={tab === "extractions" ? "active" : ""} onClick={() => setTab("extractions")}>
              Geçmiş ayıklamalar <span>{extractions.length}</span>
            </button>
          </div>
          <label className="search-box history-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Yarışma veya kaynak PDF ara" /></label>
        </>
      ) : null}

      {compact || tab === "profiles" ? (
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
                  <em>{item.profile.criteria.length} kriter</em>
                  <small>{formatDateTime(item.updatedAt)}</small>
                </div>
              </summary>
              <div className="history-detail">
                <p><strong>Kaynak şartname:</strong> {item.sourceDocumentName}</p>
                {item.reviewNote ? (
                  <p className={item.status === "changes_requested" ? "admin-error" : "page-note"}>
                    <strong>İnceleme notu{item.reviewedByName ? ` (${item.reviewedByName})` : ""}:</strong> {item.reviewNote}
                  </p>
                ) : null}
                {item.status !== "approved" ? <p className="page-note">Bu profil yürürlükte değil; değerlendirmede kullanılmaz.</p> : null}
                {/*
                  Geçmiş profil gerçekten düzenlenebilir: Kriter Atölyesi bu kimliği
                  okuyup kriterleri yükler, yönetici düzenleyip yeniden yayımlar.
                */}
                <div className="history-actions">
                  <Link className="secondary-button" href={`/kriter-atolyesi?profile=${encodeURIComponent(item.id)}`}>
                    Kriter Atölyesi&apos;nde düzenle
                  </Link>
                  {item.profile.sourceDocument.fileKey ? (
                    <a className="secondary-button" href={workflowApi.profileFileUrl(item.id)} target="_blank" rel="noreferrer">
                      Şartnameyi aç
                    </a>
                  ) : (
                    <small className="page-note">Şartname PDF&apos;i bu profille birlikte saklanmamış; kriterleri yeniden yayımladığınızda kaynak belge de kaydedilir.</small>
                  )}
                </div>
                {/*
                  Kaynak sayfa bilgi değil BAĞLANTIDIR: şartname PDF'i o sayfada
                  açılır. Belge yayımlama sırasında R2'ye yazılmadıysa (eski
                  profiller) yalnızca sayfa numarası gösterilir.
                */}
                <ul>{item.profile.criteria.map((criterion) => (
                  <li key={criterion.id}>
                    <span>{criterion.required ? "Zorunlu" : "Diğer"}</span>
                    <strong>{criterion.name}</strong>
                    <small>
                      {criterion.sourcePage
                        ? (item.profile.sourceDocument.fileKey
                          ? <a className="source-page-link" href={`${workflowApi.profileFileUrl(item.id)}#page=${criterion.sourcePage}`} target="_blank" rel="noreferrer" title="Şartnameyi bu sayfada aç">Kaynak s. {criterion.sourcePage} ↗</a>
                          : `Kaynak s. ${criterion.sourcePage}`)
                        : "Kaynak sayfası belirtilmemiş"}
                    </small>
                  </li>
                ))}</ul>
              </div>
            </details>
          ))}
          {!filteredProfiles.length ? <div className="participant-empty"><strong>Profil bulunamadı</strong><p>Kriter Atölyesi&apos;nde doğruladığınız bir profili yayımladığınızda burada görünecek.</p></div> : null}
        </div>
      ) : (
        <div className="history-list extraction-history-list">
          {filteredExtractions.map((item) => (
            <article key={item.id}>
              <div>
                <span className={`history-status ${item.status}`}>{item.status === "approved" ? "Yayımlandı" : "Analiz edildi"}</span>
                <strong>{item.competitionName || "Yarışma adı PDF'de bulunamadı"}</strong>
                <p>{item.sourceDocumentName}</p>
              </div>
              <div>
                <em>{item.criteriaCount} kriter</em>
                <small>{formatDateTime(item.analyzedAt)}</small>
                {item.profileId ? (
                  <Link className="text-button" href={`/kriter-atolyesi?profile=${encodeURIComponent(item.profileId)}`}>Profili düzenle</Link>
                ) : null}
              </div>
            </article>
          ))}
          {!filteredExtractions.length ? <div className="participant-empty"><strong>Ayıklama geçmişi bulunamadı</strong><p>İlk şartname PDF&apos;i analiz edildiğinde kayıt burada oluşacak.</p></div> : null}
        </div>
      )}
    </section>
  );
}
