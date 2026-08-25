"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import DocumentLibraryModal from "./document-library-modal";
import FileBadge from "./file-badge";
import TopbarSession from "./topbar-session";
import { analyzeWithGemini } from "../lib/gemini-analyzer";
import { getPdfPageCount } from "../lib/pdf-reader";
import { workflowApi } from "../lib/workflow-client";
import { SAMPLE_DOCUMENTS } from "../lib/sample-documents";
import {
  clearDraftSnapshot,
  loadDraftFile,
  loadDraftTemplateFile,
  loadDraftSnapshot,
  saveDraftFile,
  saveDraftTemplateFile,
  saveDraftSnapshot,
} from "../lib/draft-store";
import {
  CHECK_STAGES,
  checkStageOf,
  type AnalysisResult,
  type CheckStage,
  type Criterion,
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

type GroupFilter = "all" | "required" | "other";
type StageFilter = "all" | CheckStage;

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
  templateFile,
  onFile,
  onTemplateFile,
  onSample,
  onAnalyze,
  analysisReady,
  loading,
  loadingMessage,
  error,
}: {
  file: File | null;
  templateFile: File | null;
  onFile: (file: File) => void;
  onTemplateFile: (file: File | null) => void;
  onSample: (file: File) => void;
  onAnalyze: () => void;
  analysisReady: boolean;
  loading: boolean;
  loadingMessage: string;
  error: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
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
          <p>Buraya katılımcı projesi değil; rapor kurallarını, zorunlu başlıkları ve teknik gereksinimleri anlatan şartname PDF&apos;si yüklenir.</p>
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
        <div className="template-upload-card">
          <div>
            <span className="section-kicker">İsteğe bağlı ikinci kaynak</span>
            <h2>Resmî rapor şablonu</h2>
            <p>2. aşamadaki zorunlu başlıkları ve 1. aşamadaki biçim kurallarını daha doğru belirlemek için ekleyebilirsiniz. Şablondan yeni yarışma kuralı üretilmez.</p>
          </div>
          <input
            ref={templateInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => onTemplateFile(event.target.files?.[0] ?? null)}
          />
          {templateFile ? (
            <div className="template-file-row">
              <FileBadge fileName={templateFile.name} mimeType={templateFile.type} />
              <div><strong>{templateFile.name}</strong><small>{formatBytes(templateFile.size)} · Rapor şablonu</small></div>
              <button type="button" className="text-button" onClick={() => onTemplateFile(null)}>Kaldır</button>
            </div>
          ) : (
            <button type="button" className="secondary-button" onClick={() => templateInputRef.current?.click()}>Rapor şablonu ekle</button>
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

      {error ? <div className="inline-error" role="alert"><strong>Belge analiz edilemedi.</strong><span>{error}</span></div> : null}

      {loading ? (
        <div className="analysis-progress" role="status" aria-live="polite">
          <span className="progress-spinner" />
          <div><strong>Belge anlamlandırılıyor</strong><p>{loadingMessage}</p></div>
          <div className="progress-line"><span /></div>
        </div>
      ) : null}

      <div className="workspace-actions">
        <span className="source-limit-note">Kaynak PDF analiz motoru için teknik yükleme sınırı: 18 MB.</span>
        <button type="button" className="primary-button" disabled={!file || loading} onClick={onAnalyze}>
          {analysisReady ? "Mevcut analize dön" : "Belgeyi analiz et"} <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

function CriteriaReview({
  setup,
  file,
  documentUrl,
  result,
  criteria,
  setCriteria,
  onBack,
  onApprove,
  approvalError,
}: {
  setup: SetupData;
  file: File;
  documentUrl: string;
  result: AnalysisResult;
  criteria: Criterion[];
  setCriteria: (criteria: Criterion[]) => void;
  onBack: () => void;
  onApprove: () => void;
  approvalError: string;
}) {
  const [selectedId, setSelectedId] = useState(criteria[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const selected = criteria.find((item) => item.id === selectedId) ?? criteria[0];
  const active = criteria.filter((item) => item.active);
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
  const allGroups: Array<{ id: GroupFilter; title: string; hint: string; items: Criterion[] }> = [
    {
      id: "required",
      title: "Zorunlu kriterler",
      hint: "Karşılanmaması KRİTİK HATA doğurur.",
      items: filtered.filter((item) => item.required).sort(byStageThenPage),
    },
    {
      id: "other",
      title: "Diğer kriterler",
      hint: "Karşılanmaması REVİZYON önerisi doğurur.",
      items: filtered.filter((item) => !item.required).sort(byStageThenPage),
    },
  ];
  const groups = allGroups.filter((group) => groupFilter === "all" || group.id === groupFilter);

  const canApprove = reviewConfirmed && active.length > 0;

  function update(patch: Partial<Criterion>) {
    if (!selected) return;
    setCriteria(criteria.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
    setReviewConfirmed(false);
  }

  function addCriterion(required: boolean) {
    const added: Criterion = {
      id: `manual-${Date.now()}`,
      name: "Yeni kriter",
      stage: "criteria_evidence",
      required,
      description: "Kuralın koşulunu, raporda ne aranacağını ve sonucunu yazın.",
      violationOutcome: "Belgede belirtilmemiş",
      sourcePage: null,
      sourceText: "",
      active: true,
      origin: "manager",
    };
    setCriteria([...criteria, added]);
    setSelectedId(added.id);
    setStageFilter("all");
    setGroupFilter("all");
    setQuery("");
    setReviewConfirmed(false);
    setConfirmingDelete(false);
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
            {item.sourcePage ? ` · Kaynak s. ${item.sourcePage}` : " · Kaynak sayfa girilmedi"}
            {item.origin === "manager" ? " · Yönetici ekledi" : ""}
          </small>
        </span>
        <span className={`criterion-value ${item.active ? (item.required ? "required" : "other") : "passive"}`}>
          {!item.active ? "Pasif" : item.required ? "Zorunlu" : "Diğer"}
        </span>
      </button>
    );
  }

  return (
    <section className="workspace review-workspace" aria-labelledby="review-title">
      <div className="review-heading">
        <div>
          <span className="section-kicker">Belgeden çıkarılan kriterler</span>
          <h1 id="review-title">Kriterleri doğrulayın ve kesinleştirin</h1>
          <p>{file.name} · {result.pageCount} sayfa · {setup.competition} · Her kriter kaynak sayfasıyla birlikte gösteriliyor.</p>
        </div>
        <span className="step-fraction">2 / 3</span>
      </div>

      <div className="analysis-summary" aria-label="Kriter özeti">
        <div><strong>{requiredCount}</strong><span>zorunlu</span></div>
        <div><strong>{otherCount}</strong><span>diğer</span></div>
        <div><strong>{active.length}</strong><span>aktif kriter</span></div>
        {stageCounts.map(({ stage, count }) => (
          <div key={stage.id} title={stage.detail}><strong>{count}</strong><span>{stage.order}. {stage.shortTitle}</span></div>
        ))}
        {missingSource ? <div className="summary-warning"><strong>{missingSource}</strong><span>kaynak sayfası eksik</span></div> : null}
      </div>

      {result.analysisWarnings.length ? (
        <ul className="analysis-warning-list" role="status">
          {result.analysisWarnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}

      <div className="review-grid">
        <div className="criteria-ledger" id="criteria-list">
          <div className="criteria-section-heading">
            <div><h2>Kriter listesi</h2><p>AI çıkarımlarını düzeltin, gereksizleri silin veya belgedeki eksik bir kriteri kendiniz ekleyin.</p></div>
            <div className="add-criterion-group">
              <button type="button" className="secondary-button add-criterion-button" onClick={() => addCriterion(true)}>
                <span aria-hidden="true">＋</span>
                <span><strong>Zorunlu kriter ekle</strong><small>Tüm alanları elle doldur</small></span>
              </button>
              <button type="button" className="secondary-button add-criterion-button" onClick={() => addCriterion(false)}>
                <span aria-hidden="true">＋</span>
                <span><strong>Diğer kriter ekle</strong><small>Revizyon önerisi doğurur</small></span>
              </button>
            </div>
          </div>
          <div className="ledger-tools three-col">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kriter, açıklama veya alıntı ara" aria-label="Kriter ara" />
            </label>
            <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as StageFilter)} aria-label="Aşamaya göre filtrele">
              <option value="all">Tüm aşamalar</option>
              {CHECK_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.order}. {stage.title}</option>)}
            </select>
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as GroupFilter)} aria-label="Zorunluluğa göre filtrele">
              <option value="all">Zorunlu ve diğer</option>
              <option value="required">Yalnızca zorunlu</option>
              <option value="other">Yalnızca diğer</option>
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
                <span className={`required-chip ${selected.required ? "required" : "other"}`}>{selected.required ? "Zorunlu" : "Diğer"}</span>
                <span className="origin-label">{selected.origin === "document" ? "AI tarafından belgeden çıkarıldı" : "Yönetici tarafından eklendi"}</span>
              </div>
              <label className="active-toggle">
                <input
                  type="checkbox"
                  checked={selected.active}
                  onChange={(event) => update({ active: event.target.checked })}
                />
                <span />
                {selected.active ? "Aktif" : "Pasif"}
              </label>
            </div>

            <div className="inspector-section edit-section">
              <span className="inspector-label">Kriter tanımı</span>
              <div className="form-grid two-col">
                <Field label="Kriter adı">
                  <input value={selected.name} onChange={(event) => update({ name: event.target.value })} />
                </Field>
                <Field label="Kontrol aşaması" hint={checkStageOf(selected.stage).detail}>
                  <select value={selected.stage} onChange={(event) => update({ stage: event.target.value as CheckStage })}>
                    {CHECK_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.order}. {stage.title}</option>)}
                  </select>
                </Field>
                <Field label="Zorunluluk" hint="Zorunlu kuralın ihlali KRİTİK HATA, diğer kuralın ihlali REVİZYON sonucu doğurur.">
                  <select value={selected.required ? "required" : "other"} onChange={(event) => update({ required: event.target.value === "required" })}>
                    <option value="required">Zorunlu</option>
                    <option value="other">Diğer</option>
                  </select>
                </Field>
                <Field label="İhlal sonucunda">
                  <input value={selected.violationOutcome} onChange={(event) => update({ violationOutcome: event.target.value })} />
                </Field>
              </div>
              <Field label="Kural açıklaması" hint="Koşul, raporda ne aranacağı ve karşılanmadığında ne olacağı tek anlamlı yazılmalı; rapor değerlendirmesinde bu metin kullanılır.">
                <textarea value={selected.description} onChange={(event) => update({ description: event.target.value })} />
              </Field>
            </div>

            <div className="inspector-section evidence-section">
              <div className="inspector-section-heading">
                <span className="inspector-label">Belgedeki dayanak</span>
                {selected.sourcePage && documentUrl ? (
                  <a href={`${documentUrl}#page=${selected.sourcePage}`} target="_blank" rel="noreferrer">Kaynak sayfayı aç · s. {selected.sourcePage} ↗</a>
                ) : <span>Kaynak sayfa girilmedi</span>}
              </div>
              <div className="manual-evidence-grid">
                <Field label="Kaynak PDF sayfası" hint={`1–${result.pageCount} arası PDF sayfa sırası. Model yanlış okuduysa düzeltin.`}>
                  <input
                    type="number"
                    min={1}
                    max={result.pageCount}
                    value={selected.sourcePage ?? ""}
                    placeholder="Örn. 12"
                    onChange={(event) => {
                      const next = event.target.value === "" ? null : Math.round(Number(event.target.value));
                      update({ sourcePage: next !== null && Number.isFinite(next) && next >= 1 ? Math.min(next, result.pageCount) : null });
                    }}
                  />
                </Field>
                <Field label="Kaynak alıntı" hint="Kuralı kanıtlayan cümle, belgeden birebir.">
                  <textarea value={selected.sourceText} onChange={(event) => update({ sourceText: event.target.value })} />
                </Field>
              </div>
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
                  <p>Yanlış çıkarılan veya bu yarışmada uygulanmayacak kriterleri silebilir, geçici olarak dışarıda bırakmak için pasifleştirebilirsiniz.</p>
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
            <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
            <span>Zorunlu ve diğer kriterleri, aşamalarını ve kaynak sayfalarını inceledim.</span>
          </label>
          {!canApprove ? (
            <small>
              {active.length === 0 && "En az bir aktif kriter gerekli. "}
              {!reviewConfirmed && "Yönetici kontrolünü onaylayın."}
            </small>
          ) : <small className="ready-note">Profil yayıma hazır.</small>}
          {approvalError ? <small className="approval-error" role="alert">{approvalError}</small> : null}
        </div>
        <button type="button" className="primary-button" disabled={!canApprove} onClick={onApprove}>Kriter profilini yayımla <span>→</span></button>
      </div>
    </section>
  );
}

function ProfileReady({
  profile,
  onEdit,
  onRestart,
}: {
  profile: ProfileExport;
  onEdit: () => void;
  onRestart: () => void;
}) {
  const active = profile.criteria.filter((item) => item.active);
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
          {profile.setup.competition} · {profile.setup.reportType} için doğruladığınız dört aşamalı kriter seti yayımlandı.
          Hakemler katılımcı raporlarını yalnızca bu sürümlü profile göre değerlendirebilir.
        </p>
        <div className="ready-actions">
          <button type="button" className="primary-button" onClick={downloadProfile}>Profil JSON’unu indir</button>
          <button type="button" className="secondary-button" onClick={onEdit}>Kriterleri yeniden düzenle</button>
        </div>
      </div>

      <div className="profile-sheet">
        <div className="profile-sheet-header">
          <div><span>Profil kimliği</span><strong>{profile.setup.year} / {profile.setup.stage} / v2.0</strong></div>
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
          <div><strong>{active.length}</strong><span>aktif kriter</span></div>
          <div><strong>{requiredCount}</strong><span>zorunlu</span></div>
          <div><strong>{active.length - requiredCount}</strong><span>diğer</span></div>
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
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [documentUrl, setDocumentUrl] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [profile, setProfile] = useState<ProfileExport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [draftReady, setDraftReady] = useState(false);

  const backgroundLabel = useMemo(
    () => result ? `${setup.competition} · ${setup.reportType}` : "Organizatör PDF'si bekleniyor",
    [result, setup],
  );

  useEffect(() => {
    let active = true;
    async function restoreDraft() {
      const snapshot = loadDraftSnapshot();
      const [storedFile, storedTemplateFile] = await Promise.all([loadDraftFile(), loadDraftTemplateFile()]);
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
      if (storedTemplateFile) setTemplateFile(storedTemplateFile);
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
    if (!draftReady) return;
    saveDraftSnapshot({ step, setup, result, criteria, profile });
  }, [criteria, draftReady, profile, result, setup, step]);

  useEffect(() => {
    if (!draftReady) return;
    saveDraftFile(file).catch(() => undefined);
  }, [draftReady, file]);

  useEffect(() => {
    if (!draftReady) return;
    saveDraftTemplateFile(templateFile).catch(() => undefined);
  }, [draftReady, templateFile]);

  function chooseFile(nextFile: File) {
    setError("");
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
  }

  function chooseTemplateFile(nextFile: File | null) {
    setError("");
    if (!nextFile) {
      setTemplateFile(null);
      setResult(null);
      setCriteria([]);
      setProfile(null);
      return;
    }
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
      setError("Rapor şablonu PDF olmalıdır.");
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setError("Rapor şablonu 10 MB'den büyük olamaz.");
      return;
    }
    setTemplateFile(nextFile);
    setResult(null);
    setCriteria([]);
    setProfile(null);
  }

  async function analyze() {
    if (!file) return;
    if (result && criteria.length) {
      setStep(2);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setLoadingMessage("PDF sayfa yapısı doğrulanıyor…");
      const pageCount = await getPdfPageCount(file);
      const templatePageCount = templateFile ? await getPdfPageCount(templateFile) : undefined;
      setLoadingMessage("Belgenin tamamı tek AI çağrısıyla dört aşamaya göre okunuyor…");
      const analysis = await analyzeWithGemini(file, pageCount, templateFile, templatePageCount);
      setLoadingMessage("Kriterler kaynak sayfalarıyla eşleştiriliyor…");
      if (!analysis.criteria.length) {
        throw new Error("Belgede PDF aşamasında kontrol edilebilecek bir kriter bulunamadı.");
      }
      setResult(analysis);
      setSetup(analysis.setup);
      setCriteria(analysis.criteria);
      setStep(2);
    } catch (analysisError) {
      const message = analysisError instanceof Error ? analysisError.message : "Bilinmeyen bir hata oluştu.";
      setError(`${message} API bağlantısını, kotayı veya kaynak belgenin geçerliliğini kontrol edin.`);
    } finally {
      setLoading(false);
    }
  }

  async function approve() {
    if (!file || !result) return;
    setApprovalError("");
    const nextProfile: ProfileExport = {
      version: "2.0",
      status: "approved",
      // Aynı taslak yeniden yayımlanıyorsa mevcut profil kimliği korunur; D1'de
      // ikinci bir "yürürlükte" satır oluşmaz, eski başvurular aynı profile bağlı kalır.
      profileId: profile?.profileId ?? `profil-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      setup,
      sourceDocument: {
        name: file.name,
        pages: result.pageCount,
        analyzedAt: result.analyzedAt,
      },
      templateProfile: result.templateProfile,
      criteria,
    };
    try {
      const published = await workflowApi.submitProfileForReview(nextProfile);
      localStorage.setItem("kriter-atolyesi:last-profile", JSON.stringify(published.profile.profile));
      setProfile(published.profile.profile);
      setStep(3);
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : "Profil yayımlanamadı. Bağlantıyı kontrol edip yeniden deneyin.");
    }
  }

  function restart() {
    if (documentUrl) URL.revokeObjectURL(documentUrl);
    setStep(1);
    setSetup(DEFAULT_SETUP);
    setFile(null);
    setTemplateFile(null);
    setDocumentUrl("");
    setResult(null);
    setCriteria([]);
    setProfile(null);
    setError("");
    setApprovalError("");
    clearDraftSnapshot();
    saveDraftFile(null).catch(() => undefined);
    saveDraftTemplateFile(null).catch(() => undefined);
  }

  const completedSteps = useMemo(() => {
    const completed = new Set<Step>();
    if (result && file) completed.add(1);
    if (profile) {
      completed.add(2);
      completed.add(3);
    }
    return completed;
  }, [file, profile, result]);

  function navigate(nextStep: Step) {
    if (nextStep === 2 && (!result || !file)) return;
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
            templateFile={templateFile}
            onFile={chooseFile}
            onTemplateFile={chooseTemplateFile}
            onSample={(sampleFile) => chooseFile(sampleFile)}
            onAnalyze={analyze}
            analysisReady={Boolean(result && criteria.length)}
            loading={loading}
            loadingMessage={loadingMessage}
            error={error}
          />
        ) : null}
        {step === 2 && result && file ? (
          <CriteriaReview
            setup={setup}
            file={file}
            documentUrl={documentUrl}
            result={result}
            criteria={criteria}
            setCriteria={setCriteria}
            onBack={() => setStep(1)}
            onApprove={approve}
            approvalError={approvalError}
          />
        ) : null}
        {step === 3 && profile ? <ProfileReady profile={profile} onEdit={() => navigate(2)} onRestart={restart} /> : null}
      </div>
    </main>
  );
}
