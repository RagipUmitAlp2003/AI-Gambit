"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { workflowApi } from "../lib/workflow-client";
import type {
  AnalyticsBreakdownRow,
  AnalyticsOption,
  JudgeAlignmentRow,
  OperationsAnalytics,
  OperationsAnalyticsFilters,
} from "../lib/workflow-types";

type AnalyticsView = "participation" | "alignment";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: AnalyticsOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="analytics-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Tümü</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}
      </select>
    </label>
  );
}

function Breakdown({ title, description, rows }: { title: string; description: string; rows: AnalyticsBreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <section className="analytics-breakdown">
      <header><h3>{title}</h3><p>{description}</p></header>
      <div className="analytics-bars">
        {rows.slice(0, 12).map((row) => (
          <div className="analytics-bar-row" key={row.key}>
            <div><strong>{row.label}</strong><small>{row.total} başvuru · {row.completed} karara bağlandı</small></div>
            <div className="analytics-bar-track" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round((row.total / max) * 100))}%` }} /></div>
            <span className="analytics-rate">
              {row.successRate === null ? <small>örneklem az</small> : <><strong>%{row.successRate}</strong><small>onay</small></>}
            </span>
          </div>
        ))}
        {!rows.length ? <p className="participant-empty">Bu filtrelerle gösterilecek veri yok.</p> : null}
      </div>
    </section>
  );
}

function AlignmentList({ title, rows }: { title: string; rows: JudgeAlignmentRow[] }) {
  return (
    <section className="alignment-list">
      <h3>{title}</h3>
      {rows.map((row) => (
        <article key={row.key}>
          <div><strong>{row.label}</strong><small>{row.decisions} kesinleşmiş kriter kararı</small></div>
          <dl>
            <div><dt>AI bulgusu kullanımı</dt><dd>{row.findingReuseRate === null ? "—" : `%${row.findingReuseRate}`}</dd></div>
            <div><dt>Nihai sonuç uyumu</dt><dd>{row.finalVerdictAgreementRate === null ? "—" : `%${row.finalVerdictAgreementRate}`}</dd></div>
            <div><dt>AI bulgusu reddedildi, sonuç aynı kaldı</dt><dd>{row.sameResultRewritten}</dd></div>
          </dl>
        </article>
      ))}
      {!rows.length ? <p className="participant-empty">Tamamlanmış kriter kararı bulunmuyor.</p> : null}
    </section>
  );
}

export default function OperationsAnalyticsPanel() {
  const [view, setView] = useState<AnalyticsView>("participation");
  const [filters, setFilters] = useState<OperationsAnalyticsFilters>({});
  const [analytics, setAnalytics] = useState<OperationsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const requestSeq = ++seq.current;
    workflowApi.operationsAnalytics(filters)
      .then(({ analytics: next }) => {
        if (requestSeq !== seq.current) return;
        setAnalytics(next);
        setError("");
      })
      .catch((caught) => {
        if (requestSeq !== seq.current) return;
        setError(caught instanceof Error ? caught.message : "Analitik veriler yüklenemedi.");
        setAnalytics(null);
      })
      .finally(() => { if (requestSeq === seq.current) setLoading(false); });
    return () => { seq.current += 1; };
  }, [filters]);

  const update = (key: keyof OperationsAnalyticsFilters, value: string) => {
    setLoading(true);
    setError("");
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  };
  const clearFilters = () => {
    setLoading(true);
    setError("");
    setFilters({});
  };
  const options = analytics?.options;

  return (
    <section className="analytics-workspace" aria-labelledby="analytics-title">
      <div className="analytics-heading">
        <div><span className="section-kicker">Karar destek görünümü</span><h2 id="analytics-title">Katılım, başarı ve AI–hakem uyumu</h2><p>Sonuçları filtreleyin; hangi grupların başvurduğunu, başvuruların nasıl sonuçlandığını ve hakemlerin AI bulgularını nasıl kullandığını birlikte okuyun.</p></div>
        {analytics ? <small>Son güncelleme: {formatDateTime(analytics.generatedAt)}</small> : null}
      </div>

      <div className="analytics-view-switch" role="tablist" aria-label="Analitik bölümü">
        <button type="button" role="tab" aria-selected={view === "participation"} className={view === "participation" ? "active" : ""} onClick={() => setView("participation")}>Katılım ve başarı</button>
        <button type="button" role="tab" aria-selected={view === "alignment"} className={view === "alignment" ? "active" : ""} onClick={() => setView("alignment")}>AI–hakem uyumu</button>
      </div>

      <section className="analytics-filters" aria-label="Analitik filtreleri">
        <div className="analytics-filter-head"><div><strong>Görünümü daraltın</strong><small>Her grafik aynı filtre kümesini kullanır.</small></div><button type="button" className="text-button" onClick={clearFilters} disabled={!Object.values(filters).some(Boolean)}>Filtreleri temizle</button></div>
        <div className="analytics-filter-grid">
          <FilterSelect label="Yarışma" value={filters.competitionKey ?? ""} options={options?.competitions ?? []} onChange={(value) => update("competitionKey", value)} />
          <FilterSelect label="Yıl" value={filters.year ?? ""} options={options?.years ?? []} onChange={(value) => update("year", value)} />
          <FilterSelect label="Sonuç" value={filters.outcome ?? ""} options={options?.outcomes ?? []} onChange={(value) => update("outcome", value)} />
          <FilterSelect label="Eğitim durumu" value={filters.educationStatus ?? ""} options={options?.educationStatuses ?? []} onChange={(value) => update("educationStatus", value)} />
          <FilterSelect label="Şehir" value={filters.city ?? ""} options={options?.cities ?? []} onChange={(value) => update("city", value)} />
          <FilterSelect label="Duyuru kanalı" value={filters.discoverySource ?? ""} options={options?.discoverySources ?? []} onChange={(value) => update("discoverySource", value)} />
        </div>
        <details className="analytics-more-filters">
          <summary>Daha fazla filtre</summary>
          <div className="analytics-filter-grid">
            <FilterSelect label="Rapor aşaması" value={filters.stage ?? ""} options={options?.stages ?? []} onChange={(value) => update("stage", value)} />
            <FilterSelect label="Kurum" value={filters.institutionName ?? ""} options={options?.institutions ?? []} onChange={(value) => update("institutionName", value)} />
            <FilterSelect label="Cinsiyet" value={filters.gender ?? ""} options={options?.genders ?? []} onChange={(value) => update("gender", value)} />
            <FilterSelect label="TEKNOFEST geçmişi" value={filters.teknofestHistory ?? ""} options={options?.teknofestHistories ?? []} onChange={(value) => update("teknofestHistory", value)} />
            <FilterSelect label="Takım büyüklüğü" value={filters.teamSize ?? ""} options={options?.teamSizes ?? []} onChange={(value) => update("teamSize", value)} />
          </div>
        </details>
      </section>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {loading ? <p className="page-note" role="status">Analitik görünüm hazırlanıyor…</p> : null}
      {analytics ? (
        <>
          <div className="analytics-summary" aria-label="Filtrelenmiş örneklem özeti">
            <div><strong>{analytics.sample.registrations}</strong><span>profilini tamamlayan yarışmacı</span></div>
            <div><strong>{analytics.sample.applications}</strong><span>başvuru</span></div>
            <div><strong>{analytics.sample.completed}</strong><span>nihai karar</span></div>
            <div><strong>{analytics.sample.accepted}</strong><span>onaylanan</span></div>
            <div><strong>{analytics.sample.successRate === null ? "—" : `%${analytics.sample.successRate}`}</strong><span>onay oranı</span></div>
          </div>
          <aside className="analytics-insights" aria-label="Yönetim notları">
            <strong>Yönetim için öne çıkanlar</strong>
            <ul>{analytics.insights.map((item) => <li key={item}>{item}</li>)}</ul>
            <small>Bu notlar mevcut sayılardan deterministik olarak üretilir; nedensellik veya otomatik karar iddiası taşımaz.</small>
          </aside>

          {view === "participation" ? (
            <div className="analytics-content">
              <section className="acquisition-table-section">
                <header><h3>Duyuru kanalı performansı</h3><p>Kayıttan başvuruya geçiş ve nihai sonuçlar. Reklam harcaması girilmediği için yatırım getirisi hesaplanmaz.</p></header>
                <div className="analytics-table" role="table" aria-label="Duyuru kanalı performansı">
                  <div className="analytics-table-head" role="row"><span>Kanal</span><span>Kayıt</span><span>Başvuran</span><span>Geçiş</span><span>Onay</span></div>
                  {analytics.dimensions.acquisition.map((row) => (
                    <div className="analytics-table-row" role="row" key={row.key}>
                      <strong>{row.label}</strong><span>{row.registrations}</span><span>{row.applicants}</span><span>{row.applicationConversionRate === null ? "Örneklem az" : `%${row.applicationConversionRate}`}</span><span>{row.successRate === null ? "Örneklem az" : `%${row.successRate}`}</span>
                    </div>
                  ))}
                </div>
              </section>
              <div className="analytics-two-column">
                <Breakdown title="Eğitim durumu" description="Başvuru hacmi ve nihai kararlar." rows={analytics.dimensions.education} />
                <Breakdown title="TEKNOFEST geçmişi" description="Katılım deneyimi ile sonuç arasındaki ilişki." rows={analytics.dimensions.teknofestHistory} />
                <Breakdown title="Şehirler" description="Başvuru erişiminin bölgesel dağılımı." rows={analytics.dimensions.cities} />
                <Breakdown title="Takım büyüklüğü" description="Başvuru sahibi dahil otomatik hesaplanan ekip sayısı." rows={analytics.dimensions.teamSizes} />
                <Breakdown title="Kurumlar" description="En çok başvuru gelen kurumlar." rows={analytics.dimensions.institutions} />
                <Breakdown title="Cinsiyet dağılımı" description="İsteğe bağlı beyanların toplu görünümü." rows={analytics.dimensions.genders} />
              </div>
            </div>
          ) : (
            <div className="analytics-content alignment-content">
              <div className="alignment-explainer">
                <strong>İki ayrı ölçüm</strong>
                <p><b>AI bulgusu kullanımı</b>, hakemin AI açıklamasını ve kanıtını değiştirmeden kabul ettiği kararları gösterir. <b>Nihai sonuç uyumu</b>, açıklama değişse bile kriter sonucunun AI ile aynı kalıp kalmadığını gösterir.</p>
                <small>Bu bölüm AI doğruluk puanı veya hakem performans notu değildir. Gerçek hakem tutarlılığı için aynı başvuruların bağımsız ikinci hakem tarafından değerlendirilmesi gerekir.</small>
              </div>
              <div className="alignment-overview">
                <div><span>İncelenen kriter kararı</span><strong>{analytics.aiJudge.overall.decisions}</strong></div>
                <div><span>AI bulgusu kullanımı</span><strong>{analytics.aiJudge.overall.findingReuseRate === null ? "—" : `%${analytics.aiJudge.overall.findingReuseRate}`}</strong></div>
                <div><span>Nihai sonuç uyumu</span><strong>{analytics.aiJudge.overall.finalVerdictAgreementRate === null ? "—" : `%${analytics.aiJudge.overall.finalVerdictAgreementRate}`}</strong></div>
                <div><span>AI bulgusu reddedildi, sonuç aynı kaldı</span><strong>{analytics.aiJudge.overall.sameResultRewritten}</strong></div>
              </div>
              <div className="analytics-two-column">
                <AlignmentList title="Hakem bazında" rows={analytics.aiJudge.byJudge} />
                <AlignmentList title="Kontrol alanına göre" rows={analytics.aiJudge.byStage} />
              </div>
              <section className="decision-matrix">
                <header><h3>Karar yönü matrisi</h3><p>AI sonucu ile hakemin kesinleştirdiği kriter sonucunun yönünü gösterir.</p></header>
                <div>
                  <span /><strong>Hakem: Uygun</strong><strong>Hakem: Olumsuz</strong>
                  <strong>AI: Uygun</strong><b>{analytics.aiJudge.matrix.aiUygunJudgeUygun}</b><b>{analytics.aiJudge.matrix.aiUygunJudgeOlumsuz}</b>
                  <strong>AI: Olumsuz</strong><b>{analytics.aiJudge.matrix.aiOlumsuzJudgeUygun}</b><b>{analytics.aiJudge.matrix.aiOlumsuzJudgeOlumsuz}</b>
                </div>
              </section>
              <section className="override-list">
                <header><h3>En sık yeniden değerlendirilen kriterler</h3><p>Hakemin AI bulgusunu reddedip kendi kanıtı ve açıklamasıyla değerlendirdiği kriterler.</p></header>
                <ol>{analytics.aiJudge.topOverrides.map((item) => <li key={item.criterionName}><span>{item.criterionName}</span><strong>{item.count}</strong></li>)}</ol>
                {!analytics.aiJudge.topOverrides.length ? <p className="participant-empty">Yeniden değerlendirilen kriter bulunmuyor.</p> : null}
              </section>
            </div>
          )}
          <p className="analytics-footnote">Başarı oranları yalnızca nihai kararı verilmiş başvurular üzerinden hesaplanır. Düzeltme istenenler ayrı sonuçtur; bekleyen başvurular başarı oranının paydasına katılmaz. Kayıttan başvuruya geçiş oranı ise başvuru durumundan bağımsızdır. {analytics.minimumRateSample} kayıttan küçük gruplarda oran gösterilmez.</p>
        </>
      ) : null}
    </section>
  );
}
