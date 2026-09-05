"use client";
import { useLiveRefresh } from "./use-live-refresh";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { roleLabel } from "../lib/admin-roles";
import { fold } from "../lib/competitions";
import { workflowApi } from "../lib/workflow-client";
import ParticipationAnalyticsPanel from "./participation-analytics-panel";
import {
  APPLICATION_STATUS_LABELS,
  COMPETITION_STATUS_LABELS,
  type CompetitionApplication,
  type CompetitionOverview,
  type JudgeWorkload,
  type OperationsSummary,
  type TimelineEntry,
} from "../lib/workflow-types";

/**
 * Aşama E · Değerlendirme Yöneticisi panosu (Rol 04).
 *
 * Bu rol yarışmacı raporlarını TEK TEK OKUMAZ; sürecin hızını, tamamlanma
 * oranlarını ve darboğazları izler. Yarışmacı PDF'i, katılımcı adı ve kanıt
 * metinleri bu role hiç gönderilmez (bkz. workflow-db · `redactEvaluation` ve
 * "operations" görünümü).
 *
 * YETKİ SINIRI:
 *   İzler   şartname/kriter özeti, başvuru durumu (Açık/Kapalı), sayaçlar.
 *   Yapar   ÖNCELİKLİ işareti, hakem yeniden atama, hatırlatma, hata kuyruğu.
 *   Yapamaz kriter değiştirme, nihai karar, başvuru durumunu açma/kapatma
 *           (o yetki yarışmanın sahibi Yarışma Yöneticisindedir).
 */
type ArchiveTrailEntry = {
  id: string;
  kind: "competition" | "application";
  subject: string;
  actorName: string;
  at: string;
  reason: string;
  previousStatus: string;
  nextStatus: string;
};

/**
 * "Değerlendirme Operasyonları" sekmeleri. Şartname özeti, hakem yükü ve
 * süreç kayıtları alt alta dizilmez; yalnızca seçili sekme çizilir. Başvuru
 * tablosu hakem sütunu ve hatırlatma işlemi taşıdığı için "Hakem iş yükü"
 * sekmesinde, arşiv izi ise olay kaydı olduğu için "Son süreç hareketleri"
 * sekmesinde durur.
 */
type OperationsTab = "overview" | "judges" | "timeline";

/**
 * Operasyon panelinin iki ÇALIŞMA GÖRÜNÜMÜ.
 *   process     Mevcut süreç ve iş yükü ekranı — aynen korunur.
 *   analytics   Katılım ve karar analitiği (toplulaştırılmış sayaçlar).
 * Görünüm değiştirmek mevcut sekmeleri, filtreleri ve işlemleri bozmaz.
 */
type WorkView = "process" | "analytics";
const WORK_VIEWS: ReadonlyArray<{ id: WorkView; label: string; detail: string }> = [
  { id: "process", label: "Süreç ve iş yükü", detail: "Sayaçlar, uyarılar, hakem yükü ve süreç hareketleri" },
  { id: "analytics", label: "Katılım ve karar analitiği", detail: "Demografi, kurum, kanal ve AI–hakem uyumu" },
];
const OPERATIONS_TABS: ReadonlyArray<{ id: OperationsTab; label: string; unit: string }> = [
  { id: "overview", label: "Şartname ve kriter özeti", unit: "yarışma" },
  { id: "judges", label: "Hakem iş yükü", unit: "başvuru" },
  { id: "timeline", label: "Son süreç hareketleri", unit: "kayıt" },
];

/**
 * HAKEM ATAMASI TAMAMEN OTOMATİKTİR: bu panelde hakem seçme kutusu, ilk atama
 * ve yeniden atama düğmesi YOKTUR. Sistem başvuruyu en az yüklü aktif hakeme
 * atar; aktif hakem yoksa başvuru "atanamadı" olarak izlenir ve yeni bir aktif
 * Hakem açıldığında (veya pano yeniden yüklendiğinde) otomatik dağıtılır.
 */
export default function OperationsPanel() {
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const [overview, setOverview] = useState<CompetitionOverview[]>([]);
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [recent, setRecent] = useState<TimelineEntry[]>([]);
  const [judges, setJudges] = useState<JudgeWorkload[]>([]);
  /** Kim neyi ne zaman ve neden arşivledi (madde 11); bu rol yalnızca görüntüler. */
  const [archiveTrail, setArchiveTrail] = useState<ArchiveTrailEntry[]>([]);
  const [priorityNote, setPriorityNote] = useState<Record<string, string>>({});
  /** Pasifleştirme notu — öncelik gerekçesinden AYRI tutulur; iki metin birbirine karışmaz. */
  const [deactivationNote, setDeactivationNote] = useState<Record<string, string>>({});
  /** İşlem bazlı meşgul durumu: başvuru, öncelik ve aktiflik işlemleri birbirini engellemez. */
  const [busyApplicationId, setBusyApplicationId] = useState("");
  const [busyPriorityId, setBusyPriorityId] = useState("");
  const [busyActiveId, setBusyActiveId] = useState("");
  /** İşlem bazlı hata: hata, yalnızca ilgili kart/satır içinde gösterilir. */
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  /** Değerlendirme Operasyonları bölümünde açık olan sekme. */
  const [tab, setTab] = useState<OperationsTab>("overview");
  /** Panelin çalışma görünümü; ilk açılışta mevcut süreç ekranı gelir. */
  const [workView, setWorkView] = useState<WorkView>("process");
  /** Eski ağ yanıtının yeni ekran durumunu ezmesini önleyen sıra sayacı. */
  const loadSeq = useRef(0);
  useLiveRefresh(load, !loading);

  function load() {
    // Her yükleme bir sıra numarası alır; yalnızca EN SON başlatılan yükleme
    // state yazabilir. Böylece geciken eski yanıt yeni veriyi ezemez.
    const seq = ++loadSeq.current;
    return Promise.all([workflowApi.applications(), workflowApi.operations()])
      .then(([applicationResult, operationsResult]) => {
        if (seq !== loadSeq.current) return;
        setApplications(applicationResult.applications);
        setSummary(operationsResult.summary);
        setRecent(operationsResult.recent);
        setJudges(operationsResult.judges);
        setOverview(operationsResult.overview ?? []);
        setArchiveTrail(operationsResult.archiveTrail ?? []);
        setError("");
      })
      .catch((caught) => {
        if (seq !== loadSeq.current) return;
        setError(caught instanceof Error ? caught.message : "Süreç bilgileri yüklenemedi.");
      })
      .finally(() => {
        if (seq !== loadSeq.current) return;
        setLoading(false);
      });
  }

  useEffect(() => {
    load();
    // İlk yükleme dışında kullanıcı eylemleri `load` ile yeniler.
    // Temizlik: bileşen kapanınca bekleyen yanıtların state yazması engellenir.
    return () => { loadSeq.current += 1; };
  }, []);

  async function applicationAction(application: CompetitionApplication, action: string) {
    setBusyApplicationId(application.id);
    setActionError(null);
    setNotice("");
    try {
      await workflowApi.updateApplication(application.id, action, { note: "Operasyon panosu işlemi" });
      setNotice("Operasyon işlemi tamamlandı.");
      await load();
    } catch (caught) {
      setActionError({ id: application.id, message: caught instanceof Error ? caught.message : "İşlem tamamlanamadı." });
    }
    finally { setBusyApplicationId(""); }
  }

  /**
   * ÖNCELİKLİ işareti — bu rolün tek yarışma seviyesi aksiyonu.
   *
   * Yarışmanın süreç durumunu (başvuruya açık/kapalı) DEĞİŞTİRMEZ; o yetki
   * Yarışma Yöneticisindedir. Buradaki işaret yalnızca hakem panelinde
   * yarışmayı öne çıkarır ve listenin başına alır.
   */
  async function togglePriority(item: CompetitionOverview) {
    setBusyPriorityId(item.competitionId);
    setActionError(null);
    setNotice("");
    try {
      const next = !item.isPriority;
      await workflowApi.setCompetitionPriority(item.competitionId, next, priorityNote[item.competitionId] ?? "");
      setNotice(next
        ? `“${item.competitionName}” ÖNCELİKLİ işaretlendi; hakem panelinde öne çıkacak.`
        : `“${item.competitionName}” önceliği kaldırıldı.`);
      setPriorityNote((current) => ({ ...current, [item.competitionId]: "" }));
      await load();
    } catch (caught) {
      setActionError({ id: item.competitionId, message: caught instanceof Error ? caught.message : "Öncelik güncellenemedi." });
    }
    finally { setBusyPriorityId(""); }
  }

  /**
   * Yarışmayı AKTİF / PASİF yapma (madde 6).
   *
   * Pasif yarışma yarışmacının listesinde görünmez ve yeni başvuru kabul
   * etmez; hakem geçmiş başvuruları görmeye devam eder. Yarışmanın süreç
   * aşaması ve kararları DEĞİŞMEZ.
   */
  async function toggleActive(item: CompetitionOverview) {
    setBusyActiveId(item.competitionId);
    setActionError(null);
    setNotice("");
    try {
      const next = !item.isActive;
      // Pasifleştirme notu KENDİ alanından okunur; öncelik gerekçesi karışmaz.
      await workflowApi.setCompetitionActive(item.competitionId, next, deactivationNote[item.competitionId] ?? "");
      setNotice(next
        ? `“${item.competitionName}” AKTİF edildi; yarışmacı listesinde görünür ve yeni başvuru kabul eder.`
        : `“${item.competitionName}” PASİF edildi; yeni başvuru alınmaz. Hakem geçmiş başvuruları görmeye devam eder.`);
      setDeactivationNote((current) => ({ ...current, [item.competitionId]: "" }));
      await load();
    } catch (caught) {
      setActionError({ id: item.competitionId, message: caught instanceof Error ? caught.message : "Yarışma durumu güncellenemedi." });
    }
    finally { setBusyActiveId(""); }
  }

  const filtered = useMemo(() => {
    const search = fold(query.trim());
    const list = search
      ? applications.filter((item) => fold(`${item.teamName} ${item.competitionName}`).includes(search))
      : applications;
    // Atama bekleyenler en üstte: süreç yalnızca bu adımda tıkanıyor ve
    // atanmayan başvuru hiçbir hakem panelinde görünmüyor.
    return [...list].sort((left, right) =>
      Number(Boolean(left.assignedJudgeId)) - Number(Boolean(right.assignedJudgeId)));
  }, [applications, query]);

  /** Operasyonel uyarılar: müdahale gerektiren durumlar. */
  /**
   * Hiç hakem atanmamış başvurular.
   *
   * Sistem başvuru alındığında en az yüklü hakeme otomatik atar; burada bir
   * kayıt görünüyorsa atama yapılamamıştır (aktif hakem yok ya da hata).
   * Hakem yalnızca kendisine ATANMIŞ dosyaları görür, bu yüzden atanmamış
   * başvuru hiçbir panelde görünmez ve süreç sessizce durur.
   */
  const unassigned = useMemo(
    () => applications.filter((item) => !item.assignedJudgeId && item.status !== "completed"),
    [applications],
  );

  const alerts = useMemo(() => {
    const list: string[] = [];
    const failed = applications.filter((item) => item.status === "analysis_failed").length;
    const stuck = applications.filter((item) => item.status === "analyzing").length;
    const waiting = applications.filter((item) => !item.assignedJudgeId && item.status !== "completed").length;
    if (waiting) {
      // Normalde başvuru alındığı anda sistem otomatik atar; burada bir kayıt
      // görünüyorsa atama YAPILAMAMIŞTIR (aktif hakem yok ya da hata oldu).
      // Elle atama YOKTUR: Admin yeni bir aktif Hakem (02) hesabı açtığında
      // veya bu pano yeniden yüklendiğinde sistem bekleyenleri otomatik dağıtır.
      list.push(
        `${waiting} başvuruya hakem atanamadı. Sistem başvuru alındığında en az yüklü aktif hakeme otomatik atar; `
        + "atama yapılamadıysa aktif Hakem (02) hesabı olmayabilir. Yeni bir aktif Hakem hesabı açıldığında "
        + "bekleyen başvurular sistem tarafından otomatik olarak en müsait hakemlere dağıtılır; elle atama yapılmaz.",
      );
    }

    // Yayımlanmış kriter profili olmayan yarışmada AI ön değerlendirmesi hiç
    // başlatılamaz; başvuru kuyrukta sessizce bekler. Operasyonun görmesi
    // gereken tıkanma budur.
    for (const item of overview) {
      if (item.criteriaCount === 0 && item.total > 0) {
        list.push(`${item.competitionName}: yayımlanmış kriter profili olmadığı için ${item.total} başvuru başlatılamıyor. Yarışma Yöneticisi kriter profilini yayımlamalı.`);
      }
    }

    // Yığılma: değerlendirilmeyi bekleyen başvurusu çok olan yarışma önceliğe aday.
    for (const item of overview) {
      if (!item.isPriority && item.pending >= 5) {
        list.push(`${item.competitionName}: ${item.pending} başvuru değerlendirme bekliyor. ÖNCELİKLİ işaretleyerek hakem panelinde öne çıkarabilirsiniz.`);
      }
    }

    if (failed) list.push(`${failed} başvuruda AI analizi başarısız oldu; yeniden analiz kuyruğuna alınabilir.`);
    if (stuck) list.push(`${stuck} başvuru AI ön değerlendirmesinde bekliyor.`);
    return list;
  }, [applications, overview]);

  /** Sekme rozetleri: her sekmenin ana listesindeki kayıt sayısı. */
  const tabCounts: Record<OperationsTab, number> = {
    overview: overview.length,
    judges: applications.length,
    timeline: recent.length,
  };

  if (loading) return <p className="page-note">Süreç görünümü yükleniyor…</p>;
  return (
    <section className="operations-workspace" aria-labelledby="operations-title">
      <header>
        <span className="role-code">Operasyon ve süreç koordinasyonu</span>
        <h1 id="operations-title">Değerlendirme süreci</h1>
        <p>Hakem yüklerini, atanamayan başvuruları ve analiz hatalarını izleyin; hatırlatma ve hata kuyruğunu yönetin. Hakem ataması sistem tarafından otomatik yapılır; teknik karar yalnızca Hakeme aittir.</p>
      </header>
      {error ? <p className="admin-error">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}

      {/*
        İKİNCİ ÇALIŞMA GÖRÜNÜMÜ: "Katılım ve karar analitiği". Mevcut süreç ve iş
        yükü ekranı aynen kalır; yalnızca seçili görünüm çizilir.
      */}
      <div className="admin-view-nav operations-view-nav" role="tablist" aria-label="Operasyon çalışma görünümleri">
        {WORK_VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={workView === item.id}
            className={workView === item.id ? "active" : ""}
            onClick={() => setWorkView(item.id)}
          >
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>

      {workView === "analytics" ? <ParticipationAnalyticsPanel /> : null}

      {workView === "process" ? summary ? (
        <div className="operations-summary">
          <div><strong>{summary.total}</strong><span>toplam başvuru</span></div>
          <div className={unassigned.length ? "summary-warning" : ""}><strong>{unassigned.length}</strong><span>hakem ataması bekliyor</span></div>
          <div><strong>{summary.aiPending}</strong><span>AI analizi bekliyor</span></div>
          <div><strong>{summary.aiProcessing}</strong><span>AI analizinde</span></div>
          <div><strong>{summary.aiCompleted}</strong><span>AI analizi tamamlandı</span></div>
          <div><strong>{summary.judgePending}</strong><span>hakem bekliyor</span></div>
          <div><strong>{summary.judgeInReview}</strong><span>hakem değerlendirmesinde</span></div>
          <div><strong>{summary.completed}</strong><span>nihai değerlendirme tamamlandı</span></div>
          <div><strong>{summary.failed}</strong><span>hatalı analiz</span></div>
          <div><strong>%{summary.completionRate}</strong><span>tamamlanma oranı</span></div>
        </div>
      ) : null : null}

      {workView === "process" ? <section className="operations-alerts" aria-label="Operasyonel uyarılar">
        <h2>Operasyonel uyarılar</h2>
        {alerts.length ? <ul>{alerts.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="page-note">Bekleyen operasyonel uyarı yok.</p>}
      </section> : null}

      {/*
        DEĞERLENDİRME OPERASYONLARI — sekmeli bölüm.
        Şartname özeti, hakem yükü ve süreç kayıtları alt alta dizildiğinde
        sayfa uzuyor ve yönetici sürekli kaydırmak zorunda kalıyordu. İlk
        ekranda süreç sayaçları ve uyarılar kalır; aşağıdaki üç bölümden
        yalnızca seçili sekmenin içeriği çizilir.
      */}
      {workView === "process" ? <section className="operations-tabs-section" aria-labelledby="operations-tabs-title">
        <div>
          <h2 id="operations-tabs-title">Değerlendirme Operasyonları</h2>
          <p>Şartname ve kriter özeti, hakem iş yükü ve son süreç hareketleri sekmelere ayrıldı; yalnızca seçili sekmenin bilgileri görünür.</p>
        </div>
        <div className="operations-tabs" role="tablist" aria-label="Değerlendirme operasyonları bölümleri">
          {OPERATIONS_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`operations-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`operations-tabpanel-${item.id}`}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label} <span title={`${tabCounts[item.id]} ${item.unit}`}>{tabCounts[item.id]}</span>
            </button>
          ))}
        </div>

        <div
          className="operations-tabpanel"
          role="tabpanel"
          id={`operations-tabpanel-${tab}`}
          aria-labelledby={`operations-tab-${tab}`}
        >
          {/*
            Şartname / kriter özeti — Problem 4 · 1.A.1.
            Yarışma adı, ayıklanan kriter sayısı ve BAŞVURU DURUMU salt okunur
            listelenir. Durumu değiştirme yetkisi Yarışma Yöneticisindedir; bu rol
            yalnızca izler. Tek aksiyon ÖNCELİKLİ işaretidir.
          */}
          {tab === "overview" ? (
            <div className="competition-overview">
              <div>
                <p>
                  Kriterleri çıkarılmış yarışmalar, ayıklanan kriter sayısı ve başvuru durumu.
                  Başvuru durumunu Yarışma Yöneticisi belirler; burada yalnızca izlenir.
                  Yığılan veya geciken yarışmaya <strong>ÖNCELİKLİ</strong> işareti koyabilirsiniz.
                </p>
              </div>
              <div className="competition-overview-list">
                {overview.map((item) => {
                  const share = summary?.total ? Math.round((item.total / summary.total) * 100) : 0;
                  return (
                    <article key={item.competitionId} className={item.isPriority ? "priority" : ""}>
                      <div className="competition-overview-head">
                        <div>
                          <strong>
                            {item.isPriority ? <span className="priority-badge" aria-label="Öncelikli">🔥 ÖNCELİKLİ</span> : null}
                            {item.competitionName}
                          </strong>
                          <small>
                            {item.sourceDocumentName || "Kaynak şartname bilinmiyor"}
                            {item.category ? ` · ${item.category}` : ""}
                          </small>
                        </div>
                        <div className="competition-overview-tags">
                          <span className="status-chip neutral">{item.criteriaCount} kriter ayıklandı</span>
                          <span className={`status-chip ${item.isActive ? "success" : "danger"}`}>
                            {item.isActive ? "AKTİF" : "PASİF"}
                          </span>
                          <span className={`status-chip ${item.acceptingApplications ? "success" : "neutral"}`}>
                            Başvuru: {item.acceptingApplications ? "Açık" : "Kapalı"}
                          </span>
                          <span className="status-chip neutral">{COMPETITION_STATUS_LABELS[item.status]}</span>
                        </div>
                      </div>

                      <div className="competition-overview-counts">
                        <div><strong>{item.total}</strong><span>toplam başvuru</span></div>
                        <div><strong>{item.analysisCompleted}</strong><span>analizi tamamlanan</span></div>
                        <div className={item.analysisPending ? "summary-warning" : ""}><strong>{item.analysisPending}</strong><span>analiz bekleyen</span></div>
                        <div><strong>{item.evaluated}</strong><span>değerlendirilen</span></div>
                        <div><strong>{item.accepted}</strong><span>onaylanan</span></div>
                        <div><strong>{item.rejected}</strong><span>reddedilen</span></div>
                        <div><strong>{item.pending}</strong><span>bekleyen</span></div>
                        {item.revision ? <div><strong>{item.revision}</strong><span>düzeltme istendi</span></div> : null}
                        {item.unassigned ? <div className="summary-warning"><strong>{item.unassigned}</strong><span>hakem atanamadı</span></div> : null}
                        {item.archived ? <div><strong>{item.archived}</strong><span>arşivlenen</span></div> : null}
                      </div>

                      {/* Yoğunluk: bu yarışmanın tüm başvurular içindeki payı. */}
                      <div className="competition-density" title={`${item.total} başvuru · tüm başvuruların %${share}'i`}>
                        <div className="competition-density-bar"><span style={{ width: `${share}%` }} /></div>
                        <small>Başvuru yoğunluğu: %{share}</small>
                      </div>

                      {item.isPriority && item.priorityNote ? (
                        <p className="priority-note">Öncelik gerekçesi: {item.priorityNote}</p>
                      ) : null}

                      <div className="competition-overview-actions">
                        {!item.isPriority ? (
                          <input
                            value={priorityNote[item.competitionId] ?? ""}
                            maxLength={300}
                            placeholder="Öncelik gerekçesi (isteğe bağlı)"
                            aria-label={`${item.competitionName} öncelik gerekçesi`}
                            onChange={(event) => setPriorityNote((current) => ({ ...current, [item.competitionId]: event.target.value }))}
                          />
                        ) : null}
                        <button
                          type="button"
                          className={item.isPriority ? "text-button" : "secondary-button"}
                          disabled={busyPriorityId === item.competitionId || busyActiveId === item.competitionId}
                          onClick={() => togglePriority(item)}
                        >
                          {busyPriorityId === item.competitionId
                            ? "Güncelleniyor…"
                            : item.isPriority ? "Önceliği kaldır" : "🔥 Öncelikli işaretle"}
                        </button>
                        {/* Pasifleştirme notu: öncelik gerekçesinden ayrı, kendi alanında tutulur. */}
                        {item.isActive ? (
                          <input
                            value={deactivationNote[item.competitionId] ?? ""}
                            maxLength={300}
                            placeholder="Pasifleştirme notu (isteğe bağlı)"
                            aria-label={`${item.competitionName} pasifleştirme notu`}
                            onChange={(event) => setDeactivationNote((current) => ({ ...current, [item.competitionId]: event.target.value }))}
                          />
                        ) : null}
                        {/* Aktif/pasif: yeni başvuru ve yeni kuyruk üretimini durdurur (madde 6). */}
                        <button
                          type="button"
                          className={item.isActive ? "danger-button ghost" : "secondary-button"}
                          disabled={busyPriorityId === item.competitionId || busyActiveId === item.competitionId}
                          onClick={() => toggleActive(item)}
                        >
                          {busyActiveId === item.competitionId
                            ? "Güncelleniyor…"
                            : item.isActive ? "Pasife al" : "Aktifleştir"}
                        </button>
                      </div>
                      {actionError?.id === item.competitionId ? (
                        <p className="admin-error" role="alert">{actionError.message}</p>
                      ) : null}
                    </article>
                  );
                })}
                {!overview.length ? <p className="participant-empty">Kriterleri çıkarılmış yarışma yok.</p> : null}
              </div>
            </div>
          ) : null}

          {tab === "judges" ? (
            <>
              <div className="judge-workloads">
                <div><p>Açık ve tamamlanan dosya sayılarını izleyin. Dağıtımı sistem yapar: yeni başvuru daima en az yüklü aktif hakeme gider.</p></div>
                {judges.map((judge) => (
                  <article key={judge.judgeId}>
                    <div><strong>{judge.judgeName}</strong><small>{judge.active} aktif · {judge.completed} tamamlandı</small></div>
                    <span className={judge.failed ? "has-error" : ""}>{judge.failed ? `${judge.failed} hata` : "Hata yok"}</span>
                  </article>
                ))}
                {!judges.length ? <p className="participant-empty">Etkin Hakem hesabı yok.</p> : null}
              </div>

              <label className="search-box operations-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Takım veya yarışma ara" /></label>
              {/*
                HAKEM SÜTUNU SALT OKUNURDUR: seçim kutusu ve atama düğmesi yoktur.
                Atamayı sistem yapar; bu tablo yalnızca kimin atandığını gösterir.
              */}
              <div className="operations-table" role="table" aria-label="Başvuru durumu">
                <div className="operations-table-head operations-table-head-actions" role="row"><span>Takım / yarışma</span><span>Durum / sonuç</span><span>Hakem</span><span>Operasyon</span></div>
                {filtered.map((item) => (
                  <div key={item.id} className="operations-table-row operations-table-row-actions" role="row">
                    <span>
                      <strong>{item.teamName}</strong>
                      <small>{item.competitionName} · {formatDateTime(item.updatedAt)}</small>
                      {!item.assignedJudgeId && item.status !== "completed"
                        ? <small className="assignment-pending">Hakem atanamadı · hakem panelinde görünmüyor</small>
                        : null}
                    </span>
                    <span><em className={`application-status ${item.status}`}>{APPLICATION_STATUS_LABELS[item.status]}</em><small>{item.outcome === "accepted" ? "Kabul edildi" : item.outcome === "rejected" ? "Reddedildi" : item.outcome === "revision_required" ? "Düzeltme istendi" : "Nihai karar bekliyor"}</small></span>
                    <span>
                      {item.assignedJudgeId
                        ? <><strong>{item.assignedJudgeName ?? "Atanmış hakem"}</strong><small>Sistem tarafından otomatik atandı</small></>
                        : <small className="assignment-pending">Sistem, aktif Hakem hesabı açıldığında otomatik atayacak</small>}
                    </span>
                    <span className="operation-actions">
                      {item.assignedJudgeId ? <button type="button" className="text-button" disabled={busyApplicationId === item.id} onClick={() => applicationAction(item, "remind_judge")}>Hatırlat</button> : null}
                      {item.status === "analysis_failed" ? <button type="button" className="text-button" disabled={busyApplicationId === item.id} onClick={() => applicationAction(item, "requeue_analysis")}>Analizi yeniden başlat</button> : null}
                      {item.status === "analysis_failed" ? <button type="button" className="text-button" disabled={busyApplicationId === item.id} onClick={() => applicationAction(item, "request_document")}>Yeni PDF iste</button> : null}
                      {actionError?.id === item.id ? <small className="admin-error" role="alert">{actionError.message}</small> : null}
                    </span>
                  </div>
                ))}
                {!filtered.length ? <p className="participant-empty">Aramanızla eşleşen başvuru bulunamadı.</p> : null}
              </div>
            </>
          ) : null}

          {tab === "timeline" ? (
            <>
              <div className="operations-timeline">
                <div><p>Rollerin gerçekleştirdiği son işlemler; sıralı belge devri değil, olay kaydıdır.</p></div>
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
              </div>

              {/*
                SİLME VE DENETİM GÖRÜNÜRLÜĞÜ (madde 11)
                Hangi yarışma/başvuru kim tarafından, ne zaman, hangi gerekçeyle
                arşivlendi. Olay kaydı olduğu için süreç hareketleriyle aynı sekmede
                durur. Bu bölüm YALNIZCA GÖRÜNTÜLENİR: bu rol katılımcı raporunun
                içeriğini değiştiremez ve arşivlenmiş kaydı geri alamaz.
              */}
              <section className="operations-archive" aria-labelledby="operations-archive-title">
                <div>
                  <h2 id="operations-archive-title">Arşivleme ve kaldırma kayıtları</h2>
                  <p>
                    Fiziksel silme yoktur: arşivlenen yarışma ve başvurular veri tabanında durur.
                    Aşağıdaki liste yalnızca izleme amaçlıdır.
                  </p>
                </div>
                {archiveTrail.length ? (
                  <div className="operations-table" role="table" aria-label="Arşivleme kayıtları">
                    <div className="operations-table-head archive-table-head" role="row">
                      <span>Kayıt</span><span>İşlemi yapan</span><span>Tarih</span><span>Önceki → yeni durum</span><span>Gerekçe</span>
                    </div>
                    {archiveTrail.map((entry) => (
                      <div key={entry.id} className="operations-table-row archive-table-row" role="row">
                        <span><strong>{entry.subject}</strong><small>{entry.kind === "competition" ? "Yarışma" : "Başvuru"}</small></span>
                        <span>{entry.actorName}</span>
                        <span>{formatDateTime(entry.at)}</span>
                        <span>{entry.previousStatus} → {entry.nextStatus}</span>
                        <span>{entry.reason}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="participant-empty">Arşivlenmiş yarışma veya başvuru yok.</p>}
              </section>
            </>
          ) : null}
        </div>
      </section> : null}
    </section>
  );
}
