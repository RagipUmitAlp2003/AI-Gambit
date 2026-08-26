"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopbarSession from "./topbar-session";
import { formatDateTime } from "../lib/admin-client";
import { extractPdfText } from "../lib/pdf-reader";
import { applySimilarity, expectedLanguageCode } from "../lib/report-prechecks";
import { evaluateReport } from "../lib/report-evaluator";
import { workflowApi } from "../lib/workflow-client";
import { APPLICATION_STATUS_LABELS, type CompetitionApplication, type CompetitionProfile, type CompetitionWorkflow } from "../lib/workflow-types";
import AiDisclaimer from "./ai-disclaimer";
import {
  CHECK_STAGES,
  PARTICIPANT_FEEDBACK_LABELS,
  PDF_RULE_VERDICTS,
  RULE_VERDICT_LABELS,
  VERIFIABILITY_LABELS,
  checkStageOf,
  isRuleVerdict,
  type CriterionFinding,
  type EvidenceRef,
  type JudgeDecision,
  type JudgeReview,
  type ParticipantFeedback,
  type ReportEvaluation,
  type RuleVerdict,
  type StageResult,
} from "../lib/types";

/**
 * Değerlendirme Atölyesi (Rol 02 · Hakem) — Problem 4 akışı.
 *
 *   Giriş → "Değerlendirme Atölyesi" ya da "Geçmiş değerlendirmeler"
 *   Atölye → kriteri çıkarılmış (yayımlı) yarışmalar → seçilen yarışmanın
 *   başvuruları kutucuk hâlinde → başvuruya tıkla → "Yapay Zeka Analizi"
 *   Analiz = yayımlı kriterlerin PDF ile karşılaştırılması: uygun kriter ✓,
 *   hatalı kriter için hata sebebi + kaynak sayfaya giden düğme.
 *   Karar → ONAY / RED. RED'de AI'nin adım adım hata analizi düzenlenebilir bir
 *   şablon olarak yarışmacıya iletilir; ekstra analiz yoktur.
 *
 * Yerel rapor havuzu, profil JSON yükleme ve cihaz içi depo yoktur; her şey
 * D1'deki başvuru kaydı üzerinden yürür. AI nihai karar vermez.
 */

type Mode = "home" | "workshop" | "history";
type Outcome = "accepted" | "rejected";

const ANALYZABLE_STATUSES = ["assigned", "resubmitted", "analysis_failed"] as const;

const OUTCOME_LABELS: Record<JudgeReview["outcome"], string> = {
  pending: "Karar bekliyor",
  accepted: "ONAY",
  rejected: "RED",
  revision_required: "Düzeltme istendi",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Yalnızca dört aşamalı (2.0) sonuçlar incelenebilir; sunucu eski sonuçları zaten düşürür. */
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

/**
 * Hakem karar taslağı. Öntanımlı olarak her kural AI kararıyla "onaylı" başlar;
 * hakem şablon aşamasında dilediğini elle değiştirir (adjusted).
 */
function draftDecisions(evaluation: ReportEvaluation, stored: JudgeReview | null): JudgeDecision[] {
  const byId = new Map((stored?.decisions ?? []).map((decision) => [decision.criterionId, decision]));
  return evaluation.findings.map((finding) => {
    const previous = byId.get(finding.criterionId);
    const finalVerdict = previous && isRuleVerdict(previous.finalVerdict) ? previous.finalVerdict : finding.verdict;
    return {
      criterionId: finding.criterionId,
      verdict: finalVerdict === finding.verdict ? "accepted" : "adjusted",
      finalVerdict,
      note: typeof previous?.note === "string" ? previous.note : "",
    };
  });
}

function finalVerdictOf(finding: CriterionFinding, decisions: JudgeDecision[]): RuleVerdict {
  const decision = decisions.find((item) => item.criterionId === finding.criterionId);
  return decision?.finalVerdict ?? finding.verdict;
}

function reasonOf(finding: CriterionFinding, decisions: JudgeDecision[]): string {
  const decision = decisions.find((item) => item.criterionId === finding.criterionId);
  return decision?.note.trim() || finding.rationale;
}

function pageOf(finding: CriterionFinding): number | null {
  return finding.evidence.find((item) => item.page)?.page ?? null;
}

/**
 * Yarışmacıya iletilecek şablon: karşılanan kriterler, hatalı kriterler ve
 * sebepleri (kaynak sayfayla), revizyon önerileri. Bulgu dışı iddia içermez.
 */
function buildFeedback(findings: CriterionFinding[], decisions: JudgeDecision[]): ParticipantFeedback {
  const line = (finding: CriterionFinding, mark: string) => {
    const page = pageOf(finding);
    return `${mark} ${finding.criterionName} — ${reasonOf(finding, decisions)}${page ? ` (rapor s. ${page})` : ""}`;
  };
  return {
    strengths: findings.filter((finding) => finalVerdictOf(finding, decisions) === "BASARILI").map((finding) => `✓ ${finding.criterionName}`),
    improvements: findings.filter((finding) => finalVerdictOf(finding, decisions) === "KRITIK_HATA").map((finding) => line(finding, "✕")),
    suggestions: findings.filter((finding) => finalVerdictOf(finding, decisions) === "REVIZYON").map((finding) => line(finding, "⚠")),
    // PDF dışı kanıt gerektiren kurallar yarışmacıya "eksik" olarak gitmez.
  };
}

function countVerdicts(findings: CriterionFinding[], decisions: JudgeDecision[]) {
  // DEGERLENDIRILEMEDI hata sayacı değildir: PDF dışı kanıt gerektiren
  // kurallar ayrı sayılır ve ekranda ayrı bir bölümde listelenir (madde 4).
  const counts = { BASARILI: 0, REVIZYON: 0, KRITIK_HATA: 0, DEGERLENDIRILEMEDI: 0 };
  for (const finding of findings) counts[finalVerdictOf(finding, decisions)] += 1;
  return counts;
}

/** PDF'den doğrulanamayan kural mı? Bu kurallar hata listesine girmez. */
function outsidePdf(finding: CriterionFinding, decisions: JudgeDecision[]): boolean {
  return finalVerdictOf(finding, decisions) === "DEGERLENDIRILEMEDI";
}

function defaultOutcomeNote(outcome: Outcome, counts: ReturnType<typeof countVerdicts>): string {
  const summary = `${counts.BASARILI} kriter uygun, ${counts.REVIZYON} kriter revizyon gerektiriyor, ${counts.KRITIK_HATA} kriterde kritik hata var.`
    + (counts.DEGERLENDIRILEMEDI ? ` ${counts.DEGERLENDIRILEMEDI} kural rapor dışından (video, portal, kurul) kontrol edilmelidir.` : "");
  return outcome === "accepted"
    ? `Rapor kriterlere uygun bulundu ve onaylandı. ${summary}`
    : `Rapor kriterleri karşılamadığı için reddedildi. ${summary} Hatalı kriterler ve sebepleri aşağıda listelenmiştir.`;
}

/* ----------------------------------------------------------------------- */

function VerdictMark({ verdict }: { verdict: RuleVerdict }) {
  const symbol = verdict === "BASARILI" ? "✓" : verdict === "REVIZYON" ? "!" : "✕";
  return <span className={`eval-mark ${verdict}`} aria-label={RULE_VERDICT_LABELS[verdict]} title={RULE_VERDICT_LABELS[verdict]}>{symbol}</span>;
}

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
    { id: "workshop", title: "Değerlendirme Atölyesi", short: "Yarışma → başvuru → AI analizi → karar", badge: String(pending) },
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
          <p>Analiz, yayımlı kriterlerin rapor PDF&apos;i ile karşılaştırılmasıdır; ONAY veya RED kararı yalnızca hakemindir.</p>
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
          <p>Kriteri çıkarılmış yarışmalar, size atanan başvurular, Yapay Zeka Analizi ve ONAY / RED kararı.</p>
          <b aria-hidden="true">→</b>
        </button>
        <button type="button" className="eval-home-choice" onClick={() => onChoose("history")}>
          <span className="eval-home-badge">{completed}</span>
          <strong>Geçmiş değerlendirmeler</strong>
          <p>Tamamlanan kararlar ve yarışmacıya iletilen şablonlar; gerekirse yeniden açılabilir.</p>
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
        const counts = evaluation ? countVerdicts(evaluation.findings, application.review?.decisions ?? []) : null;
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
                <em className="BASARILI">✓ {counts.BASARILI}</em>
                <em className="REVIZYON">! {counts.REVIZYON}</em>
                <em className="KRITIK_HATA">✕ {counts.KRITIK_HATA}</em>
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

function CriterionResult({ finding, application, decisions }: {
  finding: CriterionFinding;
  application: CompetitionApplication;
  decisions: JudgeDecision[];
}) {
  const verdict = finalVerdictOf(finding, decisions);
  const page = pageOf(finding);
  const evidence = finding.evidence[0];
  return (
    <li className={`eval-result-row ${verdict}`}>
      <VerdictMark verdict={verdict} />
      <div className="eval-result-body">
        <div className="eval-result-title">
          <strong>{finding.criterionName}</strong>
          <span className="eval-result-meta">{checkStageOf(finding.stage).shortTitle} · {finding.required ? "Zorunlu" : "Diğer"}</span>
        </div>
        {verdict !== "BASARILI" ? <p className="eval-result-reason">{reasonOf(finding, decisions)}</p> : null}
        {evidence ? <q className="eval-result-quote">{evidence.text}</q> : null}
        {verdict !== "BASARILI" && finding.evidenceMissing ? <small className="eval-result-note">Sistem rapordan alıntı gösteremedi; kaynağı PDF&apos;te kendiniz kontrol edin.</small> : null}
      </div>
      <div className="eval-result-actions">
        {verdict !== "BASARILI" || evidence ? (
          <a className="secondary-button eval-source-button" href={fileUrl(application, page)} target="_blank" rel="noreferrer">
            Kaynak Satıra Git{page ? ` · s. ${page}` : ""}
          </a>
        ) : null}
        {evidence ? <small>{evidenceLocation(evidence)}</small> : null}
      </div>
    </li>
  );
}

/** Karar sonrası düzenlenebilir şablon: hakem elle değiştirir, ardından kesinleştirip iletir. */
function DecisionTemplate({ application, evaluation, outcome, decisions, note, saving, error, onOutcome, onDecision, onNote, onFinalize, onCancel }: {
  application: CompetitionApplication;
  evaluation: ReportEvaluation;
  outcome: Outcome;
  decisions: JudgeDecision[];
  note: string;
  saving: boolean;
  error: string;
  onOutcome: (outcome: Outcome) => void;
  onDecision: (criterionId: string, patch: Partial<JudgeDecision>) => void;
  onNote: (note: string) => void;
  onFinalize: () => void;
  onCancel: () => void;
}) {
  const counts = countVerdicts(evaluation.findings, decisions);
  const feedback = buildFeedback(evaluation.findings, decisions);
  const failed = evaluation.findings.filter((finding) =>
    finalVerdictOf(finding, decisions) !== "BASARILI" && !outsidePdf(finding, decisions));
  const passed = evaluation.findings.filter((finding) => finalVerdictOf(finding, decisions) === "BASARILI");

  return (
    <section className={`eval-template outcome-${outcome}`} aria-labelledby="eval-template-title">
      <header className="eval-template-head">
        <div>
          <span className="section-kicker">Yarışmacıya iletilecek şablon</span>
          <h2 id="eval-template-title">Karar: {OUTCOME_LABELS[outcome]}</h2>
          <p>{application.competitionName} · {application.teamName}. Şablon AI&apos;nin kriter analizinden üretildi; göndermeden önce elle değiştirebilirsiniz.</p>
        </div>
        <div className="eval-template-switch" role="group" aria-label="Kararı değiştir">
          <button type="button" className={outcome === "accepted" ? "active" : ""} onClick={() => onOutcome("accepted")}>ONAY</button>
          <button type="button" className={outcome === "rejected" ? "active" : ""} onClick={() => onOutcome("rejected")}>RED</button>
        </div>
      </header>

      <div className="eval-template-summary">
        <span className="BASARILI">✓ {counts.BASARILI} uygun</span>
        <span className="REVIZYON">! {counts.REVIZYON} revizyon</span>
        <span className="KRITIK_HATA">✕ {counts.KRITIK_HATA} kritik hata</span>
      </div>

      <label className="field eval-template-note">
        <span className="field-label">Yarışmacıya sonuç açıklaması</span>
        <textarea maxLength={1000} value={note} onChange={(event) => onNote(event.target.value)} />
      </label>

      <div className="eval-template-section">
        <h3>Gelişime açık yönler · hatalı kriterler <span>{failed.length}</span></h3>
        {failed.length ? (
          <ol className="eval-template-rows">
            {failed.map((finding) => {
              const decision = decisions.find((item) => item.criterionId === finding.criterionId);
              const page = pageOf(finding);
              return (
                <li key={finding.criterionId}>
                  <div className="eval-template-row-head">
                    <strong>{finding.criterionName}</strong>
                    <select
                      value={decision?.finalVerdict ?? finding.verdict}
                      aria-label={`${finding.criterionName} nihai durumu`}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (isRuleVerdict(value)) onDecision(finding.criterionId, { finalVerdict: value, verdict: value === finding.verdict ? "accepted" : "adjusted" });
                      }}
                    >
                      {PDF_RULE_VERDICTS.map((verdict) => <option key={verdict} value={verdict}>{RULE_VERDICT_LABELS[verdict]}{verdict === finding.verdict ? " (AI)" : ""}</option>)}
                    </select>
                  </div>
                  <textarea
                    value={decision?.note ?? ""}
                    placeholder={finding.rationale}
                    aria-label={`${finding.criterionName} hata sebebi`}
                    onChange={(event) => onDecision(finding.criterionId, { note: event.target.value, verdict: "adjusted" })}
                  />
                  <small>
                    Boş bırakılırsa AI gerekçesi iletilir.
                    {page ? <> · <a href={fileUrl(application, page)} target="_blank" rel="noreferrer">Kaynak s. {page}</a></> : null}
                  </small>
                </li>
              );
            })}
          </ol>
        ) : <p className="library-empty">Hatalı kriter yok.</p>}
      </div>

      <div className="eval-template-section">
        <h3>Güçlü yönler · karşılanan kriterler <span>{passed.length}</span></h3>
        {passed.length ? (
          <ul className="eval-template-passed">
            {passed.map((finding) => (
              <li key={finding.criterionId}>
                <span>✓ {finding.criterionName}</span>
                <button type="button" className="text-button" onClick={() => onDecision(finding.criterionId, { finalVerdict: finding.required ? "KRITIK_HATA" : "REVIZYON", verdict: "adjusted" })}>
                  Hatalı işaretle
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="library-empty">Karşılanan kriter yok.</p>}
      </div>

      <details className="eval-template-preview">
        <summary>Yarışmacının göreceği metin önizlemesi</summary>
        <div>
          <p className="eval-template-preview-note">{note}</p>
          {/* Yarışmacının göreceği kart başlıklarıyla birebir aynı. */}
          {(["strengths", "improvements", "suggestions"] as const).map((key) => feedback[key].length ? (
            <section key={key}>
              <strong>{PARTICIPANT_FEEDBACK_LABELS[key]}</strong>
              <ul>{feedback[key].map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
          ) : null)}
        </div>
      </details>

      {error ? <div className="inline-error" role="alert"><strong>Karar kaydedilemedi.</strong><span>{error}</span></div> : null}

      <div className="eval-template-actions">
        <button type="button" className="text-button" disabled={saving} onClick={onCancel}>Vazgeç</button>
        <button type="button" className={`primary-button ${outcome === "rejected" ? "danger" : "success"}`} disabled={saving} onClick={onFinalize}>
          {saving ? "Kaydediliyor…" : outcome === "accepted" ? "ONAYI kesinleştir ve ilet" : "REDDİ kesinleştir ve ilet"}
        </button>
      </div>
    </section>
  );
}

function ApplicationDetail({ application, analyzing, progress, onAnalyze, onFinalize, onArchive }: {
  application: CompetitionApplication;
  analyzing: boolean;
  progress: string;
  onAnalyze: (application: CompetitionApplication, force?: boolean) => void;
  onFinalize: (application: CompetitionApplication, review: JudgeReview) => Promise<boolean>;
  /** Aktif iş listesinden kaldırma (arşivleme); fiziksel silme DEĞİLDİR. */
  onArchive: (application: CompetitionApplication, reason: string) => Promise<void>;
}) {
  const evaluation = usableEvaluation(application);
  const completed = application.status === "completed" && application.review?.status === "completed";
  const [reopened, setReopened] = useState(false);
  const [pendingOutcome, setPendingOutcome] = useState<Outcome | null>(null);
  const [decisions, setDecisions] = useState<JudgeDecision[]>(() => evaluation ? draftDecisions(evaluation, application.review) : []);
  const [note, setNote] = useState(application.review?.outcomeNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);

  const canAnalyze = (ANALYZABLE_STATUSES as readonly string[]).includes(application.status) && !analyzing;
  const canRefresh = !analyzing && (canAnalyze || application.status === "awaiting_judge" || application.status === "judge_in_review");
  const locked = completed && !reopened;
  /*
   * KRİTER TAZELİĞİ (madde 2): kriterler bu analizden sonra yeniden
   * yayımlandıysa sonuç eskimiştir. Sunucu da bu durumda nihai kararı
   * reddeder; ekran nedenini önceden söyler.
   */
  const criteriaOutdated = application.criteriaOutdated && !completed;

  function patchDecision(criterionId: string, patch: Partial<JudgeDecision>) {
    setDecisions((current) => current.map((item) => item.criterionId === criterionId ? { ...item, ...patch } : item));
  }

  function startDecision(outcome: Outcome) {
    if (!evaluation) return;
    setPendingOutcome(outcome);
    setSaveError("");
    setNote((current) => current.trim() ? current : defaultOutcomeNote(outcome, countVerdicts(evaluation.findings, decisions)));
  }

  function switchOutcome(outcome: Outcome) {
    if (!evaluation) return;
    const previousDefault = pendingOutcome ? defaultOutcomeNote(pendingOutcome, countVerdicts(evaluation.findings, decisions)) : "";
    setPendingOutcome(outcome);
    setNote((current) => !current.trim() || current === previousDefault ? defaultOutcomeNote(outcome, countVerdicts(evaluation.findings, decisions)) : current);
  }

  async function finalize() {
    if (!evaluation || !pendingOutcome) return;
    setSaving(true);
    setSaveError("");
    const review: JudgeReview = {
      status: "completed",
      outcome: pendingOutcome,
      outcomeNote: note.trim().slice(0, 1000),
      decisions,
      overallNote: "",
      finalFeedback: buildFeedback(evaluation.findings, decisions),
      feedbackApproved: true,
      completedAt: new Date().toISOString(),
    };
    try {
      const ok = await onFinalize(application, review);
      if (ok) { setPendingOutcome(null); setReopened(false); }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Bilinmeyen hata.");
    } finally {
      setSaving(false);
    }
  }

  const counts = evaluation ? countVerdicts(evaluation.findings, decisions) : null;
  const failed = evaluation
    ? evaluation.findings.filter((finding) => finalVerdictOf(finding, decisions) !== "BASARILI" && !outsidePdf(finding, decisions))
    : [];
  const passed = evaluation ? evaluation.findings.filter((finding) => finalVerdictOf(finding, decisions) === "BASARILI") : [];
  // PDF üzerinden değerlendirilemeyen kurallar AYRI ve açık bir bölümde
  // gösterilir; hata listesine karıştırılmaz (madde 4).
  const outsideFindings = evaluation ? evaluation.findings.filter((finding) => outsidePdf(finding, decisions)) : [];

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
            <p>Yapay zekâ, yayımlı kriterlerin her birini rapor PDF&apos;i ile karşılaştırır; uygun kriteri ✓, hatalı kriteri sebebi ve kaynak sayfasıyla işaretler. Nihai karar sizindir.</p>
          </div>
          {analyzing ? (
            <div className="analysis-progress" role="status" aria-live="polite">
              <span className="progress-spinner" />
              <div><strong>Yapay Zeka Analizi sürüyor</strong><p>{progress}</p></div>
              <div className="progress-line"><span /></div>
            </div>
          ) : (
            <button type="button" className="primary-button eval-analyze-button" disabled={!canAnalyze} onClick={() => onAnalyze(application)}>
              {application.status === "analysis_failed" ? "Yeniden dene" : "Yapay Zeka Analizi"} <span aria-hidden="true">→</span>
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
              <strong>Kriterler güncellendi, yeniden analiz gerekli.</strong>
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

          <div className="eval-result-summary" aria-label="Kriter sonucu özeti">
            <div className="BASARILI"><strong>{counts?.BASARILI}</strong><span>uygun kriter</span></div>
            <div className="REVIZYON"><strong>{counts?.REVIZYON}</strong><span>revizyon</span></div>
            <div className="KRITIK_HATA"><strong>{counts?.KRITIK_HATA}</strong><span>kritik hata</span></div>
            {counts?.DEGERLENDIRILEMEDI
              ? <div className="DEGERLENDIRILEMEDI"><strong>{counts.DEGERLENDIRILEMEDI}</strong><span>PDF dışı kanıt</span></div>
              : null}
            <div><strong>{evaluation.findings.length}</strong><span>toplam kriter</span></div>
            {analyzing ? (
              <span className="eval-analyzing-note" role="status">{progress || "Analiz ediliyor…"}</span>
            ) : !locked ? (
              <button type="button" className="text-button" disabled={!canRefresh} onClick={() => onAnalyze(application, true)}>Analizi yenile</button>
            ) : null}
          </div>

          {pendingOutcome && !locked ? (
            <DecisionTemplate
              application={application}
              evaluation={evaluation}
              outcome={pendingOutcome}
              decisions={decisions}
              note={note}
              saving={saving}
              error={saveError}
              onOutcome={switchOutcome}
              onDecision={patchDecision}
              onNote={setNote}
              onFinalize={finalize}
              onCancel={() => { setPendingOutcome(null); setSaveError(""); }}
            />
          ) : (
            <>
              <div className="eval-result-group">
                <h3>Hatalı kriterler <span>{failed.length}</span></h3>
                {failed.length ? (
                  <ul className="eval-result-list">
                    {failed.map((finding) => <CriterionResult key={finding.criterionId} finding={finding} application={application} decisions={decisions} />)}
                  </ul>
                ) : <p className="eval-result-empty">Hatalı kriter bulunmadı.</p>}
              </div>
              <div className="eval-result-group">
                <h3>Uygun kriterler <span>{passed.length}</span></h3>
                {passed.length ? (
                  <ul className="eval-result-list compact">
                    {passed.map((finding) => <CriterionResult key={finding.criterionId} finding={finding} application={application} decisions={decisions} />)}
                  </ul>
                ) : <p className="eval-result-empty">Uygun kriter bulunmadı.</p>}
              </div>

              {/*
                PDF DIŞI KANIT (madde 4)
                Video, portal yüklemesi, fiziksel teslim veya kurul kararı
                gerektiren kurallar. Yapay zekâ bunlar için OLUMLU ya da
                OLUMSUZ sonuç üretmez; raporda karşılıklarının bulunmaması
                ihlal SAYILMAZ. Kanıtı hakem rapor dışından kontrol eder.
              */}
              {outsideFindings.length ? (
                <div className="eval-result-group eval-outside-group">
                  <h3>PDF üzerinden değerlendirilemeyen kurallar <span>{outsideFindings.length}</span></h3>
                  <p className="eval-outside-note">
                    Bu kuralların kanıtı rapor PDF&apos;inin dışındadır. Yapay zekâ bunları hatalı ya da eksik
                    saymaz; kanıtı (video, portal yüklemesi, fiziksel teslim veya kurul kararı) siz kontrol
                    edip kararı verirsiniz.
                  </p>
                  <ul className="eval-result-list compact">
                    {outsideFindings.map((finding) => (
                      <li key={finding.criterionId} className="eval-result-row DEGERLENDIRILEMEDI">
                        <span className="eval-mark DEGERLENDIRILEMEDI" aria-label={RULE_VERDICT_LABELS.DEGERLENDIRILEMEDI} title={RULE_VERDICT_LABELS.DEGERLENDIRILEMEDI}>?</span>
                        <div className="eval-result-body">
                          <div className="eval-result-title">
                            <strong>{finding.criterionName}</strong>
                            <span className="eval-result-meta">
                              {checkStageOf(finding.stage).shortTitle} · {finding.required ? "Zorunlu" : "Diğer"} · {VERIFIABILITY_LABELS[finding.verifiability]}
                            </span>
                          </div>
                          <p className="eval-result-reason">{finding.rationale}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/*
                ARŞİVLEME (madde 11): fiziksel silme değildir. Kayıt, PDF ve
                değerlendirme geçmişi yerinde kalır; işlem gerekçesiyle birlikte
                denetim izine yazılır ve Değerlendirme Yöneticisi görebilir.
              */}
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

              <div className="eval-decision-bar">
                {locked ? (
                  <>
                    <div>
                      <strong>Karar verildi: {OUTCOME_LABELS[application.outcome]}</strong>
                      <p>{application.review?.completedAt ? `${formatDateTime(application.review.completedAt)} · ` : ""}Şablon yarışmacıya iletildi{application.outcomeNote ? `: “${application.outcomeNote}”` : "."}</p>
                    </div>
                    <button type="button" className="secondary-button" onClick={() => { setReopened(true); setPendingOutcome(application.outcome === "rejected" ? "rejected" : "accepted"); }}>
                      Kararı yeniden aç
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <strong>Nihai karar</strong>
                      <p>ONAY veya RED&apos;e basınca şablon açılır; kriter durumlarını ve hata sebeplerini elle değiştirip kesinleştirebilirsiniz.</p>
                    </div>
                    <div className="eval-decision-buttons">
                      <button type="button" className="primary-button success" onClick={() => startDecision("accepted")}>ONAY</button>
                      <button type="button" className="primary-button danger" onClick={() => startDecision("rejected")}>RED</button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
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
   * Yapay Zekâ Analizi.
   *
   * BÜTÜNLÜK (madde 3): istemci modele kriter ya da PDF GÖNDERMEZ. Sunucuya
   * yalnızca başvuru kimliği gider; kriter seti (son yayımlanan sürüm) ve
   * rapor PDF'i (R2'deki geçerli sürüm) sunucuda çözülür. Buradaki PDF indirme
   * yalnızca kanıt alıntılarının doğrulanması ve benzerlik taraması içindir ve
   * aynı yetkili uçtan (`/api/applications/{id}/file`) gelir.
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
      const extracted = await extractPdfText(file);
      setProgress("Yayımlanmış kriterler rapor ile karşılaştırılıyor…");
      let evaluation = await evaluateReport({
        applicationId: current.id,
        pages: extracted.pages,
        pageCount: extracted.pageCount,
        force,
      });
      setProgress("Aynı yarışma havuzunda benzerlik kontrol ediliyor…");
      try {
        const { check } = await workflowApi.similarityCheck(current.id, extracted.pages.join("\n"));
        evaluation = applySimilarity(evaluation, check);
      } catch (similarityError) {
        evaluation.analysisWarnings.push(similarityError instanceof Error
          ? `Benzerlik kontrolü tamamlanamadı: ${similarityError.message}`
          : "Benzerlik kontrolü tamamlanamadı.");
      }
      setProgress("Sonuç kaydediliyor…");
      const saved = await workflowApi.updateApplication(current.id, "save_evaluation", { evaluation });
      replaceApplication(saved.application);
      setApplicationId(saved.application.id);
    } catch (caught) {
      // Sistem kendiliğinden ikinci bir AI çağrısı yapmaz; başvuru
      // "analiz başarısız" durumuna döner ve hakem düğmeyle yeniden dener.
      setError(`"${application.teamName}" analiz edilemedi: ${caught instanceof Error ? caught.message : "Bilinmeyen hata."} Sorun geçiciyse “Yapay Zeka Analizi” düğmesiyle yeniden deneyebilirsiniz.`);
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
      setNotice(`${application.teamName}: ${OUTCOME_LABELS[review.outcome]} kararı kaydedildi ve şablon yarışmacıya iletildi.`);
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
                <p>{history ? "Tamamlanan kararlar ve yarışmacıya iletilen şablonlar." : "Başvuruya tıklayın; Yapay Zeka Analizi düğmesiyle kriterler PDF ile karşılaştırılır."}</p>
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
                    key={`${selected.id}-${selected.evaluation?.analyzedAt ?? ""}`}
                    application={selected}
                    analyzing={analyzingId === selected.id}
                    progress={progress}
                    onAnalyze={analyze}
                    onFinalize={finalize}
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
