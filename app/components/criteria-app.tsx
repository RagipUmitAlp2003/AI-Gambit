"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import DocumentLibraryModal from "./document-library-modal";
import FileBadge from "./file-badge";
import TemplatePreview from "./template-preview";
import TopbarSession from "./topbar-session";
import { analyzeWithGemini } from "../lib/gemini-analyzer";
import { criterionEffectOf as criterionEffect, deriveDecisionRules, maxRawScoreOf, scopeCriteriaToGroups } from "../lib/evaluation-summary";
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
import type {
  AnalysisResult,
  Confidence,
  Criterion,
  CriterionApplicability,
  CriterionEffect,
  CriterionType,
  ProfileExport,
  ScorePlan,
  SetupData,
  Step,
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
};

const STEPS = [
  { id: 1, title: "Kaynak belge", short: "Resmî kriter PDF'si" },
  { id: 2, title: "Kriter inceleme", short: "Belgeden çıkan kuralları doğrula" },
  { id: 3, title: "Kriter profilini yayımla", short: "Yarışmayı başvuruya hazırla" },
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

const EFFECT_LABELS: Record<CriterionEffect, string> = {
  gate: "Zorunlu uygunluk koşulu",
  score: "Puanlama kriteri",
  penalty: "Toplam puandan kesinti",
  threshold: "Asgari puan veya sonuç şartı",
  advisory: "Bilgi notu — sonucu doğrudan değiştirmez",
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Yüksek güven",
  medium: "Orta güven",
  low: "Düşük güven",
};

const APPLICABILITY_LABELS: Record<CriterionApplicability, string> = {
  report: "Katılımcı PDF içeriğinde aranır",
  upload: "Yüklenen dosyanın özelliğinden kontrol edilir",
  physical: "Saha / fiziksel aşamada kontrol edilir",
  external: "Haricî onay veya insan kararı gerekir",
  informational: "Yalnızca bilgi ve kaynak notudur",
};

const EVIDENCE_LABELS = {
  verified: "Kaynak ve anlam doğrulandı",
  partial: "Kaynak kısmen doğrulandı",
  not_found: "Kaynak metin bulunamadı",
  contradicted: "Belgeyle çelişiyor",
  not_run: "Kaynak doğrulaması tamamlanmadı",
} as const;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function applyDecisionSafetyPolicy(item: Criterion): Criterion {
  const reviewStatus = item.reviewStatus
    ?? (!item.active && item.issue ? "needs_review" : item.active ? "ready" : "excluded");
  return { ...item, reviewStatus };
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

function Topbar({ step, onBack }: { step: Step; onBack: () => void }) {
  const current = STEPS.find((item) => item.id === step)!;
  return (
    <header className="topbar">
      <div className="topbar-lead">
        <button type="button" className="topbar-back" onClick={onBack} aria-label="Geri dön" title="Geri dön">
          <span aria-hidden="true">←</span>
        </button>
        <div>
          <span className="topbar-context">P4 · Değerlendirme karar destek sistemi</span>
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
          <h1 id="upload-title">Resmî değerlendirme belgesini yükleyin</h1>
          <p>Buraya katılımcı projesi değil; kriterleri, yazım kurallarını ve ihlal sonuçlarını anlatan PDF yüklenir.</p>
        </div>
        <span className="step-fraction">1 / 3</span>
      </div>

      <div className="source-explainer">
        <span className="explainer-mark">K</span>
        <div>
          <strong>Bu belge, değerlendirme profilinin kaynağı olacak.</strong>
          <p>AI önce belgeyi yorumlayacak; hiçbir çıkarım yönetici onayı olmadan uygulanmayacak.</p>
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
              <p>veya bilgisayarınızdan bir değerlendirme kılavuzu seçin</p>
              <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>PDF seç</button>
            </div>
          )}
        </div>
        <div className="template-upload-card">
          <div>
            <span className="section-kicker">İsteğe bağlı ikinci kaynak</span>
            <h2>Resmî rapor şablonu</h2>
            <p>Yarışmacı raporunda aranacak zorunlu ana başlıkları daha doğru belirlemek için ekleyebilirsiniz. Şablon, puan veya yeni yarışma kuralı üretmek için kullanılmaz.</p>
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
  includedGroupIds,
  setIncludedGroupIds,
  scoringEnabled,
  setScoringEnabled,
  onScorePlanChange,
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
  includedGroupIds: string[];
  setIncludedGroupIds: (groupIds: string[]) => void;
  scoringEnabled: boolean;
  setScoringEnabled: (enabled: boolean) => void;
  onScorePlanChange: (scorePlan: ScorePlan) => void;
  onBack: () => void;
  onApprove: () => void;
  approvalError: string;
}) {
  const [selectedId, setSelectedId] = useState(criteria[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | "needs_review">("all");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const selected = criteria.find((item) => item.id === selectedId) ?? criteria[0];
  const scopes = [...new Set(criteria.map((item) => item.scope || "Genel"))];
  const pendingReview = criteria.filter((item) => item.reviewStatus === "needs_review");
  const filtered = criteria.filter((item) => {
    const queryMatch = item.name.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR"));
    const scopeMatch = scopeFilter === "all" || (item.scope || "Genel") === scopeFilter;
    const reviewMatch = reviewFilter === "all" || item.reviewStatus === "needs_review";
    return queryMatch && scopeMatch && reviewMatch;
  }).sort((left, right) => {
    const rank = (item: Criterion) => item.reviewStatus === "needs_review" ? 3
      : ["physical", "external", "informational"].includes(item.applicability || "report") ? 2
        : item.active ? 0 : 1;
    return rank(left) - rank(right);
  });
  const active = criteria.filter((item) => item.active);
  const scorePlan = result.scorePlan;
  const displayTotal = scorePlan?.declaredTotalScore ?? null;
  const scoreGroupCount = scorePlan?.groups.length ?? active.filter((item) => criterionEffect(item) === "score").length;
  const humanReviewCount = active.filter((item) => ["human", "hybrid"].includes(item.evaluationMethod)).length;
  const deterministicCount = active.filter((item) => item.evaluationMethod === "deterministic").length;
  const groups = scorePlan?.groups ?? [];
  // Kapsam kararı yalnızca kimlik üzerinden verilir; aynı isimli iki grup karışmaz.
  // Eski analizlerde grup kimliği yoktur: kapsam daraltması uygulanamaz, tüm
  // gruplar dahil sayılır (aksi hâlde profil hiç onaylanamaz hâle gelirdi).
  const groupsHaveIds = groups.some((group) => group.id);
  const included = groupsHaveIds
    ? groups.filter((group) => group.id && includedGroupIds.includes(group.id))
    : groups;
  const includedIds = new Set(included.map((group) => group.id));
  // Rozet, onay kutusu ve hesaplama aynı kaynağı kullanır ki gösterim ile
  // gerçek kapsam birbirinden ayrılmasın.
  const isIncluded = (group: { id?: string }) => (groupsHaveIds ? Boolean(group.id && includedGroupIds.includes(group.id)) : true);
  // Kapsam dışı gruplara bağlı kriterler pasifleştirilir. Puan gösterimi PDF'nin
  // resmî ölçeğini korur; kriter toplamı bu ölçekle uyuşmuyorsa profil onaylanmaz.
  const scopedCriteria = scopeCriteriaToGroups(criteria, groups, includedIds);
  const criterionTotal = maxRawScoreOf(scopedCriteria);
  const groupTotal = included.reduce((sum, group) => sum + group.maxScore, 0);
  const officialTotal = scoringEnabled ? (groups.length ? groupTotal : (displayTotal ?? criterionTotal)) : 0;
  // Eski kayıtlarda veya görevli düzenlemesinden sonra toplam farklılaşırsa
  // bilgi verilir; yeni analizlerde puan kapsamı motor tarafından dengelenir.
  const scoreDifferenceNote = officialTotal > 0 && criterionTotal !== officialTotal
    ? `Aktif puan kriterleri ${criterionTotal}, PDF'nin seçili grupları ${officialTotal} puan ediyor. Onaydan önce puan alanlarını gözden geçirmeniz önerilir.`
    : null;
  // Şartname birden çok aşamayı topluyorsa yalnızca kapsama alınan gruplar puanlanır.
  const scopeNarrowed = groups.length > 1 && included.length > 0 && included.length < groups.length;
  const canApprove = reviewConfirmed && pendingReview.length === 0 && active.length > 0
    && (!scoringEnabled || groups.length === 0 || included.length > 0);

  function toggleGroup(groupId: string, on: boolean) {
    setIncludedGroupIds(on ? [...includedGroupIds, groupId] : includedGroupIds.filter((item) => item !== groupId));
    setReviewConfirmed(false);
  }

  function update(patch: Partial<Criterion>) {
    setCriteria(criteria.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  }

  function updateDeclaredTotal(value: number | null) {
    if (!scorePlan) return;
    const groupTotal = scorePlan.groups.reduce((sum, group) => sum + group.maxScore, 0);
    const matched = value !== null && Math.abs(groupTotal - value) < 0.01;
    onScorePlanChange({
      ...scorePlan,
      declaredTotalScore: value,
      auditStatus: value === null ? "not_declared" : matched ? "matched" : "mismatch",
      auditMessage: value === null
        ? "Belgede genel toplam açıkça belirtilmemiş olarak işaretlendi."
        : matched
          ? `Görevlinin doğruladığı PDF toplamı ile puan grupları eşleşiyor (${value} puan).`
          : `Görevlinin girdiği PDF toplamı ${value}; mevcut üst düzey puan grupları ${groupTotal} puan ediyor. Grup değerlerini de kaynak tabloyla karşılaştırın.`,
    });
    setReviewConfirmed(false);
  }

  function resolvePendingCriterion(decision: "confirm" | "exclude") {
    if (!selected) return;
    update({
      active: decision === "confirm",
      reviewStatus: decision === "confirm" ? "confirmed" : "excluded",
      confidence: decision === "confirm" ? "high" : selected.confidence,
      evidence: selected.evidence ? {
        status: decision === "confirm" ? "verified" : selected.evidence.status,
        reason: decision === "confirm"
          ? "Görevli PDF sayfasını ve alıntıyı doğrudan kontrol ederek doğruladı."
          : "Görevli bu bulgunun uygulanabilir bir değerlendirme kriteri olmadığına karar verdi.",
      } : undefined,
      issue: decision === "confirm"
        ? "Görevli kaynak sayfayı kontrol ederek bu kriteri onayladı."
        : "Görevli bu bulgunun değerlendirme kriteri olmadığına karar verdi.",
    });
    setReviewConfirmed(false);
  }

  function addCriterion() {
    const added: Criterion = {
      id: `manual-${Date.now()}`,
      name: "Yeni kriter",
      type: "qualitative_score",
      maxScore: null,
      weight: null,
      required: false,
      violationOutcome: "Belirtiniz",
      evaluationMethod: "human",
      sourcePage: null,
      sourceText: "Kaynak metni buraya yazın.",
      aiInterpretation: "Kriterin nasıl uygulanacağını açıklayın.",
      confidence: "high",
      active: true,
      origin: "manager",
      reviewStatus: "confirmed",
      effect: "advisory",
      scope: setup.stage || "Genel",
      applicability: "report",
    };
    setCriteria([...criteria, added]);
    setSelectedId(added.id);
    setScopeFilter("all");
    setReviewFilter("all");
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

  return (
    <section className="workspace review-workspace" aria-labelledby="review-title">
      <div className="review-heading">
        <div>
          <span className="section-kicker">Belgeden çıkarılan taslak</span>
          <h1 id="review-title">Kriterleri doğrulayın ve kesinleştirin</h1>
          <p>{file.name} · {result.pageCount} sayfa · Her çıkarım kaynağıyla birlikte gösteriliyor.</p>
        </div>
        <span className="step-fraction">2 / 3</span>
      </div>

      <div className="analysis-summary" aria-label="Analiz özeti">
        <div><strong>{active.length}</strong><span>aktif kural</span></div>
        <div><strong>{scoreGroupCount}</strong><span>puan grubu</span></div>
        <div><strong>{deterministicCount}</strong><span>kesin kontrol</span></div>
        <div><strong>{humanReviewCount}</strong><span>görevli onayı</span></div>
        <div className="summary-ok"><strong>{result.provider === "api" ? "AI" : "Demo"}</strong><span>çıkarım kaynağı</span></div>
        <div><strong>{displayTotal ?? "—"}</strong><span>PDF toplam puanı</span></div>
      </div>

      <section className="fixed-prechecks" aria-labelledby="fixed-prechecks-title">
        <div className="criteria-section-heading">
          <div>
            <span className="section-kicker">Her raporda önce çalışır</span>
            <h2 id="fixed-prechecks-title">Sabit ön kontroller</h2>
            <p>Bunlar şartnameden puan kriteri olarak çıkarılmaz; Hakem AI analizini başlattığında raporun temel uygunluğunu ayrı bir bölümde gösterir.</p>
          </div>
        </div>
        <div className="fixed-precheck-grid">
          {[
            ["PDF ve dosya kapısı", setup.allowedFormats.length || setup.maxFileSizeMb ? "Şartnamedeki tür ve boyut sınırlarıyla kontrol edilir." : "Belgede sınır yoksa yalnızca güvenli ve okunabilir PDF kontrol edilir."],
            ["Rapor dili", "Raporun dili tespit edilir; şartnamede açık bir dil kuralı varsa onunla karşılaştırılır."],
            ["Resmî şablon", result.templateProfile?.provided ? `${result.templateProfile.name} şablonu ve ${result.templateProfile.requiredHeadings.length} ana başlıkla karşılaştırılır.` : "Ayrı şablon yüklenmedi; yalnızca onaylı kriterlerdeki açık biçim kuralları uygulanır."],
            ["Başlık ve içerik", "Zorunlu bölümlerin varlığı ve boş bırakılıp bırakılmadığı kanıtlarıyla gösterilir."],
            ["Kategori uygunluğu", "Rapor içeriğinin seçilen yarışma, kategori, yıl ve aşamayla ilişkisi incelenir."],
            ["Benzerlik işareti", "Yalnızca aynı yarışma, yıl ve aşamadaki raporlarla karşılaştırılır; sistem otomatik ihlal veya diskalifiye kararı vermez."],
          ].map(([name, detail], index) => (
            <article key={name}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{name}</strong><p>{detail}</p></div></article>
          ))}
        </div>
      </section>

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
            {scorePlan?.auditStatus === "matched" ? "Toplam doğrulandı" : scorePlan?.auditStatus === "mismatch" ? "Toplam yeniden kontrol edilmeli" : "Genel toplam belirtilmemiş"}
          </span>
        </div>
        <label className="score-mode-toggle">
          <input
            type="checkbox"
            checked={scoringEnabled}
            onChange={(event) => { setScoringEnabled(event.target.checked); setReviewConfirmed(false); }}
          />
          <span><strong>PDF aşamasında puanlamayı kullan</strong><small>Kapalı olduğunda saha ve puan maddeleri kaynak referansı olarak korunur, sonuç toplamına girmez.</small></span>
        </label>
        {scorePlan && scoringEnabled ? (
          <div className="score-total-review">
            <div>
              <strong>PDF’de yazan resmî toplam puan</strong>
              <p>AI bu sayıyı yanlış okuduysa yalnızca PDF’de gördüğünüz toplamı yazın. Sistem puan gruplarını yeniden karşılaştırır.</p>
            </div>
            <label>
              <span>Toplam puan</span>
              <input
                type="number"
                min={0}
                value={scorePlan.declaredTotalScore ?? ""}
                placeholder="Belirtilmemiş"
                onChange={(event) => updateDeclaredTotal(event.target.value === "" ? null : Number(event.target.value))}
              />
            </label>
          </div>
        ) : null}
        {result.scoreAudit && !result.scoreAudit.agrees ? (
          <p className="score-audit-note warning">
            İkinci, bağımsız tarama genel toplamı <strong>{result.scoreAudit.declaredTotalScore ?? "belirtilmemiş"}</strong>,
            grup toplamını <strong>{result.scoreAudit.groupTotal}</strong> olarak okudu. İki tarama aynı sonuca ulaşmadığı için kaynak tabloyu görevlinin doğrulaması gerekir.
          </p>
        ) : null}
        {scorePlan?.groups.length && scoringEnabled ? (
          <div className="score-group-list">
            {scorePlan.groups.map((group) => (
              <details key={group.id ?? `${group.name}-${group.sourcePage}`} className={`score-group-row ${isIncluded(group) ? "" : "excluded"}`}>
                <summary>
                  <span><strong>{group.name}</strong><small>{group.scope} · Sayfa {group.sourcePage}</small></span>
                  <span className="score-group-value">
                    {group.maxScore} puan
                    {!isIncluded(group)
                      ? <small>kapsam dışı</small>
                      : <small>resmî ölçekte</small>}
                  </span>
                </summary>
                <div>
                  <label className="group-include">
                    <input
                      type="checkbox"
                      checked={isIncluded(group)}
                      disabled={!group.id}
                      onChange={(event) => group.id && toggleGroup(group.id, event.target.checked)}
                    />
                    <span>
                      Bu grup değerlendirmeye dahil
                      <small>Kapsam dışı bırakılan gruplar bu profilin resmî puan hesabına girmez.</small>
                    </span>
                  </label>
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
        {scoringEnabled && officialTotal ? (
          <p className="normalization-note">
            {scopeNarrowed ? (
              <>
                Belgede ilan edilen genel toplam {displayTotal} puandır; bu profil yalnızca kapsama alınan
                {" "}{included.length} grubu değerlendirir. Sonuç, PDF’nin bu kapsam için tanımladığı
                {" "}{officialTotal} puanlık resmî ölçekle gösterilir.
              </>
            ) : (
              <>
                Yarışmanın orijinal puan sistemi korunur; sonuç {officialTotal} puanlık resmî ölçekle gösterilir.
              </>
            )}
          </p>
        ) : null}
        {scoringEnabled && groups.length > 1 && !included.length ? (
          <p className="score-audit-note warning">
            Hiçbir puan grubu kapsama alınmadı. Bu profille puan hesaplanamaz; en az bir grup seçin.
          </p>
        ) : null}
        {scoringEnabled && groups.length && !groupsHaveIds ? (
          <p className="score-audit-note">
            Bu analiz kapsam daraltmasını desteklemeyen eski veri modeliyle üretildi; tüm puan grupları
            dahil edilir. Grup bazlı kapsam seçimi için belgeyi yeniden analiz edin.
          </p>
        ) : null}
        {scoreDifferenceNote ? <p className="score-audit-note warning">{scoreDifferenceNote}</p> : null}
        <p className={`score-audit-note ${scorePlan?.auditStatus === "mismatch" ? "warning" : ""}`}>
          {scorePlan?.auditMessage ?? "Bu analiz eski veri modeliyle oluşturuldu. Güncel puan denetimi için belgeyi yeniden analiz edin."}
        </p>
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
            <div><h2>Kriter listesi</h2><p>AI çıkarımlarını doğrulayın veya belgede bulunan eksik bir kriteri kendiniz oluşturun.</p></div>
            <button type="button" className="secondary-button add-criterion-button" onClick={addCriterion}>
              <span aria-hidden="true">＋</span>
              <span><strong>Yeni kriter oluştur</strong><small>Tüm alanları elle doldur</small></span>
            </button>
          </div>
          {pendingReview.length ? (
            <div className="review-queue" role="status">
              <div>
                <strong>{pendingReview.length} bulgu görevli kararı bekliyor</strong>
                <p>Bu maddelerde eksik kanıt, anlam farkı veya tamamlanmamış doğrulama var. Profili yayımlamadan önce kaynak sayfayı kontrol edin.</p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setReviewFilter(reviewFilter === "needs_review" ? "all" : "needs_review");
                  if (reviewFilter !== "needs_review") setSelectedId(pendingReview[0].id);
                }}
              >
                {reviewFilter === "needs_review" ? "Tüm kriterleri göster" : "Karar bekleyenleri incele"}
              </button>
            </div>
          ) : (
            <div className="review-queue complete" role="status">
              <div><strong>Karar bekleyen bulgu yok</strong><p>Belirsiz çıkarımların tamamı görevli tarafından sonuçlandırıldı.</p></div>
            </div>
          )}
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
                  <small>{item.scope || "Genel"} · {EFFECT_LABELS[criterionEffect(item)]} · {item.sourcePage ? `Sayfa ${item.sourcePage}` : "Kaynak sayfa yok"}{item.evidence ? ` · ${EVIDENCE_LABELS[item.evidence.status]}` : ""}</small>
                </span>
                <span className={`criterion-value ${criterionEffect(item)}`}>
                  {criterionEffect(item) === "score" && item.maxScore !== null
                    ? `${item.maxScore} puan`
                    : criterionEffect(item) === "score"
                      ? "Puanlama"
                    : criterionEffect(item) === "penalty"
                      ? item.maxScore !== null ? `-${Math.abs(item.maxScore)} puan` : "Puan kesintisi"
                      : criterionEffect(item) === "threshold"
                        ? "Asgari sonuç"
                        : criterionEffect(item) === "gate"
                          ? "Uygunluk şartı"
                          : "Bilgi notu"}
                </span>
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
                {selected.evidence ? <span className="origin-label">{EVIDENCE_LABELS[selected.evidence.status]}</span> : null}
              </div>
              <label className="active-toggle">
                <input
                  type="checkbox"
                  checked={selected.active}
                  onChange={(event) => {
                    update({
                      active: event.target.checked,
                      reviewStatus: event.target.checked
                        ? "confirmed"
                        : selected.reviewStatus === "needs_review" ? "needs_review" : "excluded",
                    });
                    setReviewConfirmed(false);
                  }}
                />
                <span />
                {selected.active ? "Aktif" : "Pasif"}
              </label>
            </div>

            {selected.issue ? (
              <div className="audit-note" role="note">
                <strong>Kaynak doğrulama notu</strong>
                <p>{selected.issue}</p>
              </div>
            ) : null}

            {selected.reviewStatus === "needs_review" ? (
              <div className="pending-decision" role="group" aria-label="Belirsiz kriter kararı">
                <div>
                  <strong>Bu maddenin kaynak kanıtı kesinleşmedi</strong>
                  <p>PDF sayfasında koşulu, varsa sayısal değeri ve ihlal sonucunu birlikte kontrol edin. Tamamı destekleniyorsa kriteri etkinleştirin.</p>
                </div>
                <div>
                  <button type="button" className="primary-button" onClick={() => resolvePendingCriterion("confirm")}>Kaynağı doğruladım, kriteri etkinleştir</button>
                  <button type="button" className="secondary-button" onClick={() => resolvePendingCriterion("exclude")}>Kriter değil, dışarıda bırak</button>
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
                <Field label="Kapsam / aşama">
                  <input value={selected.scope || "Genel"} onChange={(event) => { update({ scope: event.target.value }); setReviewConfirmed(false); }} />
                </Field>
                <Field label="Kanıtın inceleneceği yer">
                  <select
                    value={selected.applicability || "report"}
                    onChange={(event) => { update({ applicability: event.target.value as CriterionApplicability }); setReviewConfirmed(false); }}
                  >
                    {(Object.keys(APPLICABILITY_LABELS) as CriterionApplicability[]).map((key) => (
                      <option key={key} value={key}>{APPLICABILITY_LABELS[key]}</option>
                    ))}
                  </select>
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
              {selected.origin === "manager" ? (
                <div className="manual-evidence-grid">
                  <Field label="Kaynak PDF sayfası" hint="Kriter PDF’de bulunuyorsa sayfa numarasını yazın; yeni yönetim kuralıysa boş bırakın.">
                    <input
                      type="number"
                      min={1}
                      max={result.pageCount}
                      value={selected.sourcePage ?? ""}
                      placeholder="Örn. 12"
                      onChange={(event) => {
                        update({ sourcePage: event.target.value === "" ? null : Number(event.target.value) });
                        setReviewConfirmed(false);
                      }}
                    />
                  </Field>
                  <Field label="İlgili metin" hint="Kriteri destekleyen cümleyi veya yönetici kararının dayanağını yazın.">
                    <textarea
                      value={selected.sourceText}
                      onChange={(event) => { update({ sourceText: event.target.value }); setReviewConfirmed(false); }}
                    />
                  </Field>
                </div>
              ) : <blockquote>{selected.sourceText}</blockquote>}
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
        <button type="button" className="icon-back" onClick={onBack} aria-label="Kaynak belgeye dön · taslak korunur" title="Kaynak belgeye dön · taslak korunur"><span aria-hidden="true">←</span></button>
        <div className="approval-check">
          <label>
            <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
            <span>Aktif kriterleri, kaynaklarını ve puan planını inceledim; karar bekleyen bulgu kalmadı.</span>
          </label>
          {!canApprove ? (
            <small>
              {scoringEnabled && groups.length > 0 && included.length === 0 && "En az bir puan grubunu değerlendirmeye dahil edin. "}
              {pendingReview.length > 0 && `${pendingReview.length} kanıt bulgusunu onaylayın veya dışarıda bırakın. `}
              {!reviewConfirmed && "Görevli kontrolünü onaylayın."}
            </small>
          ) : <small className="ready-note">Profil onaya hazır.</small>}
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
  const scoreCriteria = active.filter((item) => criterionEffect(item) === "score");
  const allGroups = profile.scorePlan?.groups ?? [];
  // Profilin bu kapsam için sakladığı resmî azami puan.
  const scoreTotal = profile.normalization?.evaluationTotal ?? maxRawScoreOf(profile.criteria);
  const declaredTotal = profile.scorePlan?.declaredTotalScore ?? null;
  const includedGroupCount = profile.normalization?.includedGroupIds?.length ?? allGroups.length;
  // Kapsam daraltması yalnızca gerçekten grup çıkarıldıysa vardır; puan
  // toplamlarının farklı olması tek başına daraltma anlamına gelmez.
  const scopeNarrowed = allGroups.length > 0 && includedGroupCount < allGroups.length;
  const scopeAnomaly = profile.normalization?.scopeAnomaly ?? null;
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
        <span className="section-kicker">Profil yayımlandı</span>
        <h1 id="ready-title">Kriter seti değerlendirmeye hazır</h1>
        <p>
          {profile.setup.competition} · {profile.setup.reportType} için doğruladığınız kriter ve puan kapsamı yayımlandı.
          Hakemler katılımcı raporlarını yalnızca bu sürümlü profile göre değerlendirebilir.
        </p>
        <div className="ready-actions">
          <button type="button" className="primary-button" onClick={downloadProfile}>Profil JSON’unu indir</button>
          <button type="button" className="secondary-button" onClick={onEdit}>Kriterleri yeniden düzenle</button>
        </div>
      </div>

      <div className="profile-sheet">
        <div className="profile-sheet-header">
          <div><span>Profil kimliği</span><strong>{profile.setup.year} / {profile.setup.stage} / v1.0</strong></div>
          <span className="status-chip success">Yayında</span>
        </div>
        <dl className="profile-facts">
          <div><dt>Yarışma</dt><dd>{profile.setup.competition}</dd></div>
          <div><dt>Kategori</dt><dd>{profile.setup.category}</dd></div>
          <div><dt>Rapor</dt><dd>{profile.setup.reportType}</dd></div>
          <div><dt>Kaynak</dt><dd>{profile.sourceDocument.name}</dd></div>
        </dl>
        <div className="profile-metrics">
          <div><strong>{active.length}</strong><span>aktif kural</span></div>
          <div><strong>{includedGroupCount || scoreCriteria.length}</strong><span>puan grubu</span></div>
          <div><strong>{scoreTotal || "—"}</strong><span>resmî azami puan</span></div>
          <div><strong>{profile.sourceDocument.pages}</strong><span>kaynak sayfa</span></div>
        </div>
        {scoreTotal ? (
          <div className="profile-footer-note">
            <span>Puan gösterimi</span>
            <p>
              {scopeNarrowed
                ? `Belgede ilan edilen genel toplam ${declaredTotal ?? "belirtilmemiş"} puandır; bu profil ${allGroups.length} puan grubundan ${includedGroupCount} tanesini kapsama aldı ve ${scoreTotal} puanlık resmî ölçeği kullanır.`
                : `Değerlendirme belgenin orijinal sistemiyle, ${scoreTotal} puan üzerinden yapılır.`}
            </p>
            {scopeAnomaly ? <p className="score-audit-note warning">{scopeAnomaly}</p> : null}
          </div>
        ) : null}
        <div className="profile-footer-note">
          <span>Puan dışı kurallar</span>
          <p>
            Uygunluk koşulu {decisionRules.gates.length} · En düşük sonuç {decisionRules.thresholds.length} ·
            Puan kesintisi {decisionRules.penalties.length} · Eleme incelemesi {decisionRules.eliminations.length} madde
            toplam puandan bağımsız olarak ayrıca denetlenir.
          </p>
        </div>
        <div className="profile-footer-note">
          <span>Sonraki adım</span>
          <p>
            Katılımcı raporları bu profile göre analiz edilir. Kriter değişikliği gerekiyorsa Yarışma Yöneticisi
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
  const [includedGroupIds, setIncludedGroupIds] = useState<string[]>([]);
  const [scoringEnabled, setScoringEnabled] = useState(true);
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
      const legacyManagerDraft = Boolean(snapshot && (
        !snapshot.result?.setup
        || snapshot.criteria.some((criterion) => (
          criterion.origin === "manager"
          && /belge yüklenmeden önce|başlangıç ayar/i.test(`${criterion.sourceText} ${criterion.aiInterpretation}`)
        ))
      ));
      if (snapshot && !legacyManagerDraft) {
        const restoredCriteria = snapshot.criteria.map(applyDecisionSafetyPolicy);
        setSetup(snapshot.result?.setup ?? snapshot.setup ?? DEFAULT_SETUP);
        setResult(snapshot.result);
        setCriteria(restoredCriteria);
        // Eski taslaklarda kapsam bilgisi yok; tüm gruplar dahil sayılır.
        // Eski taslaklar kapsamı isimle tutuyordu; kimliğe göç ettirilir.
        const restoredGroups = snapshot.result?.scorePlan?.groups ?? [];
        const legacyNames = snapshot.includedGroups;
        setIncludedGroupIds(
          snapshot.includedGroupIds
          ?? (legacyNames
            ? restoredGroups.filter((group) => legacyNames.includes(group.name)).flatMap((group) => (group.id ? [group.id] : []))
            : restoredGroups.flatMap((group) => (group.id ? [group.id] : []))),
        );
        setScoringEnabled(snapshot.scoringEnabled ?? snapshot.profile?.normalization?.scoringEnabled ?? true);
        setProfile(snapshot.profile ? { ...snapshot.profile, criteria: snapshot.profile.criteria.map(applyDecisionSafetyPolicy) } : null);
      } else if (legacyManagerDraft) {
        // Önceki dört adımlı sürümün yönetici ayarları artık geçerli değildir.
        // Kaynak dosya korunur; belge yeni, yalnızca-PDF akışıyla yeniden analiz edilir.
        setSetup(DEFAULT_SETUP);
        setResult(null);
        setCriteria([]);
        setProfile(null);
        setIncludedGroupIds([]);
        setScoringEnabled(true);
      }
      if (storedFile) {
        setFile(storedFile);
        setDocumentUrl(URL.createObjectURL(storedFile));
      }
      if (storedTemplateFile) setTemplateFile(storedTemplateFile);
      if (snapshot && !legacyManagerDraft) setStep(snapshot.profile ? 3 : snapshot.result && storedFile ? 2 : 1);
      else setStep(1);
      setDraftReady(true);
    }
    restoreDraft();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    saveDraftSnapshot({ step, setup, result, criteria, profile, includedGroupIds, scoringEnabled });
  }, [criteria, draftReady, includedGroupIds, profile, result, scoringEnabled, setup, step]);

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
    setIncludedGroupIds([]);
    setScoringEnabled(true);
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
      setLoadingMessage("PDF, yapısı korunarak AI modele aktarılıyor…");
      const analysis = await analyzeWithGemini(file, pageCount, templateFile, templatePageCount);
      setLoadingMessage("Kaynak sayfaları ve güven açıklamaları eşleştiriliyor…");
      if (!analysis.criteria.length) {
        throw new Error("Belgede güvenilir bir değerlendirme kriteri bulunamadı.");
      }
      setResult(analysis);
      setSetup(analysis.setup);
      setCriteria(analysis.criteria.map(applyDecisionSafetyPolicy));
      // Varsayılan: belgedeki tüm puan grupları kapsamda; yönetici daraltabilir.
      setIncludedGroupIds((analysis.scorePlan?.groups ?? []).flatMap((group) => (group.id ? [group.id] : [])));
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
    const declaredTotal = result.scorePlan?.declaredTotalScore ?? null;
    const groups = result.scorePlan?.groups ?? [];
    const groupsHaveIds = groups.some((group) => group.id);
    const included = groupsHaveIds
      ? groups.filter((group) => group.id && includedGroupIds.includes(group.id))
      : groups;
    const includedIds = new Set(included.map((group) => group.id));

    // Kapsam dışı gruba bağlı kriterler profile pasif girer. Puan ölçeği PDF'deki
    // kapsanmış grup toplamıdır; otomatik 100'lük dönüşüm yapılmaz.
    const groupScopedCriteria = scopeCriteriaToGroups(criteria, groups, includedIds);
    const scopedCriteria = scoringEnabled ? groupScopedCriteria : groupScopedCriteria.map((criterion) => (
      ["score", "penalty", "threshold"].includes(criterionEffect(criterion))
        ? { ...criterion, active: false }
        : criterion
    ));
    const criterionTotal = maxRawScoreOf(scopedCriteria);
    const groupTotal = included.reduce((sum, group) => sum + group.maxScore, 0);
    const evaluationTotal = scoringEnabled ? (groups.length ? groupTotal : (declaredTotal ?? criterionTotal)) : 0;
    const scopeAnomaly = evaluationTotal > 0 && criterionTotal !== evaluationTotal
      ? `Puanlanabilir aktif kriterlerin azami toplamı ${criterionTotal}, PDF'nin bu kapsam için ilan ettiği resmî toplam ${evaluationTotal}.`
      : null;

    const nextProfile: ProfileExport = {
      version: "1.0",
      status: "approved",
      profileId: `profil-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      setup,
      sourceDocument: {
        name: file.name,
        pages: result.pageCount,
        analyzedAt: result.analyzedAt,
      },
      templateProfile: result.templateProfile,
      criteria: scopedCriteria,
      skippedChecks: result.skippedChecks,
      scorePlan: result.scorePlan,
      normalization: {
        scoringEnabled,
        declaredTotal,
        evaluationTotal,
        includedGroupIds: included.flatMap((group) => (group.id ? [group.id] : [])),
        scopeAnomaly,
      },
      decisionRules: deriveDecisionRules(scopedCriteria, result.scorePlan),
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
    setIncludedGroupIds([]);
    setScoringEnabled(true);
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
        OWN-WORLD: Soğuk beyaz kâğıt yüzey, lacivert mürekkep, turkuaz kanıt bağlantıları, kehribar belirsizlik ve sıkı belge satırları.
        STORY: Yönetici resmî PDF'yi yükler, belgeden çıkarılan kuralları kaynaklarıyla düzeltir ve sürümlü profili onaylar.
        FIRST VIEWPORT: Solda üç adımlı sabit süreç izi; ortada tek aktif görev ve yalnızca o göreve ait özet/kanıt yüzeyi.
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
            includedGroupIds={includedGroupIds}
            setIncludedGroupIds={setIncludedGroupIds}
            scoringEnabled={scoringEnabled}
            setScoringEnabled={setScoringEnabled}
            onScorePlanChange={(scorePlan) => setResult((current) => current ? { ...current, scorePlan } : current)}
            onBack={() => setStep(1)}
            onApprove={approve}
            approvalError={approvalError}
          />
        ) : null}
        {step === 3 && profile ? <ProfileReady profile={profile} onEdit={() => setStep(2)} onRestart={restart} /> : null}
      </div>
    </main>
  );
}
