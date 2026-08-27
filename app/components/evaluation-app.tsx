"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopbarSession from "./topbar-session";
import { formatDateTime } from "../lib/admin-client";
import { extractPdfText } from "../lib/pdf-reader";
import { applySimilarity, expectedLanguageCode } from "../lib/report-prechecks";
import { evaluateReport } from "../lib/report-evaluator";
import { WorkflowApiError, workflowApi } from "../lib/workflow-client";
import { APPLICATION_STATUS_LABELS, type CompetitionApplication, type CompetitionProfile, type CompetitionWorkflow } from "../lib/workflow-types";
import AiDisclaimer from "./ai-disclaimer";
import {
  buildJudgeFeedback,
  criterionDecisionError,
  defaultOutcomeNote,
  effectiveVerdictOf,
  judgeDecisionCounts,
  restoreCriterionDecisions,
  visibleFindingsOf,
} from "../lib/judge-review";
import {
  AI_CRITERION_VERDICT_LABELS,
  CHECK_STAGES,
  PARTICIPANT_FEEDBACK_LABELS,
  RULE_VERDICT_LABELS,
  aiVerdictOf,
  checkStageOf,
  type CriterionFinding,
  type EvidenceRef,
  type JudgeCriterionDecision,
  type JudgeEvidenceMode,
  type JudgeReview,
  type ReportEvaluation,
  type RuleVerdict,
  type SimilarityReport,
  type StageResult,
} from "../lib/types";

/**
 * Değerlendirme Atölyesi (Rol 02 · Hakem) — nihai hakem akışı.
 *
 *   1. Hakem "Yapay Zekâ Analizi Yap" düğmesine basar.
 *   2. AI yalnızca PDF'den değerlendirilebilen kriterleri analiz eder; benzerlik
 *      karşılaştırması aynı PDF metniyle PARALEL çalışır (bağımsız hata yönetimi).
 *   3. Her kriter kartında AI ön değerlendirmesi (Uygun/Olumsuz) gösterilir;
 *      AI sonucu DEĞİŞTİRİLEMEZ ve denetim için korunur.
 *   4. Hakem her kriter için AYRI Onay veya Ret kararı verir; karar başlangıçta
 *      daima "Karar bekliyor"dur, AI sonucuyla otomatik doldurulmaz.
 *   5. Bütün kriterler sonuçlanmadan genel karar bölümü AÇILMAZ.
 *   6. Nihai ONAY/RET yalnızca hakemindir; sistem öneri bile üretmez.
 *
 * Benzerlik kontrolü bütün kriter analizlerinin altında ayrı bir nottur;
 * sayaçlara katılmaz ve hiçbir kararı otomatik değiştirmez.
 */

type Mode = "home" | "workshop" | "history";
type Outcome = "accepted" | "rejected";

const ANALYZABLE_STATUSES = ["assigned", "resubmitted", "analysis_failed"] as const;

const OUTCOME_LABELS: Record<JudgeReview["outcome"], string> = {
  pending: "Karar bekliyor",
  accepted: "ONAY",
  rejected: "RET",
  revision_required: "Düzeltme istendi",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Yalnızca dört aşamalı (2.0) sonuçlar incelenebilir. Eski kayıtlardaki
 * DEGERLENDIRILEMEDI (PDF dışı) bulguları geriye uyum için okunur ama hakem
 * karar listesine ve sayaçlara ALINMAZ (madde 2).
 */
function usableEvaluation(application: CompetitionApplication): ReportEvaluation | null {
  const evaluation = application.evaluation;
  return evaluation && evaluation.version === "2.0" && Array.isArray(evaluation.findings) && Array.isArray(evaluation.stages) && evaluation.summary
    ? evaluation
    : null;
}

function fileUrl(application: CompetitionApplication, page?: number | null) {
  const base = `/api/applications/${encodeURIComponent(application.id)}/file`;
  return page ? `${base}#page=${page}` : base;
}

function evidenceLocation(item: EvidenceRef): string {
  const parts = [
    item.page ? `s. ${item.page}` : null,
    item.paragraph ? `¶ ${item.paragraph}` : null,
    item.section ? item.section : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Konum belirtilmemiş";
}

function pageOf(finding: CriterionFinding): number | null {
  return finding.evidence.find((item) => item.page)?.page ?? null;
}

/** AI ön değerlendirme sayaçları; hakem sayaçlarıyla KARIŞTIRILMAZ. */
function aiCounts(findings: CriterionFinding[]) {
  const uygun = findings.filter((finding) => aiVerdictOf(finding.verdict) === "UYGUN").length;
  return { uygun, olumsuz: findings.length - uygun };
}

function sha256HexOf(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes)
    .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

/* ----------------------------------------------------------------------- */

function VerdictBadge({ verdict }: { verdict: RuleVerdict }) {
  return <span className={`eval-verdict ${verdict}`}>{RULE_VERDICT_LABELS[verdict]}</span>;
}

function Rail({ mode, pending, completed, onNavigate }: {
  mode: Mode;
  pending: number;
  completed: number;
  onNavigate: (mode: Mode) => void;
}) {
  const items: Array<{ id: Mode; title: string; short: string; badge: string }> = [
    { id: "home", title: "Giriş", short: "Nereden devam edilecek?", badge: "◈" },
    { id: "workshop", title: "Değerlendirme Atölyesi", short: "Yarışma → başvuru → AI analizi → kriter kararları", badge: String(pending) },
    { id: "history", title: "Geçmiş değerlendirmeler", short: "Kararı verilmiş başvurular", badge: String(completed) },
  ];
  return (
    <nav className="step-rail" aria-label="Değerlendirme bölümleri">
      <div className="rail-heading">
        <span className="rail-mark">DA</span>
        <div>
          <strong>Değerlendirme Atölyesi</strong>
          <span>Hakem · AI 4. göz</span>
        </div>
      </div>
      <ol>
        {items.map((item) => (
          <li key={item.id} className={`rail-step ${item.id === mode ? "active" : "upcoming"}`}>
            <button type="button" aria-current={item.id === mode ? "page" : undefined} onClick={() => onNavigate(item.id)}>
              <span className="step-index" aria-hidden="true">{item.badge}</span>
              <span><strong>{item.title}</strong><small>{item.short}</small></span>
            </button>
          </li>
        ))}
      </ol>
      <div className="rail-note">
        <span className="status-dot" />
        <div>
          <strong>AI karşılaştırır, hakem karar verir</strong>
          <p>AI her kriter için ön değerlendirme üretir; kriter kararları ve nihai ONAY/RET yalnızca hakemindir.</p>
        </div>
      </div>
      <Link className="eval-rail-link icon-back" href="/" aria-label="Çalışma alanıma dön" title="Çalışma alanıma dön"><span aria-hidden="true">←</span></Link>
    </nav>
  );
}

function HomeView({ pending, completed, onChoose }: { pending: number; completed: number; onChoose: (mode: Mode) => void }) {
  return (
    <section className="workspace eval-home" aria-labelledby="eval-home-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Hakem girişi</span>
          <h1 id="eval-home-title">Nereden devam etmek istersiniz?</h1>
          <p>Yeni başvuruları değerlendirmek için atölyeye, kararı verilmiş başvuruları görmek için geçmişe geçin.</p>
        </div>
      </div>
      <div className="eval-home-choices">
        <button type="button" className="eval-home-choice primary" onClick={() => onChoose("workshop")}>
          <span className="eval-home-badge">{pending}</span>
          <strong>Değerlendirme Atölyesi</strong>
          <p>Kriteri çıkarılmış yarışmalar, size atanan başvurular, Yapay Zekâ Analizi ve kriter bazlı hakem kararları.</p>
          <b aria-hidden="true">→</b>
        </button>
        <button type="button" className="eval-home-choice" onClick={() => onChoose("history")}>
          <span className="eval-home-badge">{completed}</span>
          <strong>Geçmiş değerlendirmeler</strong>
          <p>Tamamlanan kararlar ve yarışmacıya iletilen sonuçlar; gerekirse yeniden açılabilir.</p>
          <b aria-hidden="true">→</b>
        </button>
      </div>
    </section>
  );
}

function CompetitionList({ profiles, applications, competitions, selectedKey, history, onSelect }: {
  profiles: CompetitionProfile[];
  applications: CompetitionApplication[];
  /** Öncelik bayrakları; Değerlendirme Yöneticisi tarafından atanır. */
  competitions: CompetitionWorkflow[];
  selectedKey: string | null;
  history: boolean;
  onSelect: (key: string) => void;
}) {
  // Kriteri çıkarılmış (yayımlı) her yarışma listelenir; henüz başvurusu olmayan da görünür.
  const entries = useMemo(() => {
    const priorityByKey = new Map(competitions.map((item) => [item.competitionKey, item]));
    const byKey = new Map<string, { key: string; name: string; profile: CompetitionProfile | null; items: CompetitionApplication[] }>();
    for (const profile of profiles.filter((item) => item.status === "approved")) {
      byKey.set(profile.competitionKey, { key: profile.competitionKey, name: profile.competitionName, profile, items: [] });
    }
    for (const application of applications) {
      const entry = byKey.get(application.competitionKey) ?? { key: application.competitionKey, name: application.competitionName, profile: null, items: [] };
      entry.items.push(application);
      byKey.set(application.competitionKey, entry);
    }
    // ÖNCELİKLİ yarışmalar her zaman listenin başında; gerisi ada göre sıralı.
    return [...byKey.values()]
      .map((entry) => ({ ...entry, competition: priorityByKey.get(entry.key) ?? null }))
      .sort((left, right) =>
        Number(Boolean(right.competition?.isPriority)) - Number(Boolean(left.competition?.isPriority))
        || left.name.localeCompare(right.name, "tr"));
  }, [profiles, applications, competitions]);

  return (
    <nav className="eval-competition-list" aria-label="Kriteri çıkarılmış yarışmalar">
      {entries.map((entry) => {
        const count = entry.items.filter((item) => history ? item.status === "completed" : item.status !== "completed").length;
        const criteriaCount = entry.profile?.profile.criteria.length ?? 0;
        const priority = entry.competition?.isPriority ?? false;
        return (
          <button
            key={entry.key}
            type="button"
            className={`${entry.key === selectedKey ? "active" : ""} ${priority ? "priority" : ""}`.trim()}
            onClick={() => onSelect(entry.key)}
            title={priority && entry.competition?.priorityNote ? `Öncelik gerekçesi: ${entry.competition.priorityNote}` : undefined}
          >
            {/* Değerlendirme Yöneticisi bu yarışmayı acil işaretledi. */}
            {priority ? <em className="priority-badge">🔥 ACİL / ÖNCELİKLİ</em> : null}
            <strong>{entry.name}</strong>
            <span>{entry.profile ? `${criteriaCount} kriter` : "Kriter profili yok"} · {count} {history ? "tamamlanan" : "bekleyen"} başvuru</span>
            {priority && entry.competition?.priorityNote ? <span className="priority-reason">{entry.competition.priorityNote}</span> : null}
          </button>
        );
      })}
      {!entries.length ? <p className="library-empty">Kriteri çıkarılmış yarışma yok. Yarışma Yöneticisi Kriter Atölyesi&apos;nde profil yayımladığında burada görünür.</p> : null}
    </nav>
  );
}

function ApplicationGrid({ applications, selectedId, analyzingId, onSelect }: {
  applications: CompetitionApplication[];
  selectedId: string | null;
  analyzingId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!applications.length) {
    // Hakem yalnızca kendisine ATANMIŞ başvuruları görür; boş liste "başvuru
    // yok" ya da "hepsi başka hakemde" demektir. Sebebi yazılmazsa sistem
    // bozuk görünüyordu.
    return (
      <div className="library-empty">
        <p>Bu yarışmada size atanmış başvuru yok.</p>
        <p>
          Yarışmacı raporunu gönderdiğinde sistem dosyayı en az yüklü hakeme otomatik atar.
          Size atanan başvurular anında burada görünür.
        </p>
      </div>
    );
  }
  return (
    <div className="eval-application-grid" role="list">
      {applications.map((application) => {
        const evaluation = usableEvaluation(application);
        const findings = evaluation ? visibleFindingsOf(evaluation) : [];
        const decisions = evaluation
          ? restoreCriterionDecisions(findings, application.review?.criterionDecisions)
          : [];
        const counts = evaluation ? judgeDecisionCounts(decisions) : null;
        return (
          <button
            key={application.id}
            type="button"
            role="listitem"
            className={`eval-application-card ${application.id === selectedId ? "selected" : ""} ${application.status === "completed" ? `outcome-${application.outcome}` : ""}`}
            onClick={() => onSelect(application.id)}
          >
            <span className="eval-card-status">
              {analyzingId === application.id ? "Analiz ediliyor…" : application.status === "completed" ? OUTCOME_LABELS[application.outcome] : APPLICATION_STATUS_LABELS[application.status]}
            </span>
            <strong>{application.teamName}</strong>
            <small>{application.applicantFullName || application.participantName}</small>
            <small>{application.fileName ?? "Başvuru PDF'i"}{application.sizeBytes ? ` · ${formatBytes(application.sizeBytes)}` : ""} · sürüm {application.currentVersionNumber}</small>
            {counts ? (
              <span className="eval-card-counts">
                <em className="BASARILI">Uygun {counts.uygun}</em>
                <em className="KRITIK_HATA">Olumsuz {counts.olumsuz}</em>
                <em className="REVIZYON">Bekleyen {counts.pending}</em>
              </span>
            ) : <span className="eval-card-counts muted">AI analizi yapılmadı</span>}
            <time>{formatDateTime(application.updatedAt)}</time>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Aşama ikonu: BAŞARILI → yeşil ✓, REVİZYON → sarı !, KRİTİK HATA → kırmızı ✕.
 * Problem 4 kitapçığı dil/şablon ve diğer kontrollerin yeşil/kırmızı ikonla
 * listelenmesini ister; renk tek başına bilgi taşımasın diye simge de değişir.
 */
function StageIcon({ verdict }: { verdict: RuleVerdict | null }) {
  if (!verdict) return <span className="eval-stage-icon none" aria-label="Sonuç yok" title="Sonuç yok">–</span>;
  const symbol = verdict === "BASARILI" ? "✓" : verdict === "REVIZYON" ? "!" : "✕";
  return (
    <span className={`eval-stage-icon ${verdict}`} aria-label={RULE_VERDICT_LABELS[verdict]} title={RULE_VERDICT_LABELS[verdict]}>
      {symbol}
    </span>
  );
}

function StageStrip({ stages }: { stages: StageResult[] }) {
  return (
    <div className="eval-stage-strip" aria-label="Dört aşamalı kontrol özeti">
      {CHECK_STAGES.map((definition) => {
        const stage = stages.find((item) => item.stage === definition.id);
        /** Aşamaya özgü, tek bakışta okunan ölçüm satırları. */
        const rows: Array<{ label: string; value: string; tone?: "ok" | "warn" | "bad" }> = [];

        if (stage && definition.id === "language_template") {
          const detected = stage.detectedLanguage ?? "tespit edilemedi";
          const expected = stage.expectedLanguage ?? null;
          // "Turkish" ile "Türkçe" aynı dildir: ham metin değil dil KODU karşılaştırılır.
          const detectedCode = expectedLanguageCode(stage.detectedLanguage);
          const expectedCode = expectedLanguageCode(expected);
          const matches = !expectedCode || !detectedCode ? null : detectedCode === expectedCode;
          rows.push({
            label: "Rapor dili",
            value: expected ? `${detected} (beklenen: ${expected})` : detected,
            tone: matches === null ? undefined : matches ? "ok" : "bad",
          });
        }

        if (stage && definition.id === "headings_content") {
          const headings = stage.headings ?? [];
          const filled = headings.filter((item) => item.present && item.contentFilled).length;
          const missing = headings.filter((item) => !item.present);
          rows.push({
            label: "Zorunlu başlıklar",
            value: headings.length ? `${filled}/${headings.length} başlık dolu` : "Başlık listesi yok",
            tone: !headings.length ? undefined : filled === headings.length ? "ok" : missing.length ? "bad" : "warn",
          });
          if (missing.length) {
            rows.push({ label: "Eksik", value: missing.slice(0, 3).map((item) => item.heading).join(", ") + (missing.length > 3 ? ` +${missing.length - 3}` : ""), tone: "bad" });
          }
        }

        if (stage && definition.id === "category_similarity") {
          const score = stage.categoryScore;
          rows.push({
            label: "Kategori uygunluğu",
            value: score === null || score === undefined ? "Skor yok" : `%${score}`,
            tone: score === null || score === undefined ? undefined : score >= 70 ? "ok" : score >= 40 ? "warn" : "bad",
          });
          // Benzerlik hakeme "Şüpheli / Normal" olarak işaretlenir (Problem 4 · 3).
          const similarity = stage.similarity;
          const suspicious = similarity?.status === "flagged" || similarity?.status === "failed";
          const warning = similarity?.status === "warning";
          rows.push({
            label: "Benzerlik taraması",
            value: !similarity || similarity.status === "skipped"
              ? "Çalıştırılmadı"
              : `${suspicious || warning ? "ŞÜPHELİ" : "Normal"}${similarity.percent !== null && similarity.percent !== undefined ? ` · %${similarity.percent}` : ""}${similarity.closestTeam ? ` · en yakın: ${similarity.closestTeam}` : ""}`,
            tone: !similarity || similarity.status === "skipped" ? undefined : suspicious ? "bad" : warning ? "warn" : "ok",
          });
        }

        if (stage && definition.id === "criteria_evidence") {
          rows.push({ label: "Kriter bulguları", value: stage.summary || "Aşağıdaki listede", tone: undefined });
        }

        return (
          <div key={definition.id} className={`eval-stage-chip ${stage?.verdict ?? "none"}`} title={stage?.summary || definition.detail}>
            <div className="eval-stage-head">
              <StageIcon verdict={stage?.verdict ?? null} />
              <div>
                <span className="eval-stage-order">{definition.order}. aşama</span>
                <strong>{definition.title}</strong>
              </div>
              {stage ? <VerdictBadge verdict={stage.verdict} /> : null}
            </div>
            <dl className="eval-stage-rows">
              {rows.map((row) => (
                <div key={row.label} className={row.tone ? `tone-${row.tone}` : ""}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              {!rows.length ? <div><dt>Durum</dt><dd>{stage?.summary || "Sonuç yok"}</dd></div> : null}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/**
 * "AI bulgusunu reddet" formunun taslağı; kaydedilmeden karar değişmez.
 * Hakem bulguyu reddettiğinde AYNI kriter için KENDİ değerlendirmesini girer:
 * kendi sonucu (UYGUN/OLUMSUZ) + kaynak (sayfa/bölüm/alıntı ya da raporda
 * bulunamadı) + gerekçe.
 */
type RejectDraft = {
  criterionId: string;
  /** Hakemin kendi sonucu; kaydetmeden önce seçilmesi zorunludur. */
  judgeResult: "UYGUN" | "OLUMSUZ" | null;
  evidenceMode: JudgeEvidenceMode;
  reason: string;
  page: string;
  section: string;
  quote: string;
  missingContent: string;
};

/**
 * Tek kriter kartı: üstte DEĞİŞTİRİLEMEZ AI ön değerlendirmesi (Uygun/Olumsuz),
 * altta hakemin bağımsız kararı (Karar bekliyor / Onay / Ret). Geçerli kriter
 * sonucu YALNIZCA hakem kararıdır.
 */
function CriterionDecisionCard({ finding, decision, application, specSourcePage, locked, rejectDraft, rejectError, onApprove, onOpenReject, onRejectDraft, onConfirmReject, onCancelReject, onReset }: {
  finding: CriterionFinding;
  decision: JudgeCriterionDecision;
  application: CompetitionApplication;
  /** Kriterin ŞARTNAMEDEKİ sabit kaynak sayfası (varsa); "Raporda bulunamadı" kararında gösterilir. */
  specSourcePage: number | null;
  locked: boolean;
  rejectDraft: RejectDraft | null;
  rejectError: string;
  onApprove: () => void;
  onOpenReject: () => void;
  onRejectDraft: (patch: Partial<RejectDraft>) => void;
  onConfirmReject: () => void;
  /** Yalnızca formu kapatır; VERİLMİŞ kararı DEĞİŞTİRMEZ. */
  onCancelReject: () => void;
  onReset: () => void;
}) {
  const evidence = finding.evidence[0];
  const page = pageOf(finding);
  const ai = aiVerdictOf(finding.verdict);
  const effective = effectiveVerdictOf(decision);
  const rejectOpen = rejectDraft?.criterionId === finding.criterionId;
  return (
    <li className={`eval-decision-card judge-${decision.judgeVerdict}`}>
      <div className="eval-decision-card-head">
        <div className="eval-result-title">
          <strong>{finding.criterionName}</strong>
          <span className="eval-result-meta">{checkStageOf(finding.stage).shortTitle} · {finding.required ? "Zorunlu" : "Zorunlu olmayan"}</span>
        </div>
        <div className="eval-decision-card-chips">
          {/* Onayla/Ret AI BULGUSUNUN kabulüdür; kesin sonuç ayrıca gösterilir. */}
          <span className={`judge-chip ${decision.judgeVerdict}`}>
            {decision.judgeVerdict === "pending" ? "KARAR BEKLİYOR" : decision.judgeVerdict === "approved" ? "AI bulgusu onaylandı" : "AI bulgusu reddedildi"}
          </span>
          {effective ? (
            <span className={`eval-ai-verdict ${effective}`} title="Kriterin kesinleşmiş sonucu">
              Kesin sonuç: {AI_CRITERION_VERDICT_LABELS[effective]}
            </span>
          ) : null}
        </div>
      </div>

      {/* AI ÖN DEĞERLENDİRMESİ — değiştirilemez, denetim için korunur. */}
      <div className={`eval-ai-block ai-${ai}`}>
        <div className="eval-ai-line">
          <span className="eval-ai-label">AI ön değerlendirmesi</span>
          <span className={`eval-ai-verdict ${ai}`}>{AI_CRITERION_VERDICT_LABELS[ai]}</span>
        </div>
        <p className="eval-result-reason">{finding.rationale}</p>
        {evidence ? <q className="eval-result-quote">{evidence.text}</q> : null}
        {finding.evidenceMissing ? <small className="eval-result-note">Sistem rapordan alıntı gösteremedi; kaynağı PDF&apos;te kendiniz kontrol edin.</small> : null}
        <div className="eval-result-actions">
          <a className="secondary-button eval-source-button" href={fileUrl(application, page)} target="_blank" rel="noreferrer">
            Kaynak Satıra Git{page ? ` · s. ${page}` : ""}
          </a>
          {evidence ? <small>{evidenceLocation(evidence)}</small> : null}
        </div>
      </div>

      {/*
        HAKEM DEĞERLENDİRMESİ — AI bulgusu reddedildiğinde bulgu kesin sonuç
        olarak kullanılamaz; yerine hakemin buraya yazdığı sonuç geçer.
      */}
      {decision.judgeVerdict === "rejected" && !rejectOpen ? (
        <div className="eval-judge-decision rejected">
          <div className="eval-ai-line">
            <span className="eval-ai-label">Hakem değerlendirmesi</span>
            {decision.judgeResult ? (
              <span className={`eval-ai-verdict ${decision.judgeResult}`}>{AI_CRITERION_VERDICT_LABELS[decision.judgeResult]}</span>
            ) : null}
          </div>
          <p>{decision.rejectionReason}</p>
          {decision.evidenceMode === "PDF_KONUMU" ? (
            <small>
              Dayanak: PDF konumu · <a href={fileUrl(application, decision.evidencePage)} target="_blank" rel="noreferrer">rapor s. {decision.evidencePage}</a>
              {decision.evidenceSection ? <> · {decision.evidenceSection}</> : null}
              {decision.evidenceQuote ? <> · “{decision.evidenceQuote}”</> : null}
            </small>
          ) : (
            <small>Dayanak: Raporda bulunamadı · aranan bölüm: {decision.missingContent}</small>
          )}
        </div>
      ) : null}

      {!locked ? (
        <div className="eval-judge-actions">
          {rejectOpen ? (
            <div className="eval-reject-form" role="group" aria-label={`${finding.criterionName} için hakem değerlendirmesi`}>
              <p className="eval-reject-intro">
                AI bulgusunu reddettiniz: bulgu kesin sonuç olarak kullanılamaz. Bu kriter
                (<strong>{finding.criterionName}</strong>) için KENDİ değerlendirmenizi girin;
                açıklamanız yalnızca bu kriterin kapsamıyla ilgili olmalıdır.
              </p>
              {/* Hakemin kendi sonucu: kriterin kesinleşecek değeri. */}
              <div className="eval-reject-mode" role="radiogroup" aria-label="Hakem sonucu">
                <label>
                  <input
                    type="radio"
                    name={`judge-result-${finding.criterionId}`}
                    checked={rejectDraft!.judgeResult === "UYGUN"}
                    onChange={() => onRejectDraft({ judgeResult: "UYGUN" })}
                  />
                  <span><strong>UYGUN</strong> — kriter, hakem değerlendirmesine göre karşılanıyor</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name={`judge-result-${finding.criterionId}`}
                    checked={rejectDraft!.judgeResult === "OLUMSUZ"}
                    onChange={() => onRejectDraft({ judgeResult: "OLUMSUZ" })}
                  />
                  <span><strong>OLUMSUZ</strong> — kriter, hakem değerlendirmesine göre karşılanmıyor</span>
                </label>
              </div>
              <div className="eval-reject-mode" role="radiogroup" aria-label="Dayanak türü">
                <label>
                  <input
                    type="radio"
                    name={`evidence-mode-${finding.criterionId}`}
                    checked={rejectDraft!.evidenceMode === "PDF_KONUMU"}
                    onChange={() => onRejectDraft({ evidenceMode: "PDF_KONUMU" })}
                  />
                  <span>PDF konumu — değerlendirme katılımcı PDF&apos;inin belirli bir kısmına dayanıyor</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name={`evidence-mode-${finding.criterionId}`}
                    checked={rejectDraft!.evidenceMode === "RAPORDA_BULUNAMADI"}
                    onChange={() => onRejectDraft({ evidenceMode: "RAPORDA_BULUNAMADI" })}
                  />
                  <span>Raporda bulunamadı — aranan bölüm/içerik raporda hiç yok (sahte sayfa/alıntı istenmez)</span>
                </label>
              </div>
              {rejectDraft!.evidenceMode === "PDF_KONUMU" ? (
                <div className="eval-reject-grid">
                  <label className="field">
                    <span className="field-label">Katılımcı PDF sayfası</span>
                    <input
                      type="number"
                      min={1}
                      value={rejectDraft!.page}
                      placeholder="Örn. 6"
                      onChange={(event) => onRejectDraft({ page: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Kaynak bölüm / madde (isteğe bağlı)</span>
                    <input
                      value={rejectDraft!.section}
                      maxLength={300}
                      placeholder="Örn. 3.2 Mekanik Tasarım"
                      onChange={(event) => onRejectDraft({ section: event.target.value })}
                    />
                  </label>
                  <label className="field eval-reject-quote">
                    <span className="field-label">Doğrudan alıntı</span>
                    <textarea
                      value={rejectDraft!.quote}
                      maxLength={1200}
                      placeholder="Örn. “Sistem boyutu 104 cm olarak belirlenmiştir.”"
                      onChange={(event) => onRejectDraft({ quote: event.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <div className="eval-reject-grid">
                  <label className="field">
                    <span className="field-label">Aranan bölüm / başlık</span>
                    <input
                      value={rejectDraft!.missingContent}
                      maxLength={400}
                      placeholder="Örn. Yapısal analiz sonuçları bölümü"
                      onChange={(event) => onRejectDraft({ missingContent: event.target.value })}
                    />
                  </label>
                  <p className="eval-reject-note">
                    Olmayan içerik için katılımcı PDF sayfası ve alıntı İSTENMEZ.
                    {specSourcePage ? <> İlgili şartname kriterinin kaynağı: s. {specSourcePage}.</> : null}
                  </p>
                </div>
              )}
              <label className="field">
                <span className="field-label">Hakem gerekçesi ve açıklaması</span>
                <textarea
                  value={rejectDraft!.reason}
                  maxLength={2000}
                  placeholder="Örn. Şartnamede izin verilen azami boyut 100 cm'dir; rapor 104 cm bildiriyor."
                  onChange={(event) => onRejectDraft({ reason: event.target.value })}
                />
              </label>
              {rejectError ? <p className="approval-error" role="alert">{rejectError}</p> : null}
              <div className="eval-reject-actions">
                {/* Vazgeç yalnızca formu kapatır; önceden verilmiş karar korunur. */}
                <button type="button" className="text-button" onClick={onCancelReject}>Vazgeç</button>
                <button type="button" className="danger-button" onClick={onConfirmReject}>Hakem değerlendirmesini kaydet</button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={`secondary-button eval-approve-button ${decision.judgeVerdict === "approved" ? "active" : ""}`}
                title="AI bulgusunu doğru kabul et: kesin sonuç AI sonucu olur"
                onClick={onApprove}
              >
                ✓ Onayla
              </button>
              <button
                type="button"
                className={`secondary-button eval-reject-button ${decision.judgeVerdict === "rejected" ? "active" : ""}`}
                title="AI bulgusunu reddet ve kendi değerlendirmeni gir (katılımcıyı reddetmez)"
                onClick={onOpenReject}
              >
                ✕ Ret
              </button>
              {decision.judgeVerdict !== "pending" ? (
                <button type="button" className="text-button" onClick={onReset}>Kararı sıfırla</button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Benzerlik kontrolü notu (madde 9.9–9.10): bütün kriter analizlerinin
 * ALTINDA ayrı ve sade bir nottur. Sayaçlara katılmaz, genel kararı
 * değiştirmez, otomatik intihal veya ret kararı vermez.
 */
function SimilarityNote({ report, application }: { report: SimilarityReport; application: CompetitionApplication }) {
  const flagged = report.level === "review" || report.level === "high";
  return (
    <section className={`eval-similarity-note level-${report.level}`} aria-label="Benzerlik kontrolü">
      <p>
        <strong>Benzerlik kontrolü:</strong> {report.note}
      </p>
      {flagged && report.matches.length ? (
        <details className="eval-similarity-detail">
          <summary>Güçlü eşleşmeleri göster ({Math.min(3, report.matches.length)})</summary>
          <ol>
            {report.matches.slice(0, 3).map((match, index) => (
              <li key={`${match.peerApplicationId}-${index}`}>
                <div className="eval-similarity-match-head">
                  <strong>{match.peerLabel}</strong>
                  <span>{match.kind === "direct" ? "Doğrudan metin benzerliği" : "Anlamsal benzerlik"} · Hakem incelemesi gerekir</span>
                </div>
                <div className="eval-similarity-quotes">
                  <div>
                    <small>Bu rapor{match.ownPage ? ` · s. ${match.ownPage}` : ""}</small>
                    <q>{match.ownQuote || "Alıntı yok"}</q>
                    <a href={fileUrl(application, match.ownPage)} target="_blank" rel="noreferrer">Bu PDF&apos;i sayfada aç</a>
                  </div>
                  <div>
                    {/* Başka takımın PDF'ine DOĞRUDAN BAĞLANTI verilmez; alıntı yeterlidir. */}
                    <small>{match.peerLabel}{match.peerPage ? ` · s. ${match.peerPage}` : ""}</small>
                    <q>{match.peerQuote || "Alıntı yok"}</q>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function ApplicationDetail({ application, profile, analyzing, progress, onAnalyze, onFinalize, onReopen, onDeleteAnalysis, onArchive }: {
  application: CompetitionApplication;
  /** Yarışmanın yayımlı profili; kriterlerin şartname kaynak sayfası buradan okunur. */
  profile: CompetitionProfile | null;
  analyzing: boolean;
  progress: string;
  onAnalyze: (application: CompetitionApplication, force?: boolean) => void;
  onFinalize: (application: CompetitionApplication, review: JudgeReview) => Promise<boolean>;
  /** Kesinleşmiş kararı sunucuda yeniden açar. */
  onReopen: (application: CompetitionApplication) => Promise<void>;
  /** AI analizini ve tamamlanmamış kriter kararlarını sunucudan siler. */
  onDeleteAnalysis: (application: CompetitionApplication) => Promise<void>;
  /** Aktif iş listesinden kaldırma (arşivleme); fiziksel silme DEĞİLDİR. */
  onArchive: (application: CompetitionApplication, reason: string) => Promise<void>;
}) {
  const evaluation = usableEvaluation(application);
  // PDF dışı kurallar hakem ekranına HİÇ gelmez (madde 2).
  const findings = useMemo(() => evaluation ? visibleFindingsOf(evaluation) : [], [evaluation]);
  const completed = application.status === "completed" && application.review?.status === "completed";
  const [decisions, setDecisions] = useState<JudgeCriterionDecision[]>(
    () => restoreCriterionDecisions(findings, application.review?.criterionDecisions),
  );
  const [rejectDraft, setRejectDraft] = useState<RejectDraft | null>(null);
  const [rejectError, setRejectError] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState(application.review?.outcomeNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);

  const canAnalyze = (ANALYZABLE_STATUSES as readonly string[]).includes(application.status) && !analyzing;
  const canRefresh = !analyzing && (canAnalyze || application.status === "awaiting_judge" || application.status === "judge_in_review");
  const locked = completed;
  /*
   * KRİTER TAZELİĞİ (madde 2): kriterler bu analizden sonra yeniden
   * yayımlandıysa sonuç eskimiştir. Sunucu da bu durumda nihai kararı
   * reddeder; ekran nedenini önceden söyler.
   */
  const criteriaOutdated = application.criteriaOutdated && !completed;

  /** Kriterin şartnamedeki sabit kaynak sayfası; yalnızca gösterim içindir. */
  const specPageOf = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const criterion of profile?.profile.criteria ?? []) map.set(criterion.id, criterion.sourcePage);
    return map;
  }, [profile]);

  const counts = judgeDecisionCounts(decisions);
  const ai = aiCounts(findings);
  // PDF'den değerlendirilebilen kriter hiç yoksa (hepsi PDF dışı) genel karar
  // yine verilebilir; kilitli kalmaz. Bekleyen karar varsa bölüm açılmaz.
  const allDecided = counts.pending === 0;

  function patchDecision(criterionId: string, patch: Partial<JudgeCriterionDecision>) {
    setDecisions((current) => current.map((item) => item.criterionId === criterionId ? { ...item, ...patch } : item));
    setPendingOutcome(null);
    setSaveError("");
  }

  function approve(criterionId: string) {
    /*
     * Onayla = AI BULGUSU doğru kabul edildi. AI UYGUN dediyse kesin sonuç
     * uygun, OLUMSUZ dediyse kesin sonuç olumsuz olur; AI'nin kaynağı ve
     * gerekçesi korunur, hakemin ek açıklama yazması zorunlu değildir.
     */
    patchDecision(criterionId, {
      judgeVerdict: "approved", judgeResult: null, rejectionReason: "", evidenceMode: null,
      evidencePage: null, evidenceSection: "", evidenceQuote: "", missingContent: "",
    });
    setRejectDraft(null);
    setRejectError("");
  }

  function openReject(finding: CriterionFinding) {
    const decision = decisions.find((item) => item.criterionId === finding.criterionId);
    setRejectDraft({
      criterionId: finding.criterionId,
      // Hakem sonucu bilinçli olarak BOŞ başlar: AI'nin tersi otomatik seçilmez.
      judgeResult: decision?.judgeVerdict === "rejected" ? decision.judgeResult : null,
      evidenceMode: decision?.evidenceMode ?? "PDF_KONUMU",
      reason: decision?.rejectionReason ?? "",
      page: decision?.evidencePage ? String(decision.evidencePage) : String(pageOf(finding) ?? ""),
      section: decision?.evidenceSection ?? "",
      quote: decision?.evidenceQuote ?? "",
      missingContent: decision?.missingContent ?? "",
    });
    setRejectError("");
  }

  function confirmReject() {
    if (!rejectDraft) return;
    const page = rejectDraft.page.trim() ? Math.round(Number(rejectDraft.page)) : null;
    const candidate: JudgeCriterionDecision = {
      ...(decisions.find((item) => item.criterionId === rejectDraft.criterionId)!),
      judgeVerdict: "rejected",
      judgeResult: rejectDraft.judgeResult,
      rejectionReason: rejectDraft.reason.trim(),
      evidenceMode: rejectDraft.evidenceMode,
      evidencePage: rejectDraft.evidenceMode === "PDF_KONUMU" && Number.isInteger(page) && (page as number) >= 1 ? page : null,
      evidenceSection: rejectDraft.evidenceMode === "PDF_KONUMU" ? rejectDraft.section.trim() : "",
      evidenceQuote: rejectDraft.evidenceMode === "PDF_KONUMU" ? rejectDraft.quote.trim() : "",
      missingContent: rejectDraft.evidenceMode === "RAPORDA_BULUNAMADI" ? rejectDraft.missingContent.trim() : "",
    };
    const error = criterionDecisionError(candidate);
    if (error) { setRejectError(error); return; }
    patchDecision(candidate.criterionId, candidate);
    setRejectDraft(null);
    setRejectError("");
  }

  function resetDecision(criterionId: string) {
    patchDecision(criterionId, {
      judgeVerdict: "pending", judgeResult: null, rejectionReason: "", evidenceMode: null,
      evidencePage: null, evidenceSection: "", evidenceQuote: "", missingContent: "",
    });
    setRejectDraft(null);
    setRejectError("");
  }

  function startDecision(outcome: Outcome) {
    // Onayla ↔ Reddet geçişinde ELLE YAZILMIŞ açıklama korunur; ama dokunulmamış
    // otomatik şablon bayat kalmaz, yeni kararın şablonuyla değiştirilir.
    const previousDefault = pendingOutcome ? defaultOutcomeNote(pendingOutcome, findings, decisions) : "";
    setPendingOutcome(outcome);
    setSaveError("");
    // Nihai RET açıklaması deterministik şablondan gelir; AI çağrısı YAPILMAZ.
    setNote((current) => !current.trim() || current === previousDefault
      ? defaultOutcomeNote(outcome, findings, decisions)
      : current);
  }

  async function finalize() {
    if (!evaluation || !pendingOutcome) return;
    setSaving(true);
    setSaveError("");
    const review: JudgeReview = {
      status: "completed",
      outcome: pendingOutcome,
      outcomeNote: note.trim().slice(0, 1000),
      decisions: [],
      criterionDecisions: decisions,
      overallNote: "",
      finalFeedback: buildJudgeFeedback(findings, decisions),
      feedbackApproved: true,
      completedAt: new Date().toISOString(),
    };
    try {
      const ok = await onFinalize(application, review);
      if (ok) setPendingOutcome(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Bilinmeyen hata.");
    } finally {
      setSaving(false);
    }
  }

  const similarityReport = evaluation?.similarityReport ?? null;

  return (
    <section className="eval-detail" aria-labelledby="eval-detail-title">
      <header className="eval-detail-head">
        <div>
          <span className="section-kicker">{application.competitionName}</span>
          <h2 id="eval-detail-title">{application.teamName}</h2>
          <p>
            {application.applicantFullName || application.participantName}
            {application.teamMembers.length ? ` · ${application.teamMembers.length} ekip üyesi` : ""}
            {" · "}sürüm {application.currentVersionNumber} · {formatDateTime(application.submittedAt)}
          </p>
        </div>
        <div className="eval-detail-actions">
          <span className={`status-chip ${completed ? (application.outcome === "accepted" ? "success" : "danger") : "neutral"}`}>
            {completed ? OUTCOME_LABELS[application.outcome] : APPLICATION_STATUS_LABELS[application.status]}
          </span>
          <a className="secondary-button" href={fileUrl(application)} target="_blank" rel="noreferrer">PDF&apos;i aç</a>
        </div>
      </header>

      {!evaluation ? (
        <div className="eval-analyze-block">
          <div>
            <strong>{application.status === "analysis_failed" ? "AI analizi tamamlanamadı veya eski sürümle yapılmış" : "Bu başvuru henüz analiz edilmedi"}</strong>
            <p>
              Yapay zekâ, yalnızca PDF&apos;den değerlendirilebilen yayımlı kriterleri rapor ile karşılaştırır ve her kriter için
              Uygun/Olumsuz ön değerlendirme üretir; aynı anda rapor, aynı yarışmadaki diğer başvurularla benzerlik açısından
              karşılaştırılır. Kriter kararları ve nihai karar sizindir.
            </p>
          </div>
          {analyzing ? (
            <div className="analysis-progress" role="status" aria-live="polite">
              <span className="progress-spinner" />
              <div><strong>Yapay Zekâ Analizi sürüyor</strong><p>{progress}</p></div>
              <div className="progress-line"><span /></div>
            </div>
          ) : (
            <button type="button" className="primary-button eval-analyze-button" disabled={!canAnalyze} onClick={() => onAnalyze(application)}>
              {application.status === "analysis_failed" ? "Yeniden dene" : "Yapay Zekâ Analizi Yap"} <span aria-hidden="true">→</span>
            </button>
          )}
          {!canAnalyze && !analyzing ? (
            <small>{application.status === "analyzing" ? "Analiz başka bir oturumda sürüyor." : "Bu durumda analiz başlatılamaz."}</small>
          ) : null}
        </div>
      ) : (
        <>
          {criteriaOutdated ? (
            <div className="inline-error criteria-outdated" role="alert">
              <strong>Kriterler güncellendi, yeniden analiz yapın.</strong>
              <span>
                Bu analiz v{application.evaluationCriteriaVersion ?? "?"} kriter sürümüyle üretildi;
                yürürlükteki sürüm v{application.currentCriteriaVersion}. Nihai karar vermeden önce
                “Analizi yenile” deyin.
              </span>
              <button type="button" className="secondary-button" disabled={analyzing} onClick={() => onAnalyze(application, true)}>
                Analizi yenile
              </button>
            </div>
          ) : null}

          <StageStrip stages={evaluation.stages} />
          {/* AI sonucunun HEMEN ALTINDA; altbilgide kaybolmaz (madde 10). */}
          <AiDisclaimer />

          {evaluation.analysisWarnings.length ? (
            <details className="eval-warnings">
              <summary>{evaluation.analysisWarnings.length} analiz uyarısı</summary>
              <ul>{evaluation.analysisWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          ) : null}

          {/*
            HAKEM KARAR SAYAÇLARI — kararlar ilerledikçe anlık güncellenir.
            AI ön değerlendirme sayacı ayrı satırdadır; ikisi karıştırılmaz.
          */}
          {/*
            SAYAÇLAR yalnızca KESİNLEŞMİŞ sonuçları sayar: bulgu onaylandıysa
            AI sonucu, bulgu reddedildiyse hakemin yazdığı sonuç. AI'nin ham
            sayacı ayrı bilgi satırıdır; ikisi karıştırılmaz.
          */}
          <div className="eval-result-summary" aria-label="Kesinleşmiş kriter sonucu özeti">
            <div className="BASARILI"><strong>{counts.uygun}</strong><span>uygun (kesinleşmiş)</span></div>
            <div className="KRITIK_HATA"><strong>{counts.olumsuz}</strong><span>olumsuz (kesinleşmiş)</span></div>
            <div className="REVIZYON"><strong>{counts.pending}</strong><span>karar bekleyen</span></div>
            <div><strong>{counts.total}</strong><span>toplam değerlendirilen PDF kriteri</span></div>
            {analyzing ? (
              <span className="eval-analyzing-note" role="status">{progress || "Analiz ediliyor…"}</span>
            ) : !locked ? (
              <button type="button" className="text-button" disabled={!canRefresh} onClick={() => onAnalyze(application, true)}>Analizi yenile</button>
            ) : null}
          </div>
          <p className="eval-ai-counts" aria-label="AI ön değerlendirme özeti">
            AI bulguları (bilgi amaçlı): {ai.uygun} Uygun · {ai.olumsuz} Olumsuz
            {counts.findingsApproved || counts.findingsRejected
              ? ` — hakem ${counts.findingsApproved} bulguyu onayladı, ${counts.findingsRejected} bulguyu reddedip kendi değerlendirmesini yazdı.`
              : ". Onayla/Ret düğmeleri AI bulgusunun kabulünü belirtir; kesin sonuç yukarıdaki sayaçlardadır."}
          </p>

          <div className="eval-result-group">
            <h3>Kriter kararları <span>{counts.total}</span></h3>
            {/*
              GERİYE UYUM: kriter bazlı karar akışından ÖNCE tamamlanmış
              kayıtlarda hakem kararı alanları boştur; nihai sonuç aşağıdaki
              karar kutusundadır. Eski kayıt "Karar bekliyor" diye YENİDEN
              karar istemez — yeniden kesinleştirilmek istenirse önce karar
              açılır ve yeni akışla kriter kararları verilir.
            */}
            {locked && !(application.review?.criterionDecisions?.length) ? (
              <p className="page-note">
                Bu karar, kriter bazlı hakem kararı akışından önce verildi; kartlardaki hakem kararı alanları bu yüzden boş görünür.
                Nihai sonuç aşağıdaki karar kutusundadır.
              </p>
            ) : null}
            {findings.length ? (
              <ul className="eval-result-list eval-decision-list">
                {findings.map((finding) => {
                  const decision = decisions.find((item) => item.criterionId === finding.criterionId)!;
                  return (
                    <CriterionDecisionCard
                      key={finding.criterionId}
                      finding={finding}
                      decision={decision}
                      application={application}
                      specSourcePage={specPageOf.get(finding.criterionId) ?? null}
                      locked={locked}
                      rejectDraft={rejectDraft?.criterionId === finding.criterionId ? rejectDraft : null}
                      rejectError={rejectDraft?.criterionId === finding.criterionId ? rejectError : ""}
                      onApprove={() => approve(finding.criterionId)}
                      onOpenReject={() => openReject(finding)}
                      onRejectDraft={(patch) => setRejectDraft((current) => current ? { ...current, ...patch } : current)}
                      onConfirmReject={confirmReject}
                      onCancelReject={() => { setRejectDraft(null); setRejectError(""); }}
                      onReset={() => resetDecision(finding.criterionId)}
                    />
                  );
                })}
              </ul>
            ) : <p className="eval-result-empty">Bu analizde PDF&apos;den değerlendirilebilen kriter yok.</p>}
          </div>

          {/* Benzerlik kontrolü: bütün kriter analizlerinin EN ALTINDA (madde 9.9). */}
          {similarityReport ? <SimilarityNote report={similarityReport} application={application} /> : null}

          {/*
            NİHAİ KARAR — bütün kriterler sonuçlanmadan AÇILMAZ. Sistem
            "öneriliyor" bile demez; kararı yalnızca hakem verir (madde 4).
          */}
          {locked ? (
            <div className="eval-decision-bar">
              <div>
                <strong>Karar verildi: {OUTCOME_LABELS[application.outcome]}</strong>
                <p>{application.review?.completedAt ? `${formatDateTime(application.review.completedAt)} · ` : ""}Sonuç yarışmacıya iletildi{application.outcomeNote ? `: “${application.outcomeNote}”` : "."}</p>
              </div>
              <button type="button" className="secondary-button" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await onReopen(application); } finally { setBusy(false); }
              }}>
                Kararı yeniden aç
              </button>
            </div>
          ) : pendingOutcome ? (
            <div className={`eval-final-panel outcome-${pendingOutcome}`}>
              <div className="eval-final-head">
                <strong>Nihai karar: {OUTCOME_LABELS[pendingOutcome]}</strong>
                <div className="eval-template-switch" role="group" aria-label="Kararı değiştir">
                  <button type="button" className={pendingOutcome === "accepted" ? "active" : ""} onClick={() => startDecision("accepted")}>Onayla</button>
                  <button type="button" className={pendingOutcome === "rejected" ? "active" : ""} onClick={() => startDecision("rejected")}>Reddet</button>
                </div>
              </div>
              <label className="field eval-template-note">
                <span className="field-label">Yarışmacıya sonuç açıklaması</span>
                <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <details className="eval-template-preview">
                <summary>Yarışmacının göreceği geri bildirim önizlemesi</summary>
                <div>
                  <p className="eval-template-preview-note">{note}</p>
                  {/* Yarışmacı yalnızca iki bölüm görür: Güçlü Yönler ve Gelişime Açık Yönler. */}
                  {(["strengths", "improvements"] as const).map((key) => {
                    const feedback = buildJudgeFeedback(findings, decisions);
                    return feedback[key].length ? (
                      <section key={key}>
                        <strong>{PARTICIPANT_FEEDBACK_LABELS[key]}</strong>
                        <ul>{feedback[key].map((line) => <li key={line}>{line}</li>)}</ul>
                      </section>
                    ) : null;
                  })}
                </div>
              </details>
              {saveError ? <div className="inline-error" role="alert"><strong>Karar kaydedilemedi.</strong><span>{saveError}</span></div> : null}
              <div className="eval-template-actions">
                <button type="button" className="text-button" disabled={saving} onClick={() => { setPendingOutcome(null); setSaveError(""); }}>Vazgeç</button>
                <button type="button" className={`primary-button ${pendingOutcome === "rejected" ? "danger" : "success"}`} disabled={saving} onClick={finalize}>
                  {saving ? "Kaydediliyor…" : pendingOutcome === "accepted" ? "ONAY kararını kesinleştir" : "RET kararını kesinleştir"}
                </button>
              </div>
            </div>
          ) : (
            <div className="eval-decision-bar">
              <div>
                <strong>Nihai karar</strong>
                <p>
                  {counts.total === 0
                    ? "Bu analizde PDF'den değerlendirilebilen kriter yok; raporun tamamı için nihai kararınızı doğrudan verebilirsiniz."
                    : allDecided
                      ? "Bütün kriterler sonuçlandı. Raporun tamamı için nihai kararınızı verin; sistem öneri üretmez."
                      : `Genel karar bölümü, ${counts.pending} bekleyen kriter kararı tamamlanmadan açılmaz.`}
                </p>
              </div>
              <div className="eval-decision-buttons">
                <button type="button" className="primary-button success" disabled={!allDecided} onClick={() => startDecision("accepted")}>Onayla</button>
                <button type="button" className="primary-button danger" disabled={!allDecided} onClick={() => startDecision("rejected")}>Reddet</button>
              </div>
            </div>
          )}

          {/*
            AI ANALİZİNİ SİL (madde 5): yalnızca AI analizi ve tamamlanmamış
            kriter kararları kaldırılır; başvuru, PDF, takım bilgileri, hakem
            ataması ve yarışma korunur. Kesinleşmiş kararda önce "Kararı
            yeniden aç" gerekir (sunucu da doğrular).
          */}
          {!locked ? (
            <div className="eval-archive-row">
              {deleteConfirmOpen ? (
                <div className="eval-delete-confirm" role="alertdialog" aria-label="AI analizini silme onayı">
                  <strong>AI analizi silinsin mi?</strong>
                  <ul>
                    <li>Bu işlem yalnızca AI analizini ve tamamlanmamış kriter kararlarını kaldırır.</li>
                    <li>Katılımcı başvurusu silinmez.</li>
                    <li>Katılımcı PDF&apos;i silinmez.</li>
                    <li>Takım bilgileri silinmez.</li>
                    <li>Hakem ataması silinmez.</li>
                    <li>Yarışma silinmez.</li>
                    <li>Bu PDF sürümünün benzerlik sonucu kaldırılır; başvuru yeniden “AI analizi bekliyor” durumuna döner.</li>
                  </ul>
                  <div className="eval-reject-actions">
                    <button type="button" className="text-button" disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>Vazgeç</button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try { await onDeleteAnalysis(application); setDeleteConfirmOpen(false); }
                        finally { setBusy(false); }
                      }}
                    >
                      {busy ? "Siliniyor…" : "Evet, AI analizini sil"}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="text-button eval-delete-analysis" onClick={() => setDeleteConfirmOpen(true)}>
                  AI analizini sil
                </button>
              )}
            </div>
          ) : null}

          {/*
            ARŞİVLEME (madde 11): fiziksel silme değildir. Kayıt, PDF ve
            değerlendirme geçmişi yerinde kalır; işlem gerekçesiyle birlikte
            denetim izine yazılır ve Değerlendirme Yöneticisi görebilir.
          */}
          {!locked ? (
            <div className="eval-archive-row">
              {archiveOpen ? (
                <div className="eval-archive-form" role="group" aria-label="Başvuruyu aktif listeden kaldır">
                  <label className="field">
                    <span className="field-label">Kaldırma gerekçesi</span>
                    <input
                      value={archiveReason}
                      maxLength={400}
                      placeholder="Örn. Yanlış yarışmaya gönderilmiş başvuru"
                      onChange={(event) => setArchiveReason(event.target.value)}
                    />
                  </label>
                  <button type="button" className="text-button" disabled={archiving} onClick={() => setArchiveOpen(false)}>Vazgeç</button>
                  <button
                    type="button"
                    className="danger-button ghost"
                    disabled={archiving || !archiveReason.trim()}
                    onClick={async () => {
                      setArchiving(true);
                      try { await onArchive(application, archiveReason.trim()); setArchiveOpen(false); setArchiveReason(""); }
                      finally { setArchiving(false); }
                    }}
                  >
                    {archiving ? "Kaldırılıyor…" : "Aktif listeden kaldır"}
                  </button>
                </div>
              ) : (
                <button type="button" className="text-button" onClick={() => setArchiveOpen(true)}>
                  Bu başvuruyu aktif listemden kaldır (arşivle)
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default function EvaluationApp() {
  const [mode, setMode] = useState<Mode>("home");
  const [profiles, setProfiles] = useState<CompetitionProfile[]>([]);
  /** Öncelik bayrakları; ÖNCELİKLİ yarışmalar listenin başında gösterilir. */
  const [competitions, setCompetitions] = useState<CompetitionWorkflow[]>([]);
  const [applications, setApplications] = useState<CompetitionApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [competitionKey, setCompetitionKey] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    let active = true;
    Promise.allSettled([workflowApi.profiles(), workflowApi.applications(), workflowApi.competitions()])
      .then(([profileResult, applicationResult, competitionResult]) => {
        if (!active) return;
        if (profileResult.status === "fulfilled") setProfiles(profileResult.value.profiles);
        if (applicationResult.status === "fulfilled") setApplications(applicationResult.value.applications);
        // Öncelik bayrağı olmadan da ekran çalışır; yalnızca rozet görünmez.
        if (competitionResult.status === "fulfilled") setCompetitions(competitionResult.value.competitions);
        const failure = [profileResult, applicationResult].find((result) => result.status === "rejected");
        setError(failure && failure.status === "rejected" ? (failure.reason instanceof Error ? failure.reason.message : "Veriler yüklenemedi.") : "");
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const pending = applications.filter((item) => item.status !== "completed");
  const completed = applications.filter((item) => item.status === "completed");
  const history = mode === "history";
  const pool = history ? completed : pending;
  const visible = competitionKey ? pool.filter((item) => item.competitionKey === competitionKey) : [];
  const selected = applications.find((item) => item.id === applicationId) ?? null;
  const selectedProfile = selected
    ? profiles.find((item) => item.competitionKey === selected.competitionKey && item.status === "approved") ?? null
    : null;

  function replaceApplication(next: CompetitionApplication) {
    setApplications((current) => current.some((item) => item.id === next.id)
      ? current.map((item) => item.id === next.id ? next : item)
      : [next, ...current]);
  }

  function navigate(next: Mode) {
    setMode(next);
    setApplicationId(null);
    setNotice("");
    setError("");
  }

  /**
   * Yapay Zekâ Analizi (madde 9.1).
   *
   * BÜTÜNLÜK (madde 3): istemci modele kriter ya da PDF GÖNDERMEZ. Sunucuya
   * yalnızca başvuru kimliği gider; kriter seti (son yayımlanan sürüm) ve
   * rapor PDF'i (R2'deki geçerli sürüm) sunucuda çözülür.
   *
   * PDF metni BİR KEZ çıkarılır ve iki işlem paylaşır: kriter analizi ile
   * benzerlik karşılaştırması `Promise.allSettled` ile PARALEL yürütülür.
   * Benzerlik başarısız olsa bile kriter analizi kaybolmaz; embedding 429
   * aldıysa benzerlik, kriter analizinin hemen arkasından kısa gecikmeyle
   * BİR KEZ daha denenir (kontrolsüz tekrar yok).
   *
   * @param force "Analizi yenile": sunucudaki kayıtlı sonuç atlanır.
   */
  async function analyze(application: CompetitionApplication, force = false) {
    if (analyzingId) return;
    setAnalyzingId(application.id);
    setError("");
    setNotice("");
    let started = false;
    try {
      setProgress("Analiz başlatılıyor…");
      const current = (await workflowApi.updateApplication(application.id, "start_analysis")).application;
      started = true;
      replaceApplication(current);
      setProgress("Rapor PDF'i okunuyor…");
      const file = await workflowApi.applicationFile(current.id, current.fileName ?? "basvuru.pdf");
      // PDF bir kez okunur: metin çıkarımı ve benzerliğin PDF bağı aynı bayttan üretilir.
      const pdfHash = await sha256HexOf(await file.arrayBuffer());
      const extracted = await extractPdfText(file);

      setProgress("Rapor kriterlere göre analiz ediliyor… · Aynı yarışmadaki başvurularla benzerlik karşılaştırılıyor…");
      const runSimilarity = () => workflowApi.similarityCheck(current.id, { pages: extracted.pages, pdfHash });
      const [evaluationResult, similarityResult] = await Promise.allSettled([
        evaluateReport({ applicationId: current.id, pages: extracted.pages, pageCount: extracted.pageCount, force }),
        runSimilarity(),
      ]);
      // Kriter analizi başarısızsa akış durur; benzerlik tek başına sonuç değildir.
      if (evaluationResult.status === "rejected") throw evaluationResult.reason;
      let evaluation = evaluationResult.value;

      let similarity = similarityResult.status === "fulfilled" ? similarityResult.value : null;
      const rateLimited = (similarityResult.status === "rejected"
        && similarityResult.reason instanceof WorkflowApiError && similarityResult.reason.status === 429)
        || (similarity?.embeddingRateLimited === true);
      if (rateLimited) {
        // 429: kriter analizi bitti; benzerlik kısa gecikmeyle BİR KEZ daha denenir.
        setProgress("Benzerlik karşılaştırması kısa gecikmeyle yeniden deneniyor…");
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        try { similarity = await runSimilarity(); } catch { /* MinHash/ilk sonuç neyse o kalır. */ }
      }
      if (similarity) {
        evaluation = applySimilarity(evaluation, similarity.check);
        evaluation = { ...evaluation, similarityReport: similarity.similarity };
      } else {
        const reason = similarityResult.status === "rejected" && similarityResult.reason instanceof Error
          ? similarityResult.reason.message
          : "bilinmeyen hata";
        evaluation = { ...evaluation, similarityReport: null };
        evaluation.analysisWarnings.push(`Benzerlik kontrolü tamamlanamadı: ${reason}. Kriter analizi bundan etkilenmedi.`);
      }

      setProgress("AI analizi ve benzerlik sonucu kaydediliyor…");
      const saved = await workflowApi.updateApplication(current.id, "save_evaluation", { evaluation });
      replaceApplication(saved.application);
      // Hakem analiz sürerken BAŞKA bir başvuruya geçmiş olabilir; oradaki
      // kaydedilmemiş kriter kararlarını silecek zorla gezinme yapılmaz.
      setApplicationId((currentId) => currentId === null || currentId === current.id ? saved.application.id : currentId);
    } catch (caught) {
      // Sistem kendiliğinden ikinci bir AI çağrısı yapmaz; başvuru
      // "analiz başarısız" durumuna döner ve hakem düğmeyle yeniden dener.
      setError(`"${application.teamName}" analiz edilemedi: ${caught instanceof Error ? caught.message : "Bilinmeyen hata."} Sorun geçiciyse “Yapay Zekâ Analizi Yap” düğmesiyle yeniden deneyebilirsiniz.`);
      if (started) {
        workflowApi.updateApplication(application.id, "analysis_failed")
          .then((saved) => replaceApplication(saved.application))
          .catch(() => undefined);
      }
    } finally {
      setAnalyzingId(null);
      setProgress("");
    }
  }

  /** Arşivleme: fiziksel silme değil; kayıt ve denetim izi korunur (madde 11). */
  async function archive(application: CompetitionApplication, reason: string): Promise<void> {
    try {
      await workflowApi.updateApplication(application.id, "archive_application", { note: reason });
      setApplications((current) => current.filter((item) => item.id !== application.id));
      setApplicationId(null);
      setError("");
      setNotice(`“${application.teamName}” aktif listenizden kaldırıldı. Kayıt silinmedi; işlem denetim izine yazıldı.`);
    } catch (caught) {
      setNotice("");
      setError(caught instanceof Error ? caught.message : "Başvuru aktif listeden kaldırılamadı.");
    }
  }

  /** AI analizini siler (madde 5); başvuru yeniden analiz bekler duruma döner. */
  async function deleteAnalysis(application: CompetitionApplication): Promise<void> {
    try {
      const saved = await workflowApi.updateApplication(application.id, "delete_analysis");
      if (saved.application) replaceApplication(saved.application);
      setError("");
      setNotice(`“${application.teamName}” için AI analizi silindi. Başvuru yeniden “AI analizi bekliyor” durumunda; işlem denetim izine yazıldı.`);
    } catch (caught) {
      setNotice("");
      setError(caught instanceof Error ? caught.message : "AI analizi silinemedi.");
    }
  }

  /** Kesinleşmiş nihai kararı sunucuda yeniden açar (madde 5). */
  async function reopen(application: CompetitionApplication): Promise<void> {
    try {
      const saved = await workflowApi.updateApplication(application.id, "reopen_review");
      if (saved.application) replaceApplication(saved.application);
      setError("");
      setNotice(`“${application.teamName}” kararı yeniden açıldı; sonuç yarışmacıya kapatıldı.`);
    } catch (caught) {
      setNotice("");
      setError(caught instanceof Error ? caught.message : "Karar yeniden açılamadı.");
    }
  }

  async function finalize(application: CompetitionApplication, review: JudgeReview): Promise<boolean> {
    const saved = await workflowApi.updateApplication(application.id, "save_review", { review });
    replaceApplication(saved.application);
    // Karar her hâlükârda kaydedildi. E-posta gönderilemediyse bu ayrıca bildirilir;
    // karar geri alınmaz (bkz. api/applications/[id] · notifyOutcome).
    if (saved.notificationWarning) {
      setNotice("");
      setError(`${application.teamName}: ${OUTCOME_LABELS[review.outcome]} kararı KAYDEDİLDİ. Ancak yarışmacıya bildirim gönderilemedi — ${saved.notificationWarning}`);
    } else {
      setError("");
      setNotice(`${application.teamName}: ${OUTCOME_LABELS[review.outcome]} kararı kaydedildi ve yarışmacıya iletildi.`);
    }
    return true;
  }

  const title = mode === "home" ? "Giriş" : mode === "workshop" ? "Değerlendirme Atölyesi" : "Geçmiş değerlendirmeler";

  return (
    <main className="app-shell">
      <Rail mode={mode} pending={pending.length} completed={completed.length} onNavigate={navigate} />
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-lead">
            <button type="button" className="topbar-back" onClick={() => { if (applicationId) setApplicationId(null); else if (mode !== "home") navigate("home"); else window.location.href = "/"; }} aria-label="Geri dön" title="Geri dön">
              <span aria-hidden="true">←</span>
            </button>
            <div>
              <span className="topbar-context">Değerlendirme karar destek sistemi</span>
              <strong>{title}</strong>
            </div>
          </div>
          <TopbarSession />
        </header>
        <div className="context-line" aria-hidden="true">
          {selected ? `${selected.competitionName} · ${selected.teamName}` : competitionKey ? (profiles.find((item) => item.competitionKey === competitionKey)?.competitionName ?? "") : "Hakem çalışma alanı"}
        </div>

        {error ? <div className="inline-error eval-persist-error" role="alert"><strong>İşlem tamamlanamadı.</strong><span>{error}</span></div> : null}
        {notice ? <p className="success-note eval-notice" role="status">{notice}</p> : null}

        {loading ? <p className="page-note eval-panel-margin">Yarışmalar ve başvurular yükleniyor…</p> : null}

        {!loading && mode === "home" ? <HomeView pending={pending.length} completed={completed.length} onChoose={navigate} /> : null}

        {!loading && mode !== "home" ? (
          <section className="workspace eval-workshop" aria-labelledby="eval-workshop-title">
            <div className="workspace-heading">
              <div>
                <span className="section-kicker">{history ? "Kararı verilmiş başvurular" : "Kriteri çıkarılmış yarışmalar"}</span>
                <h1 id="eval-workshop-title">{history ? "Geçmiş değerlendirmeler" : "Yarışmayı seçin, başvuruyu açın"}</h1>
                <p>{history ? "Tamamlanan kararlar ve yarışmacıya iletilen sonuçlar." : "Başvuruya tıklayın; Yapay Zekâ Analizi Yap düğmesiyle kriterler PDF ile karşılaştırılır ve benzerlik kontrol edilir."}</p>
              </div>
            </div>
            <div className="eval-workshop-layout">
              <CompetitionList
                profiles={profiles}
                applications={applications}
                competitions={competitions}
                selectedKey={competitionKey}
                history={history}
                onSelect={(key) => { setCompetitionKey(key); setApplicationId(null); }}
              />
              <div className="eval-workshop-main">
                {!competitionKey ? (
                  <p className="library-empty">Soldan bir yarışma seçin.</p>
                ) : selected ? (
                  <ApplicationDetail
                    key={`${selected.id}-${selected.evaluation?.analyzedAt ?? ""}-${selected.status}`}
                    application={selected}
                    profile={selectedProfile}
                    analyzing={analyzingId === selected.id}
                    progress={progress}
                    onAnalyze={analyze}
                    onFinalize={finalize}
                    onReopen={reopen}
                    onDeleteAnalysis={deleteAnalysis}
                    onArchive={archive}
                  />
                ) : (
                  <ApplicationGrid applications={visible} selectedId={applicationId} analyzingId={analyzingId} onSelect={setApplicationId} />
                )}
                {selected ? (
                  <button type="button" className="text-button eval-back-to-grid" onClick={() => setApplicationId(null)}>← Başvuru listesine dön</button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
