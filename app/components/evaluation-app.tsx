"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import FileBadge from "./file-badge";
import DocumentLibraryModal from "./document-library-modal";
import TopbarSession from "./topbar-session";
import { applyPenalties, criterionEffectOf, criterionEliminates, normalizeScoreDetailed } from "../lib/evaluation-summary";
import { assessCompliance } from "../lib/compliance-verdict";
import { extractPdfText } from "../lib/pdf-reader";
import { loadLastApprovedProfile, readProfileFile, saveActiveProfile } from "../lib/profile-loader";
import { createReportId, deleteReport, listReports, saveReport, type StoredReport } from "../lib/report-pool";
import { buildFileGateChecks, gateBlocksUpload, type SimilarityPeer } from "../lib/report-prechecks";
import { evaluateReport } from "../lib/report-evaluator";
import { workflowApi } from "../lib/workflow-client";
import { fold } from "../lib/competitions";
import { APPLICATION_STATUS_LABELS, type CompetitionApplication } from "../lib/workflow-types";
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
  received: "Havuzda · AI ön değerlendirmesi bekliyor",
  analyzing: "AI ön değerlendirmesi yapılıyor",
  analyzed: "AI ön değerlendirmesi tamam · hakem bekliyor",
  reviewed: "Nihai değerlendirme tamamlandı",
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

/** Hakem sonucunun yarışmacıya gösterilen rozet, mühür ve renk karşılığı. */
const OUTCOME_VIEW: Record<JudgeReview["outcome"], { label: string; seal: string; chip: string; summary: string }> = {
  accepted: {
    label: "Kabul edildi",
    seal: "✓",
    chip: "success",
    summary: "Başvuru, uzman hakem tarafından incelendi ve kabul edildi.",
  },
  rejected: {
    label: "Reddedildi",
    seal: "✕",
    chip: "danger",
    summary: "Başvuru, uzman hakem tarafından incelendi ve reddedildi.",
  },
  revision_required: {
    label: "Hatalar düzeltilmeli",
    seal: "!",
    chip: "warning",
    summary: "Başvuru incelendi; aşağıdaki maddeler düzeltilerek yeniden gönderilmelidir.",
  },
  pending: {
    label: "Sonuç bekliyor",
    seal: "…",
    chip: "neutral",
    summary: "Değerlendirme tamamlandı; sonuç henüz kesinleştirilmedi.",
  },
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
    outcome: "pending",
    outcomeNote: "",
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
      <Link className="eval-rail-link icon-back" href="/" aria-label="Çalışma alanıma dön" title="Çalışma alanıma dön"><span aria-hidden="true">←</span></Link>
    </nav>
  );
}

function EvalTopbar({ view, onBack }: { view: EvalView; onBack: () => void }) {
  const current = VIEWS.find((item) => item.id === view)!;
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
          <Link className="secondary-button" href="/kriter-atolyesi">Kriter Atölyesi’nde profil oluştur</Link>
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

function PoolView({ profile, profileError, onProfileFile, records, uploadError, analyzingId, onUpload, onAnalyze, onDelete, onOpenReview, applications, onOpenApplication }: {
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
  applications: CompetitionApplication[];
  onOpenApplication: (application: CompetitionApplication, analyze: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [participant, setParticipant] = useState("");
  const [dragging, setDragging] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selectedCompetition, setSelectedCompetition] = useState("");
  const [teamQuery, setTeamQuery] = useState("");
  const [queueFilter, setQueueFilter] = useState<"pending" | "completed">("pending");

  const competitionGroups = useMemo(() => {
    const groups = new Map<string, CompetitionApplication[]>();
    for (const application of applications) {
      groups.set(application.competitionName, [...(groups.get(application.competitionName) ?? []), application]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "tr"));
  }, [applications]);
  const effectiveCompetition = selectedCompetition && competitionGroups.some(([name]) => name === selectedCompetition)
    ? selectedCompetition
    : competitionGroups[0]?.[0] ?? "";
  const visibleApplications = useMemo(() => {
    const search = fold(teamQuery.trim());
    return applications.filter((application) => application.competitionName === effectiveCompetition)
      .filter((application) => queueFilter === "completed" ? application.status === "completed" : application.status !== "completed")
      .filter((application) => !search || fold(`${application.teamName} ${application.applicantFullName} ${application.teamMembers.map((member) => member.fullName).join(" ")}`).includes(search));
  }, [applications, effectiveCompetition, queueFilter, teamQuery]);

  async function accept(file?: File) {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";
    // Başvuru adı yalnızca dosya gerçekten havuza alındığında temizlenir.
    const accepted = await onUpload(file, participant.trim());
    if (accepted) setParticipant("");
  }

  if (applications) {
    return (
      <section className="workspace eval-pool-workspace" aria-labelledby="pool-title">
        <div className="workspace-heading">
          <div><span className="section-kicker">Katılımcı başvuruları</span><h1 id="pool-title">Başvuru havuzu</h1><p>PDF&apos;ler yarışmacı gönderdiğinde burada görünür. AI analizi yalnızca hakem başlattığında çalışır ve yalnızca Yarışma Yöneticisinin yayımladığı şartname kriterlerini kullanır.</p></div>
          <span className="step-fraction">1 / 3</span>
        </div>
        {uploadError ? <div className="inline-error eval-panel-margin" role="alert"><strong>İşlem tamamlanamadı.</strong><span>{uploadError}</span></div> : null}
        <section className="eval-pool-list eval-panel-margin" aria-label="Katılımcı başvuruları">
          <div className="sample-library-heading"><div><h2>Projeler ve başvurular</h2><p>Önce yarışmayı seçin; ardından o yarışmaya başvuran takımları inceleyin.</p></div><span>{applications.length} başvuru</span></div>
          {competitionGroups.length ? <div className="judge-project-layout">
            <nav className="judge-project-list" aria-label="Başvuru bulunan yarışmalar">
              {competitionGroups.map(([name, items]) => (
                <button key={name} type="button" className={effectiveCompetition === name ? "active" : ""} onClick={() => { setSelectedCompetition(name); setTeamQuery(""); }}>
                  <strong>{name}</strong><span>{items.filter((item) => item.status !== "completed").length} bekleyen · {items.length} toplam</span>
                </button>
              ))}
            </nav>
            <div className="judge-project-applications">
              <div className="judge-project-toolbar"><div><strong>{effectiveCompetition}</strong><span>{visibleApplications.length} takım gösteriliyor</span></div><label className="search-box"><span aria-hidden="true">⌕</span><input value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="Takım veya üye ara" /></label></div>
              <div className="judge-queue-tabs" role="group" aria-label="Başvuru durumu filtresi"><button type="button" className={queueFilter === "pending" ? "active" : ""} onClick={() => setQueueFilter("pending")}>İncelenmeyi bekleyenler</button><button type="button" className={queueFilter === "completed" ? "active" : ""} onClick={() => setQueueFilter("completed")}>Tamamlananlar</button></div>
              <div className="sample-document-list">
            {visibleApplications.map((application) => <article key={application.id}>
              <FileBadge fileName={application.fileName ?? "basvuru.pdf"} mimeType={application.mimeType ?? "application/pdf"} size="sm" />
              <div className="sample-copy"><span>{APPLICATION_STATUS_LABELS[application.status]}</span><h3>{application.teamName}</h3><p>{application.applicantFullName} · {application.fileName ?? "Başvuru PDF'i"} · {formatBytes(application.sizeBytes ?? 0)}</p><small>{application.teamMembers.length ? `${application.teamMembers.length} ekip üyesi` : "Bireysel başvuru"}</small></div>
              <div className="sample-actions eval-pool-actions">
                <a className="text-button" href={`/api/applications/${application.id}/file`} target="_blank" rel="noreferrer">PDF&apos;i aç</a>
                {["submitted", "assigned", "resubmitted", "analysis_failed"].includes(application.status) ? <button type="button" className="primary-button" disabled={analyzingId !== null} onClick={() => onOpenApplication(application, true)}>{analyzingId === `server-${application.id}` ? "Analiz ediliyor…" : "AI analizini başlat"}</button>
                  : application.status === "analyzing" ? <span className="eval-analyzing-note">Analiz ediliyor…</span>
                    : <button type="button" className="secondary-button" disabled={analyzingId !== null} onClick={() => onOpenApplication(application, false)}>{application.status === "completed" ? "Tamamlanan incelemeyi aç" : "Hakem incelemesini aç"}</button>}
              </div>
            </article>)}
              {!visibleApplications.length ? <p className="library-empty">Bu aramayla eşleşen takım bulunamadı.</p> : null}
              </div>
            </div>
          </div> : <p className="library-empty">Henüz katılımcı başvurusu yok.</p>}
        </section>
      </section>
    );
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
                PDF belgesinden çıkarılan teslim kuralları: {profile.setup.allowedFormats.join(", ") || "format belirtilmemiş"} · {profile.setup.maxFileSizeMb > 0 ? `en fazla ${profile.setup.maxFileSizeMb} MB` : "boyut belirtilmemiş"} ·
                ihlal sonucu “{profile.setup.defaultViolationAction === "block" ? "yüklemeyi engelle" : profile.setup.defaultViolationAction === "warn" ? "uyarı oluştur" : profile.setup.defaultViolationAction === "jury" ? "jüri incelemesine gönder" : "PDF'de açıkça belirtilmemiş"}”
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
  const storedReview = record?.review ?? (evaluation ? buildInitialReview(evaluation) : null);
  const review = storedReview ? {
    ...storedReview,
    outcome: storedReview.outcome ?? "pending",
    outcomeNote: storedReview.outcomeNote ?? "",
  } : null;
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
  // Yayımlanmış kriter profiline göre uygunluk önerisi. Karar değil, gerekçeli öneridir.
  const compliance = assessCompliance(evaluation, profileMatches ? profile : null);
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
  // Reddedilen başvuru puanlanmaz: şartname koşulu karşılanmadığı için dosya zaten
  // değerlendirme dışıdır. Bu durumda yalnızca yarışmacıya iletilecek gerekçe aranır.
  const rejecting = review.outcome === "rejected";
  const canComplete = rejecting
    ? reviewConfirmed && review.outcomeNote.trim().length > 0
    : reviewConfirmed
      && decidedScores.length === scoreFindings.length
      && decisionPending.length === 0
      && review.outcome !== "pending";

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

      <section className={`compliance-verdict eval-panel-margin ${compliance.verdict}`} aria-labelledby="compliance-verdict-title">
        <div className="compliance-head">
          <div>
            <span className="section-kicker">AI uygunluk önerisi · karar hakemde</span>
            <h2 id="compliance-verdict-title">
              {compliance.verdict === "compliant" ? "Başvuru şartname kriterlerine uygun"
                : compliance.verdict === "not_compliant" ? "Başvuru şartname kriterlerine uygun değil"
                  : "Uygunluk için hakem kararı gerekiyor"}
            </h2>
            <p>{compliance.summary}</p>
          </div>
          <span className="compliance-count">{compliance.metRequired}/{compliance.totalRequired}<small>zorunlu koşul</small></span>
        </div>

        {compliance.blocking.length ? (
          <div className="compliance-issues blocking">
            <strong>Karşılanmayan zorunlu koşullar</strong>
            <ul>
              {compliance.blocking.map((issue) => (
                <li key={`${issue.source}-${issue.id}`}>
                  <span>{issue.name}{issue.sourcePage ? ` · s. ${issue.sourcePage}` : ""}</span>
                  <small>{issue.detail}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {compliance.review.length ? (
          <div className="compliance-issues review">
            <strong>Hakem kararı bekleyen maddeler</strong>
            <ul>
              {compliance.review.map((issue) => (
                <li key={`${issue.source}-${issue.id}`}>
                  <span>{issue.name}{issue.sourcePage ? ` · s. ${issue.sourcePage}` : ""}</span>
                  <small>{issue.detail}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="compliance-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => patchReview({
              outcome: "accepted",
              outcomeNote: review.outcomeNote.trim() || "Başvurunuz, yayımlanmış şartname kriterlerini karşıladığı için kabul edilmiştir.",
            })}
          >
            Başvuruyu onayla
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => patchReview({
              outcome: "rejected",
              outcomeNote: compliance.rejectionDraft
                || review.outcomeNote.trim()
                || "Başvurunuz, yayımlanmış şartname kriterlerini karşılamadığı için reddedilmiştir.",
            })}
          >
            Başvuruyu reddet{compliance.rejectionDraft ? " · AI gerekçesiyle" : ""}
          </button>
          <small>
            Seçtiğiniz sonuç ve gerekçe aşağıdaki “Başvuru sonucu” alanına yazılır; göndermeden önce
            metni serbestçe değiştirebilirsiniz.
          </small>
        </div>
      </section>

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
        <div className="form-grid two-col eval-outcome-fields">
          <Field label="Başvuru sonucu" hint="Bu sonuç yarışmacının Başvurularım ekranında gösterilir.">
            <select value={review.outcome} onChange={(event) => patchReview({ outcome: event.target.value as JudgeReview["outcome"] })}>
              <option value="pending">Sonuç seçin</option>
              <option value="accepted">Kabul edildi</option>
              <option value="rejected">Reddedildi</option>
              <option value="revision_required">Hatalar düzeltilmeli</option>
            </select>
          </Field>
          <Field label="Yarışmacıya sonuç açıklaması" hint={rejecting ? "Ret gerekçesi zorunludur; yarışmacıya e-posta ile de gönderilir. AI taslağını olduğu gibi bırakabilir veya kendiniz yazabilirsiniz." : "Kısa, açık ve uygulanabilir bir açıklama yazın."}>
            <textarea maxLength={1000} value={review.outcomeNote} onChange={(event) => patchReview({ outcomeNote: event.target.value })} placeholder="Sonucun kısa gerekçesi veya beklenen düzeltme" />
          </Field>
        </div>
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
              {rejecting
                ? !review.outcomeNote.trim() && "Yarışmacıya iletilecek ret gerekçesini yazın. "
                : <>
                  {decidedScores.length !== scoreFindings.length && `${scoreFindings.length - decidedScores.length} puan kriteri kararsız. `}
                  {decisionPending.length > 0 && `${decisionPending.length} görevli kararı bekliyor. `}
                  {review.outcome === "pending" && "Başvuru sonucunu seçin. "}
                </>}
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

  const outcome = OUTCOME_VIEW[review.outcome] ?? OUTCOME_VIEW.pending;

  return (
    <section className={`workspace ready-workspace outcome-${review.outcome ?? "pending"}`} aria-labelledby="participant-title">
      <div className="ready-hero">
        <span className="approval-seal" aria-hidden="true">{outcome.seal}</span>
        <span className="section-kicker">Değerlendirme sonucu</span>
        <h1 id="participant-title">{record.participant}</h1>
        <p className="ready-outcome-line">
          <span className="outcome-badge">{outcome.label}</span>
        </p>
        <p>
          {evaluation.profileRef.competition} · {evaluation.profileRef.reportType} · {evaluation.profileRef.year}.
          {" "}{outcome.summary}
        </p>
        {review.outcomeNote ? <p className="ready-outcome-note">{review.outcomeNote}</p> : null}
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
          <span className={`status-chip ${outcome.chip}`}>{outcome.label}</span>
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
          <div>
            <strong>{findings.filter((finding) => finding.status === "met").length}<small> / {findings.length}</small></strong>
            <span>karşılanan kriter</span>
          </div>
          <div>
            <strong>{evaluation.report.pages}</strong>
            <span>rapor sayfası</span>
          </div>
        </div>
        {normalized.anomaly ? (
          <div className="inline-error" role="alert">
            <strong>Puan anomalisi</strong><span>{normalized.anomaly}</span>
          </div>
        ) : null}
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
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const remoteReviewTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
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
      const [stored, remote] = await Promise.allSettled([listReports(), workflowApi.applications()]);
      if (!active) return;
      if (stored.status === "fulfilled") { setRecords(stored.value); setPersistError(""); }
      else reportPersistFailure();
      if (remote.status === "fulfilled") setApplications(remote.value.applications);
      else setUploadError(remote.reason instanceof Error ? remote.reason.message : "Başvuru havuzu yüklenemedi.");
      setProfile(loadLastApprovedProfile());
    }
    restore();
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    for (const timer of remoteReviewTimers.current.values()) clearTimeout(timer);
    remoteReviewTimers.current.clear();
  }, []);

  const counts = useMemo(() => ({
    pool: applications.length,
    // AI ön değerlendirmesi tamamlanan her başvuru; hakem incelemesi sürenler dahil.
    analyzed: applications.filter((item) => ["awaiting_judge", "judge_in_review", "completed"].includes(item.status)).length,
    completed: applications.filter((item) => item.status === "completed").length,
  }), [applications]);

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
        `${failed.map((check) => check.detail).join(" ")} Dosya bu sürümde analiz edilemediği veya PDF'de açıkça engelleyici bir kural bulunduğu için havuza alınmadı.`,
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

  async function analyzeRecord(record: StoredReport, activeProfile: ProfileExport, remoteAlreadyStarted = false) {
    setAnalyzingId(record.id);
    setUploadError("");
    setRecords((current) => current.map((item) => item.id === record.id ? { ...item, status: "analyzing" } : item));
    try {
      if (record.sourceApplicationId && !remoteAlreadyStarted) {
        await workflowApi.updateApplication(record.sourceApplicationId, "start_analysis");
      }
      const extracted = await extractPdfText(record.file);
      const peers: SimilarityPeer[] = records
        .filter((item) => item.id !== record.id && item.pagesText?.length)
        .map((item) => ({ label: item.participant, text: (item.pagesText ?? []).join(" ") }));
      const evaluation = await evaluateReport({
        profile: activeProfile,
        file: record.file,
        pages: extracted.pages,
        pageCount: extracted.pageCount,
        peers,
        gateChecks: record.gateChecks,
      });
      if (record.sourceApplicationId) {
        try {
          const { check } = await workflowApi.similarityCheck(record.sourceApplicationId, extracted.pages.join("\n"));
          evaluation.preChecks = [...evaluation.preChecks.filter((item) => item.kind !== "similarity"), check];
        } catch (similarityError) {
          evaluation.analysisWarnings.push(
            similarityError instanceof Error
              ? `Aynı yarışma havuzu benzerlik kontrolü tamamlanamadı: ${similarityError.message}`
              : "Aynı yarışma havuzu benzerlik kontrolü tamamlanamadı.",
          );
        }
      }
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
      if (record.sourceApplicationId) {
        const saved = await workflowApi.updateApplication(record.sourceApplicationId, "save_evaluation", { evaluation });
        setApplications((current) => current.map((item) => item.id === saved.application.id ? saved.application : item));
      } else await persist(saveReport(updated));
      setRecords((current) => current.map((item) => item.id === record.id ? updated : item));
      if (record.sourceApplicationId) { setSelectedId(record.id); setView(2); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.";
      setUploadError(`"${record.fileName}" analiz edilemedi: ${message}`);
      setRecords((current) => current.map((item) => item.id === record.id ? { ...item, status: "received" } : item));
      if (record.sourceApplicationId) {
        workflowApi.updateApplication(record.sourceApplicationId, "analysis_failed")
          .then((saved) => setApplications((current) => current.map((item) => item.id === saved.application.id ? saved.application : item)))
          .catch(() => undefined);
      }
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleAnalyze(record: StoredReport) {
    if (!profile || analyzingId) return;
    await analyzeRecord(record, profile);
  }

  async function openApplication(application: CompetitionApplication, analyze: boolean) {
    if (analyzingId) return;
    setUploadError("");
    setAnalyzingId(`server-${application.id}`);
    let analysisStarted = false;
    try {
      const current = analyze
        ? (await workflowApi.updateApplication(application.id, "start_analysis")).application
        : application;
      analysisStarted = analyze;
      if (!current.profileId) throw new Error("Bu yarışma için onaylı kriter profili bulunamadı.");
      const [profileResult, file] = await Promise.all([
        workflowApi.profile(current.profileId),
        workflowApi.applicationFile(current.id, current.fileName ?? "basvuru.pdf"),
      ]);
      const activeProfile = profileResult.profile.profile;
      setProfile(activeProfile);
      const report: StoredReport = {
        id: `server-${current.id}`,
        sourceApplicationId: current.id,
        participant: current.teamName || current.participantName,
        fileName: current.fileName ?? "basvuru.pdf",
        mimeType: current.mimeType ?? "application/pdf",
        sizeBytes: current.sizeBytes ?? 0,
        pages: current.evaluation?.report.pages ?? null,
        uploadedAt: current.submittedAt,
        status: current.status === "completed" ? "reviewed" : current.evaluation ? "analyzed" : "received",
        gateChecks: buildFileGateChecks(file, activeProfile.setup, 0),
        evaluation: current.evaluation,
        review: current.review,
        file,
      };
      setRecords((items) => [report, ...items.filter((item) => item.id !== report.id)]);
      setApplications((items) => items.map((item) => item.id === current.id ? current : item));
      if (analyze) await analyzeRecord(report, activeProfile, true);
      else { setSelectedId(report.id); setView(2); setAnalyzingId(null); }
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : "Başvuru açılamadı.");
      if (analysisStarted) {
        workflowApi.updateApplication(application.id, "analysis_failed")
          .then((saved) => setApplications((current) => current.map((item) => item.id === saved.application.id ? saved.application : item)))
          .catch(() => undefined);
      }
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
    if (target.sourceApplicationId) {
      const applicationId = target.sourceApplicationId;
      const existingTimer = remoteReviewTimers.current.get(applicationId);
      if (existingTimer) clearTimeout(existingTimer);
      const saveRemote = () => {
        remoteReviewTimers.current.delete(applicationId);
        workflowApi.updateApplication(applicationId, "save_review", { review })
          .then((saved) => {
            setApplications((current) => current.map((item) => item.id === saved.application.id ? saved.application : item));
            // Karar kaydedildi; yalnızca yarışmacı bildirimi düşmüşse uyarılır.
            setUploadError(saved.notificationWarning
              ? `Karar kaydedildi. Ancak yarışmacıya sonuç e-postası gönderilemedi: ${saved.notificationWarning}`
              : "");
          })
          .catch(reportPersistFailure);
      };
      if (status === "reviewed") saveRemote();
      else remoteReviewTimers.current.set(applicationId, setTimeout(saveRemote, 600));
    } else persist(saveReport(updated));
  }

  return (
    <main className="app-shell">
      <EvalRail view={view} counts={counts} onNavigate={setView} />
      <div className="app-main">
        <EvalTopbar view={view} onBack={() => { if (view > 1) setView((view - 1) as EvalView); else window.location.href = "/"; }} />
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
            applications={applications}
            onOpenApplication={openApplication}
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
