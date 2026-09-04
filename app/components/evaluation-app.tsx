"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ElapsedTime from "./elapsed-time";
import { useLiveRefresh } from "./use-live-refresh";
import { competitionReadOnly, COMPETITION_STATUS_LABELS } from "../lib/workflow-types";
import TopbarSession from "./topbar-session";
import { formatDateTime } from "../lib/admin-client";
import { extractPdfText } from "../lib/pdf-reader";
import { expectedLanguageCode } from "../lib/report-prechecks";
import { evaluateReport, ReportEngineError } from "../lib/report-evaluator";
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
import PdfEvidenceViewer from "./pdf-evidence-viewer";
import {
  AI_CRITERION_VERDICT_LABELS,
  CATEGORY_FIT_LABELS,
  CHECK_STAGES,
  PARTICIPANT_FEEDBACK_LABELS,
  RULE_VERDICT_LABELS,
  aiVerdictOf,
  checkStageOf,
  verifiedOutsidePdf,
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
type BulkSimilaritySummary = Awaited<ReturnType<typeof workflowApi.bulkSimilarity>>;
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

/**
 * Analiz hatasını hakemin ne yapacağını söyleyen bir cümleye çevirir (madde 11).
 *
 * Genel "API bağlantısını kontrol edin" metni hakeme hiçbir şey anlatmıyordu.
 * Artık üç durum ayrılır:
 *   - OCR gerekiyor        → belge taranmış; katılımcıdan metin katmanlı PDF
 *   - Geçici hata (429/503) → aynı düğmeyle yeniden denenebilir
 *   - Kalıcı hata           → sunucunun gerekçesi olduğu gibi gösterilir
 */
/** Benzerlik koşusunun (kriter analizinden bağımsız) istemci durumu. */
type SimilarityRunState = { state: "running" | "partial" | "failed"; message: string };
/** Benzerlik ucunun yanıt tipi; tek kaynak workflow-client'tır. */
type SimilarityCheckResult = Awaited<ReturnType<typeof workflowApi.similarityCheck>>;

function analysisFailureMessage(caught: unknown): string {
  if (caught instanceof ReportEngineError) {
    if (caught.code === "OCR_REQUIRED") {
      return `${caught.message} Katılımcıdan OCR uygulanmış (metni seçilebilen) bir PDF istenmelidir; `
        + "bu belgeden kanıtlı alıntı çıkarılamaz. Kanıtsız bir analiz hakeme sunulmaz.";
    }
    if (caught.engineUnavailable) {
      return `${caught.message} Sunucu ortamında AI anahtarı tanımlanana kadar yalnızca deterministik kontroller çalışır.`;
    }
    if (caught.retryable) {
      return `${caught.message} Bu geçici bir hatadır: birkaç saniye sonra yeniden deneyebilirsiniz.`;
    }
    return caught.message;
  }
  if (caught instanceof WorkflowApiError) {
    if (caught.code === "OCR_REQUIRED") {
      return `${caught.message} Katılımcıdan OCR uygulanmış (metni seçilebilen) bir PDF istenmelidir; `
        + "bu belgeden kanıtlı alıntı çıkarılamaz.";
    }
    if (caught.retryable) {
      return `${caught.message} Bu geçici bir hatadır: birkaç saniye sonra “Analizi yenile” ile yeniden deneyebilirsiniz.`;
    }
    return caught.message;
  }
  if (caught instanceof TypeError) {
    return "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.";
  }
  return caught instanceof Error && caught.message ? caught.message : "Bilinmeyen hata.";
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
            <span>{entry.competition ? `${entry.competition.isActive ? "Aktif" : "Pasif"} · ${COMPETITION_STATUS_LABELS[entry.competition.status]}` : "Yarışma durumu alınamadı"}</span>
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

/**
 * DÖRT AŞAMALI ÖZET (madde 3)
 *
 * Kart yapısı korunur ama her karta yalnızca AÇIK SONUÇ yazılır:
 *
 *   1. Dil ve Şablon      → tek cümlelik dil sonucu (oran/teknik ayrıntı yok)
 *   2. Başlık ve İçerik    → başlık ve içerik kriterleri AYRI sayılır; yalnızca
 *                            içindekiler tablosunda geçen ifade "dolu" sayılmaz
 *   3. Kategori Uygunluğu → yapay yüzde YOK; dört durumdan biri
 *   4. Kriter Bazlı Kanıt → "9 kriter incelendi · 8 uygun · 1 olumsuz";
 *                            profilde teknik kriter yoksa aşama "uygulanmıyor"
 *                            olarak gösterilir (sonuç ikonu/rozeti basılmaz)
 *
 * Benzerlik sonucu bu kartlardan ÇIKARILDI; ayrı bir sistem olarak kriter
 * listesinin altında kendi kartında durur (bkz. SimilarityCard).
 */
function StageStrip({ stages, findings, outsidePdfCount = 0 }: {
  stages: StageResult[];
  findings: CriterionFinding[];
  /** PDF dışı kanıt gerektirdiği için rapor analizine girmeyen kriter sayısı. */
  outsidePdfCount?: number;
}) {
  return (
    // Bu şerit AI ÖN DEĞERLENDİRMESİDİR; hakemin kesinleşen sayaçları ayrıdır.
    <div className="eval-stage-strip" aria-label="AI ön değerlendirme özeti — dört aşamalı kontrol">
      {CHECK_STAGES.map((definition) => {
        const stage = stages.find((item) => item.stage === definition.id);
        /**
         * 4. aşama yalnızca teknik (criteria_evidence) kriteri olan profillerde
         * uygulanır. Üç aşamalı eski çıkarımla üretilmiş profilde bu aşamada
         * hiç bulgu yoktur; karta sonuç yerine "uygulanmıyor" yazılır. Eski
         * teknik kriterli profiller mevcut görünümü korur.
         */
        const notApplicable = definition.id === "criteria_evidence"
          && !findings.some((finding) => finding.stage === "criteria_evidence");
        /** Aşamaya özgü, tek bakışta okunan ölçüm satırları. */
        const rows: Array<{ label: string; value: string; tone?: "ok" | "warn" | "bad" }> = [];

        if (stage && definition.id === "language_template") {
          // "Turkish" ile "Türkçe" aynı dildir: ham metin değil dil KODU karşılaştırılır.
          const detectedCode = expectedLanguageCode(stage.detectedLanguage);
          const expectedCode = expectedLanguageCode(stage.expectedLanguage ?? null);
          const matches = !expectedCode || !detectedCode ? null : detectedCode === expectedCode;
          rows.push({
            label: "Rapor dili",
            // Cümle sunucuda kurulur (languageSentence); ekran onu olduğu gibi basar.
            value: stage.summary || "Rapor dili güvenilir biçimde belirlenemedi.",
            tone: !detectedCode ? "warn" : matches === null ? undefined : matches ? "ok" : "bad",
          });
        }

        if (stage && definition.id === "headings_content") {
          const checks = stage.headings ?? [];
          const headings = checks.filter((item) => (item.controlType ?? "BIREBIR_BASLIK") === "BIREBIR_BASLIK");
          const contents = checks.filter((item) => (item.controlType ?? "BIREBIR_BASLIK") !== "BIREBIR_BASLIK");
          const filled = (list: typeof checks) => list.filter((item) => item.present && item.contentFilled).length;
          if (headings.length) {
            rows.push({
              label: "Zorunlu başlıklar",
              value: `${filled(headings)}/${headings.length} başlık yerinde ve dolu`,
              tone: filled(headings) === headings.length ? "ok" : "bad",
            });
          }
          if (contents.length) {
            rows.push({
              label: "Beklenen içerik",
              value: `${filled(contents)}/${contents.length} içerik bulundu`,
              tone: filled(contents) === contents.length ? "ok" : "warn",
            });
          }
          if (!headings.length && !contents.length) {
            rows.push({ label: "Durum", value: "Profilde başlık veya içerik kriteri tanımlı değil." });
          }
          // İçindekiler satırı boş bölümü DOLU göstermez; hakeme ayrıca söylenir.
          const decorative = checks.filter((item) => item.tableOfContentsOnly);
          if (decorative.length) {
            rows.push({
              label: "Yalnızca içindekilerde",
              value: decorative.slice(0, 2).map((item) => item.heading).join(", ")
                + (decorative.length > 2 ? ` +${decorative.length - 2}` : ""),
              tone: "bad",
            });
          }
        }

        if (stage && definition.id === "category_similarity") {
          // Yapay kesinlik göstergesi (ör. "%100") KALDIRILDI: dört durumdan biri.
          const fit = stage.categoryFit ?? "KANIT_YOK";
          rows.push({
            label: "Kategori uygunluğu",
            value: CATEGORY_FIT_LABELS[fit],
            tone: fit === "UYUMLU" ? "ok" : fit === "KISMEN_UYUMLU" ? "warn" : fit === "UYUMSUZ" ? "bad" : undefined,
          });
          // Benzerlik ARTIK bu şeritte gösterilmez (GÖREV 3 · madde 7): dört
          // kriter aşamasının parçası değildir; bağımsız "Raporlar arası
          // benzerlik" kartında sunulur ve sayaçlara/karara katılmaz.
        }

        if (definition.id === "criteria_evidence" && notApplicable) {
          /*
           * "Bulgu gelmedi" ile "profilde teknik kriter yok" AYNI ŞEY DEĞİLDİR
           * (madde 7). Elimizdeki veri bunu kesin ayırmaya yetmiyorsa kart
           * kesin bir iddia kurmaz; PDF dışı kriter varsa bunu sayıyla söyler.
           */
          rows.push({
            label: "Durum",
            value: outsidePdfCount > 0
              ? `Bu analizde PDF'den değerlendirilebilen teknik kriter bulgusu yok; ${outsidePdfCount} kriter PDF dışı kanıt gerektirdiği için rapor analizine girmedi.`
              : "Bu analizde teknik kriter bulgusu yok; profilde PDF'den değerlendirilebilen teknik kriter tanımlı olmayabilir.",
          });
        } else if (stage && definition.id === "criteria_evidence") {
          rows.push({ label: "Kriter bulguları", value: stage.summary || "Aşağıdaki listede", tone: undefined });
        }

        // Uygulanmayan aşama sonuç rengi/ikonu/rozeti taşımaz ("none").
        const verdict = notApplicable ? null : stage?.verdict ?? null;
        return (
          <div key={definition.id} className={`eval-stage-chip ${verdict ?? "none"}`} title={stage?.summary || definition.detail}>
            <div className="eval-stage-head">
              <StageIcon verdict={verdict} />
              <div>
                <span className="eval-stage-order">{definition.order}. aşama</span>
                <strong>{definition.title}</strong>
              </div>
              {verdict ? <VerdictBadge verdict={verdict} /> : null}
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
function CriterionDecisionCard({ finding, decision, specSourcePage, reportPages, locked, rejectDraft, rejectError, rejectFieldErrors, onApprove, onOpenReject, onRejectDraft, onConfirmReject, onCancelReject, onReset, onShowEvidence }: {
  finding: CriterionFinding;
  decision: JudgeCriterionDecision;
  /** Kriterin ŞARTNAMEDEKİ sabit kaynak sayfası (varsa); "Raporda bulunamadı" kararında gösterilir. */
  specSourcePage: number | null;
  /** Katılımcı PDF'inin sayfa sayısı; sayfa girişi bu aralıkta olmalıdır. */
  reportPages: number;
  locked: boolean;
  rejectDraft: RejectDraft | null;
  rejectError: string;
  /** Alan bazlı hata mesajları; anahtar = alan adı (madde 5). */
  rejectFieldErrors: Record<string, string>;
  onApprove: () => void;
  onOpenReject: () => void;
  onRejectDraft: (patch: Partial<RejectDraft>) => void;
  onConfirmReject: () => void;
  /** Yalnızca formu kapatır; VERİLMİŞ kararı DEĞİŞTİRMEZ. */
  onCancelReject: () => void;
  onReset: () => void;
  /** Kanıtı uygulama içi PDF panelinde açar (madde 6). */
  onShowEvidence: (evidence: { page: number | null; quote: string; label: string }) => void;
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
          {/*
            KANITI PDF'DE GÖSTER (madde 6): uygulama içi panelde doğru sayfa
            açılır ve alıntı vurgulanır. Tarayıcı PDF görüntüleyicisinin
            desteklemediği `#page=` adres parçasına güvenilmez.
          */}
          <button
            type="button"
            className="secondary-button eval-source-button"
            disabled={!page && !evidence?.text}
            title={page || evidence?.text
              ? "Kanıtı uygulama içindeki PDF panelinde aç"
              : "Bu bulgu için sayfa veya alıntı yok; kaynak gösterilemez"}
            onClick={() => onShowEvidence({
              page,
              quote: evidence?.text ?? "",
              label: finding.criterionName,
            })}
          >
            Kanıtı PDF&apos;de göster{page ? ` · s. ${page}` : ""}
          </button>
          {evidence ? <small>{evidenceLocation(evidence)}</small> : null}
          {!page && !evidence?.text ? <small>Kanıt konumu yok; raporu kendiniz kontrol edin.</small> : null}
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
              Dayanak: PDF konumu ·{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => onShowEvidence({
                  page: decision.evidencePage,
                  quote: decision.evidenceQuote,
                  label: `${decision.criterionName} · hakem dayanağı`,
                })}
              >
                rapor s. {decision.evidencePage} — kanıtı PDF&apos;de göster
              </button>
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
                <strong>Hakem değerlendirmesi</strong> — bu kriter
                (<strong>{finding.criterionName}</strong>) için kesin sonuç artık AI bulgusu değil,
                buraya yazdığınız değerlendirme olacaktır. Alanlar AI bulgusundan önceden
                dolduruldu: yalnızca açıklamayı, yalnızca sonucu ya da ikisini birlikte
                değiştirebilirsiniz. Açıklamanız yalnızca bu kriterin kapsamıyla ilgili olmalıdır.
                AI&apos;nin özgün analizi silinmez; denetim kaydında ayrı tutulur.
              </p>
              {/*
                İKİ AYRI SORU (madde 5): "Kriter sonucu" ile "Dayanak" tek soru
                gibi dört seçenek olarak gösterilmez. Seçenekler kompakt ve yan
                yanadır; gerçek radio semantiği (klavye, odak, ekran okuyucu)
                korunur, yalnızca görünüm sadeleştirilir.
              */}
              <fieldset className="eval-choice-group" aria-describedby={rejectFieldErrors.judgeResult ? `judge-result-error-${finding.criterionId}` : undefined}>
                <legend className="field-label">Kriter sonucu</legend>
                <div className="eval-choice-options">
                  <label className={rejectDraft!.judgeResult === "UYGUN" ? "selected" : ""}>
                    <input
                      type="radio"
                      name={`judge-result-${finding.criterionId}`}
                      checked={rejectDraft!.judgeResult === "UYGUN"}
                      onChange={() => onRejectDraft({ judgeResult: "UYGUN" })}
                    />
                    <span>Uygun</span>
                  </label>
                  <label className={rejectDraft!.judgeResult === "OLUMSUZ" ? "selected" : ""}>
                    <input
                      type="radio"
                      name={`judge-result-${finding.criterionId}`}
                      checked={rejectDraft!.judgeResult === "OLUMSUZ"}
                      onChange={() => onRejectDraft({ judgeResult: "OLUMSUZ" })}
                    />
                    <span>Olumsuz</span>
                  </label>
                </div>
                <small>Kriterin kesinleşecek sonucu; başvurunun onay/ret kararı değildir.</small>
                {rejectFieldErrors.judgeResult ? (
                  <p className="field-error" id={`judge-result-error-${finding.criterionId}`} role="alert">{rejectFieldErrors.judgeResult}</p>
                ) : null}
              </fieldset>
              <fieldset className="eval-choice-group">
                <legend className="field-label">Dayanak</legend>
                <div className="eval-choice-options">
                  <label className={rejectDraft!.evidenceMode === "PDF_KONUMU" ? "selected" : ""}>
                    <input
                      type="radio"
                      name={`evidence-mode-${finding.criterionId}`}
                      checked={rejectDraft!.evidenceMode === "PDF_KONUMU"}
                      onChange={() => onRejectDraft({ evidenceMode: "PDF_KONUMU" })}
                    />
                    <span>PDF&apos;de bulunan bilgi</span>
                  </label>
                  <label className={rejectDraft!.evidenceMode === "RAPORDA_BULUNAMADI" ? "selected" : ""}>
                    <input
                      type="radio"
                      name={`evidence-mode-${finding.criterionId}`}
                      checked={rejectDraft!.evidenceMode === "RAPORDA_BULUNAMADI"}
                      onChange={() => onRejectDraft({ evidenceMode: "RAPORDA_BULUNAMADI" })}
                    />
                    <span>Raporda bulunmayan içerik</span>
                  </label>
                </div>
                <small>
                  {rejectDraft!.evidenceMode === "PDF_KONUMU"
                    ? "Sayfa, bölüm ve doğrudan alıntı istenir."
                    : "Sahte sayfa veya alıntı istenmez; yalnızca aranan içeriği yazın."}
                </small>
              </fieldset>
              {rejectDraft!.evidenceMode === "PDF_KONUMU" ? (
                <div className="eval-reject-grid">
                  <label className="field eval-reject-page">
                    <span className="field-label">Katılımcı PDF sayfası</span>
                    <input
                      type="number"
                      min={1}
                      max={reportPages > 0 ? reportPages : undefined}
                      step={1}
                      value={rejectDraft!.page}
                      placeholder="Örn. 6"
                      aria-invalid={rejectFieldErrors.page ? true : undefined}
                      aria-describedby={rejectFieldErrors.page ? `page-error-${finding.criterionId}` : undefined}
                      onChange={(event) => onRejectDraft({ page: event.target.value })}
                    />
                    {rejectFieldErrors.page ? (
                      <span className="field-error" id={`page-error-${finding.criterionId}`} role="alert">{rejectFieldErrors.page}</span>
                    ) : reportPages > 0 ? <span className="field-hint">Rapor {reportPages} sayfa.</span> : null}
                  </label>
                  <label className="field eval-reject-section">
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
                      aria-invalid={rejectFieldErrors.quote ? true : undefined}
                      aria-describedby={rejectFieldErrors.quote ? `quote-error-${finding.criterionId}` : undefined}
                      onChange={(event) => onRejectDraft({ quote: event.target.value })}
                    />
                    {rejectFieldErrors.quote ? (
                      <span className="field-error" id={`quote-error-${finding.criterionId}`} role="alert">{rejectFieldErrors.quote}</span>
                    ) : null}
                  </label>
                </div>
              ) : (
                <div className="eval-reject-grid">
                  <label className="field eval-reject-quote">
                    <span className="field-label">Raporda aranan bölüm / içerik</span>
                    <input
                      value={rejectDraft!.missingContent}
                      maxLength={400}
                      placeholder="Örn. Yapısal analiz sonuçları bölümü"
                      aria-invalid={rejectFieldErrors.missingContent ? true : undefined}
                      aria-describedby={rejectFieldErrors.missingContent ? `missing-error-${finding.criterionId}` : undefined}
                      onChange={(event) => onRejectDraft({ missingContent: event.target.value })}
                    />
                    {rejectFieldErrors.missingContent ? (
                      <span className="field-error" id={`missing-error-${finding.criterionId}`} role="alert">{rejectFieldErrors.missingContent}</span>
                    ) : null}
                  </label>
                  <p className="eval-reject-note">
                    Olmayan içerik için katılımcı PDF sayfası ve alıntı İSTENMEZ.
                    {specSourcePage ? <> İlgili şartname kriterinin kaynağı: s. {specSourcePage}.</> : null}
                  </p>
                </div>
              )}
              <label className="field eval-reject-reason">
                <span className="field-label">Hakem gerekçesi ve açıklaması</span>
                <textarea
                  value={rejectDraft!.reason}
                  maxLength={2000}
                  placeholder="Örn. Şartnamede izin verilen azami boyut 100 cm'dir; rapor 104 cm bildiriyor."
                  aria-invalid={rejectFieldErrors.reason ? true : undefined}
                  aria-describedby={rejectFieldErrors.reason ? `reason-error-${finding.criterionId}` : undefined}
                  onChange={(event) => onRejectDraft({ reason: event.target.value })}
                />
                {rejectFieldErrors.reason ? (
                  <span className="field-error" id={`reason-error-${finding.criterionId}`} role="alert">{rejectFieldErrors.reason}</span>
                ) : null}
              </label>
              {rejectError ? <p className="approval-error" role="alert">{rejectError}</p> : null}
              <div className="eval-reject-actions">
                {/* Vazgeç yalnızca formu kapatır; önceden verilmiş karar korunur. */}
                <button type="button" className="text-button" onClick={onCancelReject}>Vazgeç</button>
                <button type="button" className="primary-button" onClick={onConfirmReject}>Hakem değerlendirmesini kaydet</button>
              </div>
            </div>
          ) : (
            <>
              {/*
                İKİ ANLAŞILIR İŞLEM (madde 4). Buton adları artık "Onayla/Ret"
                değil: "Onayla" hakemlerce başvuru onayı, "Ret" ise başvuru
                reddi sanılıyordu. Bu düğmeler YALNIZCA AI bulgusunun kabulünü
                belirler; nihai başvuru kararı aşağıdaki ayrı bölümdedir.
              */}
              <button
                type="button"
                className={`secondary-button eval-approve-button ${decision.judgeVerdict === "approved" ? "active" : ""}`}
                title={`AI bulgusunu olduğu gibi kabul et: kriterin kesin sonucu ${AI_CRITERION_VERDICT_LABELS[ai]} olur`}
                onClick={onApprove}
              >
                ✓ AI bulgusunu aynen kullan
              </button>
              <button
                type="button"
                className={`secondary-button eval-reject-button ${decision.judgeVerdict === "rejected" ? "active" : ""}`}
                title="Kendi değerlendirmeni gir: sonucu, kaynağı ve açıklamayı sen belirle (başvuruyu reddetmez)"
                onClick={onOpenReject}
              >
                ✎ Hakem değerlendirmesi gir
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
 * Bağımsız "Raporlar arası benzerlik" kartı (GÖREV 3 · madde 7): bütün kriter
 * analizlerinin ALTINDA, dört aşamadan AYRI bir bölümdür. Sayaçlara katılmaz,
 * genel kararı değiştirmez, otomatik intihal veya ret kararı vermez.
 *
 * Bütün sayılar YAPILANDIRILMIŞ alanlardan okunur (madde 6): gösterim
 * cümlesinden asla yüzde geri ayrıştırılmaz ("%98'li takım adı" oranı bozamaz).
 * Eski kayıtlarda bulunmayan alanların satırları gizlenir (geriye uyum).
 */
/**
 * Sonuç durumu tek cümleyle ve DOĞRU biçimde adlandırılır (madde 3):
 * karşılaştırılamayan, kısmi ya da anlamsal katmanı düşmüş bir koşu "Normal"
 * denmez. "ŞÜPHELİ" gibi suçlayıcı ifade yerine "İnceleme önerilir" kullanılır;
 * karar her durumda hakemindir.
 */
function similarityStatusLabel(report: SimilarityReport): string {
  if (report.noComparableContent) return "karşılaştırılabilir özgün içerik bulunamadı";
  if (report.level === "none" || report.comparedCount === 0) return "karşılaştırılabilecek başka rapor yok";
  if (report.level === "review" || report.level === "high") return "inceleme önerilir";
  if (report.poolTruncated) return "kısmen tamamlandı · belirgin eşleşme yok";
  if (report.method === "minhash-only") return "yalnız doğrudan metin karşılaştırması · belirgin eşleşme yok";
  return "tamamlandı · belirgin eşleşme yok";
}

function SimilarityCard({ report, application }: { report: SimilarityReport; application: CompetitionApplication }) {
  const flagged = report.level === "review" || report.level === "high";
  const stale = application.similarityStale || report.stale;
  const hasSplit = typeof report.directMatchCount === "number" || typeof report.semanticMatchCount === "number";
  return (
    <section className={`eval-similarity-note level-${report.level}`} aria-label="Raporlar arası benzerlik">
      {/*
        Şüpheli/Normal işareti DÖRT AŞAMA KARTLARINDAN buraya taşındı
        (madde 3): benzerlik ayrı bir sistemdir, aşama sonuçlarına ve kriter
        sayaçlarına karışmaz ve hiçbir kararı otomatik değiştirmez.
      */}
      <h3 className="eval-similarity-title">Raporlar arası benzerlik — {similarityStatusLabel(report)}</h3>
      {stale ? (
        <p className="eval-similarity-stale">
          Bu sonuç güncel değil: {application.similarityStaleReason || report.staleReason || "havuza yeni rapor geldi."}{" "}
          “Analizi Yenile” ile güncelleyebilirsiniz.
        </p>
      ) : null}
      <p>{report.note}</p>
      {report.level !== "none" ? (
        <dl className="eval-similarity-facts">
          <div>
            <dt>Matematiksel olarak karşılaştırılan rapor</dt>
            <dd>{report.comparedCount}{report.poolTruncated ? " (havuz üst sınırı uygulandı; tarama tamamlanmadı)" : ""}</dd>
          </div>
          {/*
            Tarama, kanıt seçimi ve AI açıklaması AYRI sayılardır (madde 3):
            tek bir "incelendi" sayısında birleştirilmez. AI açıklaması yalnızca
            seçilen eşleşme kanıtları için, en yakın TEK rapor üzerinden üretilir.
          */}
          <div>
            <dt>AI açıklaması için seçilen kanıt</dt>
            <dd>
              {report.matches.length
                ? `${Math.min(3, report.matches.length)} eşleşme · 1 rapor`
                : "0 eşleşme · AI açıklaması istenmedi"}
              {report.llmStatus === "failed" ? " · açıklama üretilemedi" : ""}
              {report.llmStatus === "skipped" ? " · açıklama kapalı/uygun değil" : ""}
            </dd>
          </div>
          {typeof report.comparableWords === "number" ? (
            <div><dt>Karşılaştırılabilir özgün içerik</dt><dd>{report.comparableWords} kelime</dd></div>
          ) : null}
          <div><dt>Yaklaşık oran</dt><dd>{report.approxPercent === null ? "—" : `%${report.approxPercent}`}</dd></div>
          {report.closestLabel ? <div><dt>En yakın rapor</dt><dd>{report.closestLabel}</dd></div> : null}
          {hasSplit ? (
            <div>
              <dt>Eşleşme ayrımı</dt>
              <dd>{report.directMatchCount ?? 0} doğrudan (MinHash) · {report.semanticMatchCount ?? 0} anlamsal</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
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
                {match.llmClassLabel ? (
                  // Katman 3 açıklaması: sayfa/alıntı deterministik veridir;
                  // model yalnızca sınıf + açıklama verir (madde 5).
                  <p className="eval-similarity-llm">
                    <strong>{match.llmClassLabel}</strong>
                    {match.llmExplanation ? ` — ${match.llmExplanation}` : ""}
                    {match.llmAssessment ? ` · ${match.llmAssessment}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {report.llmStatus === "failed" ? (
        <p className="eval-similarity-llmfail">Açıklama kontrolü tamamlanamadı; MinHash ve anlamsal sonuç geçerlidir.</p>
      ) : null}
      {/* Madde 7: uyarı her durumda AYRI bir öğe olarak gösterilir. */}
      <p className="eval-similarity-disclaimer">Bu sonuç intihal veya otomatik ret kararı değildir.</p>
    </section>
  );
}

/**
 * Geriye uyum: `similarityReport` alanı olmayan ESKİ değerlendirme kayıtları
 * 3. aşama şeridinden kaldırılan benzerlik satırı yerine bu sade kartla
 * gösterilir; yapılandırılmış `stage.similarity` alanından okunur (regex yok).
 */
function LegacySimilarityCard({ similarity }: { similarity: NonNullable<StageResult["similarity"]> }) {
  return (
    <section className="eval-similarity-note level-normal" aria-label="Raporlar arası benzerlik">
      <h3 className="eval-similarity-title">Raporlar arası benzerlik</h3>
      <p>
        {similarity.status === "skipped"
          ? "Karşılaştırılabilecek başka güncel rapor henüz bulunmuyor."
          : `Önceki analizde ${similarity.percent === null || similarity.percent === undefined ? "benzerlik oranı hesaplanmadı" : `yaklaşık %${similarity.percent} benzerlik bulundu`}${similarity.closestTeam ? ` (en yakın: ${similarity.closestTeam})` : ""}. Ayrıntı için analizi yenileyin.`}
      </p>
      <p className="eval-similarity-disclaimer">Bu sonuç intihal veya otomatik ret kararı değildir.</p>
    </section>
  );
}

function ApplicationDetail({ application, profile, competition, analyzing, otherAnalysisRunning, progress, similarityRun, onAnalyze, onRetrySimilarity, onReviewSaved, onFinalize, onReopen, onDeleteAnalysis, onArchive }: {
  application: CompetitionApplication;
  competition: CompetitionWorkflow | null;
  /** Yarışmanın yayımlı profili; kriterlerin şartname kaynak sayfası buradan okunur. */
  profile: CompetitionProfile | null;
  analyzing: boolean;
  /**
   * BAŞKA bir başvurunun analizi sürüyor. Düğme bu durumda da devre dışı
   * kalmalıdır: eskiden etkin görünüyor, tıklanınca ise `analyze()` sessizce
   * geri dönüyordu ve hakem hiçbir tepki görmüyordu (madde 11).
   */
  otherAnalysisRunning: boolean;
  progress: string;
  /** Benzerlik koşusu kriter analizinden bağımsız ilerler; null iken sonuç yerindedir. */
  similarityRun: SimilarityRunState | null;
  onAnalyze: (application: CompetitionApplication, force?: boolean) => void;
  /** Yalnızca benzerliği yeniden çalıştırır; kriter analizine dokunmaz. */
  onRetrySimilarity: (application: CompetitionApplication) => Promise<void>;
  /** Taslak kaydından dönen güncel başvuru; listeyi tazeler, gezinme YAPMAZ. */
  onReviewSaved: (application: CompetitionApplication) => void;
  onFinalize: (application: CompetitionApplication, review: JudgeReview) => Promise<boolean>;
  /** Kesinleşmiş kararı sunucuda yeniden açar. */
  onReopen: (application: CompetitionApplication) => Promise<void>;
  /** AI analizini ve tamamlanmamış kriter kararlarını sunucudan siler. */
  onDeleteAnalysis: (application: CompetitionApplication) => Promise<void>;
  /** Aktif iş listesinden kaldırma (arşivleme); fiziksel silme DEĞİLDİR. */
  onArchive: (application: CompetitionApplication, reason: string) => Promise<void>;
}) {
  const evaluation = usableEvaluation(application);
  /** Katılımcı PDF'inin sayfa sayısı; hakem sayfa girişi bu aralıkla denetlenir. */
  const reportPages = evaluation?.report.pages ?? 0;
  // PDF dışı kurallar hakem ekranına HİÇ gelmez (madde 2).
  const findings = useMemo(() => evaluation ? visibleFindingsOf(evaluation) : [], [evaluation]);
  const completed = application.status === "completed" && application.review?.status === "completed";
  /**
   * Taslak kapsamı (madde 6): kaydedilmiş TASLAK kararlar yalnızca üretildikleri
   * analize aittir. Yeni analizden sonra eski taslak OTOMATİK uygulanmaz;
   * kayıt silinmez, yalnızca geri yüklenmez. Kesinleşmiş karar (completed)
   * her zaman geri yüklenir: o artık taslak değil, kaydın kendisidir.
   */
  const storedReview = application.review ?? null;
  const draftMatchesAnalysis = storedReview?.status === "completed"
    || !storedReview?.draftScope
    || (storedReview.draftScope.analyzedAt === (evaluation?.analyzedAt ?? "")
      && storedReview.draftScope.pdfHash === (evaluation?.report.pdfHash ?? null)
      && storedReview.draftScope.criteriaVersion === (application.evaluationCriteriaVersion ?? null));
  const [decisions, setDecisions] = useState<JudgeCriterionDecision[]>(
    () => restoreCriterionDecisions(findings, draftMatchesAnalysis ? storedReview?.criterionDecisions : []),
  );
  /** Sunucuya yazılmış son taslağın damgası; iki sekme çakışmasında kullanılır. */
  const draftStamp = useRef<string | null>(storedReview?.draftSavedAt ?? null);
  const draftQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const latestDecisions = useRef(decisions);
  const [draftState, setDraftState] = useState<{ state: "idle" | "saving" | "saved" | "error"; message: string }>(
    { state: "idle", message: "" },
  );
  const [rejectDraft, setRejectDraft] = useState<RejectDraft | null>(null);
  const [rejectError, setRejectError] = useState("");
  /** Alan bazlı hata mesajları (madde 5); anahtar = alan adı. */
  const [rejectFieldErrors, setRejectFieldErrors] = useState<Record<string, string>>({});
  const [pendingOutcome, setPendingOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState(application.review?.outcomeNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Uygulama içi PDF kanıt paneli (madde 6); null iken kapalıdır. */
  const [evidenceView, setEvidenceView] = useState<{ page: number | null; quote: string; label: string } | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Analiz tek seferde bir başvuru için yürür; düğme GERÇEK durumu yansıtır.
  const readOnly = competitionReadOnly(competition);
  const analysisBusy = analyzing || otherAnalysisRunning || readOnly;
  const canAnalyze = (ANALYZABLE_STATUSES as readonly string[]).includes(application.status) && !analysisBusy;
  const canRefresh = !analysisBusy
    && ((ANALYZABLE_STATUSES as readonly string[]).includes(application.status)
      || application.status === "awaiting_judge"
      || application.status === "judge_in_review");
  const locked = completed || readOnly;
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
  /*
   * KRİTER KAPSAMI (madde 2)
   *
   * Dört sayı birbirinden AYRI gösterilir: yayımlanmış toplam kriter, katılımcı
   * PDF'i üzerinden değerlendirilen kriter, PDF dışında kalan kriter ve hakem
   * kararı bekleyen kriter. Sayılar analizle birlikte kaydedilen kapsamdan
   * okunur; kayıt eski olup kapsamı taşımıyorsa yayımlı profilden hesaplanır,
   * o da yoksa yalnızca değerlendirilen kriter sayısı gösterilir.
   */
  const scope = useMemo(() => {
    if (evaluation?.criteriaScope) return evaluation.criteriaScope;
    const active = (profile?.profile.criteria ?? []).filter((item) => item.active);
    if (!active.length) return null;
    const outside = active.filter((item) => verifiedOutsidePdf(item.verifiability));
    return {
      published: active.length,
      pdfEvaluable: active.length - outside.length,
      outsidePdf: outside.length,
      outsideNames: outside.map((item) => item.name),
    };
  }, [evaluation, profile]);
  // PDF'den değerlendirilebilen kriter hiç yoksa (hepsi PDF dışı) genel karar
  // yine verilebilir; kilitli kalmaz. Bekleyen karar varsa bölüm açılmaz.
  const allDecided = counts.pending === 0;

  /**
   * TASLAK KAYDI (madde 6).
   *
   * Kriter kararları eskiden yalnızca React durumunda duruyordu ve sunucuya
   * ancak NİHAİ işlemde yazılıyordu: geri dönmek, başvuru değiştirmek veya
   * sayfayı yenilemek çalışmayı sessizce siliyordu. Artık her karar sunucuya
   * `in_progress` TASLAK olarak yazılır:
   *   - nihai karar ÜRETMEZ (outcome "pending", katılımcıya bildirim gitmez),
   *   - "Kaydedildi" yalnızca sunucu onayladıktan sonra yazılır,
   *   - başarısızlıkta form kapanmaz ve hata görünür,
   *   - başka sekmede yapılan düzenleme sunucudaki damgayla korunur.
   */
  async function persistDraft(next: JudgeCriterionDecision[]): Promise<boolean> {
    if (!evaluation || completed) return true;
    setDraftState({ state: "saving", message: "" });
    const draft: JudgeReview = {
      status: "in_progress",
      outcome: "pending",
      outcomeNote: "",
      decisions: [],
      criterionDecisions: next,
      overallNote: "",
      finalFeedback: buildJudgeFeedback(findings, next),
      feedbackApproved: false,
      completedAt: null,
      draftScope: {
        analyzedAt: evaluation.analyzedAt,
        pdfHash: evaluation.report.pdfHash ?? null,
        criteriaVersion: application.evaluationCriteriaVersion ?? null,
      },
      draftSavedAt: draftStamp.current,
    };
    try {
      const saved = await workflowApi.updateApplication(application.id, "save_review", { review: draft });
      draftStamp.current = saved.application.review?.draftSavedAt ?? null;
      setDraftState({ state: "saved", message: "" });
      onReviewSaved(saved.application);
      return true;
    } catch (caught) {
      setDraftState({
        state: "error",
        message: caught instanceof Error ? caught.message : "Kriter kararı kaydedilemedi.",
      });
      return false;
    }
  }

  /**
   * Kararı önce ekranda uygular, sonra sunucuya yazar. Yazma başarısızsa karar
   * ekranda KALIR (hakemin yazdığı kaybolmaz) ama "kaydedilmedi" uyarısı görünür.
   */
  async function patchDecision(criterionId: string, patch: Partial<JudgeCriterionDecision>): Promise<boolean> {
    const next = latestDecisions.current.map((item) => item.criterionId === criterionId ? { ...item, ...patch } : item);
    latestDecisions.current = next;
    setDecisions(next);
    setPendingOutcome(null);
    setSaveError("");
    // Aynı ekrandaki hızlı tıklamalar tek sırada ve son sunucu damgasıyla yazılır.
    const queued = draftQueue.current.then(() => persistDraft(next));
    draftQueue.current = queued;
    return queued;
  }

  function approve(criterionId: string) {
    /*
     * Onayla = AI BULGUSU doğru kabul edildi. AI UYGUN dediyse kesin sonuç
     * uygun, OLUMSUZ dediyse kesin sonuç olumsuz olur; AI'nin kaynağı ve
     * gerekçesi korunur, hakemin ek açıklama yazması zorunlu değildir.
     */
    void patchDecision(criterionId, {
      judgeVerdict: "approved", judgeResult: null, rejectionReason: "", evidenceMode: null,
      evidencePage: null, evidenceSection: "", evidenceQuote: "", missingContent: "",
    });
    setRejectDraft(null);
    setRejectError("");
    setRejectFieldErrors({});
  }

  /**
   * Hakem değerlendirmesi formunu açar (madde 4).
   *
   * Form AI VERİLERİYLE ÖNCEDEN DOLDURULUR: sonuç, sayfa, bölüm, alıntı ve
   * gerekçe AI bulgusundan gelir. Böylece hakem "yalnızca açıklamayı değiştir"
   * ya da "yalnızca sonucu değiştir" diyebilir; her alanı elle yeniden yazmak
   * zorunda kalmaz. Kararın kendisi HÂLÂ bekliyordur: kayıt yapılana kadar
   * hiçbir kriter kesinleşmez ve AI'nin özgün analizi değişmez.
   *
   * Daha önce verilmiş bir hakem değerlendirmesi varsa onun değerleri esastır.
   */
  function openReject(finding: CriterionFinding) {
    const decision = decisions.find((item) => item.criterionId === finding.criterionId);
    const previous = decision?.judgeVerdict === "rejected" ? decision : null;
    const aiEvidence = finding.evidence[0];
    setRejectDraft({
      criterionId: finding.criterionId,
      judgeResult: previous?.judgeResult ?? aiVerdictOf(finding.verdict),
      evidenceMode: previous?.evidenceMode
        // AI hiç kanıt gösteremediyse dayanak türü "raporda bulunamadı" başlar.
        ?? (finding.evidenceMissing ? "RAPORDA_BULUNAMADI" : "PDF_KONUMU"),
      reason: previous?.rejectionReason || finding.rationale || "",
      page: previous?.evidencePage ? String(previous.evidencePage) : String(pageOf(finding) ?? ""),
      section: previous?.evidenceSection || aiEvidence?.section || "",
      quote: previous?.evidenceQuote || aiEvidence?.text || "",
      missingContent: previous?.missingContent ?? "",
    });
    setRejectError("");
    setRejectFieldErrors({});
  }

  /**
   * ALAN BAZLI DENETİM (madde 5): hata ilgili alanın yanında gösterilir, ilk
   * hatalı alana odaklanılır. Sayfa numarası TAM SAYI ve belge aralığında
   * olmalıdır; ondalık sessizce yuvarlanmaz (eskiden Math.round ediliyordu).
   */
  function rejectFieldErrorsOf(draft: RejectDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    if (draft.judgeResult !== "UYGUN" && draft.judgeResult !== "OLUMSUZ") {
      errors.judgeResult = "Kriter sonucunu seçin.";
    }
    if (draft.evidenceMode === "PDF_KONUMU") {
      const raw = draft.page.trim();
      if (!raw) errors.page = "Sayfa numarası zorunludur.";
      else if (!/^\d+$/.test(raw)) errors.page = "Sayfa numarası tam sayı olmalıdır (ör. 6).";
      else if (Number(raw) < 1 || (reportPages > 0 && Number(raw) > reportPages)) {
        errors.page = reportPages > 0
          ? `Sayfa numarası 1 ile ${reportPages} arasında olmalıdır.`
          : "Sayfa numarası 1 veya daha büyük olmalıdır.";
      }
      if (!draft.quote.trim()) errors.quote = "Doğrudan alıntı zorunludur.";
    } else if (!draft.missingContent.trim()) {
      errors.missingContent = "Raporda aranan bölüm/başlık adını yazın.";
    }
    if (!draft.reason.trim()) errors.reason = "Hakem gerekçesi zorunludur.";
    return errors;
  }

  function confirmReject() {
    if (!rejectDraft) return;
    const fieldErrors = rejectFieldErrorsOf(rejectDraft);
    if (Object.keys(fieldErrors).length) {
      setRejectFieldErrors(fieldErrors);
      setRejectError("");
      return;
    }
    setRejectFieldErrors({});
    const page = rejectDraft.page.trim() ? Number(rejectDraft.page.trim()) : null;
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
    // Form YALNIZCA kayıt gerçekten kalıcılaştıysa kapanır (madde 6).
    void patchDecision(candidate.criterionId, candidate).then((persisted) => {
      if (!persisted) {
        setRejectError("Karar sunucuya kaydedilemedi; form açık bırakıldı. Yeniden deneyin.");
        return;
      }
      setRejectDraft(null);
      setRejectError("");
      setRejectFieldErrors({});
    });
  }

  function resetDecision(criterionId: string) {
    void patchDecision(criterionId, {
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
    if (!await draftQueue.current) {
      setSaveError("Son kriter kararı kaydedilemedi. Taslağı kaydedip yeniden deneyin.");
      setSaving(false);
      return;
    }
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
      draftSavedAt: draftStamp.current,
      draftScope: {
        analyzedAt: evaluation.analyzedAt,
        pdfHash: evaluation.report.pdfHash ?? null,
        criteriaVersion: application.evaluationCriteriaVersion ?? null,
      },
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
  // Geriye uyum: eski kayıtta similarityReport yoksa 3. aşamaya yazılmış
  // yapılandırılmış benzerlik alanı sade kartla gösterilir (madde 7).
  const legacySimilarity = !similarityReport
    ? evaluation?.stages.find((stage) => stage.stage === "category_similarity")?.similarity ?? null
    : null;

  return (
    <section className="eval-detail" aria-labelledby="eval-detail-title">
      {/* Kanıt paneli: doğru sayfayı açar ve alıntıyı vurgular (madde 6). */}
      {evidenceView ? (
        <PdfEvidenceViewer
          fileUrl={fileUrl(application)}
          fileName={application.fileName ?? "basvuru.pdf"}
          page={evidenceView.page}
          quote={evidenceView.quote}
          label={evidenceView.label}
          onClose={() => setEvidenceView(null)}
        />
      ) : null}
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

      {readOnly ? <p className="inline-error" role="status">{competition ? "Yarışma kilitli veya arşivli; yalnızca görüntüleyebilirsiniz." : "Yarışma durumu doğrulanamadı; düzenleme geçici olarak kapalı."}</p> : null}
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
              <div><strong>Yapay Zekâ Analizi sürüyor</strong><p>{progress}</p><ElapsedTime /></div>
              <div className="progress-line"><span /></div>
            </div>
          ) : (
            <button type="button" className="primary-button eval-analyze-button" disabled={!canAnalyze} onClick={() => onAnalyze(application)}>
              {application.status === "analysis_failed" ? "Yeniden dene" : "Yapay Zekâ Analizi Yap"} <span aria-hidden="true">→</span>
            </button>
          )}
          {!canAnalyze && !analyzing ? (
            <small>
              {otherAnalysisRunning
                ? "Başka bir başvurunun analizi sürüyor; bitince bu düğme yeniden etkinleşir."
                : application.status === "analyzing"
                  ? "Analiz başka bir oturumda sürüyor."
                  : "Bu durumda analiz başlatılamaz."}
            </small>
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
              <button type="button" className="secondary-button" disabled={!canRefresh} onClick={() => onAnalyze(application, true)}>
                Analizi yenile
              </button>
            </div>
          ) : null}

          <p className="eval-stage-kicker">AI ön değerlendirme özeti — kesinleşen kriter sonuçları aşağıdaki sayaçlardadır.</p>
          <StageStrip
            stages={evaluation.stages}
            findings={evaluation.findings}
            outsidePdfCount={evaluation.criteriaScope?.outsidePdf ?? 0}
          />
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
          {/*
            KRİTER KAPSAMI (madde 2): PDF dışında kalan kriterler uygun ya da
            olumsuz SAYILMAZ, kritik hata üretmez, karar listesinde görünmez ve
            nihai karar kapısını engellemez. Yalnızca burada ve denetim
            kaydında sayılırlar; katılımcıya eksiklik olarak gönderilmezler.
          */}
          {scope ? (
            <div className="eval-scope-line" role="status">
              <p>
                <strong>{scope.published} yayımlı kriterden {scope.pdfEvaluable}&apos;i</strong> katılımcı
                PDF&apos;si üzerinden değerlendirildi.
                {scope.outsidePdf
                  ? ` ${scope.outsidePdf} kriter video, portal veya fiziksel aşama gerektirdiği için rapor analizine katılmadı.`
                  : " Yayımlı kriterlerin tamamı rapor üzerinden denetlenebilir."}
                {counts.pending ? ` ${counts.pending} kriter hakem kararı bekliyor.` : " Kriterlerin tamamı kesinleşti."}
              </p>
              {scope.outsidePdf && scope.outsideNames?.length ? (
                <details>
                  <summary>PDF dışında kalan kriterler ({scope.outsidePdf})</summary>
                  <ul>{scope.outsideNames.map((name) => <li key={name}>{name}</li>)}</ul>
                  <small>
                    Bu kurallar uygun veya olumsuz sayılmaz, kritik hata üretmez ve nihai kararı
                    engellemez. Kayıt olarak denetim izinde korunurlar.
                  </small>
                </details>
              ) : null}
            </div>
          ) : null}

          <div className="eval-result-summary" aria-label="Kesinleşmiş kriter sonucu özeti">
            <div className="BASARILI"><strong>{counts.uygun}</strong><span>uygun (kesinleşmiş)</span></div>
            <div className="KRITIK_HATA"><strong>{counts.olumsuz}</strong><span>olumsuz (kesinleşmiş)</span></div>
            <div className="REVIZYON"><strong>{counts.pending}</strong><span>hakem kararı bekleyen</span></div>
            <div><strong>{counts.total}</strong><span>PDF&apos;den değerlendirilen kriter</span></div>
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
              : ". “AI bulgusunu aynen kullan” ve “Hakem değerlendirmesi gir” düğmeleri yalnızca AI bulgusunun kabulünü belirler; kesin sonuç yukarıdaki sayaçlardadır."}
          </p>

          <div className="eval-result-group">
            <h3>Kriter kararları <span>{counts.total}</span></h3>
            {/*
              KAYIT DURUMU (madde 6): "Kaydedildi" YALNIZCA sunucu onayladıktan
              sonra yazılır; kaydedilemeyen çalışma sessizce kaybolmuş gibi
              görünmez. Taslak nihai karar DEĞİLDİR ve katılımcıya gitmez.
            */}
            {!locked ? (
              <p className={`eval-draft-state ${draftState.state}`} role="status" aria-live="polite">
                {draftState.state === "saving" ? "Kriter kararı kaydediliyor…"
                  : draftState.state === "error"
                    ? `Kaydedilemedi: ${draftState.message} Kararlarınız ekranda duruyor; yeniden deneyin.`
                    : application.review?.draftSavedAt
                      ? `Kriter kararlarınız taslak olarak kaydedildi (${formatDateTime(application.review.draftSavedAt)}). Taslak nihai karar değildir; yarışmacıya iletilmez.`
                      : "Verdiğiniz her kriter kararı taslak olarak sunucuya kaydedilir."}
              </p>
            ) : null}
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
                      specSourcePage={specPageOf.get(finding.criterionId) ?? null}
                      reportPages={reportPages}
                      onShowEvidence={setEvidenceView}
                      locked={locked}
                      rejectDraft={rejectDraft?.criterionId === finding.criterionId ? rejectDraft : null}
                      rejectError={rejectDraft?.criterionId === finding.criterionId ? rejectError : ""}
                      rejectFieldErrors={rejectDraft?.criterionId === finding.criterionId ? rejectFieldErrors : {}}
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

          {/* Benzerlik kontrolü: bütün kriter analizlerinin EN ALTINDA (madde 9.9).
              Kriter analizinden BAĞIMSIZ ilerler (madde 4): süren, kısmi ve
              başarısız durumlar birbirinden ayrı gösterilir, hiçbiri "Normal"
              diye sunulmaz ve hakem kararlarını beklet(me)mez. */}
          {similarityRun ? (
            <section className="eval-similarity-note level-normal" aria-label="Raporlar arası benzerlik">
              <h3 className="eval-similarity-title">
                Raporlar arası benzerlik — {similarityRun.state === "running"
                  ? "karşılaştırma sürüyor"
                  : similarityRun.state === "partial" ? "kısmen tamamlandı" : "tamamlanamadı"}
              </h3>
              <p>
                {similarityRun.state === "running"
                  ? "Aynı yarışmadaki güncel başvurularla karşılaştırma sürüyor. Kriter kararlarınızı vermek için beklemeniz gerekmez."
                  : similarityRun.message}
              </p>
              {similarityRun.state === "running" ? <ElapsedTime /> : (
                <button type="button" className="secondary-button" disabled={readOnly} onClick={() => { void onRetrySimilarity(application); }}>
                  Benzerliği yenile
                </button>
              )}
              <p className="eval-similarity-disclaimer">Bu sonuç intihal veya otomatik ret kararı değildir.</p>
            </section>
          ) : similarityReport
            ? <SimilarityCard report={similarityReport} application={application} />
            : legacySimilarity ? <LegacySimilarityCard similarity={legacySimilarity} /> : null}

          {/*
            NİHAİ KARAR — bütün kriterler sonuçlanmadan AÇILMAZ. Sistem
            "öneriliyor" bile demez; kararı yalnızca hakem verir (madde 4).
          */}
          {completed ? (
            <div className="eval-decision-bar">
              <div>
                <strong>Karar verildi: {OUTCOME_LABELS[application.outcome]}</strong>
                <p>{application.review?.completedAt ? `${formatDateTime(application.review.completedAt)} · ` : ""}Sonuç yarışmacıya iletildi{application.outcomeNote ? `: “${application.outcomeNote}”` : "."}</p>
              </div>
              <button type="button" className="secondary-button" disabled={busy || readOnly} onClick={async () => {
                setBusy(true);
                try { await onReopen(application); } finally { setBusy(false); }
              }}>
                Kararı yeniden aç
              </button>
            </div>
          ) : readOnly ? <p role="status">Yarışma durumu nedeniyle değerlendirme salt okunur. Yazdığınız taslak alanları korunuyor.</p> : pendingOutcome ? (
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
  /**
   * Benzerlik, kriter analizinden BAĞIMSIZ ilerler (madde 4); durumu başvuru
   * kimliğine göre burada tutulur ve kendi kartında gösterilir.
   */
  const [similarityState, setSimilarityState] = useState<Record<string, SimilarityRunState>>({});
  const [progress, setProgress] = useState("");
  const [competitionError, setCompetitionError] = useState("");
  const [bulkSimilarity, setBulkSimilarity] = useState<BulkSimilaritySummary | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  useLiveRefresh(async () => {
    try {
      const result = await workflowApi.competitions();
      setCompetitions(result.competitions);
      setCompetitionError("");
    } catch {
      setCompetitionError("Yarışma durumu yenilenemedi. İşlemler geçici olarak kapalı; bağlantı geldiğinde yeniden denenecek.");
    }
  }, !loading);

  useEffect(() => {
    let active = true;
    Promise.allSettled([workflowApi.profiles(), workflowApi.applications(), workflowApi.competitions()])
      .then(([profileResult, applicationResult, competitionResult]) => {
        if (!active) return;
        if (profileResult.status === "fulfilled") setProfiles(profileResult.value.profiles);
        if (applicationResult.status === "fulfilled") setApplications(applicationResult.value.applications);
        // Öncelik bayrağı olmadan da ekran çalışır; yalnızca rozet görünmez.
        if (competitionResult.status === "fulfilled") setCompetitions(competitionResult.value.competitions);
        const failure = [profileResult, applicationResult, competitionResult].find((result) => result.status === "rejected");
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

  async function loadBulkSimilarity() {
    const competition = competitions.find((item) => item.competitionKey === competitionKey);
    if (!competition || competitionReadOnly(competition)) return;
    setBulkBusy(true);
    setError("");
    try {
      setBulkSimilarity(await workflowApi.bulkSimilarity(competition.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Toplu benzerlik özeti hazırlanamadı.");
    } finally {
      setBulkBusy(false);
    }
  }

  /** Sahipsiz reddedilmiş söz bırakmadan koşuyu sonuçlanmış hâle getirir. */
  function settledSimilarity(
    run: Promise<SimilarityCheckResult>,
  ): Promise<{ ok: true; value: SimilarityCheckResult } | { ok: false; error: unknown }> {
    return run.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  }

  /**
   * BENZERLİĞİN BAĞIMSIZ TAKİBİ (madde 4).
   *
   * Kriter analizi kaydedildikten SONRA çalışır: sonucu geldiğinde sunucudaki
   * yetkili kaydı `attach_similarity` ile analize iliştirir, gelmezse durumu
   * kendi kartında gösterir. Hakem kararlarına, başka bir başvuruya ve daha
   * yeni bir analiz sürümüne DOKUNMAZ — sunucu bunları CAS ile korur.
   */
  async function trackSimilarity(
    applicationId: string,
    /*
     * Koşu, kriter analizi beklenirken de sürdüğü için SONUÇLANMIŞ biçimde
     * (hata dâhil) geçilir: hiçbir aşamada sahipsiz reddedilmiş söz kalmaz.
     */
    run: Promise<{ ok: true; value: SimilarityCheckResult } | { ok: false; error: unknown }>,
    rerun: () => Promise<SimilarityCheckResult>,
  ): Promise<void> {
    setSimilarityState((current) => ({ ...current, [applicationId]: { state: "running", message: "" } }));
    let result: SimilarityCheckResult | null = null;
    let failure = "";
    const settled = await run;
    if (settled.ok) {
      result = settled.value;
    } else {
      const caught = settled.error;
      failure = caught instanceof Error ? caught.message : "bilinmeyen hata";
      if (caught instanceof WorkflowApiError && caught.status === 429) failure = `429 · ${failure}`;
    }
    // 429 / embedding kotası: kısa gecikmeyle BİR KEZ daha denenir (kontrolsüz tekrar yok).
    const rateLimited = failure ? failure.includes("429") : result?.embeddingRateLimited === true;
    if (rateLimited && !result?.similarity) {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      try {
        result = await rerun();
        failure = "";
      } catch (retryCaught) {
        failure = retryCaught instanceof Error ? retryCaught.message : "bilinmeyen hata";
      }
    }

    if (result?.similarity) {
      try {
        const attached = await workflowApi.updateApplication(applicationId, "attach_similarity");
        // Bu yanıt hazırlanırken yeni hakem taslağı kaydedilmiş olabilir.
        // Bütün başvuruyu değiştirmek yerine yalnız aynı analizin benzerliğini al.
        setApplications((current) => current.map((item) => {
          const incoming = attached.application;
          if (item.id !== applicationId || !item.evaluation || !incoming.evaluation
            || item.evaluation.analyzedAt !== incoming.evaluation.analyzedAt
            || item.evaluation.report.pdfHash !== incoming.evaluation.report.pdfHash) return item;
          return {
            ...item,
            evaluation: { ...item.evaluation, similarityReport: incoming.evaluation.similarityReport },
            similarityStale: incoming.similarityStale,
            similarityStaleReason: incoming.similarityStaleReason,
          };
        }));
        setSimilarityState((current) => {
          const next = { ...current };
          delete next[applicationId];
          return next;
        });
        return;
      } catch (attachError) {
        failure = attachError instanceof Error ? attachError.message : "bilinmeyen hata";
      }
    }
    setSimilarityState((current) => ({
      ...current,
      [applicationId]: result?.status === "partial" && !failure
        ? { state: "partial", message: "Havuz taraması bu oturumda tamamlanamadı; benzerliği yenileyerek sürdürebilirsiniz." }
        : { state: "failed", message: failure || "Benzerlik karşılaştırması tamamlanamadı." },
    }));
  }

  /**
   * "Benzerliği yenile" (madde 4): YALNIZCA benzerlik yeniden çalışır. Kriter
   * analizi yeniden başlatılmaz, hakem kararları sıfırlanmaz; sonuç geldiğinde
   * yalnızca `similarityReport` alanı güncellenir.
   */
  async function retrySimilarity(application: CompetitionApplication): Promise<void> {
    if (similarityState[application.id]?.state === "running") return;
    setSimilarityState((current) => ({ ...current, [application.id]: { state: "running", message: "" } }));
    try {
      const file = await workflowApi.applicationFile(application.id, application.fileName ?? "basvuru.pdf");
      const pdfHash = await sha256HexOf(await file.arrayBuffer());
      const extracted = await extractPdfText(file);
      const runSimilarity = async () => {
        let result = await workflowApi.similarityCheck(application.id, { pages: extracted.pages, pdfHash });
        for (let attempt = 0; attempt < 12 && result.status === "partial" && result.resumeRunId; attempt += 1) {
          result = await workflowApi.similarityCheck(application.id, {
            pages: extracted.pages, pdfHash, resumeRunId: result.resumeRunId,
          });
        }
        return result;
      };
      await trackSimilarity(application.id, settledSimilarity(runSimilarity()), runSimilarity);
    } catch (caught) {
      setSimilarityState((current) => ({
        ...current,
        [application.id]: {
          state: "failed",
          message: caught instanceof Error ? caught.message : "Benzerlik karşılaştırması tamamlanamadı.",
        },
      }));
    }
  }

  /**
   * Yapay Zekâ Analizi (madde 9.1).
   *
   * BÜTÜNLÜK (madde 3): istemci modele kriter ya da PDF GÖNDERMEZ. Sunucuya
   * yalnızca başvuru kimliği gider; kriter seti (son yayımlanan sürüm) ve
   * rapor PDF'i (R2'deki geçerli sürüm) sunucuda çözülür.
   *
   * PDF metni BİR KEZ çıkarılır ve iki işlem paylaşır. İkisi PARALEL başlar
   * ama BİRLİKTE BEKLENMEZ (madde 4): kriter analizi biter bitmez kendi
   * bütünlük kapılarından geçip kaydedilir ve hakem çalışmaya başlayabilir.
   * Benzerlik kendi hızında sürer; bittiğinde sonucunu `attach_similarity`
   * ile kayda iliştirir. Böylece uzun süren ya da başarısız olan bir
   * benzerlik taraması hakem analizini BEKLETMEZ.
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
      /*
       * Büyük havuz (madde 8): sunucu süre bütçesi dolunca "partial" +
       * resumeRunId döndürür; koşu SINIRLI sayıda devam çağrısıyla sürdürülür
       * (kontrolsüz tekrar yok). Devam çağrıları embedding API'sini yeniden
       * ÇAĞIRMAZ; kesinti hâlinde ödenmiş maliyet sunucuda kalıcıdır.
       */
      const runSimilarity = async () => {
        let result = await workflowApi.similarityCheck(current.id, { pages: extracted.pages, pdfHash });
        for (let attempt = 0; attempt < 12 && result.status === "partial" && result.resumeRunId; attempt += 1) {
          result = await workflowApi.similarityCheck(current.id, {
            pages: extracted.pages, pdfHash, resumeRunId: result.resumeRunId,
          });
        }
        return result;
      };
      // Benzerlik BAŞLATILIR ama beklenmez; hatası burada yutulmaz, aşağıdaki
      // bağımsız takip zincirinde ele alınır.
      const similarityPromise = settledSimilarity(runSimilarity());
      const evaluation = await evaluateReport({
        applicationId: current.id, pages: extracted.pages, pageCount: extracted.pageCount, force,
      });

      setProgress("AI analizi kaydediliyor…");
      const saved = await workflowApi.updateApplication(current.id, "save_evaluation", { evaluation });
      replaceApplication(saved.application);
      // Hakem analiz sürerken BAŞKA bir başvuruya geçmiş olabilir; oradaki
      // kaydedilmemiş kriter kararlarını silecek zorla gezinme yapılmaz.
      setApplicationId((currentId) => currentId === null || currentId === current.id ? saved.application.id : currentId);
      // Kriter analizi elde: hakem benzerliği beklemeden çalışabilir.
      trackSimilarity(current.id, similarityPromise, runSimilarity);
    } catch (caught) {
      /*
       * ANLAMLI HATA (madde 11): "API'yi kontrol edin" gibi genel bir metin
       * yerine hakemin ne yapacağını söyleyen bilgi verilir — geçici hata mı,
       * OCR mı gerekiyor, eski analiz korundu mu.
       */
      setError(`“${application.teamName}” analiz edilemedi: ${analysisFailureMessage(caught)}`);
      if (started) {
        workflowApi.updateApplication(application.id, "analysis_failed")
          .then((saved) => {
            replaceApplication(saved.application);
            if (saved.previousAnalysisKept) {
              // Kullanıcı, elindeki çalışan analizin silinmediğini görmeli.
              setNotice("Yeni analiz denemesi başarısız oldu; önceki başarılı analiz ve verdiğiniz kriter kararları korundu.");
            }
          })
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
                onSelect={(key) => { setCompetitionKey(key); setApplicationId(null); setBulkSimilarity(null); }}
              />
              <div className="eval-workshop-main">
                {competitionKey ? (
                  <section className="eval-similarity-note level-normal" aria-label="Toplu benzerlik incelemesi">
                    <h3 className="eval-similarity-title">Toplu benzerlik incelemesi</h3>
                    <p>Güncel matematiksel sonuçlardan en güçlü beş rapor çifti hazırlanır. Bu işlem kriter veya nihai karar üretmez.</p>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={bulkBusy || competitionReadOnly(competitions.find((item) => item.competitionKey === competitionKey))}
                      onClick={() => { void loadBulkSimilarity(); }}
                    >
                      {bulkBusy ? "Hazırlanıyor…" : "Benzerlikleri toplu tara"}
                    </button>
                    {bulkBusy ? <ElapsedTime /> : null}
                    {bulkSimilarity ? (
                      <div aria-live="polite">
                        <p>{bulkSimilarity.poolSize} rapor · {bulkSimilarity.possiblePairCount} olası çift · {bulkSimilarity.candidates.length} güçlü aday</p>
                        {bulkSimilarity.missingCount ? <p>{bulkSimilarity.missingCount} raporun matematiksel analizi henüz güncel değil.</p> : null}
                        <ol>{bulkSimilarity.candidates.map((pair) => (
                          <li key={pair.pairKey}><strong>{pair.leftLabel} ↔ {pair.rightLabel}</strong> · yaklaşık %{pair.mathematicalPercent}</li>
                        ))}</ol>
                        <p>{bulkSimilarity.note}</p>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {!competitionKey ? (
                  <p className="library-empty">Soldan bir yarışma seçin.</p>
                ) : selected ? (
                  <ApplicationDetail
                    key={`${selected.id}-${selected.evaluation?.analyzedAt ?? ""}-${selected.status === "completed"}`}
                    application={selected}
                    profile={selectedProfile}
                    competition={competitionError ? null : competitions.find((item) => item.competitionKey === selected.competitionKey) ?? null}
                    analyzing={analyzingId === selected.id}
                    otherAnalysisRunning={analyzingId !== null && analyzingId !== selected.id}
                    progress={progress}
                    similarityRun={similarityState[selected.id] ?? null}
                    onAnalyze={analyze}
                    onRetrySimilarity={retrySimilarity}
                    onReviewSaved={replaceApplication}
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
