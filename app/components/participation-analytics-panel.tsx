"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workflowApi } from "../lib/workflow-client";
import {
  AGREEMENT_DISCLAIMER,
  INSUFFICIENT_SAMPLE_NOTE,
  OUTCOME_FILTER_OPTIONS,
  PIPELINE_STAGE_OPTIONS,
  TEAM_SIZE_BUCKETS,
  type AgreementCounts,
  type AnalyticsFilterKey,
  type AnalyticsFilters,
  type BreakdownKey,
  type BreakdownRow,
  type ParticipationAnalytics,
} from "../lib/participation-analytics";
import {
  DISCOVERY_SOURCE_OPTIONS,
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  GRADE_OPTIONS_BY_EDUCATION,
  TEKNOFEST_HISTORY_OPTIONS,
  UNSPECIFIED,
  UNSPECIFIED_LABEL,
} from "../lib/team-profile";

/**
 * Değerlendirme Yöneticisi · "Katılım ve karar analitiği" çalışma görünümü.
 *
 * Yalnızca sunucunun TOPLULAŞTIRDIĞI sayaçları çizer; katılımcı adı, e-posta,
 * PDF içeriği ve hakem gerekçesi bu ekrana hiç gelmez. Bütün grafik ve
 * tablolar aynı aktif filtre kümesinden üretilir (sunucu tek veri kümesi
 * döndürür). Küçük gruplarda oran yerine "Örneklem yetersiz" yazılır.
 */

type SubSection = "participation" | "agreement";

const FILTER_LABELS: Record<AnalyticsFilterKey, string> = {
  competition: "Yarışma",
  year: "Yıl",
  stage: "Rapor/değerlendirme aşaması",
  outcome: "Başvuru sonucu",
  education: "Eğitim durumu",
  grade: "Sınıf/eğitim aşaması",
  institution: "Kurum",
  city: "Şehir",
  gender: "Cinsiyet",
  history: "TEKNOFEST geçmişi",
  teamSize: "Takım büyüklüğü",
  source: "Duyuru kaynağı",
};

const BREAKDOWN_SECTIONS: ReadonlyArray<{ key: BreakdownKey; title: string; detail: string; unit: "participants" | "applications" }> = [
  { key: "gender", title: "Cinsiyete göre katılımcı dağılımı ve başvuru sonucu", detail: "Katılımcı sayısı kişi bazlı; sonuçlar üyenin bulunduğu başvuru başına bir kez sayılır.", unit: "participants" },
  { key: "education", title: "Eğitim durumuna göre katılım ve başarı", detail: "Her takım üyesi bir katılımcıdır; aynı başvuru aynı grupta iki kez sayılmaz.", unit: "participants" },
  { key: "grade", title: "Sınıf / eğitim aşamasına göre dağılım", detail: "Sınıf, eğitim durumuyla birlikte okunur (lise 1 ile lisans 1 ayrıdır).", unit: "participants" },
  { key: "institution", title: "Kurumlara göre başvuru sayısı", detail: "Katılımcı sayısı kişi bazlı; kurumdan gelen başvuru sayısı başvuru başına bir defa hesaplanır.", unit: "participants" },
  { key: "city", title: "Şehirlere göre bölgesel katılım", detail: "Üyenin kurumunun bulunduğu il.", unit: "participants" },
  { key: "history", title: "TEKNOFEST deneyimine göre başarı ilişkisi", detail: "Korelasyon gösterir; deneyimin sonucu belirlediği anlamına gelmez.", unit: "participants" },
  { key: "teamSize", title: "Takım büyüklüğüne göre başvuru sonucu", detail: "Başvuru sahibi dâhil; başvuru bazlı sayılır.", unit: "applications" },
  { key: "source", title: "Duyuru kanalına göre başvuru ve başarı ilişkisi", detail: "Takım başına bir kez sorulur; üye sayısıyla çoğaltılmaz. Reklam harcaması verisi olmadığı için yatırım getirisi hesaplanmaz.", unit: "applications" },
];

function rateText(rate: number | null): string {
  return rate === null ? INSUFFICIENT_SAMPLE_NOTE : `%${rate}`;
}

function BreakdownTable({ rows, unit, minDecided }: { rows: BreakdownRow[]; unit: "participants" | "applications"; minDecided: number }) {
  if (!rows.length) return <p className="participant-empty">Bu kırılım için seçili filtrelerde veri yok.</p>;
  const max = Math.max(1, ...rows.map((row) => row.applications));
  return (
    <div className="analytics-table" role="table">
      <div className="analytics-table-head" role="row">
        <span>Grup</span>
        <span>{unit === "participants" ? "Katılımcı" : "Başvuru"}</span>
        <span>{unit === "participants" ? "Başvuru" : "Karar"}</span>
        <span>Onay / Ret / Düzeltme</span>
        <span>Bekleyen</span>
        <span title={`Tamamlanmış kararlar içindeki onay payı; en az ${minDecided} karar gerekir.`}>Onay oranı</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="analytics-table-row" role="row">
          <span className="analytics-row-label">
            <strong>{row.label}</strong>
            <span className="analytics-bar" aria-hidden="true"><span style={{ width: `${Math.round((row.applications / max) * 100)}%` }} /></span>
          </span>
          <span>{unit === "participants" ? row.participants : row.applications}</span>
          <span>{unit === "participants" ? row.applications : row.decided}</span>
          <span><b className="ok">{row.accepted}</b> / <b className="bad">{row.rejected}</b> / <b className="warn">{row.revision}</b></span>
          <span>{row.pending}</span>
          <span className={row.approvalRate === null ? "analytics-muted" : ""}>{rateText(row.approvalRate)}</span>
        </div>
      ))}
    </div>
  );
}

function AgreementCells({ counts }: { counts: AgreementCounts }) {
  return (
    <>
      <span>{counts.total}</span>
      <span>{counts.approved}</span>
      <span>{counts.rejected}</span>
      <span className={counts.usageRate === null ? "analytics-muted" : ""}>{rateText(counts.usageRate)}</span>
      <span className={counts.outcomeAgreementRate === null ? "analytics-muted" : ""}>{rateText(counts.outcomeAgreementRate)}</span>
    </>
  );
}

export default function ParticipationAnalyticsPanel() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [data, setData] = useState<ParticipationAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [section, setSection] = useState<SubSection>("participation");
  const loadSeq = useRef(0);

  /** Yalnızca EN SON başlatılan istek ekrana yazar; geciken eski yanıt yeni filtreyi ezemez. */
  const fetchAnalytics = useCallback((next: AnalyticsFilters) => {
    const seq = ++loadSeq.current;
    workflowApi.operationsAnalytics(next)
      .then((result) => { if (seq === loadSeq.current) { setData(result.analytics); setError(""); } })
      .catch((caught) => { if (seq === loadSeq.current) setError(caught instanceof Error ? caught.message : "Analitik yüklenemedi."); })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }, []);

  useEffect(() => {
    fetchAnalytics({});
    return () => { loadSeq.current += 1; };
  }, [fetchAnalytics]);

  /** Filtre değişimi tek noktadan: durum + yeniden yükleme birlikte. */
  function applyFilters(next: AnalyticsFilters) {
    setFilters(next);
    setLoading(true);
    fetchAnalytics(next);
  }

  function setFilter(key: AnalyticsFilterKey, value: string) {
    const next = { ...filters };
    if (value) next[key] = value; else delete next[key];
    applyFilters(next);
  }

  const activeCount = Object.values(filters).filter(Boolean).length;
  const gradeOptions = Object.entries(GRADE_OPTIONS_BY_EDUCATION).flatMap(([education, options]) =>
    options.map((option) => ({
      value: option.value,
      label: `${EDUCATION_OPTIONS.find((item) => item.value === education)?.label ?? education} · ${option.label}`,
    })));
  // Aynı sınıf değeri birden fazla eğitimde bulunur; filtre değeri tek olduğu için tekilleştirilir.
  const uniqueGradeOptions = [...new Map(gradeOptions.map((option) => [option.value, option])).values()]
    .map((option) => ({ ...option, label: gradeOptions.filter((item) => item.value === option.value).map((item) => item.label).join(" / ") }));

  const selectFilter = (key: AnalyticsFilterKey, options: ReadonlyArray<{ value: string; label: string }>, allowUnspecified = false) => (
    <label key={key} className="field analytics-filter">
      <span className="field-label">{FILTER_LABELS[key]}</span>
      <select value={filters[key] ?? ""} onChange={(event) => setFilter(key, event.target.value)}>
        <option value="">Tümü</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        {allowUnspecified ? <option value={UNSPECIFIED}>{UNSPECIFIED_LABEL}</option> : null}
      </select>
    </label>
  );

  return (
    <section className="analytics-workspace" aria-labelledby="analytics-title">
      <div className="analytics-intro">
        <h2 id="analytics-title">Katılım ve karar analitiği</h2>
        <p>
          Yalnızca toplulaştırılmış sayılar gösterilir; kişi adı, e-posta, rapor içeriği ve hakem gerekçesi bu
          ekrana gelmez. Bütün grafik ve tablolar aşağıdaki aynı filtre kümesini kullanır. Başarı oranı
          yalnızca kararı tamamlanmış başvurular üzerinden hesaplanır; bekleyenler paydaya girmez, düzeltme
          istenenler ayrı gösterilir. {data ? `${data.minDecidedForRate}` : "3"} tamamlanmış karardan az olan gruplarda oran yerine
          “{INSUFFICIENT_SAMPLE_NOTE}” yazılır.
        </p>
      </div>

      <div className="analytics-filters" role="group" aria-label="Analitik filtreleri">
        {selectFilter("competition", (data?.options.competitions ?? []).map((item) => ({ value: item.key, label: item.name })))}
        {selectFilter("year", (data?.options.years ?? []).map((year) => ({ value: year, label: year })))}
        {selectFilter("stage", PIPELINE_STAGE_OPTIONS)}
        {selectFilter("outcome", OUTCOME_FILTER_OPTIONS)}
        {selectFilter("education", EDUCATION_OPTIONS, true)}
        {selectFilter("grade", uniqueGradeOptions, true)}
        {selectFilter("institution", (data?.options.institutions ?? []).map((item) => ({ value: item, label: item })))}
        {selectFilter("city", (data?.options.cities ?? []).map((item) => ({ value: item, label: item })))}
        {selectFilter("gender", GENDER_OPTIONS, true)}
        {selectFilter("history", TEKNOFEST_HISTORY_OPTIONS, true)}
        {selectFilter("teamSize", TEAM_SIZE_BUCKETS)}
        {selectFilter("source", DISCOVERY_SOURCE_OPTIONS, true)}
        <div className="analytics-filter-actions">
          <span>{activeCount ? `${activeCount} filtre etkin` : "Filtre yok · tüm başvurular"}</span>
          <button type="button" className="text-button" disabled={!activeCount} onClick={() => applyFilters({})}>Filtreleri temizle</button>
        </div>
      </div>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {loading && !data ? <p className="page-note">Analitik yükleniyor…</p> : null}

      {data ? (
        <div className={loading ? "analytics-body is-refreshing" : "analytics-body"} aria-busy={loading}>
          <div className="operations-summary analytics-kpis">
            <div><strong>{data.totals.applications}</strong><span>toplam başvuru</span></div>
            <div><strong>{data.totals.participants}</strong><span>toplam katılımcı</span></div>
            <div><strong>{data.totals.averageTeamSize ?? "—"}</strong><span>ortalama takım büyüklüğü</span></div>
            <div><strong>{data.totals.decided}</strong><span>kararı tamamlanan başvuru</span></div>
            <div><strong>{data.totals.pending}</strong><span>bekleyen başvuru</span></div>
            <div><strong>{data.totals.accepted}</strong><span>onaylanan</span></div>
            <div><strong>{data.totals.rejected}</strong><span>reddedilen</span></div>
            <div><strong>{data.totals.revision}</strong><span>düzeltme istenen</span></div>
            <div className={data.totals.approvalRate === null ? "analytics-kpi-muted" : ""}>
              <strong>{rateText(data.totals.approvalRate)}</strong>
              <span>tamamlanmış kararlar içindeki onay oranı</span>
            </div>
          </div>

          <div className="operations-tabs analytics-subtabs" role="tablist" aria-label="Analitik alt bölümleri">
            <button type="button" role="tab" aria-selected={section === "participation"} className={section === "participation" ? "active" : ""} onClick={() => setSection("participation")}>A · Katılım ve başarı</button>
            <button type="button" role="tab" aria-selected={section === "agreement"} className={section === "agreement" ? "active" : ""} onClick={() => setSection("agreement")}>B · AI–hakem uyumu <span>{data.agreement.total}</span></button>
          </div>

          {section === "participation" ? (
            <div className="analytics-section" role="tabpanel">
              <section className="analytics-notes" aria-labelledby="analytics-notes-title">
                <h3 id="analytics-notes-title">Yönetim notları</h3>
                <p className="analytics-hint">Mevcut toplu verilerden otomatik türetilir; korelasyon anlatır, sebep-sonuç iddia etmez.</p>
                <ul>{data.notes.map((note) => <li key={note}>{note}</li>)}</ul>
              </section>
              <div className="analytics-grid">
                {BREAKDOWN_SECTIONS.map((block) => (
                  <section key={block.key} className="analytics-card" aria-label={block.title}>
                    <header><h3>{block.title}</h3><p>{block.detail}</p></header>
                    <BreakdownTable rows={data.breakdowns[block.key]} unit={block.unit} minDecided={data.minDecidedForRate} />
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div className="analytics-section" role="tabpanel">
              <p className="analytics-disclaimer" role="note">{AGREEMENT_DISCLAIMER}</p>
              <div className="operations-summary analytics-kpis">
                <div><strong>{data.agreement.total}</strong><span>incelenen kriter kararı</span></div>
                <div><strong>{data.agreement.approved}</strong><span>AI bulgusu onaylanan</span></div>
                <div><strong>{data.agreement.rejected}</strong><span>AI bulgusu reddedilen</span></div>
                <div><strong>{data.agreement.rejectedSameOutcome}</strong><span>reddedildi, nihai sonuç aynı kaldı</span></div>
                <div className={data.agreement.usageRate === null ? "analytics-kpi-muted" : ""}><strong>{rateText(data.agreement.usageRate)}</strong><span>AI bulgusunu olduğu gibi kullanma oranı</span></div>
                <div className={data.agreement.outcomeAgreementRate === null ? "analytics-kpi-muted" : ""}><strong>{rateText(data.agreement.outcomeAgreementRate)}</strong><span>nihai kriter sonucu uyumu</span></div>
              </div>
              <p className="analytics-hint">
                <strong>İki ölçüm ayrıdır.</strong> “Olduğu gibi kullanma”: hakem AI kararını, açıklamasını ve kanıtını
                değiştirmeden onayladı. “Nihai sonuç uyumu”: hakem açıklamayı değiştirse bile kriterin Uygun/Olumsuz
                sonucu AI ile aynı kaldı.
              </p>

              <div className="analytics-grid">
                <section className="analytics-card" aria-label="AI sonucu ile hakem nihai sonucu">
                  <header><h3>AI sonucu → hakem nihai sonucu</h3><p>Nihai kriter sonucu: onayda AI sonucu, redde hakemin yazdığı sonuç.</p></header>
                  <div className="analytics-matrix" role="table">
                    <div role="row"><span /><span>Hakem “Uygun”</span><span>Hakem “Olumsuz”</span></div>
                    <div role="row"><span>AI “Uygun”</span><strong>{data.agreement.matrix.uygunUygun}</strong><strong className="analytics-diverge">{data.agreement.matrix.uygunOlumsuz}</strong></div>
                    <div role="row"><span>AI “Olumsuz”</span><strong className="analytics-diverge">{data.agreement.matrix.olumsuzUygun}</strong><strong>{data.agreement.matrix.olumsuzOlumsuz}</strong></div>
                  </div>
                </section>

                <section className="analytics-card" aria-label="Hakem bazında uyum">
                  <header><h3>Hakem bazında uyum</h3><p>Hakemler anonim sıra etiketiyle gösterilir. Tek hakemin AI ile aynı fikirde olması doğruluk ya da hakem kalitesi kanıtı değildir.</p></header>
                  <div className="analytics-table agreement-table" role="table">
                    <div className="analytics-table-head" role="row"><span>Hakem</span><span>Karar</span><span>Onay</span><span>Ret</span><span>Kullanım</span><span>Sonuç uyumu</span></div>
                    {data.agreement.byJudge.map((row) => (
                      <div key={row.label} className="analytics-table-row" role="row"><span><strong>{row.label}</strong></span><AgreementCells counts={row} /></div>
                    ))}
                    {!data.agreement.byJudge.length ? <p className="participant-empty">Tamamlanmış hakem kararı yok.</p> : null}
                  </div>
                </section>

                <section className="analytics-card" aria-label="Kontrol alanı bazında uyum">
                  <header><h3>Kontrol alanı / aşama bazında uyum</h3><p>Kriterin bağlı olduğu dört aşamalı kontrol alanı.</p></header>
                  <div className="analytics-table agreement-table" role="table">
                    <div className="analytics-table-head" role="row"><span>Aşama</span><span>Karar</span><span>Onay</span><span>Ret</span><span>Kullanım</span><span>Sonuç uyumu</span></div>
                    {data.agreement.byStage.map((row) => (
                      <div key={row.key} className="analytics-table-row" role="row"><span><strong>{row.label}</strong></span><AgreementCells counts={row} /></div>
                    ))}
                    {!data.agreement.byStage.length ? <p className="participant-empty">Tamamlanmış hakem kararı yok.</p> : null}
                  </div>
                </section>

                <section className="analytics-card" aria-label="En sık yeniden değerlendirilen kriterler">
                  <header><h3>En sık yeniden değerlendirilen kriterler</h3><p>AI bulgusunun en çok reddedildiği kriterler; şartname kriter adı gösterilir, hakem gerekçesi gösterilmez.</p></header>
                  {data.agreement.mostReevaluated.length ? (
                    <ol className="analytics-ranked">
                      {data.agreement.mostReevaluated.map((row) => (
                        <li key={row.criterionName}><strong>{row.criterionName}</strong><small>{row.rejected} ret / {row.total} karar</small></li>
                      ))}
                    </ol>
                  ) : <p className="participant-empty">Reddedilen AI bulgusu yok.</p>}
                </section>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
