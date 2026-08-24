"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import FileBadge from "./file-badge";
import DocumentLibraryModal from "./document-library-modal";
import { applyPenalties, criterionEffectOf, criterionEliminates, normalizeScoreDetailed } from "../lib/evaluation-summary";
import { extractPdfText } from "../lib/pdf-reader";
import { loadLastApprovedProfile, readProfileFile, saveActiveProfile } from "../lib/profile-loader";
import { createReportId, deleteReport, listReports, saveReport, type StoredReport } from "../lib/report-pool";
import { buildFileGateChecks, gateBlocksUpload, type SimilarityPeer } from "../lib/report-prechecks";
import { evaluateReport } from "../lib/report-evaluator";
import type {
  CheckStatus,
  FindingStatus,
  JudgeDecision,
  JudgeReview,
  ParticipantFeedback,
  PreCheck,
  ProfileExport,
  ReportEvaluation,
  ReportStatus,
} from "../lib/types";

type EvalView = 1 | 2 | 3;

const VIEWS = [
  { id: 1, title: "Rapor havuzu", short: "Yükleme ve ön kontrol" },
  { id: 2, title: "Hakem incelemesi", short: "Bulguları karara bağla" },
  { id: 3, title: "Yarışmacı görünümü", short: "Onaylı geri bildirim" },
] as const;

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  received: "Havuzda · analiz bekliyor",
  analyzing: "Analiz ediliyor",
  analyzed: "Analiz edildi · hakem bekliyor",
  reviewed: "Değerlendirme tamamlandı",
};

const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  passed: "Uygun",
  warning: "Uyarı",
  flagged: "İncelemeye işaretlendi",
  failed: "Uygun değil",
  skipped: "Çalıştırılmadı",
};

const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  met: "Karşılandı",
  partially_met: "Kısmen karşılandı",
  not_met: "Karşılanmadı",
  not_found: "Raporda bulunamadı",
  needs_human: "Görevli kararı bekliyor",
};

const VERDICT_LABELS: Record<JudgeDecision["verdict"], string> = {
  pending: "Karar bekliyor",
  accepted: "Öneri kabul edildi",
  adjusted: "Hakem düzeltti",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function feedbackToText(lines: string[]): string {
  return lines.join("\n");
}

/**
 * Yazarken satırlara ayırma kayıpsız yapılır: kırpma veya boş satır eleme
 * yapılmaz, aksi hâlde yazılan boşluk ve satır sonları anında geri alınır.
 * Temizlik yalnızca gösterim ve tamamlama anında uygulanır.
 */
function textToFeedback(value: string): string[] {
  return value.split("\n");
}

function normalizeFeedback(feedback: ParticipantFeedback): ParticipantFeedback {
  const clean = (lines: string[]) => lines.map((line) => line.trim()).filter(Boolean);
  return {
    strengths: clean(feedback.strengths),
    improvements: clean(feedback.improvements),
    suggestions: clean(feedback.suggestions),
  };
}

/**
 * Analiz bulgularından hakem karar taslağını kurar. Puan alanı boş başlar:
 * AI önerisi yalnızca ipucu olarak gösterilir, hakem değeri kendisi girer.
 */
function buildInitialReview(evaluation: ReportEvaluation): JudgeReview {
  return {
    status: "in_progress",
    decisions: evaluation.findings.map((finding) => ({
      criterionId: finding.criterionId,
      verdict: "pending",
      finalScore: null,
      penaltyPoints: null,
      note: "",
    })),
    overallNote: "",
    finalFeedback: {
      strengths: [...evaluation.feedbackDraft.strengths],
      improvements: [...evaluation.feedbackDraft.improvements],
      suggestions: [...evaluation.feedbackDraft.suggestions],
    },
    feedbackApproved: false,
    completedAt: null,
  };
}

type RuleAuditItem = {
  criterionId: string;
  name: string;
  detail: string;
  sourcePage: number | null;
  state: CheckStatus;
  label: string;
};

/**
 * Bir karar kuralının bu rapordaki durumu. Görevli kararı verilmeden hiçbir
 * madde "sağlandı" veya "sağlanmadı" olarak kapatılmaz; sistem tek başına
 * eleme veya geçiş hükmü kurmaz.
 */
function auditRule(status: FindingStatus | undefined, verdict: JudgeDecision["verdict"] | undefined): { state: CheckStatus; label: string } {
  if (!status || !verdict || verdict === "pending") return { state: "warning", label: "Görevli kararı bekliyor" };
  if (status === "met") return { state: "passed", label: "Sağlandı" };
  if (status === "not_met" || status === "not_found") return { state: "failed", label: "Sağlanmadı" };
  if (status === "partially_met") return { state: "flagged", label: "Kısmen sağlandı" };
  return { state: "passed", label: "Görevli değerlendirdi" };
}

function FeedbackField({ label, hint, lines, onChange }: {
  label: string;
  hint?: string;
  lines: string[];
  onChange: (lines: string[]) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        value={feedbackToText(lines)}
        onChange={(event) => onChange(textToFeedback(event.target.value))}
      />
    </Field>
  );
}

function CheckChip({ status }: { status: CheckStatus }) {
  return <span className={`eval-check-chip ${status}`}>{CHECK_STATUS_LABELS[status]}</span>;
}

function PreCheckList({ checks, title }: { checks: PreCheck[]; title: string }) {
  if (!checks.length) return null;
  return (
    <div className="eval-check-list">
      <span className="inspector-label">{title}</span>
      <ul>
        {checks.map((check) => (
          <li key={check.id}>
            <div>
              <strong>{check.name}</strong>
              <p>{check.detail}</p>
            </div>
            <CheckChip status={check.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvalRail({ view, counts, onNavigate }: {
  view: EvalView;
  counts: { pool: number; analyzed: number; completed: number };
  onNavigate: (view: EvalView) => void;
}) {
  const badges = [counts.pool, counts.analyzed, counts.completed];
  return (
    <nav className="step-rail" aria-label="Değerlendirme aşamaları">
      <div className="rail-heading">
        <span className="rail-mark">DA</span>
        <div>
          <strong>Değerlendirme Atölyesi</strong>
          <span>Rapor değerlendirme</span>
        </div>
      </div>
      <ol>
        {VIEWS.map((item, index) => {
          const state = item.id === view ? "active" : "upcoming";
          return (
            <li key={item.id} className={`rail-step ${state}`}>
              <button
                type="button"
                aria-current={state === "active" ? "step" : undefined}
                aria-label={`${item.title} — ${badges[index]} kayıt`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="step-index" aria-hidden="true">{badges[index]}</span>
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
          <strong>AI önerir, hakem kesinleştirir</strong>
          <p>Sistem eleme veya nihai puan kararı vermez; her sonuç hakem onayından geçer.</p>
        </div>
      </div>
      <Link className="eval-rail-link" href="/">← Kriter Atölyesi’ne dön</Link>
    </nav>
  );
}

function EvalTopbar({ view }: { view: EvalView }) {
  const current = VIEWS.find((item) => item.id === view)!;
  const role = view === 1 ? { mark: "PY", label: "Proje yöneticisi" } : view === 2 ? { mark: "HK", label: "Hakem / değerlendirici" } : { mark: "YR", label: "Yarışmacı görünümü" };
  return (
    <header className="topbar">
      <div>
        <span className="topbar-context">P4 · Değerlendirme karar destek sistemi</span>
        <strong>{current.title}</strong>
      </div>
      <div className="topbar-status">
        <span className="status-chip neutral">Yerel prototip</span>
        <span className="operator-avatar" aria-label={role.label}>{role.mark}</span>
      </div>
    </header>
  );
}

function ProfilePanel({ profile, error, onProfileFile }: {
  profile: ProfileExport | null;
  error: string;
  onProfileFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!profile) {
    return (
      <div className="eval-profile-panel empty">
        <div>
          <strong>Onaylı değerlendirme profili gerekli</strong>
          <p>
            Raporlar, Kriter Atölyesi’nde onaylanan kural profiline göre değerlendirilir.
            Bu cihazda onaylı profil bulunamadı.
          </p>
        </div>
        <div className="eval-profile-actions">
          <Link className="secondary-button" href="/">Kriter Atölyesi’nde profil oluştur</Link>
          <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>
            Profil JSON’u yükle
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden-input"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) onProfileFile(file); event.target.value = ""; }}
          />
        </div>
        {error ? <div className="inline-error eval-inline-error" role="alert"><strong>Profil yüklenemedi.</strong><span>{error}</span></div> : null}
      </div>
    );
  }
  const activeCount = profile.criteria.filter((item) => item.active).length;
  return (
    <div className="eval-profile-panel">
      <div>
        <span className="inspector-label">Aktif değerlendirme profili</span>
        <strong>{profile.setup.competition}</strong>
        <p>
          {profile.setup.reportType} · {profile.setup.category} · {profile.setup.year}
          {" · "}{activeCount} aktif kural · Kaynak: {profile.sourceDocument.name}
        </p>
      </div>
      <div className="eval-profile-actions">
        <button type="button" className="text-button" onClick={() => inputRef.current?.click()}>Farklı profil yükle</button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden-input"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) onProfileFile(file); event.target.value = ""; }}
        />
      </div>
      {error ? <div className="inline-error eval-inline-error" role="alert"><strong>Profil yüklenemedi.</strong><span>{error}</span></div> : null}
    </div>
  );
}

function PoolView({ profile, profileError, onProfileFile, records, uploadError, analyzingId, onUpload, onAnalyze, onDelete, onOpenReview }: {
  profile: ProfileExport | null;
  profileError: string;
  onProfileFile: (file: File) => void;
  records: StoredReport[];
  uploadError: string;
  analyzingId: string | null;
  onUpload: (file: File, participant: string) => Promise<boolean>;
  onAnalyze: (record: StoredReport) => void;
  onDelete: (id: string) => void;
  onOpenReview: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [participant, setParticipant] = useState("");
  const [dragging, setDragging] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  async function accept(file?: File) {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";
    // Başvuru adı yalnızca dosya gerçekten havuza alındığında temizlenir.
    const accepted = await onUpload(file, participant.trim());
    if (accepted) setParticipant("");
  }

  return (
    <section className="workspace eval-pool-workspace" aria-labelledby="pool-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Katılımcı raporları</span>
          <h1 id="pool-title">Raporları havuza alın ve ön kontrolden geçirin</h1>
          <p>
            Dosya kapısı, dil, şablon, başlık ve benzerlik kontrolleri burada çalışır.
            Anlamsal kriter analizi tamamlanan raporlar hakem incelemesine düşer.
          </p>
        </div>
        <span className="step-fraction">1 / 3</span>
      </div>

      <div className="eval-panel-margin">
        <ProfilePanel profile={profile} error={profileError} onProfileFile={onProfileFile} />
      </div>

      {profile ? (
        <div className="eval-upload-row">
          <div
            className={`drop-zone eval-drop-zone ${dragging ? "dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files[0]); }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => accept(event.target.files?.[0])}
            />
            <div className="empty-upload">
              <div className="upload-symbol" aria-hidden="true">↑</div>
              <h2>Katılımcı raporunu buraya bırakın</h2>
              <p>
                Kapı kuralları: {profile.setup.allowedFormats.join(", ")} · en fazla {profile.setup.maxFileSizeMb} MB ·
                ihlalde “{profile.setup.defaultViolationAction === "block" ? "yüklemeyi engelle" : profile.setup.defaultViolationAction === "warn" ? "uyarı oluştur" : "jüri incelemesine gönder"}”
              </p>
              <label className="field eval-participant-field">
                <span className="field-label">Takım / başvuru adı</span>
                <input
                  value={participant}
                  onChange={(event) => setParticipant(event.target.value)}
                  placeholder="Örn. Takım 42 — Hidra"
                />
              </label>
              <div className="eval-upload-buttons">
                <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>PDF seç</button>
                {/* Havuzdaki örnek yarışmacı raporları kod değişikliği olmadan test için kullanılabilir. */}
                <button type="button" className="text-button" onClick={() => setLibraryOpen(true)}>Belge havuzundan seç</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <DocumentLibraryModal
        open={libraryOpen}
        usage="rapor"
        selectedFile={null}
        onClose={() => setLibraryOpen(false)}
        onSelect={(file) => { accept(file); }}
      />

      {uploadError ? (
        <div className="inline-error eval-panel-margin" role="alert">
          <strong>Rapor kabul edilmedi.</strong><span>{uploadError}</span>
        </div>
      ) : null}

      <section className="eval-pool-list eval-panel-margin" aria-label="Değerlendirme havuzu">
        <div className="sample-library-heading">
          <div>
            <h2>Değerlendirme havuzu</h2>
            <p>Raporlar bu cihazda saklanır; analiz sonuçları hakem onayına kadar taslaktır.</p>
          </div>
          <span>{records.length} rapor</span>
        </div>
        {records.length ? (
          <div className="sample-document-list">
            {records.map((record) => {
              const flaggedGate = record.gateChecks.filter((check) => check.status !== "passed");
              return (
                <article key={record.id}>
                  <FileBadge fileName={record.fileName} mimeType={record.mimeType} size="sm" />
                  <div className="sample-copy">
                    <span>{REPORT_STATUS_LABELS[record.status]}</span>
                    <h3>{record.participant}</h3>
                    <p>
                      {record.fileName} · {formatBytes(record.sizeBytes)}
                      {record.pages ? ` · ${record.pages} sayfa` : ""}
                    </p>
                    {flaggedGate.length ? (
                      <div className="eval-gate-chips">
                        {flaggedGate.map((check) => (
                          <span key={check.id} className={`eval-check-chip ${check.status}`} title={check.detail}>
                            {check.name}: {CHECK_STATUS_LABELS[check.status]}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="sample-actions eval-pool-actions">
                    {record.status === "received" ? (
                      <button
                        type="button"
                        className="primary-button"
                        disabled={analyzingId !== null}
                        onClick={() => onAnalyze(record)}
                      >
                        {analyzingId === record.id ? "Analiz ediliyor…" : "Analiz et"}
                      </button>
                    ) : record.status === "analyzing" ? (
                      <span className="eval-analyzing-note" role="status">Analiz ediliyor…</span>
                    ) : (
                      <button type="button" className="secondary-button" onClick={() => onOpenReview(record.id)}>
                        {record.status === "reviewed" ? "İncelemeyi aç" : "Hakem incelemesine git"}
                      </button>
                    )}
                    {confirmingId === record.id ? (
                      <span className="delete-confirm" role="alertdialog" aria-label="Rapor silme onayı">
                        <button type="button" className="danger-button" onClick={() => { onDelete(record.id); setConfirmingId(null); }}>Evet, sil</button>
                        <button type="button" className="text-button" onClick={() => setConfirmingId(null)}>Vazgeç</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="danger-button ghost"
                        disabled={analyzingId === record.id}
                        onClick={() => setConfirmingId(record.id)}
                      >
                        Sil
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="library-empty">Havuzda henüz rapor yok. {profile ? "İlk katılımcı raporunu yukarıdan yükleyin." : "Önce onaylı bir profil yükleyin."}</p>
        )}
      </section>
    </section>
  );
}

function JudgeView({ profile, records, selectedId, onSelect, onUpdateReview, onComplete }: {
  profile: ProfileExport | null;
  records: StoredReport[];
  selectedId: string;
  onSelect: (id: string) => void;
  onUpdateReview: (recordId: string, review: JudgeReview) => void;
  onComplete: (recordId: string, review: JudgeReview) => void;
}) {
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [selectedFindingId, setSelectedFindingId] = useState("");
  // Seçim yapılmadan açılan ekranda ilk rapor sabitlenir; arkada tamamlanan yeni
  // bir analiz, açık incelemeyi başka bir başvuruyla değiştiremez.
  const [pinnedId, setPinnedId] = useState("");
  const reviewable = records.filter((record) => record.evaluation);
  const effectiveId = selectedId || pinnedId;
  const record = reviewable.find((item) => item.id === effectiveId) ?? reviewable[0];
  const evaluation = record?.evaluation ?? null;
  const review = record?.review ?? (evaluation ? buildInitialReview(evaluation) : null);
  const [renderedRecordId, setRenderedRecordId] = useState(record?.id ?? "");

  if (record && record.id !== effectiveId) setPinnedId(record.id);

  // Rapor değişince seçim ve onay durumu render sırasında sıfırlanır (effect'siz uyarlama kalıbı).
  if ((record?.id ?? "") !== renderedRecordId) {
    setRenderedRecordId(record?.id ?? "");
    setReviewConfirmed(false);
    setSelectedFindingId("");
  }

  if (!record || !evaluation || !review) {
    return (
      <section className="workspace eval-empty-workspace" aria-labelledby="judge-title">
        <div className="workspace-heading">
          <div>
            <span className="section-kicker">Hakem incelemesi</span>
            <h1 id="judge-title">İncelenecek analiz bekleniyor</h1>
            <p>Havuzdaki bir rapor analiz edildiğinde bulguları burada karara bağlayabilirsiniz.</p>
          </div>
          <span className="step-fraction">2 / 3</span>
        </div>
        <p className="library-empty eval-panel-margin">Henüz analiz edilmiş rapor yok. Rapor havuzundan bir raporu analiz edin.</p>
      </section>
    );
  }

  const findings = evaluation.findings;
  const selectedFinding = findings.find((item) => item.criterionId === selectedFindingId) ?? findings[0];
  const selectedDecision = review.decisions.find((item) => item.criterionId === selectedFinding?.criterionId);
  // Kriter kimlikleri profiller arasında tekrar eder; yüklü profil, sonucun
  // üretildiği profil değilse şartname dayanağı ve karar kuralları gösterilmez.
  const profileMatches = profile !== null && (
    evaluation.profileRef.profileId !== null && profile.profileId
      ? evaluation.profileRef.profileId === profile.profileId
      : evaluation.profileRef.competition === profile.setup.competition
        && evaluation.profileRef.year === profile.setup.year
        && evaluation.profileRef.stage === profile.setup.stage
        && evaluation.profileRef.reportType === profile.setup.reportType
  );
  const criterion = profileMatches
    ? profile?.criteria.find((item) => item.id === selectedFinding?.criterionId) ?? null
    : null;
  const selectedIsPenalty = criterion ? criterionEffectOf(criterion) === "penalty" : false;

  const scoreFindings = findings.filter((finding) => {
    if (finding.maxScore === null) return false;
    if (!profileMatches) return true;
    const sourceCriterion = profile?.criteria.find((item) => item.id === finding.criterionId);
    return sourceCriterion ? criterionEffectOf(sourceCriterion) === "score" : true;
  });
  const decidedScores = scoreFindings.filter((finding) => {
    const decision = review.decisions.find((item) => item.criterionId === finding.criterionId);
    return decision?.finalScore !== null && decision?.verdict !== "pending";
  });
  const decisionRuleIds = new Set(
    profileMatches
      ? (profile?.criteria ?? [])
        .filter((item) => {
          const effect = criterionEffectOf(item);
          return criterionEliminates(item) || ["gate", "threshold", "penalty"].includes(effect);
        })
        .map((item) => item.id)
      : [],
  );
  // İnsan yetkisindeki, olumsuz/kısmi bulunan veya karar kuralına bağlı hiçbir
  // madde görevli kararı olmadan tamamlanamaz.
  const decisionPending = findings.filter((finding) => {
    const decision = review.decisions.find((item) => item.criterionId === finding.criterionId);
    const needsDecision = finding.requiresHuman
      || ["needs_human", "not_met", "not_found", "partially_met"].includes(finding.status)
      || decisionRuleIds.has(finding.criterionId);
    return needsDecision && decision?.verdict === "pending";
  });
  const positiveTotal = review.decisions.reduce((sum, decision) => {
    const finding = findings.find((item) => item.criterionId === decision.criterionId);
    if (!finding || finding.maxScore === null || decision.finalScore === null || decision.verdict === "pending") return sum;
    const sourceCriterion = profileMatches ? profile?.criteria.find((item) => item.id === decision.criterionId) : null;
    if (sourceCriterion && criterionEffectOf(sourceCriterion) !== "score") return sum;
    return sum + decision.finalScore;
  }, 0);
  const penaltyTotal = review.decisions.reduce((sum, decision) => {
    if (decision.verdict === "pending") return sum;
    const criterion = profileMatches ? profile?.criteria.find((item) => item.id === decision.criterionId) : null;
    return criterion && criterionEffectOf(criterion) === "penalty"
      ? sum + Math.max(0, decision.penaltyPoints ?? 0)
      : sum;
  }, 0);
  const { finalRaw: finalTotal, appliedPenalty } = applyPenalties(positiveTotal, penaltyTotal);
  const declaredTotal = evaluation.proposedTotals.declaredTotal;
  // Yardımcı hesap yalnızca resmî aralık dışı sonucu anomali olarak yakalamak
  // için kullanılır; kullanıcıya otomatik 100'lük puan gösterilmez.
  const normalized = normalizeScoreDetailed(finalTotal, declaredTotal ?? 0);
  const flaggedChecks = evaluation.preChecks.filter((check) => check.status === "flagged" || check.status === "failed");
  // Geçiş / baraj / ceza / eleme maddelerinin bu rapordaki durumu: bulgu + görevli kararı.
  const ruleAudit = profile && profileMatches ? (() => {
    const columns: Array<{ key: string; title: string; items: RuleAuditItem[] }> = [
      { key: "gates", title: "Geçiş koşulları", items: [] },
      { key: "thresholds", title: "Barajlar", items: [] },
      { key: "penalties", title: "Cezalar", items: [] },
      { key: "eliminations", title: "Eleme / diskalifiye", items: [] },
    ];
    let pending = 0;
    let failed = 0;
    for (const criterion of profile.criteria.filter((item) => item.active)) {
      const eliminates = criterionEliminates(criterion);
      const effect = criterionEffectOf(criterion);
      const target = eliminates
        ? columns[3]
        : effect === "gate" ? columns[0]
          : effect === "threshold" ? columns[1]
            : effect === "penalty" ? columns[2]
              : null;
      if (!target) continue;
      const finding = findings.find((item) => item.criterionId === criterion.id);
      const decision = review.decisions.find((item) => item.criterionId === criterion.id);
      const audited = auditRule(finding?.status, decision?.verdict);
      if (audited.state === "warning") pending += 1;
      if (audited.state === "failed") failed += 1;
      target.items.push({
        criterionId: criterion.id,
        name: criterion.name,
        detail: criterion.violationOutcome,
        sourcePage: criterion.sourcePage,
        state: audited.state,
        label: audited.label,
      });
    }
    return { columns, pending, failed };
  })() : null;
  const canComplete =
    reviewConfirmed &&
    decidedScores.length === scoreFindings.length &&
    decisionPending.length === 0;

  function patchDecision(criterionId: string, patch: Partial<JudgeDecision>) {
    if (!record || !review) return;
    const nextReview: JudgeReview = {
      ...review,
      status: "in_progress",
      completedAt: null,
      decisions: review.decisions.map((item) => item.criterionId === criterionId ? { ...item, ...patch } : item),
    };
    setReviewConfirmed(false);
    onUpdateReview(record.id, nextReview);
  }

  function patchReview(patch: Partial<JudgeReview>) {
    if (!record || !review) return;
    setReviewConfirmed(false);
    onUpdateReview(record.id, { ...review, ...patch, status: "in_progress", completedAt: null });
  }

  return (
    <section className="workspace review-workspace" aria-labelledby="judge-title">
      <div className="review-heading">
        <div>
          <span className="section-kicker">AI 4. göz · karar hakemde</span>
          <h1 id="judge-title">Bulguları inceleyin ve nihai puanı verin</h1>
          <p>{record.participant} · {record.fileName} · {evaluation.report.pages} sayfa</p>
        </div>
        <span className="step-fraction">2 / 3</span>
      </div>

      {reviewable.length > 1 ? (
        <div className="eval-record-picker eval-panel-margin">
          <label className="field">
            <span className="field-label">İncelenen rapor</span>
            <select value={record.id} onChange={(event) => onSelect(event.target.value)} aria-label="İncelenecek raporu seç">
              {reviewable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.participant} · {REPORT_STATUS_LABELS[item.status]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="analysis-summary" aria-label="İnceleme özeti">
        <div><strong>{findings.length}</strong><span>bulgu</span></div>
        <div><strong>{decidedScores.length}/{scoreFindings.length}</strong><span>puan kararı</span></div>
        <div className={decisionPending.length ? "summary-warning" : "summary-ok"}>
          <strong>{decisionPending.length}</strong><span>bekleyen görevli kararı</span>
        </div>
        <div className={flaggedChecks.length ? "summary-warning" : "summary-ok"}>
          <strong>{flaggedChecks.length}</strong><span>işaretli ön kontrol</span>
        </div>
        <div>
          <strong>{evaluation.proposedTotals.rawScore ?? "—"}</strong>
          <span>AI puan önerisi</span>
        </div>
        <div>
          <strong>{finalTotal}{declaredTotal ? ` / ${declaredTotal}` : ""}</strong>
          <span>{appliedPenalty ? `${appliedPenalty} ceza sonrası · ` : ""}hakem toplamı · resmî ölçek</span>
        </div>
      </div>

      {normalized.anomaly ? (
        <div className="inline-error eval-panel-margin" role="alert">
          <strong>Puan anomalisi</strong><span>{normalized.anomaly}</span>
        </div>
      ) : null}

      {!profileMatches ? (
        <div className="inline-error eval-panel-margin" role="alert">
          <strong>Bu değerlendirme farklı bir profil ile üretildi.</strong>
          <span>
            Şartname dayanağı ve karar kuralları gösterilmiyor. Doğru dayanağı görmek için
            {" "}{evaluation.profileRef.competition} · {evaluation.profileRef.year} profilini yükleyin.
          </span>
        </div>
      ) : null}

      {evaluation.analysisWarnings.length ? (
        <div className="eval-warning-strip eval-panel-margin" role="status">
          <span className="inspector-label">Analiz uyarıları</span>
          <ul>
            {evaluation.analysisWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="eval-panel-margin">
        <PreCheckList checks={evaluation.preChecks} title="Ön kontroller" />
      </div>

      {ruleAudit ? (
        <section className="decision-rules" aria-labelledby="eval-decision-rules-title">
          <div className="score-plan-heading">
            <div>
              <h2 id="eval-decision-rules-title">Karar kuralları denetimi</h2>
              <p>
                Toplam puandan bağımsız denetlenen geçiş, baraj, ceza ve eleme maddelerinin bu rapordaki durumu.
                Sistem eleme kararı vermez; kapatılmamış her madde görevli kararı bekler.
              </p>
            </div>
            <span className={`score-audit ${ruleAudit.pending ? "mismatch" : ruleAudit.failed ? "mismatch" : "matched"}`}>
              {ruleAudit.pending
                ? `${ruleAudit.pending} madde karar bekliyor`
                : ruleAudit.failed
                  ? `${ruleAudit.failed} madde sağlanmadı`
                  : "Tüm maddeler karara bağlandı"}
            </span>
          </div>
          <div className="decision-rule-grid">
            {ruleAudit.columns.map((column) => (
              <details key={column.key} className={`decision-column ${column.key}`} open={column.items.some((item) => item.state !== "passed")}>
                <summary><strong>{column.items.length}</strong><span>{column.title}</span></summary>
                {column.items.length ? (
                  <ul>
                    {column.items.map((item) => (
                      <li key={item.criterionId}>
                        <strong>{item.name}</strong>
                        <span>{item.detail}{item.sourcePage ? ` · s. ${item.sourcePage}` : ""}</span>
                        <span className={`eval-check-chip ${item.state}`}>{item.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Bu profilde tanımlı madde bulunmadı.</p>
                )}
              </details>
            ))}
          </div>
        </section>
      ) : null}

      <div className="review-grid">
        <div className="criteria-ledger" id="finding-list">
          <div className="criteria-section-heading">
            <div><h2>Kriter bulguları</h2><p>Karara bağlamak istediğiniz bulguyu seçin.</p></div>
          </div>
          <div className="ledger-list" role="listbox" aria-label="Kriter bulguları">
            {findings.map((finding) => {
              const decision = review.decisions.find((item) => item.criterionId === finding.criterionId);
              const pending = decision?.verdict === "pending";
              return (
                <button
                  key={finding.criterionId}
                  type="button"
                  role="option"
                  aria-selected={finding.criterionId === selectedFinding?.criterionId}
                  className={`criterion-row ${finding.criterionId === selectedFinding?.criterionId ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedFindingId(finding.criterionId);
                    requestAnimationFrame(() => document.getElementById("finding-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                  }}
                >
                  <span className={`type-mark ${(profileMatches && profile?.criteria.find((item) => item.id === finding.criterionId)?.type) || "qualitative_score"}`} aria-hidden="true" />
                  <span className="criterion-main">
                    <strong>{finding.criterionName}</strong>
                    <small>
                      {FINDING_STATUS_LABELS[finding.status]}
                      {" · "}{decision ? VERDICT_LABELS[decision.verdict] : "Karar bekliyor"}
                    </small>
                  </span>
                  <span className={`criterion-value ${finding.maxScore !== null ? "score" : "advisory"}`}>
                    {finding.maxScore !== null
                      ? `${decision?.finalScore ?? "—"} / ${finding.maxScore}`
                      : FINDING_STATUS_LABELS[finding.status]}
                  </span>
                  {pending && (finding.requiresHuman || finding.maxScore !== null) ? <span className="row-alert" title="Karar bekliyor">!</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        {selectedFinding && selectedDecision ? (
          <div className="criterion-inspector" id="finding-detail">
            <div className="inspector-title">
              <div><span>Seçili bulgu</span><h2>{selectedFinding.criterionName}</h2></div>
              <a href="#finding-list">Bulgu listesine dön ↑</a>
            </div>
            <div className="inspector-topline">
              <div>
                <span className={`confidence ${selectedFinding.confidence}`}>
                  {selectedFinding.confidence === "high" ? "Yüksek güven" : selectedFinding.confidence === "medium" ? "Orta güven" : "Düşük güven"}
                </span>
                <span className="origin-label">{FINDING_STATUS_LABELS[selectedFinding.status]}</span>
              </div>
              <span className={`eval-check-chip ${selectedDecision.verdict === "pending" ? "warning" : "passed"}`}>
                {VERDICT_LABELS[selectedDecision.verdict]}
              </span>
            </div>

            <div className="inspector-section">
              <span className="inspector-label">Sistem bulgusu</span>
              <p className="eval-rationale">{selectedFinding.rationale}</p>
              {selectedFinding.evidence.length ? (
                <blockquote className="eval-evidence">
                  {selectedFinding.evidence[0].text}
                  {selectedFinding.evidence[0].page ? <small> — Rapor s. {selectedFinding.evidence[0].page}</small> : null}
                </blockquote>
              ) : null}
              {criterion?.sourceText ? (
                <div className="eval-source-rule">
                  <span>Şartnamedeki dayanak{criterion.sourcePage ? ` · s. ${criterion.sourcePage}` : ""}</span>
                  <p>{criterion.sourceText}</p>
                </div>
              ) : null}
              {selectedFinding.requiresHuman ? (
                <p className="human-authority-note">Bu kontrol için sistem yalnızca bulgu sunar. Nihai karar hakem, jüri veya sorumlu görevlidedir.</p>
              ) : null}
            </div>

            <div className="inspector-section">
              <span className="inspector-label">Hakem kararı</span>
              <div className="form-grid two-col">
                {selectedIsPenalty ? (
                  <Field label="Uygulanan ceza puanı" hint="Belgedeki ceza kuralını ve tekrar sayısını doğrulayarak toplam düşülecek puanı girin.">
                    <input
                      type="number"
                      min={0}
                      max={declaredTotal ?? undefined}
                      value={selectedDecision.penaltyPoints ?? ""}
                      placeholder="Örn. 5"
                      onChange={(event) => {
                        const raw = event.target.value === "" ? null : Number(event.target.value);
                        const capped = raw === null
                          ? null
                          : Math.max(0, Math.min(declaredTotal ?? raw, Number.isFinite(raw) ? raw : 0));
                        patchDecision(selectedFinding.criterionId, {
                          penaltyPoints: capped,
                          finalScore: null,
                          verdict: capped === null ? "pending" : "adjusted",
                        });
                      }}
                    />
                  </Field>
                ) : selectedFinding.maxScore !== null ? (
                  <Field label={`Nihai puan (azami ${selectedFinding.maxScore})`}>
                    <input
                      type="number"
                      min={0}
                      max={selectedFinding.maxScore}
                      value={selectedDecision.finalScore ?? ""}
                      placeholder={selectedFinding.proposedScore !== null ? `Öneri: ${selectedFinding.proposedScore}` : "Puan girin"}
                      onChange={(event) => {
                        const raw = event.target.value === "" ? null : Number(event.target.value);
                        const clamped = raw === null ? null : Math.max(0, Math.min(selectedFinding.maxScore ?? raw, raw));
                        patchDecision(selectedFinding.criterionId, {
                          finalScore: clamped,
                          verdict: clamped === null ? "pending" : clamped === selectedFinding.proposedScore ? "accepted" : "adjusted",
                        });
                      }}
                    />
                  </Field>
                ) : (
                  <Field label="Karar">
                    <select
                      value={selectedDecision.verdict}
                      onChange={(event) => patchDecision(selectedFinding.criterionId, { verdict: event.target.value as JudgeDecision["verdict"] })}
                    >
                      <option value="pending">Karar bekliyor</option>
                      <option value="accepted">Bulguyu onayla</option>
                      <option value="adjusted">Bulguyu düzelterek onayla</option>
                    </select>
                  </Field>
                )}
                <Field label="Hakem notu" hint="Not, yarışmacı geri bildirimine otomatik geçmez.">
                  <input
                    value={selectedDecision.note}
                    onChange={(event) => patchDecision(selectedFinding.criterionId, { note: event.target.value })}
                    placeholder="Gerekçe veya gözlem"
                  />
                </Field>
              </div>
              {selectedIsPenalty && selectedDecision.penaltyPoints === null ? (
                <p className="eval-pending-note">Ceza uygulanmayacaksa 0 girin; bu karar verilmeden inceleme tamamlanamaz.</p>
              ) : selectedFinding.maxScore !== null && selectedDecision.finalScore === null ? (
                <p className="eval-pending-note">Bu kriter puanlanmadan inceleme tamamlanamaz.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <section className="eval-feedback-editor eval-panel-margin" aria-labelledby="feedback-editor-title">
        <div className="score-plan-heading">
          <div>
            <h2 id="feedback-editor-title">Yarışmacı geri bildirimi</h2>
            <p>Taslak, analiz bulgularından türetildi. Hakem düzenler ve onaylar; onaysız geri bildirim yarışmacıya gösterilmez.</p>
          </div>
        </div>
        <div className="eval-feedback-grid">
          <FeedbackField
            label="Güçlü yönler"
            hint="Her satır bir madde olarak gösterilir."
            lines={review.finalFeedback.strengths}
            onChange={(strengths) => patchReview({ finalFeedback: { ...review.finalFeedback, strengths } })}
          />
          <FeedbackField
            label="Geliştirilmesi gereken alanlar"
            lines={review.finalFeedback.improvements}
            onChange={(improvements) => patchReview({ finalFeedback: { ...review.finalFeedback, improvements } })}
          />
          <FeedbackField
            label="Öneriler"
            lines={review.finalFeedback.suggestions}
            onChange={(suggestions) => patchReview({ finalFeedback: { ...review.finalFeedback, suggestions } })}
          />
        </div>
        <label className="eval-feedback-approve">
          <input
            type="checkbox"
            checked={review.feedbackApproved}
            onChange={(event) => patchReview({ feedbackApproved: event.target.checked })}
          />
          <span>Geri bildirim yarışmacıya gösterilsin.</span>
        </label>
        <Field label="Genel değerlendirme notu" hint="İç kayıt; yarışmacıya gösterilmez.">
          <textarea
            value={review.overallNote}
            onChange={(event) => patchReview({ overallNote: event.target.value })}
          />
        </Field>
      </section>

      <div className="approval-bar">
        <span className="save-note">Kararlar bu cihazda anlık kaydedilir.</span>
        <div className="approval-check">
          <label>
            <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
            <span>Ön kontrolleri, bulguları, kanıtları ve görevli kararı gerektiren maddeleri inceledim.</span>
          </label>
          {!canComplete ? (
            <small>
              {decidedScores.length !== scoreFindings.length && `${scoreFindings.length - decidedScores.length} puan kriteri kararsız. `}
              {decisionPending.length > 0 && `${decisionPending.length} görevli kararı bekliyor. `}
              {!reviewConfirmed && "Hakem kontrolünü onaylayın."}
            </small>
          ) : <small className="ready-note">İnceleme tamamlanmaya hazır.</small>}
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={!canComplete}
          onClick={() => onComplete(record.id, {
            ...review,
            // Boş satırlar ve baştaki/sondaki boşluklar yalnızca burada temizlenir.
            finalFeedback: normalizeFeedback(review.finalFeedback),
            status: "completed",
            completedAt: new Date().toISOString(),
          })}
        >
          Değerlendirmeyi tamamla <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

function ParticipantView({ profile, records, selectedId, onSelect }: {
  profile: ProfileExport | null;
  records: StoredReport[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const completed = records.filter((record) => record.review?.status === "completed");
  const record = completed.find((item) => item.id === selectedId) ?? completed[0];

  if (!record || !record.evaluation || !record.review) {
    return (
      <section className="workspace eval-empty-workspace" aria-labelledby="participant-title">
        <div className="workspace-heading">
          <div>
            <span className="section-kicker">Yarışmacı görünümü</span>
            <h1 id="participant-title">Sonuç henüz yayımlanmadı</h1>
            <p>Hakem değerlendirmeyi tamamladığında sonuç ve gelişim odaklı geri bildirim burada görünür.</p>
          </div>
          <span className="step-fraction">3 / 3</span>
        </div>
        <p className="library-empty eval-panel-margin">Tamamlanmış değerlendirme bulunmuyor.</p>
      </section>
    );
  }

  const evaluation = record.evaluation;
  const review = record.review;
  const findings = evaluation.findings;
  const declaredTotal = evaluation.proposedTotals.declaredTotal;
  const profileMatches = profile !== null && (
    evaluation.profileRef.profileId
      ? profile.profileId === evaluation.profileRef.profileId
      : profile.setup.competition === evaluation.profileRef.competition
        && profile.setup.year === evaluation.profileRef.year
        && profile.setup.stage === evaluation.profileRef.stage
        && profile.setup.reportType === evaluation.profileRef.reportType
  );
  const positiveTotal = review.decisions.reduce((sum, decision) => {
    const finding = findings.find((item) => item.criterionId === decision.criterionId);
    if (!finding || finding.maxScore === null || decision.finalScore === null || decision.verdict === "pending") return sum;
    const sourceCriterion = profileMatches ? profile.criteria.find((item) => item.id === decision.criterionId) : null;
    if (sourceCriterion && criterionEffectOf(sourceCriterion) !== "score") return sum;
    return sum + decision.finalScore;
  }, 0);
  const penaltyTotal = review.decisions.reduce((sum, decision) => {
    if (decision.verdict === "pending") return sum;
    const criterion = profileMatches ? profile.criteria.find((item) => item.id === decision.criterionId) : null;
    return criterion && criterionEffectOf(criterion) === "penalty"
      ? sum + Math.max(0, decision.penaltyPoints ?? 0)
      : sum;
  }, 0);
  const { finalRaw: finalTotal, appliedPenalty } = applyPenalties(positiveTotal, penaltyTotal);
  // Yardımcı hesap yalnızca resmî aralık dışı sonucu anomali olarak yakalamak
  // için kullanılır; sonuç PDF'deki puan ölçeğiyle gösterilir.
  const normalized = normalizeScoreDetailed(finalTotal, declaredTotal ?? 0);
  const feedback: ParticipantFeedback | null = review.feedbackApproved
    ? normalizeFeedback(review.finalFeedback)
    : null;

  return (
    <section className="workspace ready-workspace" aria-labelledby="participant-title">
      <div className="ready-hero">
        <span className="approval-seal" aria-hidden="true">✓</span>
        <span className="section-kicker">Değerlendirme sonucu</span>
        <h1 id="participant-title">{record.participant}</h1>
        <p>
          {evaluation.profileRef.competition} · {evaluation.profileRef.reportType} · {evaluation.profileRef.year}.
          Değerlendirme, uzman hakem tarafından incelenip onaylandı.
        </p>
      </div>

      {completed.length > 1 ? (
        <div className="eval-record-picker eval-panel-margin">
          <label className="field">
            <span className="field-label">Başvuru</span>
            <select value={record.id} onChange={(event) => onSelect(event.target.value)} aria-label="Başvuru seç">
              {completed.map((item) => <option key={item.id} value={item.id}>{item.participant}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      <div className="profile-sheet">
        <div className="profile-sheet-header">
          <div><span>Sonuç</span><strong>{record.fileName}</strong></div>
          <span className="status-chip success">Hakem onaylı</span>
        </div>
        <div className="profile-metrics">
          <div>
            <strong>{finalTotal}{declaredTotal ? ` / ${declaredTotal}` : ""}</strong>
            <span>{appliedPenalty ? `${appliedPenalty} ceza sonrası · ` : ""}toplam puan · resmî ölçek</span>
          </div>
          <div>
            <strong>{declaredTotal ?? "—"}</strong>
            <span>resmî azami puan</span>
          </div>
        </div>
        {normalized.anomaly ? (
          <div className="inline-error" role="alert">
            <strong>Puan anomalisi</strong><span>{normalized.anomaly}</span>
          </div>
        ) : null}
        <div className="profile-metrics">
          <div>
            <strong>{findings.filter((finding) => finding.status === "met").length}</strong>
            <span>karşılanan kriter</span>
          </div>
          <div>
            <strong>{evaluation.report.pages}</strong>
            <span>rapor sayfası</span>
          </div>
        </div>
        {feedback ? (
          <div className="eval-participant-feedback">
            <section>
              <span className="inspector-label">Güçlü yönler</span>
              {feedback.strengths.length ? <ul>{feedback.strengths.map((line) => <li key={line}>{line}</li>)}</ul> : <p>Hakem bu bölüme madde eklemedi.</p>}
            </section>
            <section>
              <span className="inspector-label">Geliştirilmesi gereken alanlar</span>
              {feedback.improvements.length ? <ul>{feedback.improvements.map((line) => <li key={line}>{line}</li>)}</ul> : <p>Hakem bu bölüme madde eklemedi.</p>}
            </section>
            <section>
              <span className="inspector-label">Öneriler</span>
              {feedback.suggestions.length ? <ul>{feedback.suggestions.map((line) => <li key={line}>{line}</li>)}</ul> : <p>Hakem bu bölüme madde eklemedi.</p>}
            </section>
          </div>
        ) : (
          <div className="profile-footer-note">
            <span>Geri bildirim</span>
            <p>Hakem, bu değerlendirme için ayrıntılı geri bildirimi yayımlamadı.</p>
          </div>
        )}
        <div className="profile-footer-note">
          <span>Nasıl değerlendirildi?</span>
          <p>
            Rapor, {evaluation.profileRef.year} yılı onaylı değerlendirme profilindeki kurallara göre incelendi.
            Sistem yalnızca bulgu sundu; tüm puanlar ve kararlar uzman hakem tarafından verildi.
          </p>
        </div>
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export default function EvaluationApp() {
  const [view, setView] = useState<EvalView>(1);
  const [profile, setProfile] = useState<ProfileExport | null>(null);
  const [profileError, setProfileError] = useState("");
  const [records, setRecords] = useState<StoredReport[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [persistError, setPersistError] = useState("");
  // Analiz sürerken silinen kayıtlar; tamamlanan analiz bunları depoya geri yazmamalı.
  const deletedIds = useRef(new Set<string>());

  function reportPersistFailure() {
    setPersistError("Bu cihazın deposuna yazılamadı. Tarayıcı depolama alanını veya gizli sekme kısıtlarını kontrol edin; sayfa yenilenirse son değişiklikler kaybolabilir.");
  }

  /** Depoya yazma hatalarını yutmadan, kullanıcıya görünür biçimde bildirir. */
  function persist(operation: Promise<unknown>) {
    return operation.then(() => setPersistError("")).catch(reportPersistFailure);
  }

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const stored = await listReports();
        if (!active) return;
        setRecords(stored);
        setPersistError("");
      } catch {
        if (active) reportPersistFailure();
      } finally {
        if (active) setProfile(loadLastApprovedProfile());
      }
    }
    restore();
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => ({
    pool: records.length,
    analyzed: records.filter((record) => record.evaluation).length,
    completed: records.filter((record) => record.review?.status === "completed").length,
  }), [records]);

  async function handleProfileFile(file: File) {
    const { profile: parsed, error } = await readProfileFile(file);
    if (parsed) {
      setProfile(parsed);
      setProfileError("");
      // Yüklenen profil bu cihazda saklanır; sayfa yenilendiğinde seçim korunur.
      saveActiveProfile(parsed);
    } else {
      setProfileError(error);
    }
  }

  /** Yükleme kabul edildiyse true döner; reddedildiyse başvuru adı formda korunur. */
  async function handleUpload(file: File, participant: string): Promise<boolean> {
    if (!profile) return false;
    setUploadError("");
    const participantName = participant || file.name.replace(/\.pdf$/i, "");
    const existingFileCount = records.filter((item) => item.participant === participantName).length;
    const gateChecks = buildFileGateChecks(file, profile.setup, existingFileCount);
    if (gateBlocksUpload(gateChecks)) {
      const failed = gateChecks.filter((check) => check.status === "failed");
      setUploadError(
        `${failed.map((check) => check.detail).join(" ")} Profil ihlal davranışı "Yüklemeyi engelle" olduğu için dosya havuza alınmadı.`,
      );
      return false;
    }
    const entry: StoredReport = {
      id: createReportId(),
      participant: participantName,
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      sizeBytes: file.size,
      pages: null,
      uploadedAt: new Date().toISOString(),
      status: "received",
      gateChecks,
      evaluation: null,
      review: null,
      file,
    };
    await persist(saveReport(entry));
    setRecords((current) => [entry, ...current]);
    return true;
  }

  async function handleAnalyze(record: StoredReport) {
    if (!profile || analyzingId) return;
    setAnalyzingId(record.id);
    setUploadError("");
    setRecords((current) => current.map((item) => item.id === record.id ? { ...item, status: "analyzing" } : item));
    try {
      const extracted = await extractPdfText(record.file);
      const peers: SimilarityPeer[] = records
        .filter((item) => item.id !== record.id && item.pagesText?.length)
        .map((item) => ({ label: item.participant, text: (item.pagesText ?? []).join(" ") }));
      const evaluation = await evaluateReport({
        profile,
        file: record.file,
        pages: extracted.pages,
        pageCount: extracted.pageCount,
        peers,
        gateChecks: record.gateChecks,
      });
      // Analiz sürerken rapor silinmiş olabilir; silinen kayıt depoya geri yazılmaz.
      if (deletedIds.current.has(record.id)) return;
      const updated: StoredReport = {
        ...record,
        status: "analyzed",
        pages: extracted.pageCount,
        pagesText: extracted.pages,
        evaluation,
        review: null,
      };
      await persist(saveReport(updated));
      setRecords((current) => current.map((item) => item.id === record.id ? updated : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.";
      setUploadError(`"${record.fileName}" analiz edilemedi: ${message}`);
      setRecords((current) => current.map((item) => item.id === record.id ? { ...item, status: "received" } : item));
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleDelete(id: string) {
    deletedIds.current.add(id);
    await persist(deleteReport(id));
    setRecords((current) => current.filter((item) => item.id !== id));
  }

  function persistReview(recordId: string, review: JudgeReview, status: ReportStatus) {
    const target = records.find((item) => item.id === recordId);
    if (!target) return;
    const updated: StoredReport = { ...target, review, status };
    setRecords((current) => current.map((item) => item.id === recordId ? updated : item));
    // Yan etki güncelleyicinin dışında: StrictMode'da çift çalışmaz.
    persist(saveReport(updated));
  }

  return (
    <main className="app-shell">
      <EvalRail view={view} counts={counts} onNavigate={setView} />
      <div className="app-main">
        <EvalTopbar view={view} />
        <div className="context-line" aria-hidden="true">
          {profile ? `${profile.setup.competition} · ${profile.setup.reportType}` : "Onaylı profil bekleniyor"}
        </div>
        {persistError ? (
          <div className="inline-error eval-persist-error" role="alert">
            <strong>Kayıt yapılamadı.</strong><span>{persistError}</span>
          </div>
        ) : null}
        {view === 1 ? (
          <PoolView
            profile={profile}
            profileError={profileError}
            onProfileFile={handleProfileFile}
            records={records}
            uploadError={uploadError}
            analyzingId={analyzingId}
            onUpload={handleUpload}
            onAnalyze={handleAnalyze}
            onDelete={handleDelete}
            onOpenReview={(id) => { setSelectedId(id); setView(2); }}
          />
        ) : null}
        {view === 2 ? (
          <JudgeView
            profile={profile}
            records={records}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdateReview={(recordId, review) => persistReview(recordId, review, "analyzed")}
            onComplete={(recordId, review) => {
              persistReview(recordId, review, "reviewed");
              setSelectedId(recordId);
              setView(3);
            }}
          />
        ) : null}
        {view === 3 ? (
          <ParticipantView profile={profile} records={records} selectedId={selectedId} onSelect={setSelectedId} />
        ) : null}
      </div>
    </main>
  );
}
