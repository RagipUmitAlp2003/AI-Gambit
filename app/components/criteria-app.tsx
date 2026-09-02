"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import DocumentLibraryModal from "./document-library-modal";
import FileBadge from "./file-badge";
import TopbarSession from "./topbar-session";
import { AnalysisRequestError, analyzeWithGemini } from "../lib/gemini-analyzer";
import { getPdfPageCount } from "../lib/pdf-reader";
import { workflowApi } from "../lib/workflow-client";
import { SAMPLE_DOCUMENTS } from "../lib/sample-documents";
import {
  clearDraftSnapshot,
  clearLegacyTemplateFile,
  loadDraftFile,
  loadDraftSnapshot,
  saveDraftFile,
  saveDraftSnapshot,
} from "../lib/draft-store";
import { resolveVerifiability } from "../lib/criteria-extraction";
import {
  CHECK_STAGES,
  checkStageOf,
  criterionControlTypesForStage,
  type AnalysisResult,
  type CheckStage,
  type Criterion,
  type CriterionControlType,
  type ProfileExport,
  type SetupData,
  type Step,
} from "../lib/types";

const DEFAULT_SETUP: SetupData = {
  competition: "Belgede belirtilmemiş",
  category: "Belgede belirtilmemiş",
  stage: "Belgede belirtilmemiş",
  reportType: "Belgede belirtilmemiş",
  year: "Belgede belirtilmemiş",
  allowedFormats: [],
  maxFileSizeMb: 0,
  maxFileCount: 0,
  defaultViolationAction: "unspecified",
  reportLanguage: null,
};

const STEPS = [
  { id: 1, title: "Kaynak belge", short: "Resmî şartname PDF'si" },
  { id: 2, title: "Kriter inceleme", short: "Dört aşamalı kriterleri doğrula" },
  { id: 3, title: "Kriter profilini yayımla", short: "Yarışmayı başvuruya hazırla" },
] as const;

type StageFilter = "all" | CheckStage;

/**
 * Kriter yalnızca ZORUNLU ya da ZORUNLU OLMAYAN olabilir; üçüncü bir durum
 * yoktur. İki bölüm her zaman yan yana listelenir, ekleme iki ayrı düğmeyle
 * yapılır. Kriterler arasında görsel bir uygunluk/güven farkı GÖSTERİLMEZ:
 * şeması geçerli her kriter normal görünür, soluk veya kararsız gösterim yoktur.
 */
type CriterionKind = "required" | "other";

/**
 * Yeni kriter formunun taslak durumu.
 *
 * PDF'den denetlenebilirlik alanı KULLANICIYA SORULMAZ: sistem, kriter
 * metninden (ad + açıklama + alıntı) otomatik belirler (resolveVerifiability).
 * Video, portal, saha teslimi gibi açık ifadeler arka planda PDF dışı
 * sınıflandırılır; amaç yalnızca bu kuralların hakem rapor analizine
 * gönderilmesini engellemektir. Alan arayüzde gösterilmez ve düzenlenemez.
 */
type CriterionDraft = {
  kind: CriterionKind;
  name: string;
  stage: CheckStage;
  controlType: CriterionControlType;
  description: string;
};

function emptyDraft(kind: CriterionKind): CriterionDraft {
  return {
    kind,
    name: "",
    stage: "criteria_evidence",
    controlType: "KANIT_KONTROLU",
    description: "",
  };
}

function controlTypeForStage(stage: CheckStage): CriterionControlType {
  if (stage === "category_similarity") return "ANLAMSAL_UYGUNLUK";
  if (stage === "criteria_evidence") return "KANIT_KONTROLU";
  return stage === "headings_content" ? "ICERIK_VARLIGI" : "KANIT_KONTROLU";
}

const CONTROL_TYPE_LABELS: Record<CriterionControlType, string> = {
  BIREBIR_BASLIK: "Birebir başlık",
  ICERIK_VARLIGI: "İçerik varlığı",
  ANLAMSAL_UYGUNLUK: "Anlamsal uygunluk",
  KANIT_KONTROLU: "Teknik kanıt kontrolü",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stageBadge(stage: CheckStage) {
  const definition = checkStageOf(stage);
  return <span className={`stage-badge stage-${definition.order}`} title={definition.title}>{definition.order} · {definition.shortTitle}</span>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function StepRail({ step, completedSteps, onNavigate }: {
  step: Step;
  completedSteps: Set<Step>;
  onNavigate: (step: Step) => void;
}) {
  return (
    <nav className="step-rail" aria-label="Profil oluşturma adımları">
      <div className="rail-heading">
        <span className="rail-mark">KA</span>
        <div>
          <strong>Kriter Atölyesi</strong>
          <span>Dört aşamalı kriter seti</span>
        </div>
      </div>
      <ol>
        {STEPS.map((item) => {
          const state = item.id === step ? "active" : completedSteps.has(item.id) ? "done" : "upcoming";
          const canNavigate = item.id <= 2 || completedSteps.has(item.id);
          return (
            <li key={item.id} className={`rail-step ${state}`}>
              <button
                type="button"
                disabled={!canNavigate}
                aria-current={state === "active" ? "step" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <span className="step-index" aria-hidden="true">{state === "done" ? "✓" : item.id}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.short}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="rail-note">
        <span className="status-dot" />
        <div>
          <strong>Tek AI çağrısı · dört aşama</strong>
          <p>Şartname sunucuda tek geçişte analiz edilir; yalnızca PDF aşaması kuralları çıkarılır, puan üretilmez.</p>
        </div>
      </div>
    </nav>
  );
}

function Topbar({ step, onBack }: { step: Step; onBack: () => void }) {
  const current = STEPS.find((item) => item.id === step)!;
  return (
    <header className="topbar">
      <div className="topbar-lead">
        <button type="button" className="topbar-back" onClick={onBack} aria-label="Geri dön" title="Geri dön">
          <span aria-hidden="true">←</span>
        </button>
        <div>
          <span className="topbar-context">Değerlendirme karar destek sistemi</span>
          <strong>{current.title}</strong>
        </div>
      </div>
      <TopbarSession />
    </header>
  );
}

function UploadStep({
  file,
  onFile,
  onSample,
  onAnalyze,
  onReanalyze,
  analysisReady,
  loading,
  loadingMessage,
  error,
  errorRetryable,
}: {
  file: File | null;
  onFile: (file: File) => void;
  onSample: (file: File) => void;
  onAnalyze: () => void;
  /** Kayıtlı sonucu atlayıp modeli gerçekten yeniden çalıştırır. */
  onReanalyze: () => void;
  analysisReady: boolean;
  loading: boolean;
  loadingMessage: string;
  error: string;
  /** Geçici model hatası: kullanıcıya "Yeniden dene" sunulur. */
  errorRetryable: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  function accept(selected?: File) {
    if (selected) onFile(selected);
  }

  return (
    <section className="workspace upload-workspace" aria-labelledby="upload-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Organizatör kaynağı</span>
          <h1 id="upload-title">Resmî şartname belgesini yükleyin</h1>
          <p>Buraya katılımcı projesi değil; rapor kurallarını, zorunlu başlıkları ve teknik gereksinimleri anlatan şartname PDF&apos;si yüklenir. Tek yüklenen belge budur; ayrı bir rapor şablonu istenmez.</p>
        </div>
        <span className="step-fraction">1 / 3</span>
      </div>

      <div className="source-explainer">
        <span className="explainer-mark">K</span>
        <div>
          <strong>Belge tek AI çağrısıyla dört aşamaya göre okunur.</strong>
          <p>
            {CHECK_STAGES.map((stage) => `${stage.order}. ${stage.title}`).join(" · ")}. Puan tabloları ve saha aşaması kuralları kriter yapılmaz; hiçbir çıkarım yönetici onayı olmadan yayımlanmaz.
          </p>
        </div>
        <span className="draft-safe-note">Geri dönerseniz seçilen belge ve analiz taslağı korunur.</span>
      </div>

      <div className="upload-layout source-only">
        <div
          className={`drop-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            accept(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => accept(event.target.files?.[0])}
          />
          {file ? (
            <div className="selected-file">
              <FileBadge fileName={file.name} mimeType={file.type} size="lg" />
              <div>
                <span>Analize hazır</span>
                <strong>{file.name}</strong>
                <small>{formatBytes(file.size)} · Kaynak belge</small>
              </div>
              <button type="button" className="text-button" onClick={() => inputRef.current?.click()}>Değiştir</button>
            </div>
          ) : (
            <div className="empty-upload">
              <div className="upload-symbol" aria-hidden="true">↑</div>
              <h2>PDF’yi buraya bırakın</h2>
              <p>veya bilgisayarınızdan resmî şartnameyi seçin</p>
              <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>PDF seç</button>
            </div>
          )}
        </div>
      </div>

      <section className="library-shortcut" aria-labelledby="library-shortcut-title">
        <div>
          <h2 id="library-shortcut-title">Belge havuzu</h2>
          <p>
            {SAMPLE_DOCUMENTS.length} hazır test belgesi ve havuza eklediğiniz şartname, kılavuz,
            referans dokümanları. Yeni belgeleri buradan ekleyip kaynak olarak seçebilirsiniz.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setLibraryOpen(true)}>
          Belge havuzunu aç
        </button>
      </section>

      <DocumentLibraryModal
        open={libraryOpen}
        usage="kriter"
        selectedFile={file}
        onClose={() => setLibraryOpen(false)}
        onSelect={onFile}
        onSelectSample={onSample}
      />

      {error ? (
        <div className="inline-error analysis-error" role="alert">
          <strong>Belge analiz edilemedi.</strong>
          <span>{error}</span>
          {/* Sistem kendiliğinden ikinci bir AI çağrısı yapmaz; tekrar denemeye kullanıcı karar verir. */}
          {errorRetryable && file && !loading ? (
            <button type="button" className="secondary-button" onClick={onAnalyze}>Yeniden dene</button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="analysis-progress" role="status" aria-live="polite">
          <span className="progress-spinner" />
          <div><strong>Belge anlamlandırılıyor</strong><p>{loadingMessage}</p></div>
          <div className="progress-line"><span /></div>
        </div>
      ) : null}

      <div className="workspace-actions">
        <span className="source-limit-note">Kaynak PDF analiz motoru için teknik yükleme sınırı: 18 MB.</span>
        {/*
          YENİDEN ANALİZ (madde 1): kayıtlı sonuç atlanır, model gerçekten
          yeniden çalışır ve yeni sonuç eski kaydın üzerine yazılır. Sonuç
          hatalıysa yönetici bu düğmeyle kaydı tazeler.
        */}
        <button type="button" className="secondary-button" disabled={!file || loading} onClick={onReanalyze}>
          Yeniden analiz et
        </button>
        <button type="button" className="primary-button" disabled={!file || loading} onClick={onAnalyze}>
          {analysisReady ? "Mevcut analize dön" : "Belgeyi analiz et"} <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

function CriteriaReview({
  setup,
  sourceName,
  pageCount,
  analysisWarnings,
  documentUrl,
  editingPublished,
  cacheNotice,
  criteria,
  setCriteria,
  onBack,
  onApprove,
  onReanalyze,
  publishing,
  approvalError,
}: {
  setup: SetupData;
  /** Kaynak şartnamenin adı; geçmiş profil düzenlenirken kayıttan gelir. */
  sourceName: string;
  pageCount: number;
  analysisWarnings: string[];
  /**
   * Kaynak şartnamenin açılabileceği adres.
   *
   * Öncelik bu oturumdaki yerel dosyanın nesne URL'idir (anında açılır);
   * profil geçmişten açıldığında yerel dosya yoktur ve sunucudaki kopya
   * kullanılır (`/api/profiles/{id}/file`). İkisi de yoksa boştur ve
   * bağlantı yerine "kaynak belge kayıtlı değil" notu gösterilir.
   */
  documentUrl: string;
  /**
   * Bu proje daha önce kaydedilmiş mi?
   *
   * false → ilk analiz; ana eylem "Kriterleri Oluştur" (yeni profil yazılır).
   * true  → kayıtlı profil düzenleniyor; ana eylem "Değişiklikleri Kaydet"
   *         ve yapay zekâ TEKRAR ÇALIŞTIRILMAZ; form doğrudan aynı profil
   *         kimliğiyle veri tabanına yazılır.
   */
  editingPublished: boolean;
  /** Sonuç kalıcı analiz kaydından geldiyse gösterilen bilgi notu; taze analizde boş. */
  cacheNotice: string;
  criteria: Criterion[];
  setCriteria: (criteria: Criterion[]) => void;
  onBack: () => void;
  onApprove: () => void;
  /** Kayıtlı analizi atlayıp şartnameyi baştan analiz eder; kaynak PDF elde ise açıktır. */
  onReanalyze: (() => void) | null;
  publishing: boolean;
  approvalError: string;
}) {
  const [selectedId, setSelectedId] = useState(criteria[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  /** Açık olan kriter ekleme formu; kapalıyken null. */
  const [draft, setDraft] = useState<CriterionDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** Yayın öncesi ikinci kesinleştirme penceresi. */
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const selected = criteria.find((item) => item.id === selectedId) ?? criteria[0];
  // Pasif kriter yoktur: listedeki her kriter yayımlanır. Yönetici istemediği
  // kriteri siler; "aktif/pasif" ikilemi ve yarı yayımlanmış set kaldırıldı.
  const active = criteria;
  const requiredCount = active.filter((item) => item.required).length;
  const otherCount = active.length - requiredCount;
  const stageCounts = CHECK_STAGES.map((stage) => ({ stage, count: active.filter((item) => item.stage === stage.id).length }));
  const missingSource = active.filter((item) => item.sourcePage === null).length;

  const filtered = criteria.filter((item) => {
    const queryMatch = !query.trim()
      || `${item.name} ${item.description} ${item.sourceText}`.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR"));
    const stageMatch = stageFilter === "all" || item.stage === stageFilter;
    return queryMatch && stageMatch;
  });
  const stageOrder = (item: Criterion) => checkStageOf(item.stage).order;
  const byStageThenPage = (left: Criterion, right: Criterion) => (
    stageOrder(left) - stageOrder(right)
    || (left.sourcePage ?? Number.MAX_SAFE_INTEGER) - (right.sourcePage ?? Number.MAX_SAFE_INTEGER)
  );
  // Yalnızca İKİ grup gösterilir: Zorunlu ve Zorunlu olmayan (madde 1).
  // İki bölüm her zaman birlikte listelenir; zorunluluğa göre filtre yoktur.
  const groups: Array<{ id: CriterionKind; title: string; hint: string; items: Criterion[] }> = [
    {
      id: "required",
      title: "Zorunlu kriterler",
      hint: "Değerlendirmede zorunlu tutulur.",
      items: filtered.filter((item) => item.required).sort(byStageThenPage),
    },
    {
      id: "other",
      title: "Zorunlu olmayan kriterler",
      hint: "Değerlendirmede zorunlu tutulmaz.",
      items: filtered.filter((item) => !item.required).sort(byStageThenPage),
    },
  ];

  const canApprove = reviewConfirmed && active.length > 0 && !publishing;

  function update(patch: Partial<Criterion>) {
    if (!selected) return;
    setCriteria(criteria.map((item) => {
      if (item.id !== selected.id) return item;
      const next = { ...item, ...patch };
      /*
       * Denetlenebilirlik arayüzden SEÇİLMEZ ve gösterilmez; sistem otomatik
       * belirler. AI kriterlerinde modelin işaretlediği değer korunur; manuel
       * kriterde metin değiştikçe yeniden hesaplanır (video/portal/saha
       * ifadeleri arka planda PDF dışı sınıflandırılır).
       */
      if (next.origin === "manager" && (patch.name !== undefined || patch.description !== undefined)) {
        next.verifiability = resolveVerifiability(undefined, next.name, next.sourceText, next.description);
      }
      return next;
    }));
    setReviewConfirmed(false);
  }

  /** İlgili ekleme düğmesi kriter giriş formunu açar; kayıt "Ekle" ile olur. */
  function openDraft(kind: CriterionKind) {
    setDraft((current) => current?.kind === kind ? null : emptyDraft(kind));
    setDraftError("");
    setConfirmingDelete(false);
    requestAnimationFrame(() => document.getElementById("criterion-draft")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    const description = draft.description.trim();
    if (!name) { setDraftError("Kriter adı zorunludur."); return; }
    if (!description) { setDraftError("Kural açıklaması zorunludur; hakem bu metne göre değerlendirir."); return; }
    const added: Criterion = {
      id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.slice(0, 200),
      stage: draft.stage,
      required: draft.kind === "required",
      description: description.slice(0, 1200),
      sourceId: null,
      sourceIds: [],
      controlType: draft.controlType,
      sourcePage: null,
      sourceText: "",
      verifiability: resolveVerifiability(undefined, name, "", description),
      active: true,
      origin: "manager",
    };
    setCriteria([...criteria, added]);
    setSelectedId(added.id);
    setDraft(null);
    setDraftError("");
    setStageFilter("all");
    setQuery("");
    setReviewConfirmed(false);
    requestAnimationFrame(() => document.getElementById("criterion-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function removeSelectedCriterion() {
    if (!selected) return;
    const remaining = criteria.filter((item) => item.id !== selected.id);
    setCriteria(remaining);
    setSelectedId(remaining[0]?.id ?? "");
    setConfirmingDelete(false);
    setReviewConfirmed(false);
  }

  function renderRow(item: Criterion) {
    return (
      <button
        key={item.id}
        type="button"
        role="option"
        aria-selected={item.id === selected?.id}
        className={`criterion-row ${item.id === selected?.id ? "selected" : ""}`}
        onClick={() => {
          setSelectedId(item.id);
          setConfirmingDelete(false);
          requestAnimationFrame(() => document.getElementById("criterion-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }}
      >
        <span className={`type-mark stage-${checkStageOf(item.stage).order}`} aria-hidden="true" />
        <span className="criterion-main">
          <strong>{item.name}</strong>
          <small>
            {stageBadge(item.stage)}
            {/*
              Kaynak sayfa bilgi değil BAĞLANTIDIR: tıklayınca şartname PDF'i
              o sayfada açılır. Satır bir <button> olduğu için bağlantının
              tıklaması satır seçimini tetiklememeli — olay durdurulur.
            */}
            {item.sourcePage ? (
              documentUrl ? (
                <>
                  {" · "}
                  <a
                    className="source-page-link"
                    href={`${documentUrl}#page=${item.sourcePage}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    title="Şartnameyi bu sayfada aç"
                  >Kaynak s. {item.sourcePage} ↗</a>
                </>
              ) : ` · Kaynak s. ${item.sourcePage}`
            ) : " · Kaynak sayfa girilmedi"}
            {item.origin === "manager" ? " · Yönetici ekledi" : ""}
          </small>
        </span>
        {/*
          Satırda yalnızca dört bilgi bulunur: kriter adı, analiz aşaması,
          kaynak sayfa bağlantısı ve zorunlu/zorunlu olmayan durumu. Başka
          uygulanabilirlik/denetlenebilirlik rozeti GÖSTERİLMEZ (madde 1).
        */}
        <span className={`criterion-value ${item.required ? "required" : "other"}`}>
          {item.required ? "Zorunlu" : "Zorunlu olmayan"}
        </span>
      </button>
    );
  }

  return (
    <section className="workspace review-workspace" aria-labelledby="review-title">
      <div className="review-heading">
        <div>
          <span className="section-kicker">{editingPublished ? "Kayıtlı profil · düzenleme" : "Belgeden çıkarılan kriterler"}</span>
          <h1 id="review-title">{editingPublished ? "Kriterleri düzenleyin ve kaydedin" : "Kriterleri doğrulayın ve kesinleştirin"}</h1>
          <p>{sourceName} · {pageCount} sayfa · {setup.competition} · Her kriter kaynak sayfasıyla birlikte gösteriliyor.</p>
        </div>
        <span className="step-fraction">2 / 3</span>
      </div>

      <div className="analysis-summary" aria-label="Kriter özeti">
        <div><strong>{requiredCount}</strong><span>zorunlu</span></div>
        <div><strong>{otherCount}</strong><span>zorunlu olmayan</span></div>
        <div><strong>{active.length}</strong><span>toplam kriter</span></div>
        {stageCounts.map(({ stage, count }) => (
          <div key={stage.id} title={stage.detail}><strong>{count}</strong><span>{stage.order}. {stage.shortTitle}</span></div>
        ))}
        {missingSource ? <div className="summary-warning"><strong>{missingSource}</strong><span>kaynak sayfası eksik</span></div> : null}
      </div>

      {editingPublished ? (
        <p className="page-note" role="status">
          Bu profil daha önce kaydedildi. <strong>Değişiklikleri Kaydet</strong> yapay zekâyı yeniden
          çalıştırmaz; formdaki güncel kriterler aynı profil kimliğiyle veri tabanına yazılır ve
          mevcut başvurular güncel kriter setine bağlı kalır.
        </p>
      ) : null}

      {/* Not yalnızca taze bir önbellek isabetini anlatır; yayımlanmış profil
          düzenlenirken bağlam değiştiği için gösterilmez. */}
      {cacheNotice && !editingPublished ? (
        <p className="page-note cache-notice" role="status">
          {cacheNotice}
          {onReanalyze ? (
            <button type="button" className="text-button" onClick={onReanalyze}>Yeniden analiz et</button>
          ) : null}
        </p>
      ) : null}

      {analysisWarnings.length ? (
        <ul className="analysis-warning-list" role="status">
          {analysisWarnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}

      <div className="review-grid">
        <div className="criteria-ledger" id="criteria-list">
          <div className="criteria-section-heading">
            <div><h2>Kriter listesi</h2><p>AI çıkarımlarını düzeltin, gereksizleri silin veya belgedeki eksik bir kriteri kendiniz ekleyin.</p></div>
            {/*
              Kriter ya ZORUNLU ya ZORUNLU OLMAYANdır. İki bağımsız düğme,
              ilgili türde bir giriş formu açar; tür formun içinde
              değiştirilemez, hangi düğmeye basıldıysa o olur.
            */}
            <div className="add-criterion-group">
              <button
                type="button"
                className={`secondary-button add-criterion-button ${draft?.kind === "required" ? "active" : ""}`}
                aria-expanded={draft?.kind === "required"}
                onClick={() => openDraft("required")}
              >
                <span aria-hidden="true">＋</span>
                <span><strong>Zorunlu Kriter Ekle</strong><small>Değerlendirmede zorunlu tutulur</small></span>
              </button>
              <button
                type="button"
                className={`secondary-button add-criterion-button ${draft?.kind === "other" ? "active" : ""}`}
                aria-expanded={draft?.kind === "other"}
                onClick={() => openDraft("other")}
              >
                <span aria-hidden="true">＋</span>
                <span><strong>Zorunlu Olmayan Kriter Ekle</strong><small>Değerlendirmede zorunlu tutulmaz</small></span>
              </button>
            </div>
          </div>

          {draft ? (
            <div className={`criterion-draft ${draft.kind}`} id="criterion-draft" role="group" aria-label="Yeni kriter">
              <div className="criterion-draft-head">
                <strong>{draft.kind === "required" ? "Yeni zorunlu kriter" : "Yeni zorunlu olmayan kriter"}</strong>
                <span>{draft.kind === "required" ? "Zorunlu" : "Zorunlu olmayan"}</span>
              </div>
              <div className="form-grid two-col">
                <Field label="Kriter adı">
                  <input
                    value={draft.name}
                    maxLength={200}
                    placeholder="Örn. Rapor dili Türkçe"
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </Field>
                <Field label="Kontrol aşaması" hint={checkStageOf(draft.stage).detail}>
                  <select value={draft.stage} onChange={(event) => {
                    const stage = event.target.value as CheckStage;
                    setDraft({ ...draft, stage, controlType: controlTypeForStage(stage) });
                  }}>
                    {CHECK_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.order}. {stage.title}</option>)}
                  </select>
                </Field>
                <Field label="Kontrol biçimi">
                  <select value={draft.controlType} onChange={(event) => setDraft({ ...draft, controlType: event.target.value as CriterionControlType })}>
                    {criterionControlTypesForStage(draft.stage).map((value) => <option key={value} value={value}>{CONTROL_TYPE_LABELS[value]}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Kural açıklaması" hint="Koşul ve raporda ne aranacağı tek anlamlı yazılmalı; rapor değerlendirmesinde bu metin kullanılır.">
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Örn. Rapor Türkçe yazılmalıdır; başka dilde yazılan rapor değerlendirmeye alınmaz."
                />
              </Field>
              <p className="page-note">Yönetici tarafından eklenen kriter manuel olarak işaretlenir; sistem sahte kaynak sayfası veya alıntı üretmez.</p>
              {draftError ? <p className="approval-error" role="alert">{draftError}</p> : null}
              <div className="criterion-draft-actions">
                <button type="button" className="text-button" onClick={() => { setDraft(null); setDraftError(""); }}>Vazgeç</button>
                <button type="button" className="primary-button" onClick={saveDraft}>
                  {draft.kind === "required" ? "Zorunlu kriteri ekle" : "Zorunlu olmayan kriteri ekle"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="ledger-tools two-col">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kriter, açıklama veya alıntı ara" aria-label="Kriter ara" />
            </label>
            <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as StageFilter)} aria-label="Aşamaya göre filtrele">
              <option value="all">Tüm aşamalar</option>
              {CHECK_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.order}. {stage.title}</option>)}
            </select>
          </div>
          {groups.map((group) => (
            <section key={group.id} className="ledger-group" aria-labelledby={`ledger-group-${group.id}`}>
              <div className="ledger-group-heading">
                <h3 id={`ledger-group-${group.id}`}>{group.title}</h3>
                <span>{group.items.length} kriter · {group.hint}</span>
              </div>
              <div className="ledger-list" role="listbox" aria-label={group.title}>
                {group.items.map(renderRow)}
                {!group.items.length ? <div className="empty-ledger">Bu bölümde kriter yok.</div> : null}
              </div>
            </section>
          ))}
        </div>

        {selected ? (
          <div className="criterion-inspector" id="criterion-detail">
            <div className="inspector-title">
              <div><span>Seçili kriter</span><h2>{selected.name}</h2></div>
              <a href="#criteria-list">Kriter listesine dön ↑</a>
            </div>
            <div className="inspector-topline">
              <div>
                {stageBadge(selected.stage)}
                <span className={`required-chip ${selected.required ? "required" : "other"}`}>{selected.required ? "Zorunlu" : "Zorunlu olmayan"}</span>
                <span className="origin-label">{selected.origin === "document" ? "AI tarafından belgeden çıkarıldı" : "Yönetici tarafından eklendi"}</span>
              </div>
            </div>

            <div className="inspector-section edit-section">
              <span className="inspector-label">Kriter tanımı</span>
              <div className="form-grid two-col">
                <Field label="Kriter adı">
                  <input value={selected.name} onChange={(event) => update({ name: event.target.value })} />
                </Field>
                <Field label="Kontrol aşaması" hint={checkStageOf(selected.stage).detail}>
                  <select value={selected.stage} onChange={(event) => {
                    const stage = event.target.value as CheckStage;
                    update({ stage, controlType: controlTypeForStage(stage) });
                  }}>
                    {CHECK_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.order}. {stage.title}</option>)}
                  </select>
                </Field>
                <Field label="Kuralın önemi" hint="Bağlayıcı kurallar mutlaka karşılanmalı; tavsiye ve beklentiler iyileştirme olarak izlenir.">
                  <select value={selected.required ? "required" : "other"} onChange={(event) => update({ required: event.target.value === "required" })}>
                    <option value="required">Mutlaka karşılanmalı</option>
                    <option value="other">İyileştirme bekleniyor</option>
                  </select>
                </Field>
                {/*
                  PDF'den denetlenebilirlik alanı ARAYÜZDE YOKTUR (madde 1):
                  sistem, kriter metninden otomatik belirler ve yalnızca PDF
                  dışı kuralların hakem rapor analizine gönderilmesini
                  engellemek için kullanır. Kullanıcı seçemez ve düzenleyemez.
                */}
                <Field label="Kontrol biçimi">
                  <select value={selected.controlType ?? controlTypeForStage(selected.stage)} onChange={(event) => update({ controlType: event.target.value as CriterionControlType })}>
                    {criterionControlTypesForStage(selected.stage).map((value) => <option key={value} value={value}>{CONTROL_TYPE_LABELS[value]}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Kural açıklaması" hint="Koşul ve raporda ne aranacağı tek anlamlı yazılmalı; rapor değerlendirmesinde bu metin kullanılır.">
                <textarea value={selected.description} onChange={(event) => update({ description: event.target.value })} />
              </Field>
            </div>

            <div className="inspector-section evidence-section">
              <div className="inspector-section-heading">
                <span className="inspector-label">Belgedeki dayanak</span>
                {selected.sourcePage && documentUrl ? (
                  <a className="source-page-link" href={`${documentUrl}#page=${selected.sourcePage}`} target="_blank" rel="noreferrer">Kaynak sayfayı aç · s. {selected.sourcePage} ↗</a>
                ) : selected.sourcePage ? (
                  <span title="Şartname PDF'i sunucuda saklanmamış; kriterleri yeniden yayımlayın.">Kaynak s. {selected.sourcePage} · belge kayıtlı değil</span>
                ) : <span>Kaynak sayfa girilmedi</span>}
              </div>
              {/*
                KAYNAK KİLİDİ (madde 12)
                Kaynak sayfa ve kaynak alıntı AI'nin belgeden çıkardığı kanıttır
                ve elle DEĞİŞTİRİLEMEZ; salt okunur gösterilir. Sunucu da aynı
                kuralı uygular: istek elle düzenlense bile ilk yayımdaki değer
                geri konur. Kaynak yanlışsa çözüm "Yeniden analiz et" ya da
                kriteri silip yerine yenisini oluşturmaktır.
              */}
              <div className="manual-evidence-grid locked-evidence-grid">
                <div className="field locked-field">
                  <span className="field-label">Kaynak PDF sayfası</span>
                  <output className="locked-value">
                    {selected.sourcePage ?? (selected.origin === "manager" ? "Manuel kriter · kaynak yok" : "Kaynak sayfa yok")}
                  </output>
                  <span className="field-hint">Salt okunur. Değiştirilemez.</span>
                </div>
                <div className="field locked-field">
                  <span className="field-label">Kaynak alıntı</span>
                  <output className="locked-value locked-quote">
                    {selected.sourceText || (selected.origin === "manager" ? "Manuel kriter · alıntı yok" : "Alıntı yok")}
                  </output>
                  <span className="field-hint">Salt okunur. Değiştirilemez.</span>
                </div>
              </div>
              <p className="locked-evidence-note">
                Kaynak sayfa ve alıntı yapay zekânın belgeden çıkardığı kanıttır; düzenlenemez.
                Kaynak yanlışsa <strong>şartnameyi yeniden analiz edin</strong> veya bu kriteri silip
                doğru kaynağıyla yeni bir kriter oluşturun.
              </p>
            </div>

            <div className="inspector-section delete-section">
              <span className="inspector-label">Kriteri kaldır</span>
              {confirmingDelete ? (
                <div className="delete-confirm-row" role="alertdialog" aria-label="Kriter silme onayı">
                  <p><strong>“{selected.name}”</strong> listeden kalıcı olarak silinecek. Emin misiniz?</p>
                  <div>
                    <button type="button" className="danger-button" onClick={removeSelectedCriterion}>Evet, kriteri sil</button>
                    <button type="button" className="text-button" onClick={() => setConfirmingDelete(false)}>Vazgeç</button>
                  </div>
                </div>
              ) : (
                <div className="delete-confirm-row">
                  <p>Yanlış çıkarılan veya bu yarışmada uygulanmayacak kriterleri silin. Yayımlanan sette pasif kriter bulunmaz: listede kalan her kriter değerlendirmede kullanılır.</p>
                  <div>
                    <button type="button" className="danger-button ghost" onClick={() => setConfirmingDelete(true)}>Kriteri sil</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="approval-bar">
        <button type="button" className="icon-back" onClick={onBack} aria-label="Kaynak belgeye dön · taslak korunur" title="Kaynak belgeye dön · taslak korunur"><span aria-hidden="true">←</span></button>
        <div className="approval-check">
          <label>
            <input
              type="checkbox"
              checked={reviewConfirmed}
              onChange={(event) => { setReviewConfirmed(event.target.checked); setConfirmingPublish(false); }}
            />
            <span>Zorunlu ve zorunlu olmayan kriterleri, aşamalarını ve kaynak sayfalarını inceledim.</span>
          </label>
          {!canApprove ? (
            <small>
              {active.length === 0 && "En az bir kriter gerekli. "}
              {!reviewConfirmed && "Yönetici kontrolünü onaylayın."}
            </small>
          ) : <small className="ready-note">{editingPublished ? "Değişiklikler kaydedilmeye hazır." : "Profil yayıma hazır."}</small>}
          {approvalError ? <small className="approval-error" role="alert">{approvalError}</small> : null}
        </div>
        {/* Etiket projenin durumuna göre değişir: ilk analizde oluşturma, kayıtlı profilde güncelleme. */}
        <button type="button" className="primary-button" disabled={!canApprove} onClick={() => setConfirmingPublish(true)}>
          {editingPublished ? "Değişiklikleri Kaydet" : "Kriterleri Oluştur"} <span>→</span>
        </button>
      </div>

      {/*
        İkinci kesinleştirme: onay kutusu yanlışlıkla işaretlenmiş olabilir.
        Yayımlanan profil aynı anda hakem değerlendirme sistemine aktarılır ve
        yarışma başvuruya açılır; bu yüzden geri dönüşü olmayan bir adımdır.
      */}
      {confirmingPublish ? (
        <div className="publish-confirm-backdrop" role="presentation" onClick={() => setConfirmingPublish(false)}>
          <div
            className="publish-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="publish-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="publish-confirm-title">
              {editingPublished ? "Değişiklikler kaydedilsin mi?" : "Kriter profili yayımlansın mı?"}
            </h2>
            <p>
              <strong>{setup.competition}</strong> için {active.length} kriter ({requiredCount} zorunlu, {otherCount} zorunlu olmayan)
              {editingPublished
                ? " veri tabanına yazılacak. Yapay zekâ yeniden çalıştırılmaz; yalnızca formdaki güncel kriterler kaydedilir."
                : " yayımlanacak. Profil yayımlandığı anda hakem değerlendirme sistemine aktarılır ve yarışma yarışmacı portalında başvuruya açılır."}
            </p>
            {missingSource ? (
              <p className="publish-confirm-warning">
                {missingSource} kriterin kaynak sayfası boş. İsterseniz vazgeçip kaynak sayfalarını tamamlayabilirsiniz.
              </p>
            ) : null}
            {editingPublished ? (
              <p className="publish-confirm-warning">
                Bu bir GÜNCELLEMEDİR: kayıt aynı profil kimliğiyle değiştirilir, yeni bir profil oluşmaz.
              </p>
            ) : null}
            <div className="publish-confirm-actions">
              <button type="button" className="text-button" disabled={publishing} onClick={() => setConfirmingPublish(false)}>Vazgeç</button>
              <button type="button" className="primary-button" disabled={publishing} onClick={onApprove}>
                {publishing
                  ? (editingPublished ? "Kaydediliyor…" : "Yayımlanıyor…")
                  : (editingPublished ? "Evet, kaydet" : "Evet, yayımla")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ProfileReady({
  profile,
  summary,
  onEdit,
  onRestart,
}: {
  profile: ProfileExport;
  /** Yayımın sürüm künyesi; kriter sürümleri değişmezdir (madde 2). */
  summary: { version: number; created: boolean; sourceLockWarning: string } | null;
  onEdit: () => void;
  onRestart: () => void;
}) {
  // Pasif kriter yoktur; profildeki her kriter değerlendirmede kullanılır.
  const active = profile.criteria;
  const requiredCount = active.filter((item) => item.required).length;
  const stageCounts = CHECK_STAGES.map((stage) => ({ stage, count: active.filter((item) => item.stage === stage.id).length }));

  function downloadProfile() {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.setup.year}-${profile.setup.competition.replace(/\s+/g, "-").toLocaleLowerCase("tr-TR")}-profil-v2.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace ready-workspace" aria-labelledby="ready-title">
      <div className="ready-hero">
        <span className="approval-seal" aria-hidden="true">✓</span>
        <span className="section-kicker">Profil yayımlandı</span>
        <h1 id="ready-title">Kriter seti değerlendirmeye hazır</h1>
        <p>
          {profile.setup.competition} · {profile.setup.reportType} için doğruladığınız dört aşamalı kriter seti yayımlandı ve
          hakem değerlendirme sistemine aktarıldı. Yarışma yarışmacı portalında başvuruya açıldı; hakemler
          katılımcı raporlarını yalnızca bu sürümlü profile göre değerlendirebilir.
        </p>
        <div className="ready-actions">
          <button type="button" className="primary-button" onClick={downloadProfile}>Profil JSON’unu indir</button>
          <button type="button" className="secondary-button" onClick={onEdit}>Kriterleri düzenle</button>
        </div>
      </div>

      {summary?.sourceLockWarning ? (
        <div className="inline-error" role="alert">
          <strong>Kaynak alanları değiştirilemez.</strong>
          <span>{summary.sourceLockWarning} Kaynak yanlışsa şartnameyi yeniden analiz edin ya da kriteri silip yenisini oluşturun.</span>
        </div>
      ) : null}

      {summary ? (
        <p className="page-note" role="status">
          {summary.created
            ? `Kriter sürümü v${summary.version} yayımlandı. Hakem analizleri bu sürümü kullanır; önceki sürümler geçmiş değerlendirmeler için değişmeden saklanır.`
            : `Kriter içeriği değişmediği için yeni sürüm açılmadı; yürürlükteki sürüm v${summary.version} olarak kaldı.`}
        </p>
      ) : null}

      <div className="profile-sheet">
        <div className="profile-sheet-header">
          <div><span>Profil kimliği</span><strong>{profile.setup.year} / {profile.setup.stage} / v2.0{summary ? ` · kriter sürümü v${summary.version}` : ""}</strong></div>
          <span className="status-chip success">Yayında</span>
        </div>
        <dl className="profile-facts">
          <div><dt>Yarışma</dt><dd>{profile.setup.competition}</dd></div>
          <div><dt>Kategori</dt><dd>{profile.setup.category}</dd></div>
          <div><dt>Rapor</dt><dd>{profile.setup.reportType}</dd></div>
          <div><dt>Rapor dili</dt><dd>{profile.setup.reportLanguage || "Belgede belirtilmemiş"}</dd></div>
          <div><dt>Kaynak</dt><dd>{profile.sourceDocument.name}</dd></div>
        </dl>
        <div className="profile-metrics">
          <div><strong>{active.length}</strong><span>toplam kriter</span></div>
          <div><strong>{requiredCount}</strong><span>zorunlu</span></div>
          <div><strong>{active.length - requiredCount}</strong><span>zorunlu olmayan</span></div>
          <div><strong>{profile.sourceDocument.pages}</strong><span>kaynak sayfa</span></div>
        </div>
        <div className="profile-footer-note">
          <span>Aşama dağılımı</span>
          <p>{stageCounts.map(({ stage, count }) => `${stage.order}. ${stage.title}: ${count}`).join(" · ")}</p>
        </div>
        <div className="profile-footer-note">
          <span>Sonraki adım</span>
          <p>
            Katılımcı raporları bu profile göre dört aşamada kontrol edilir; her kural için BAŞARILI / REVİZYON / KRİTİK HATA durumu, rapordan sayfa/paragraf alıntısı ve gerekçe üretilir. Kriter değişikliği gerekiyorsa Yarışma Yöneticisi
            profili yeniden düzenleyip yeni sürüm olarak yayımlar.{" "}
            <Link className="next-module-link" href="/">Yönetim paneline dön →</Link>
          </p>
        </div>
      </div>

      <button type="button" className="restart-link" onClick={onRestart}>Yeni bir değerlendirme profili oluştur</button>
    </section>
  );
}

export default function CriteriaApp() {
  const [step, setStep] = useState<Step>(1);
  const [setup, setSetup] = useState<SetupData>(DEFAULT_SETUP);
  const [file, setFile] = useState<File | null>(null);
  const [documentUrl, setDocumentUrl] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [profile, setProfile] = useState<ProfileExport | null>(null);
  /**
   * Kriter Geçmişi'nden açılan yayımlanmış profil (`/kriter-atolyesi?profile=<id>`).
   * Kaynak PDF elde olmasa da kriterler düzenlenip yeniden yayımlanabilir; profil
   * kimliği korunur, bu yüzden D1'de ikinci bir "yürürlükte" satır oluşmaz.
   */
  const [editedProfile, setEditedProfile] = useState<ProfileExport | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState("");
  const [errorRetryable, setErrorRetryable] = useState(false);
  /** Sonuç kayıttan geldiyse (önbellek isabeti) inceleme adımında gösterilen bilgi notu. */
  const [cacheNotice, setCacheNotice] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  /** Son yayımın sürüm künyesi ve varsa kaynak kilidi uyarısı. */
  const [publishSummary, setPublishSummary] = useState<{
    version: number;
    created: boolean;
    sourceLockWarning: string;
  } | null>(null);
  const draftScope = editingProfileId ? `profile:${editingProfileId}` : "workspace";

  const backgroundLabel = useMemo(
    () => result || editedProfile ? `${setup.competition} · ${setup.reportType}` : "Organizatör PDF'si bekleniyor",
    [editedProfile, result, setup],
  );

  useEffect(() => {
    let active = true;

    /**
     * Geçmişten açılan profil taslaktan önceliklidir: yönetici "düzenle"ye
     * bastığında Kriter Atölyesi doğrudan o profilin kriterleriyle açılır.
     */
    async function restorePublishedProfile(profileId: string): Promise<boolean> {
      try {
        const stored = await workflowApi.profile(profileId);
        if (!active) return true;
        const loaded = stored.profile.profile;
        setEditedProfile(loaded);
        setSetup(loaded.setup);
        setCriteria(loaded.criteria);
        setProfile(null);
        setResult(null);
        setStep(2);
        setError("");
        return true;
      } catch (caught) {
        if (!active) return true;
        setError(caught instanceof Error ? caught.message : "Yayımlanmış profil açılamadı.");
        setStep(1);
        return false;
      }
    }

    async function restoreDraft() {
      const profileId = new URLSearchParams(window.location.search).get("profile");
      if (profileId) {
        setEditingProfileId(profileId);
        await restorePublishedProfile(profileId);
        if (active) setDraftReady(true);
        return;
      }
      const snapshot = loadDraftSnapshot("workspace");
      const storedFile = await loadDraftFile("workspace");
      // Eski sürümde saklanmış rapor şablonu artık kullanılmıyor; tarayıcıdan silinir.
      clearLegacyTemplateFile().catch(() => undefined);
      if (!active) return;
      if (snapshot) {
        setSetup(snapshot.result?.setup ?? snapshot.setup ?? DEFAULT_SETUP);
        setResult(snapshot.result);
        setCriteria(snapshot.criteria);
        setProfile(snapshot.profile);
      }
      if (storedFile) {
        setFile(storedFile);
        setDocumentUrl(URL.createObjectURL(storedFile));
      }
      // Kaynak PDF tarayıcı deposundan geri gelmediyse inceleme/yayın adımı
      // açılamaz; taslak korunur, belge yeniden seçilince analiz tekrar edilir.
      if (snapshot && !storedFile) {
        setStep(1);
        setError("Taslak bulundu ancak kaynak PDF tarayıcı deposunda yok. Aynı belgeyi yeniden seçip analiz edin.");
      } else {
        setStep(snapshot ? (snapshot.profile ? 3 : snapshot.result ? 2 : 1) : 1);
      }
      setDraftReady(true);
    }
    restoreDraft();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // Geçmişten açılan yayımlanmış profil yerel taslağın üstüne yazılmaz.
    if (!draftReady || editedProfile) return;
    saveDraftSnapshot({ step, setup, result, criteria, profile }, draftScope);
  }, [criteria, draftReady, draftScope, editedProfile, profile, result, setup, step]);

  useEffect(() => {
    if (!draftReady || editedProfile) return;
    saveDraftFile(file, draftScope).catch(() => undefined);
  }, [draftReady, draftScope, editedProfile, file]);

  function chooseFile(nextFile: File) {
    setError("");
    setErrorRetryable(false);
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
      setError("Kaynak değerlendirme belgesi PDF olmalıdır. Lütfen PDF biçiminde bir belge seçin.");
      return;
    }
    if (nextFile.size > 18 * 1024 * 1024) {
      setError("Kaynak belge 18 MB'den büyük. Bu sürümde daha küçük veya sıkıştırılmış bir PDF yükleyin.");
      return;
    }
    if (documentUrl) URL.revokeObjectURL(documentUrl);
    setFile(nextFile);
    setDocumentUrl(URL.createObjectURL(nextFile));
    setResult(null);
    setCriteria([]);
    setProfile(null);
    setEditedProfile(null);
    setEditingProfileId(null);
    setCacheNotice("");
  }

  async function analyze(forceRefresh = false) {
    if (!file || loading) return;
    // Yeniden analizde kayıtlı sonuca dönülmez; model gerçekten yeniden çalışır.
    if (!forceRefresh && result && criteria.length) {
      setStep(2);
      return;
    }
    setLoading(true);
    setError("");
    setErrorRetryable(false);
    try {
      setLoadingMessage("PDF sayfa yapısı doğrulanıyor…");
      const pageCount = await getPdfPageCount(file);
      setLoadingMessage(forceRefresh
        ? "Kayıtlı sonuç atlanıyor; belge baştan analiz ediliyor…"
        : "Belge yapısal olarak taranıyor; güçlü adaylar tek AI çağrısıyla sınıflandırılıyor…");
      // Sunucu tek `generateContent` isteği yapar; burada da yeniden deneme yoktur.
      const analysis = await analyzeWithGemini(file, pageCount, forceRefresh);
      setLoadingMessage("Kriterler kaynak sayfalarıyla eşleştiriliyor…");
      if (!analysis.criteria.length) {
        throw new Error("Belgede PDF aşamasında kontrol edilebilecek bir kriter bulunamadı.");
      }
      setResult(analysis);
      setSetup(analysis.setup);
      setCriteria(analysis.criteria);
      setEditedProfile(null);
      // Önbellek isabetinde model hiç çağrılmaz; yönetici bunu açıkça görür.
      if (analysis.diagnostics?.cached) {
        let firstAnalyzed = "";
        if (analysis.diagnostics.firstAnalyzedAt) {
          const parsed = new Date(analysis.diagnostics.firstAnalyzedAt);
          if (!Number.isNaN(parsed.getTime())) {
            firstAnalyzed = parsed.toLocaleString("tr-TR", { dateStyle: "long", timeStyle: "short" });
          }
        }
        setCacheNotice(
          `Bu şartname daha önce analiz edilmişti${firstAnalyzed ? ` (ilk analiz: ${firstAnalyzed})` : ""}. `
          + "Kayıtlı sonuç gösterildi; yapay zekâ yeniden çalıştırılmadı ve token harcanmadı.",
        );
      } else {
        setCacheNotice("");
      }
      setStep(2);
    } catch (analysisError) {
      // Geçici model hatasında kullanıcıya "Yeniden dene" sunulur; sistem
      // kendiliğinden ikinci bir çağrı yapmaz.
      const retryable = analysisError instanceof AnalysisRequestError && analysisError.retryable;
      const message = analysisError instanceof Error ? analysisError.message : "Bilinmeyen bir hata oluştu.";
      setErrorRetryable(retryable);
      setError(retryable ? message : `${message} API bağlantısını, kotayı veya kaynak belgenin geçerliliğini kontrol edin.`);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Bu proje daha önce KAYDEDİLDİ mi?
   *   editedProfile  Kriter Geçmişi'nden açılmış, veri tabanında duran profil.
   *   profile        Bu oturumda yayımlanmış ve geri dönülüp düzenlenen profil.
   * İkisinden biri varsa ana eylem "Değişiklikleri Kaydet" olur ve yapay zekâ
   * yeniden çalıştırılmaz.
   */
  const savedBefore = Boolean(editedProfile ?? profile);

  /**
   * Kaynak şartnamenin açılacağı adres.
   *
   * Bu oturumda dosya elde ise nesne URL'i (anında açılır); değilse profil
   * yayımlanırken R2'ye yazılmış kopya. Eski profillerde kopya yoktur ve
   * bağlantı gösterilmez.
   */
  const sourceDocumentUrl = useMemo(() => {
    if (documentUrl) return documentUrl;
    const stored = editedProfile ?? profile;
    return stored?.profileId && stored.sourceDocument.fileKey
      ? workflowApi.profileFileUrl(stored.profileId)
      : "";
  }, [documentUrl, editedProfile, profile]);

  /** İnceleme adımının kaynak künyesi: taze analiz ya da geçmişten açılan profil. */
  const source = result && file
    ? { name: file.name, pages: result.pageCount, analyzedAt: result.analyzedAt, warnings: result.analysisWarnings }
    : editedProfile
      ? {
        name: editedProfile.sourceDocument.name,
        pages: editedProfile.sourceDocument.pages,
        analyzedAt: editedProfile.sourceDocument.analyzedAt,
        warnings: [] as string[],
      }
      : null;

  async function approve() {
    if (!source || publishing) return;
    setApprovalError("");
    setPublishing(true);
    const nextProfile: ProfileExport = {
      version: "2.0",
      status: "approved",
      // Aynı taslak veya yayımlanmış profil yeniden yayımlanıyorsa mevcut profil
      // kimliği korunur; D1'de ikinci bir "yürürlükte" satır oluşmaz ve eski
      // başvurular aynı profile bağlı kalır. Sunucu ayrıca `created_by`
      // sahipliğini doğrular: başka bir yöneticinin profili güncellenemez.
      profileId: profile?.profileId ?? editedProfile?.profileId
        ?? `profil-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      setup,
      sourceDocument: {
        name: source.name,
        pages: source.pages,
        analyzedAt: source.analyzedAt,
        ...((profile ?? editedProfile)?.sourceDocument.fileKey
          ? { fileKey: (profile ?? editedProfile)?.sourceDocument.fileKey }
          : {}),
      },
      templateProfile: result?.templateProfile ?? editedProfile?.templateProfile,
      // Pasif kriter yayımlanmaz: listedeki her kriter etkin olarak kaydedilir.
      criteria: criteria.map((item) => ({ ...item, active: true })),
    };
    try {
      // Kaynak şartname elde ise sunucuya da yazılır; kaynak sayfa bağlantısı
      // profil geçmişten açıldığında ancak bu kopya sayesinde çalışır.
      const published = await workflowApi.submitProfileForReview(nextProfile, file);
      localStorage.setItem("kriter-atolyesi:last-profile", JSON.stringify(published.profile.profile));
      setProfile(published.profile.profile);
      setPublishSummary({
        version: published.criteriaVersion?.criteriaVersion ?? 0,
        created: published.versionCreated === true,
        // Sunucu kaynak sayfa/alıntı değişikliğini geri aldıysa yönetici bunu görmeli:
        // alanlar salt okunurdur ve elle düzeltilemez (madde 12).
        sourceLockWarning: published.sourceLockWarning ?? "",
      });
      setEditedProfile(null);
      setStep(3);
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : "Profil yayımlanamadı. Bağlantıyı kontrol edip yeniden deneyin.");
    } finally {
      setPublishing(false);
    }
  }

  function restart() {
    if (documentUrl) URL.revokeObjectURL(documentUrl);
    setStep(1);
    setSetup(DEFAULT_SETUP);
    setFile(null);
    setDocumentUrl("");
    setResult(null);
    setCriteria([]);
    setProfile(null);
    setEditedProfile(null);
    setError("");
    setErrorRetryable(false);
    setCacheNotice("");
    setApprovalError("");
    setPublishSummary(null);
    clearDraftSnapshot(draftScope);
    saveDraftFile(null, draftScope).catch(() => undefined);
    setEditingProfileId(null);
    // Geçmiş profil düzenleme adresinden çıkılır; yenilemede taslak geri gelmesin.
    if (new URLSearchParams(window.location.search).has("profile")) {
      window.history.replaceState(null, "", "/kriter-atolyesi");
    }
  }

  const completedSteps = useMemo(() => {
    const completed = new Set<Step>();
    if ((result && file) || editedProfile) completed.add(1);
    if (profile) {
      completed.add(2);
      completed.add(3);
    }
    return completed;
  }, [editedProfile, file, profile, result]);

  function navigate(nextStep: Step) {
    if (nextStep === 2 && !source) return;
    if (nextStep === 3 && !profile) return;
    setStep(nextStep);
  }

  return (
    <main className="app-shell">
      {/*
        THESIS: Kaynak belge ile onaylı kural arasındaki zinciri tek çalışma masasında görünür kılar; genel dashboard düzenini reddeder.
        OWN-WORLD: Soğuk beyaz kâğıt yüzey, lacivert mürekkep, turkuaz kanıt bağlantıları ve sıkı belge satırları.
        STORY: Yönetici resmî PDF'yi yükler, dört aşamaya ayrılmış kuralları kaynaklarıyla düzeltir ve sürümlü profili yayımlar.
        FIRST VIEWPORT: Solda üç adımlı sabit süreç izi; ortada yalnızca kriter listesi ve seçili kriterin kanıt/düzenleme paneli.
        FORM: Operasyonel inceleme masası; belge defteri ve karar tutanağı biçimlerinin birleşimi.
      */}
      <StepRail step={step} completedSteps={completedSteps} onNavigate={navigate} />
      <div className="app-main">
        <Topbar step={step} onBack={() => { if (step > 1) setStep((step - 1) as Step); else window.location.href = "/"; }} />
        <div className="context-line" aria-hidden="true">{backgroundLabel}</div>
        {step === 1 ? (
          <UploadStep
            file={file}
            onFile={chooseFile}
            onSample={(sampleFile) => chooseFile(sampleFile)}
            onAnalyze={() => analyze(false)}
            onReanalyze={() => analyze(true)}
            analysisReady={Boolean(result && criteria.length)}
            loading={loading}
            loadingMessage={loadingMessage}
            error={error}
            errorRetryable={errorRetryable}
          />
        ) : null}
        {step === 2 && source ? (
          <CriteriaReview
            setup={setup}
            sourceName={source.name}
            pageCount={source.pages || 1}
            analysisWarnings={source.warnings}
            documentUrl={sourceDocumentUrl}
            editingPublished={savedBefore}
            cacheNotice={cacheNotice}
            criteria={criteria}
            setCriteria={setCriteria}
            onBack={() => setStep(1)}
            onApprove={approve}
            onReanalyze={file ? () => analyze(true) : null}
            publishing={publishing}
            approvalError={approvalError}
          />
        ) : null}
        {step === 3 && profile ? <ProfileReady profile={profile} summary={publishSummary} onEdit={() => navigate(2)} onRestart={restart} /> : null}
      </div>
    </main>
  );
}
