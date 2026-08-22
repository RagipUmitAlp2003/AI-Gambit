"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CompetitionSelect from "./competition-select";
import SearchSelect from "./search-select";
import DocumentLibraryPanel from "./document-library-panel";
import { categoriesFor, reportTypesFor, stagesFor } from "../lib/competitions";
import FileBadge from "./file-badge";
import TemplatePreview from "./template-preview";
import { analyzeWithGemini } from "../lib/gemini-analyzer";
import { criterionEffectOf as criterionEffect, deriveDecisionRules, normalizeScore } from "../lib/evaluation-summary";
import { getPdfPageCount } from "../lib/pdf-reader";
import {
  clearDraftSnapshot,
  loadDraftFile,
  loadDraftSnapshot,
  saveDraftFile,
  saveDraftSnapshot,
} from "../lib/draft-store";
import type {
  AnalysisResult,
  Confidence,
  Criterion,
  CriterionEffect,
  CriterionType,
  EvaluationMethod,
  ProfileExport,
  SetupData,
  Step,
  ViolationAction,
} from "../lib/types";

const DEFAULT_COMPETITION = "Akıllı Ulaşım Sistemleri Yarışması";
const DEFAULT_CATEGORY = categoriesFor(DEFAULT_COMPETITION)[0];
const DEFAULT_STAGE = stagesFor(DEFAULT_COMPETITION)[0];

const DEFAULT_SETUP: SetupData = {
  competition: DEFAULT_COMPETITION,
  category: DEFAULT_CATEGORY,
  stage: DEFAULT_STAGE,
  reportType: reportTypesFor(DEFAULT_COMPETITION, DEFAULT_STAGE)[0],
  year: "2026",
  allowedFormats: ["PDF"],
  maxFileSizeMb: 25,
  maxFileCount: 1,
  defaultViolationAction: "block",
};

type SampleDocument = {
  path: string;
  name: string;
  title: string;
  source: string;
  description: string;
  pages: number;
  setup: Partial<SetupData>;
};

const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    path: "/ornek-degerlendirme-kilavuzu.pdf",
    name: "Ornek_Akilli_Ulasim_OTR_Degerlendirme_Kilavuzu.pdf",
    title: "Akıllı Ulaşım - kısa test kılavuzu",
    source: "Sentetik test belgesi",
    description: "100 puanlık sade tablo, teknik teslim kuralları ve bilinçli olarak atlanan biçim kontrolleri.",
    pages: 3,
    setup: DEFAULT_SETUP,
  },
  {
    path: "/samples/2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf",
    name: "2026_Celikkubbe_Hava_Savunma_Teknik_Sartnamesi.pdf",
    title: "Çelikkubbe Hava Savunma Sistemleri",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Çok aşamalı puanlama, barajlar, sayfa sınırları, başarısızlık koşulları ve toplam puan formülleri.",
    pages: 25,
    setup: {
      competition: "Çelikkubbe Hava Savunma Sistemleri Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Teknik şartname profili",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Insansiz_Deniz_Araci_Sartnamesi.pdf",
    name: "2026_Insansiz_Deniz_Araci_Sartnamesi.pdf",
    title: "İnsansız Deniz Aracı Yarışması",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Rapor, video, teknik uygunluk ve parkur puanlarını aynı belgede birleştiren karmaşık değerlendirme yapısı.",
    pages: 29,
    setup: {
      competition: "İnsansız Deniz Aracı Yarışması",
      category: "Üniversite Seviyesi",
      stage: "Kritik tasarım değerlendirmesi",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
    },
  },
  {
    path: "/samples/2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf",
    name: "2026_Insansiz_Su_Alti_Sistemleri_Sartnamesi.pdf",
    title: "İnsansız Su Altı Sistemleri",
    source: "Resmî TEKNOFEST şartnamesi",
    description: "Kategoriye göre değişen puanlar, görev başarımı, minimum başarı şartları ve eleme incelemeleri.",
    pages: 35,
    setup: {
      competition: "İnsansız Su Altı Sistemleri Yarışması",
      category: "Temel / İleri Kategori",
      stage: "Kritik tasarım değerlendirmesi",
      reportType: "Kritik Tasarım Raporu (KTR)",
      year: "2026",
    },
  },
];

const STEPS = [
  { id: 1, title: "Temel ayarlar", short: "Yarışma ve teslim kapısı" },
  { id: 2, title: "Kaynak belge", short: "Resmî kriter PDF'si" },
  { id: 3, title: "Kriter inceleme", short: "AI çıkarımlarını doğrula" },
  { id: 4, title: "Profil onayı", short: "Sürümü kaydet" },
] as const;

const TYPE_LABELS: Record<CriterionType, string> = {
  technical_upload: "Teknik yükleme kuralı",
  format_rule: "Biçim kuralı",
  mandatory_content: "Zorunlu içerik",
  qualitative_score: "Nitel puanlama",
  elimination_review: "Eleme incelemesi",
  formula: "Hesaplama / formül",
  human_only: "Yalnızca jüri",
};

const METHOD_LABELS: Record<EvaluationMethod, string> = {
  deterministic: "Kesin otomatik kontrol",
  ai: "AI önerisi",
  human: "Hakem / jüri kararı",
  hybrid: "AI önerisi + görevli onayı",
};

const EFFECT_LABELS: Record<CriterionEffect, string> = {
  gate: "Uygunluk / geçiş şartı",
  score: "Puan kazandırır",
  penalty: "Ceza puanı",
  threshold: "Baraj / devam şartı",
  advisory: "Bilgi ve öneri",
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Yüksek güven",
  medium: "Orta güven",
  low: "Düşük güven",
};

const ACTION_LABELS: Record<ViolationAction, string> = {
  block: "Yüklemeyi engelle",
  warn: "Uyarı oluştur",
  jury: "Jüri incelemesine gönder",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function applyDecisionSafetyPolicy(item: Criterion): Criterion {
  const text = `${item.name} ${item.scope || ""} ${item.sourceText}`;
  const requiresHuman = /hakem|jüri|güvenlik|acil durdur|yalıtım|açık kablo|keskin nokta|patlayıcı|fiziksel boyut|sistem maksimum boyut|yasak bölge|mülakat|dışarıdan (?:yardım|yönlendirme)/i.test(text);
  return requiresHuman && item.evaluationMethod === "deterministic"
    ? { ...item, evaluationMethod: "human" }
    : item;
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
          <span>Profil oluşturucu</span>
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
          <strong>AI belge analiz motoru</strong>
          <p>PDF sunucuda analiz edilir; API anahtarı tarayıcıya gönderilmez.</p>
        </div>
      </div>
    </nav>
  );
}

function Topbar({ step }: { step: Step }) {
  const current = STEPS.find((item) => item.id === step)!;
  return (
    <header className="topbar">
      <div>
        <span className="topbar-context">P4 · Değerlendirme karar destek sistemi</span>
        <strong>{current.title}</strong>
      </div>
      <div className="topbar-status">
        <span className="status-chip neutral">Yerel prototip</span>
        <span className="operator-avatar" aria-label="Proje yöneticisi">PY</span>
      </div>
    </header>
  );
}

function SetupStep({
  setup,
  onChange,
  onContinue,
  file,
  result,
  criteria,
}: {
  setup: SetupData;
  onChange: (value: SetupData) => void;
  onContinue: () => void;
  file: File | null;
  result: AnalysisResult | null;
  criteria: Criterion[];
}) {
  const canContinue = setup.competition.trim() && setup.stage.trim() && setup.reportType.trim();
  const categoryOptions = categoriesFor(setup.competition);
  const stageOptions = stagesFor(setup.competition);
  const reportOptions = reportTypesFor(setup.competition, setup.stage);

  // Yarışma → Kategori → Aşama → Rapor türü zinciri: üst alan listeden
  // seçildiğinde alt alanlar yeni seçeneklere göre güncellenir; mevcut değer
  // hâlâ geçerliyse korunur, görevli her değeri sonradan değiştirebilir.
  function pickCompetition(competition: string) {
    const categories = categoriesFor(competition);
    const category = categories.includes(setup.category) ? setup.category : categories[0] ?? setup.category;
    const stages = stagesFor(competition);
    const stage = stages.includes(setup.stage) ? setup.stage : stages[0] ?? setup.stage;
    const reports = reportTypesFor(competition, stage);
    const reportType = reports.includes(setup.reportType) ? setup.reportType : reports[0] ?? setup.reportType;
    onChange({ ...setup, competition, category, stage, reportType });
  }

  function pickStage(stage: string) {
    const reports = reportTypesFor(setup.competition, stage);
    const reportType = reports.includes(setup.reportType) ? setup.reportType : reports[0] ?? setup.reportType;
    onChange({ ...setup, stage, reportType });
  }

  return (
    <section className="workspace setup-workspace" aria-labelledby="setup-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Katılımcı raporundan önce</span>
          <h1 id="setup-title">Değerlendirme profilinin çerçevesini kurun</h1>
          <p>
            Bu üç bölüm, şartnamede unutulabilecek en temel teslim kurallarını güvenceye alır.
            İçerik ve sayfa düzeni kriterlerini bir sonraki adımda belgeden çıkaracağız.
          </p>
        </div>
        <span className="step-fraction">1 / 4</span>
      </div>

      <div className="setup-layout">
        <form className="setup-form" onSubmit={(event) => { event.preventDefault(); onContinue(); }}>
          <fieldset>
            <legend><span>1</span> Bu profil ne için hazırlanıyor?</legend>
            <div className="form-grid two-col">
              <Field label="Yarışma adı" hint="Yazmaya başlayın; kayıtlı yarışmalar anlık filtrelenir.">
                <CompetitionSelect
                  value={setup.competition}
                  onChange={(competition) => onChange({ ...setup, competition })}
                  onPick={pickCompetition}
                />
              </Field>
              <Field label="Kategori / seviye" hint="Seçenekler seçilen yarışmaya göre listelenir.">
                <SearchSelect
                  value={setup.category}
                  onChange={(category) => onChange({ ...setup, category })}
                  options={categoryOptions}
                  placeholder="Örn. Üniversite Seviyesi"
                  ariaLabel="Kategori veya seviye seç"
                />
              </Field>
              <Field label="Aşama" hint="Seçenekler yarışma ve kategoriye göre listelenir.">
                <SearchSelect
                  value={setup.stage}
                  onChange={(stage) => onChange({ ...setup, stage })}
                  onPick={pickStage}
                  options={stageOptions}
                  placeholder="Örn. Ön değerlendirme"
                  ariaLabel="Değerlendirme aşaması seç"
                />
              </Field>
              <Field label="Rapor türü" hint="Seçenekler seçilen aşamaya göre listelenir.">
                <SearchSelect
                  value={setup.reportType}
                  onChange={(reportType) => onChange({ ...setup, reportType })}
                  options={reportOptions}
                  placeholder="Örn. Ön Tasarım Raporu (ÖTR)"
                  ariaLabel="Rapor türü seç"
                />
              </Field>
              <Field label="Yarışma yılı">
                <input
                  inputMode="numeric"
                  value={setup.year}
                  onChange={(event) => onChange({ ...setup, year: event.target.value })}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend><span>2</span> Katılımcı hangi dosyayı yükleyebilir?</legend>
            <div className="form-grid three-col">
              <Field label="İzin verilen format" hint="İlk sürümde PDF ile sınırlandı.">
                <div className="fixed-value"><span>PDF</span><small>Değiştirilemez</small></div>
              </Field>
              <Field label="En büyük dosya boyutu">
                <div className="input-with-unit">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={setup.maxFileSizeMb}
                    onChange={(event) => onChange({ ...setup, maxFileSizeMb: Number(event.target.value) })}
                  />
                  <span>MB</span>
                </div>
              </Field>
              <Field label="En fazla dosya sayısı">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={setup.maxFileCount}
                  onChange={(event) => onChange({ ...setup, maxFileCount: Number(event.target.value) })}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend><span>3</span> Teknik kurala uyulmazsa ne yapılmalı?</legend>
            <div className="action-options">
              {(Object.keys(ACTION_LABELS) as ViolationAction[]).map((action) => (
                <label key={action} className={`action-option ${setup.defaultViolationAction === action ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="violation"
                    value={action}
                    checked={setup.defaultViolationAction === action}
                    onChange={() => onChange({ ...setup, defaultViolationAction: action })}
                  />
                  <span className="radio-mark" />
                  <span>
                    <strong>{ACTION_LABELS[action]}</strong>
                    <small>
                      {action === "block" && "Kesin teknik ihlallerde katılımcı dosyası kabul edilmez."}
                      {action === "warn" && "Dosya alınır, yönetici ekranında açık uyarı oluşur."}
                      {action === "jury" && "Karar otomatik verilmez; görevliye inceleme açılır."}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="form-actions">
            <span className="save-note">Ayarlar bu cihazda taslak olarak tutulur.</span>
            <button className="primary-button" type="submit" disabled={!canContinue}>
              Kaynak belgeye geç <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>

        <aside className="setup-preview" aria-label="Değerlendirme şablonu canlı önizlemesi">
          <TemplatePreview setup={setup} file={file} result={result} criteria={criteria} />
        </aside>
      </div>
    </section>
  );
}

function UploadStep({
  setup,
  file,
  result,
  criteria,
  onFile,
  onSample,
  onBack,
  onAnalyze,
  loading,
  loadingMessage,
  error,
}: {
  setup: SetupData;
  file: File | null;
  result: AnalysisResult | null;
  criteria: Criterion[];
  onFile: (file: File) => void;
  onSample: (file: File, setup: Partial<SetupData>) => void;
  onBack: () => void;
  onAnalyze: () => void;
  loading: boolean;
  loadingMessage: string;
  error: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function loadSample(sample: SampleDocument) {
    const response = await fetch(sample.path);
    const blob = await response.blob();
    onSample(new File([blob], sample.name, { type: "application/pdf" }), sample.setup);
  }

  function accept(selected?: File) {
    if (selected) onFile(selected);
  }

  return (
    <section className="workspace upload-workspace" aria-labelledby="upload-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Organizatör kaynağı</span>
          <h1 id="upload-title">Resmî değerlendirme belgesini yükleyin</h1>
          <p>Buraya katılımcı projesi değil; kriterleri, yazım kurallarını ve ihlal sonuçlarını anlatan PDF yüklenir.</p>
        </div>
        <span className="step-fraction">2 / 4</span>
      </div>

      <div className="source-explainer">
        <span className="explainer-mark">K</span>
        <div>
          <strong>Bu belge, değerlendirme profilinin kaynağı olacak.</strong>
          <p>AI önce belgeyi yorumlayacak; hiçbir çıkarım yönetici onayı olmadan uygulanmayacak.</p>
        </div>
        <span className="draft-safe-note">Geri dönerseniz seçilen belge ve analiz taslağı korunur.</span>
      </div>

      <div className="upload-layout">
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
              <p>veya bilgisayarınızdan bir değerlendirme kılavuzu seçin</p>
              <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>PDF seç</button>
            </div>
          )}
        </div>

        <aside className="setup-preview upload-preview" aria-label="Değerlendirme şablonu canlı önizlemesi">
          <TemplatePreview setup={setup} file={file} result={result} criteria={criteria} />
        </aside>
      </div>

      <section className="sample-library" aria-labelledby="sample-library-title">
        <div className="sample-library-heading">
          <div>
            <h2 id="sample-library-title">Hazır test belgeleri</h2>
            <p>Farklı yarışma ve kriter yapılarında sistemi sınayın.</p>
          </div>
          <span>{SAMPLE_DOCUMENTS.length} belge</span>
        </div>
        <div className="sample-document-list">
          {SAMPLE_DOCUMENTS.map((sample) => (
            <article key={sample.path} className={file?.name === sample.name ? "selected" : ""}>
              <FileBadge fileName={sample.name} mimeType="application/pdf" size="sm" />
              <div className="sample-copy">
                <span>{sample.source} · {sample.pages} sayfa</span>
                <h3>{sample.title}</h3>
                <p>{sample.description}</p>
              </div>
              <div className="sample-actions">
                <a href={sample.path} target="_blank" rel="noreferrer">Belgeyi aç</a>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => loadSample(sample)}
                  disabled={file?.name === sample.name}
                >
                  {file?.name === sample.name ? "Seçildi" : "Bu belgeyi seç"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <DocumentLibraryPanel selectedFileName={file?.name ?? null} onSelect={onFile} />

      {error ? <div className="inline-error" role="alert"><strong>Belge analiz edilemedi.</strong><span>{error}</span></div> : null}

      {loading ? (
        <div className="analysis-progress" role="status" aria-live="polite">
          <span className="progress-spinner" />
          <div><strong>Belge anlamlandırılıyor</strong><p>{loadingMessage}</p></div>
          <div className="progress-line"><span /></div>
        </div>
      ) : null}

      <div className="workspace-actions">
        <button type="button" className="back-button" onClick={onBack}>← Temel ayarlara dön <small>Taslak korunur</small></button>
        <button type="button" className="primary-button" disabled={!file || loading} onClick={onAnalyze}>
          Belgeyi analiz et <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

function CriteriaReview({
  setup,
  setSetup,
  file,
  documentUrl,
  result,
  criteria,
  setCriteria,
  onBack,
  onApprove,
}: {
  setup: SetupData;
  setSetup: (setup: SetupData) => void;
  file: File;
  documentUrl: string;
  result: AnalysisResult;
  criteria: Criterion[];
  setCriteria: (criteria: Criterion[]) => void;
  onBack: () => void;
  onApprove: () => void;
}) {
  const [selectedId, setSelectedId] = useState(criteria[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const selected = criteria.find((item) => item.id === selectedId) ?? criteria[0];
  const scopes = [...new Set(criteria.map((item) => item.scope || "Genel"))];
  const filtered = criteria.filter((item) => {
    const queryMatch = item.name.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR"));
    return queryMatch && (scopeFilter === "all" || (item.scope || "Genel") === scopeFilter);
  });
  const active = criteria.filter((item) => item.active);
  const scorePlan = result.scorePlan;
  const displayTotal = scorePlan?.declaredTotalScore ?? null;
  const scoreGroupCount = scorePlan?.groups.length ?? active.filter((item) => criterionEffect(item) === "score").length;
  const humanReviewCount = active.filter((item) => ["human", "hybrid"].includes(item.evaluationMethod)).length;
  const deterministicCount = active.filter((item) => item.evaluationMethod === "deterministic").length;
  const conflicts = active.filter((item) => item.issue).length;
  const canApprove = reviewConfirmed && conflicts === 0 && active.length > 0;
  const decisionRules = deriveDecisionRules(criteria, scorePlan);

  function update(patch: Partial<Criterion>) {
    setCriteria(criteria.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  }

  function addCriterion() {
    const added: Criterion = {
      id: `manual-${Date.now()}`,
      name: "Yeni yönetici kriteri",
      type: "qualitative_score",
      maxScore: 0,
      weight: 0,
      required: false,
      violationOutcome: "Jüri değerlendirmesine bilgi ver",
      evaluationMethod: "human",
      sourcePage: null,
      sourceText: "Bu kriter yönetici tarafından eklendi; kaynak belgeye dayanmıyor.",
      aiInterpretation: "Yönetici eklemesi",
      confidence: "high",
      active: true,
      origin: "manager",
      effect: "advisory",
      scope: setup.stage || "Genel",
    };
    setCriteria([...criteria, added]);
    setSelectedId(added.id);
    setScopeFilter("all");
    setQuery("");
    setReviewConfirmed(false);
    setConfirmingDelete(false);
  }

  function removeSelectedCriterion() {
    if (!selected) return;
    const remaining = criteria.filter((item) => item.id !== selected.id);
    setCriteria(remaining);
    setSelectedId(remaining[0]?.id ?? "");
    setConfirmingDelete(false);
    setReviewConfirmed(false);
  }

  function resolveConflict(useDocumentValue: boolean) {
    const match = selected.name.match(/(\d+)\s*MB/i);
    if (useDocumentValue && match) {
      setSetup({ ...setup, maxFileSizeMb: Number(match[1]) });
    }
    update({
      issue: undefined,
      aiInterpretation: `${selected.aiInterpretation} Yönetici çakışmayı inceledi ve ${useDocumentValue ? "belgedeki değeri" : "başlangıç ayarını"} geçerli kabul etti.`,
    });
    setReviewConfirmed(false);
  }

  return (
    <section className="workspace review-workspace" aria-labelledby="review-title">
      <div className="review-heading">
        <div>
          <span className="section-kicker">AI çıkarım taslağı</span>
          <h1 id="review-title">Kriterleri doğrulayın ve kesinleştirin</h1>
          <p>{file.name} · {result.pageCount} sayfa · Her çıkarım kaynağıyla birlikte gösteriliyor.</p>
        </div>
        <span className="step-fraction">3 / 4</span>
      </div>

      <div className="analysis-summary" aria-label="Analiz özeti">
        <div><strong>{active.length}</strong><span>aktif kural</span></div>
        <div><strong>{scoreGroupCount}</strong><span>puan grubu</span></div>
        <div><strong>{deterministicCount}</strong><span>kesin kontrol</span></div>
        <div><strong>{humanReviewCount}</strong><span>görevli onayı</span></div>
        <div className={conflicts ? "summary-warning" : "summary-ok"}><strong>{conflicts}</strong><span>açık çakışma</span></div>
        <div><strong>{displayTotal ?? "—"}</strong><span>PDF toplam puanı</span></div>
      </div>

      <details className="template-peek">
        <summary>Şablon önizlemesi — yaptığınız değişiklikler anında yansır</summary>
        <TemplatePreview setup={setup} file={file} result={result} criteria={criteria} />
      </details>

      <section className="score-plan" aria-labelledby="score-plan-title">
        <div className="score-plan-heading">
          <div>
            <h2 id="score-plan-title">Belgedeki puan yapısı</h2>
            <p>Sistem puanı değiştirmez; PDF’de ilan edilen grupları, barajları ve alt kalemleri görünür kılar.</p>
          </div>
          <span className={`score-audit ${scorePlan?.auditStatus ?? "not_declared"}`}>
            {scorePlan?.auditStatus === "matched" ? "Toplam doğrulandı" : scorePlan?.auditStatus === "mismatch" ? "Eksik veya çakışan puan" : "Genel toplam belirtilmemiş"}
          </span>
        </div>
        {scorePlan?.groups.length ? (
          <div className="score-group-list">
            {scorePlan.groups.map((group) => (
              <details key={`${group.name}-${group.sourcePage}`} className="score-group-row">
                <summary>
                  <span><strong>{group.name}</strong><small>{group.scope} · Sayfa {group.sourcePage}</small></span>
                  <span className="score-group-value">
                    {group.maxScore} puan
                    {displayTotal ? <small>≈ {normalizeScore(group.maxScore, displayTotal)}/100</small> : null}
                  </span>
                </summary>
                <div>
                  {group.minimumScore !== null ? <p><strong>Baraj:</strong> En az {group.minimumScore} puan</p> : null}
                  {group.breakdown.length ? <ul>{group.breakdown.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                  <blockquote>{group.sourceText}</blockquote>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="score-plan-empty">PDF’de sayısal puan tablosu bulunmadı. Sistem bu belge için puan üretmedi.</p>
        )}
        {displayTotal ? (
          <p className="normalization-note">
            Yarışmanın orijinal puan sistemi korunur: değerlendirme {displayTotal} puan üzerinden yapılır,
            sonuç (alınan puan ÷ {displayTotal}) × 100 formülüyle 100 üzerinden gösterilir.
          </p>
        ) : null}
        <p className={`score-audit-note ${scorePlan?.auditStatus === "mismatch" ? "warning" : ""}`}>
          {scorePlan?.auditMessage ?? "Bu analiz eski veri modeliyle oluşturuldu. Güncel puan denetimi için belgeyi yeniden analiz edin."}
        </p>
      </section>

      <section className="decision-rules" aria-labelledby="decision-rules-title">
        <div className="score-plan-heading">
          <div>
            <h2 id="decision-rules-title">Karar kuralları</h2>
            <p>Toplam puanın yanında ayrıca denetlenecek geçiş koşulları, barajlar, cezalar ve eleme maddeleri.</p>
          </div>
        </div>
        <div className="decision-rule-grid">
          {([
            { key: "gates", title: "Geçiş koşulları", items: decisionRules.gates },
            { key: "thresholds", title: "Barajlar", items: decisionRules.thresholds },
            { key: "penalties", title: "Cezalar", items: decisionRules.penalties },
            { key: "eliminations", title: "Eleme / diskalifiye", items: decisionRules.eliminations },
          ] as const).map((column) => (
            <details key={column.key} className={`decision-column ${column.key}`}>
              <summary><strong>{column.items.length}</strong><span>{column.title}</span></summary>
              {column.items.length ? (
                <ul>
                  {column.items.slice(0, 8).map((rule, index) => (
                    <li key={`${rule.name}-${index}`}>
                      <strong>{rule.name}</strong>
                      <span>{rule.detail}{rule.sourcePage ? ` · s. ${rule.sourcePage}` : ""}</span>
                    </li>
                  ))}
                  {column.items.length > 8 ? <li className="more">+ {column.items.length - 8} madde daha</li> : null}
                </ul>
              ) : (
                <p>Bu belgede tanımlı madde bulunmadı.</p>
              )}
            </details>
          ))}
        </div>
      </section>

      <details className="analysis-notes">
        <summary>AI’nin kriter dışında bıraktığı notları göster</summary>
        <div>
          {result.informationalNotes.length ? (
            <section><strong>Bilgi metni</strong><p>{result.informationalNotes[0]}</p></section>
          ) : null}
          <section><strong>Çalıştırılmayacak kontroller</strong><p>{result.skippedChecks.join(" · ") || "Atlanan kontrol bulunmadı"}</p></section>
          {result.analysisWarnings?.length ? <section><strong>Analiz uyarısı</strong><p>{result.analysisWarnings.join(" · ")}</p></section> : null}
        </div>
      </details>

      <div className="review-grid">
        <div className="criteria-ledger" id="criteria-list">
          <div className="criteria-section-heading">
            <div><h2>Kriter listesi</h2><p>Düzenlemek istediğiniz kriteri seçin.</p></div>
            <button type="button" className="secondary-button" onClick={addCriterion}>+ Kriter ekle</button>
          </div>
          <div className="ledger-tools">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kriter ara" aria-label="Kriter ara" />
            </label>
            <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} aria-label="Aşamaya göre filtrele">
              <option value="all">Tüm aşamalar</option>
              {scopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
            </select>
          </div>
          <div className="ledger-list" role="listbox" aria-label="Çıkarılan kriterler">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={item.id === selected?.id}
                className={`criterion-row ${item.id === selected?.id ? "selected" : ""} ${!item.active ? "inactive" : ""}`}
                onClick={() => {
                  setSelectedId(item.id);
                  setConfirmingDelete(false);
                  requestAnimationFrame(() => document.getElementById("criterion-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
              >
                <span className={`type-mark ${item.type}`} aria-hidden="true" />
                <span className="criterion-main">
                  <strong>{item.name}</strong>
                  <small>{item.scope || "Genel"} · {EFFECT_LABELS[criterionEffect(item)]} · {item.sourcePage ? `Sayfa ${item.sourcePage}` : "Yönetici eklemesi"}</small>
                </span>
                <span className={`criterion-value ${criterionEffect(item)}`}>
                  {criterionEffect(item) === "score" && item.maxScore !== null
                    ? `${item.maxScore}p`
                    : criterionEffect(item) === "score"
                      ? "Puan"
                    : criterionEffect(item) === "penalty"
                      ? "Ceza"
                      : criterionEffect(item) === "threshold"
                        ? "Baraj"
                        : criterionEffect(item) === "gate"
                          ? "Geçiş"
                          : "Öneri"}
                </span>
                {item.issue ? <span className="row-alert" title="Çakışma var">!</span> : null}
              </button>
            ))}
            {!filtered.length ? <div className="empty-ledger">Bu filtrede kriter bulunamadı.</div> : null}
          </div>
        </div>

        {selected ? (
          <div className="criterion-inspector" id="criterion-detail">
            <div className="inspector-title">
              <div><span>Seçili kriter</span><h2>{selected.name}</h2></div>
              <a href="#criteria-list">Kriter listesine dön ↑</a>
            </div>
            <div className="inspector-topline">
              <div>
                <span className={`confidence ${selected.confidence}`}>{CONFIDENCE_LABELS[selected.confidence]}</span>
                <span className="origin-label">{selected.origin === "document" ? "AI tarafından belgeden çıkarıldı" : "Yönetici tarafından eklendi"}</span>
              </div>
              <label className="active-toggle">
                <input type="checkbox" checked={selected.active} onChange={(event) => { update({ active: event.target.checked }); setReviewConfirmed(false); }} />
                <span />
                {selected.active ? "Aktif" : "Pasif"}
              </label>
            </div>

            {selected.issue ? (
              <div className="conflict-box" role="alert">
                <div><strong>Kaynaklar arasında çakışma bulundu</strong><p>{selected.issue}</p></div>
                <div className="conflict-actions">
                  <button type="button" onClick={() => resolveConflict(true)}>Belgedeki değeri kullan</button>
                  <button type="button" onClick={() => resolveConflict(false)}>Başlangıç ayarını koru</button>
                </div>
              </div>
            ) : null}

            <div className="inspector-section edit-section">
              <span className="inspector-label">Kriter tanımı</span>
              <div className="form-grid two-col">
                <Field label="Kriter adı">
                  <input value={selected.name} onChange={(event) => { update({ name: event.target.value }); setReviewConfirmed(false); }} />
                </Field>
                <Field label="Kriter türü">
                  <select value={selected.type} onChange={(event) => { update({ type: event.target.value as CriterionType }); setReviewConfirmed(false); }}>
                    {(Object.keys(TYPE_LABELS) as CriterionType[]).map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                  </select>
                </Field>
                <Field label="Etkisi">
                  <select value={criterionEffect(selected)} onChange={(event) => { update({ effect: event.target.value as CriterionEffect }); setReviewConfirmed(false); }}>
                    {(Object.keys(EFFECT_LABELS) as CriterionEffect[]).map((effect) => <option key={effect} value={effect}>{EFFECT_LABELS[effect]}</option>)}
                  </select>
                </Field>
                <Field label="Değerlendirme yöntemi">
                  <select value={selected.evaluationMethod} onChange={(event) => { update({ evaluationMethod: event.target.value as EvaluationMethod }); setReviewConfirmed(false); }}>
                    {(Object.keys(METHOD_LABELS) as EvaluationMethod[]).map((method) => <option key={method} value={method}>{METHOD_LABELS[method]}</option>)}
                  </select>
                </Field>
                <Field label="Kapsam / aşama">
                  <input value={selected.scope || "Genel"} onChange={(event) => { update({ scope: event.target.value }); setReviewConfirmed(false); }} />
                </Field>
                {criterionEffect(selected) === "score" ? (
                  <Field label="Azami puan">
                    <input
                      type="number"
                      min={0}
                      value={selected.maxScore ?? ""}
                      placeholder="Belirtilmemiş"
                      onChange={(event) => {
                        const next = event.target.value === "" ? null : Number(event.target.value);
                        update({ maxScore: next, weight: next });
                        setReviewConfirmed(false);
                      }}
                    />
                  </Field>
                ) : null}
                <Field label="Zorunluluk">
                  <select value={selected.required ? "required" : "optional"} onChange={(event) => { update({ required: event.target.value === "required" }); setReviewConfirmed(false); }}>
                    <option value="required">Zorunlu</option>
                    <option value="optional">İsteğe bağlı / bilgi</option>
                  </select>
                </Field>
                <Field label="İhlal sonucunda">
                  <input value={selected.violationOutcome} onChange={(event) => { update({ violationOutcome: event.target.value }); setReviewConfirmed(false); }} />
                </Field>
              </div>
            </div>

            <div className="inspector-section evidence-section">
              <div className="inspector-section-heading">
                <span className="inspector-label">Belgedeki dayanak</span>
                {selected.sourcePage && documentUrl ? (
                  <a href={`${documentUrl}#page=${selected.sourcePage}`} target="_blank" rel="noreferrer">Kaynak sayfayı aç · s. {selected.sourcePage} ↗</a>
                ) : <span>Kaynak sayfa yok</span>}
              </div>
              <blockquote>{selected.sourceText}</blockquote>
            </div>

            <div className="inspector-section ai-section">
              <span className="inspector-label">Sistem önerisi</span>
              <textarea value={selected.aiInterpretation} onChange={(event) => { update({ aiInterpretation: event.target.value }); setReviewConfirmed(false); }} />
              {selected.evaluationMethod === "human" || selected.evaluationMethod === "hybrid" ? (
                <p className="human-authority-note">Bu kontrol için sistem yalnızca bulgu sunar. Nihai karar hakem, jüri veya sorumlu görevlidedir.</p>
              ) : null}
              <div className="ai-meta">
                <span>Güven seviyesi</span>
                <select value={selected.confidence} onChange={(event) => { update({ confidence: event.target.value as Confidence }); setReviewConfirmed(false); }}>
                  {(Object.keys(CONFIDENCE_LABELS) as Confidence[]).map((confidence) => <option key={confidence} value={confidence}>{CONFIDENCE_LABELS[confidence]}</option>)}
                </select>
                <span className="provider-note">
                  {result.provider === "api" ? "AI modeli · sunucu analizi" : "Yerel demo motoru"}
                </span>
              </div>
            </div>

            {selected.id.startsWith("manual-") ? (
              <div className="inspector-section delete-section">
                <span className="inspector-label">Kriteri kaldır</span>
                {confirmingDelete ? (
                  <div className="delete-confirm-row" role="alertdialog" aria-label="Kriter silme onayı">
                    <p><strong>“{selected.name}”</strong> kalıcı olarak silinecek. Emin misiniz?</p>
                    <div>
                      <button type="button" className="danger-button" onClick={removeSelectedCriterion}>Evet, kriteri sil</button>
                      <button type="button" className="text-button" onClick={() => setConfirmingDelete(false)}>Vazgeç</button>
                    </div>
                  </div>
                ) : (
                  <div className="delete-confirm-row">
                    <p>Yanlışlıkla veya fazladan eklenen kriterler buradan kaldırılabilir. Belgeden çıkarılan kriterler silinmez; pasifleştirilir.</p>
                    <div>
                      <button type="button" className="danger-button ghost" onClick={() => setConfirmingDelete(true)}>Kriteri sil</button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="approval-bar">
        <button type="button" className="back-button" onClick={onBack}>← Kaynak belgeye dön <small>Taslak korunur</small></button>
        <div className="approval-check">
          <label>
            <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
            <span>Aktif kriterleri, kaynaklarını, puan planını ve görevli onayı gerektiren kontrolleri inceledim.</span>
          </label>
          {!canApprove ? (
            <small>
              {conflicts > 0 && `${conflicts} çakışmayı çözün. `}
              {!reviewConfirmed && "Görevli kontrolünü onaylayın."}
            </small>
          ) : <small className="ready-note">Profil onaya hazır.</small>}
        </div>
        <button type="button" className="primary-button" disabled={!canApprove} onClick={onApprove}>Profili onayla <span>→</span></button>
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
  const scoreCriteria = active.filter((item) => criterionEffect(item) === "score");
  const scoreTotal = profile.scorePlan?.declaredTotalScore
    ?? scoreCriteria.reduce((sum, item) => sum + (item.maxScore ?? 0), 0);
  const decisionRules = profile.decisionRules ?? deriveDecisionRules(profile.criteria, profile.scorePlan);

  function downloadProfile() {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.setup.year}-${profile.setup.competition.replace(/\s+/g, "-").toLocaleLowerCase("tr-TR")}-profil-v1.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace ready-workspace" aria-labelledby="ready-title">
      <div className="ready-hero">
        <span className="approval-seal" aria-hidden="true">✓</span>
        <span className="section-kicker">Onaylı değerlendirme profili</span>
        <h1 id="ready-title">Kurallar artık tek ve izlenebilir bir profilde</h1>
        <p>
          {profile.setup.competition} · {profile.setup.reportType} için kriterler yönetici tarafından doğrulandı.
          Bu profil sonraki aşamada katılımcı raporlarını değerlendirmek için kullanılabilir.
        </p>
        <div className="ready-actions">
          <button type="button" className="primary-button" onClick={downloadProfile}>Profil JSON’unu indir</button>
          <button type="button" className="secondary-button" onClick={onEdit}>Kriterleri yeniden düzenle</button>
        </div>
      </div>

      <div className="profile-sheet">
        <div className="profile-sheet-header">
          <div><span>Profil kimliği</span><strong>{profile.setup.year} / {profile.setup.stage} / v1.0</strong></div>
          <span className="status-chip success">Onaylandı</span>
        </div>
        <dl className="profile-facts">
          <div><dt>Yarışma</dt><dd>{profile.setup.competition}</dd></div>
          <div><dt>Kategori</dt><dd>{profile.setup.category}</dd></div>
          <div><dt>Rapor</dt><dd>{profile.setup.reportType}</dd></div>
          <div><dt>Kaynak</dt><dd>{profile.sourceDocument.name}</dd></div>
        </dl>
        <div className="profile-metrics">
          <div><strong>{active.length}</strong><span>aktif kural</span></div>
          <div><strong>{profile.scorePlan?.groups.length ?? scoreCriteria.length}</strong><span>puan grubu</span></div>
          <div><strong>{scoreTotal || "—"}</strong><span>PDF toplam puanı</span></div>
          <div><strong>{profile.sourceDocument.pages}</strong><span>kaynak sayfa</span></div>
        </div>
        {scoreTotal ? (
          <div className="profile-footer-note">
            <span>Puan gösterimi</span>
            <p>
              Değerlendirme orijinal sistemle, {scoreTotal} puan üzerinden yapılır; sonuç
              (alınan puan ÷ {scoreTotal}) × 100 formülüyle 100 üzerinden raporlanır.
            </p>
          </div>
        ) : null}
        <div className="profile-footer-note">
          <span>Karar kuralları</span>
          <p>
            Geçiş koşulu {decisionRules.gates.length} · Baraj {decisionRules.thresholds.length} ·
            Ceza {decisionRules.penalties.length} · Eleme {decisionRules.eliminations.length} madde
            toplam puandan bağımsız olarak ayrıca denetlenir.
          </p>
        </div>
        <div className="profile-footer-note">
          <span>Sonraki modül</span>
          <p>Katılımcı raporundaki kanıtları bu onaylı kriterlerle eşleştirme ve gerekçeli puan önerisi.</p>
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
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState("");
  const [draftReady, setDraftReady] = useState(false);

  const backgroundLabel = useMemo(() => `${setup.competition} · ${setup.reportType}`, [setup]);

  useEffect(() => {
    let active = true;
    async function restoreDraft() {
      const snapshot = loadDraftSnapshot();
      const storedFile = await loadDraftFile();
      if (!active) return;
      if (snapshot) {
        const restoredCriteria = snapshot.criteria.map(applyDecisionSafetyPolicy);
        setSetup(snapshot.setup);
        setResult(snapshot.result);
        setCriteria(restoredCriteria);
        setProfile(snapshot.profile ? { ...snapshot.profile, criteria: snapshot.profile.criteria.map(applyDecisionSafetyPolicy) } : null);
      }
      if (storedFile) {
        setFile(storedFile);
        setDocumentUrl(URL.createObjectURL(storedFile));
      }
      if (snapshot) {
        const safeStep = snapshot.step === 4 && !snapshot.profile
          ? 3
          : snapshot.step === 3 && (!snapshot.result || !storedFile)
            ? 2
            : snapshot.step;
        setStep(safeStep);
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

  async function analyze() {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      setLoadingMessage("PDF sayfa yapısı doğrulanıyor…");
      const pageCount = await getPdfPageCount(file);
      setLoadingMessage("PDF, yapısı korunarak AI modele aktarılıyor…");
      const analysis = await analyzeWithGemini(file, setup, pageCount);
      setLoadingMessage("Kaynak sayfaları ve güven açıklamaları eşleştiriliyor…");
      if (!analysis.criteria.length) {
        throw new Error("Belgede güvenilir bir değerlendirme kriteri bulunamadı.");
      }
      setResult(analysis);
      setCriteria(analysis.criteria.map(applyDecisionSafetyPolicy));
      setStep(3);
    } catch (analysisError) {
      const message = analysisError instanceof Error ? analysisError.message : "Bilinmeyen bir hata oluştu.";
      setError(`${message} API bağlantısını, kotayı veya kaynak belgenin geçerliliğini kontrol edin.`);
    } finally {
      setLoading(false);
    }
  }

  function approve() {
    if (!file || !result) return;
    const declaredTotal = result.scorePlan?.declaredTotalScore ?? null;
    const nextProfile: ProfileExport = {
      version: "1.0",
      status: "approved",
      setup,
      sourceDocument: {
        name: file.name,
        pages: result.pageCount,
        analyzedAt: result.analyzedAt,
      },
      criteria,
      skippedChecks: result.skippedChecks,
      scorePlan: result.scorePlan,
      normalization: {
        declaredTotal,
        normalizedTo: 100,
        formula: declaredTotal
          ? `(alınan puan / ${declaredTotal}) × 100`
          : "Belgede genel toplam ilan edilmediği için normalizasyon uygulanmaz.",
      },
      decisionRules: deriveDecisionRules(criteria, result.scorePlan),
    };
    localStorage.setItem("kriter-atolyesi:last-profile", JSON.stringify(nextProfile));
    setProfile(nextProfile);
    setStep(4);
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
    setError("");
    clearDraftSnapshot();
    saveDraftFile(null).catch(() => undefined);
  }

  const completedSteps = useMemo(() => {
    const completed = new Set<Step>();
    if (step > 1 || file) completed.add(1);
    if (result && file) {
      completed.add(2);
      completed.add(3);
    }
    if (profile) completed.add(4);
    return completed;
  }, [file, profile, result, step]);

  function navigate(nextStep: Step) {
    if (nextStep === 3 && (!result || !file)) return;
    if (nextStep === 4 && !profile) return;
    setStep(nextStep);
  }

  return (
    <main className="app-shell">
      {/*
        THESIS: Kaynak belge ile onaylı kural arasındaki zinciri tek çalışma masasında görünür kılar; genel dashboard düzenini reddeder.
        OWN-WORLD: Soğuk beyaz kâğıt yüzey, lacivert mürekkep, turkuaz kanıt bağlantıları, kehribar belirsizlik ve sıkı belge satırları.
        STORY: Yönetici çerçeveyi kurar, resmî PDF'yi yükler, AI çıkarımlarını kaynaklarıyla düzeltir ve sürümlü profili onaylar.
        FIRST VIEWPORT: Solda dört adımlı sabit süreç izi; ortada tek aktif görev ve sağda yalnızca o göreve ait özet/kanıt yüzeyi.
        FORM: Operasyonel inceleme masası; belge defteri ve karar tutanağı biçimlerinin birleşimi.
      */}
      <StepRail step={step} completedSteps={completedSteps} onNavigate={navigate} />
      <div className="app-main">
        <Topbar step={step} />
        <div className="context-line" aria-hidden="true">{backgroundLabel}</div>
        {step === 1 ? (
          <SetupStep
            setup={setup}
            onChange={setSetup}
            onContinue={() => setStep(2)}
            file={file}
            result={result}
            criteria={criteria}
          />
        ) : null}
        {step === 2 ? (
          <UploadStep
            setup={setup}
            result={result}
            criteria={criteria}
            file={file}
            onFile={chooseFile}
            onSample={(sampleFile, sampleSetup) => {
              setSetup((current) => ({ ...current, ...sampleSetup }));
              chooseFile(sampleFile);
            }}
            onBack={() => setStep(1)}
            onAnalyze={analyze}
            loading={loading}
            loadingMessage={loadingMessage}
            error={error}
          />
        ) : null}
        {step === 3 && result && file ? (
          <CriteriaReview
            setup={setup}
            setSetup={setSetup}
            file={file}
            documentUrl={documentUrl}
            result={result}
            criteria={criteria}
            setCriteria={setCriteria}
            onBack={() => setStep(2)}
            onApprove={approve}
          />
        ) : null}
        {step === 4 && profile ? <ProfileReady profile={profile} onEdit={() => setStep(3)} onRestart={restart} /> : null}
      </div>
    </main>
  );
}
