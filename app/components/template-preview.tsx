"use client";

import FileBadge from "./file-badge";
import { criterionEffectOf, deriveDecisionRules, normalizeScore } from "../lib/evaluation-summary";
import type { AnalysisResult, Criterion, SetupData, ViolationAction } from "../lib/types";

const ACTION_LABELS: Record<ViolationAction, string> = {
  block: "Yüklemeyi engelle",
  warn: "Uyarı oluştur",
  jury: "Jüri incelemesine gönder",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Profilin hangi aşamada olduğunu tek bakışta veren durum rozeti.
 * Soldaki her adım ilerledikçe rozet de canlı olarak değişir.
 */
function previewState(file: File | null, result: AnalysisResult | null) {
  if (result) return { tone: "done", label: `${result.pageCount} sayfa analiz edildi` };
  if (file) return { tone: "ready", label: "Analize hazır" };
  return { tone: "draft", label: "Bilgi giriliyor" };
}

/**
 * Sağ panel canlı önizlemesi: seçilen yarışma, değerlendirme profili, belge
 * türü, girilen teslim ayarları ve çıkarılan kriterlerden oluşan şablonun
 * küçük bir görünümü. Soldaki her değişiklik bu panele anında yansır.
 */
export default function TemplatePreview({
  setup,
  file,
  result,
  criteria,
}: {
  setup: SetupData;
  file: File | null;
  result: AnalysisResult | null;
  criteria: Criterion[];
}) {
  const active = criteria.filter((item) => item.active);
  const scorePlan = result?.scorePlan;
  const declaredTotal = scorePlan?.declaredTotalScore ?? null;
  const scoreGroups = scorePlan?.groups ?? [];
  const rules = active.length ? deriveDecisionRules(criteria, scorePlan) : null;
  const scoreCriterionCount = active.filter((item) => criterionEffectOf(item) === "score").length;
  const state = previewState(file, result);
  // Profil kimliği görevlinin girdiği yıl/aşama değerlerinden anlık kurulur.
  const profileId = [setup.year, setup.stage].filter(Boolean).join(" / ") || "Tanımlanmadı";

  return (
    <div className="template-preview">
      <div className="preview-topline">
        <span className="preview-label">Canlı önizleme</span>
        <span className={`preview-state ${state.tone}`}>{state.label}</span>
      </div>

      <div className="template-head">
        <FileBadge fileName={file?.name ?? "sablon.pdf"} mimeType={file?.type} size="lg" />
        <div>
          <h2>{setup.reportType || "Rapor türü bekleniyor"}</h2>
          <p>{setup.competition || "Yarışma adı bekleniyor"}</p>
          <small>Profil {profileId} · v1.0</small>
        </div>
      </div>

      {file ? (
        <div className="template-file-row">
          <FileBadge fileName={file.name} mimeType={file.type} size="sm" />
          <div>
            <strong>{file.name}</strong>
            <small>{formatBytes(file.size)} · Kaynak belge</small>
          </div>
        </div>
      ) : (
        <div className="template-file-row empty">
          <span>Henüz kaynak belge seçilmedi.</span>
        </div>
      )}

      <dl>
        <div><dt>Kategori</dt><dd>{setup.category || "—"}</dd></div>
        <div><dt>Aşama</dt><dd>{setup.stage || "—"}</dd></div>
        <div><dt>Yıl</dt><dd>{setup.year || "—"}</dd></div>
        {/* Format satırı başlangıç ayarından okunur; sabit "PDF" varsayılmaz. */}
        <div><dt>Format</dt><dd>{setup.allowedFormats.join(", ") || "—"}</dd></div>
        <div><dt>Boyut</dt><dd>≤ {setup.maxFileSizeMb || 0} MB</dd></div>
        <div><dt>Dosya</dt><dd>≤ {setup.maxFileCount || 0}</dd></div>
        <div><dt>İhlal</dt><dd>{ACTION_LABELS[setup.defaultViolationAction]}</dd></div>
      </dl>

      {active.length ? (
        <div className="template-structure">
          <span className="preview-label">Değerlendirme yapısı</span>
          <div className="template-metrics">
            <div><strong>{active.length}</strong><span>aktif kural</span></div>
            <div><strong>{scoreGroups.length || scoreCriterionCount}</strong><span>puan grubu</span></div>
            <div>
              <strong>{declaredTotal ?? "—"}</strong>
              <span>{declaredTotal ? "puan → 100" : "toplam puan"}</span>
            </div>
          </div>
          {scoreGroups.length ? (
            <ul className="template-groups">
              {scoreGroups.slice(0, 4).map((group) => (
                <li key={`${group.name}-${group.sourcePage}`}>
                  <span>{group.name}</span>
                  <strong>
                    {group.maxScore}p
                    {declaredTotal ? <em> ≈ {normalizeScore(group.maxScore, declaredTotal)}/100</em> : null}
                  </strong>
                </li>
              ))}
              {scoreGroups.length > 4 ? <li className="more">+ {scoreGroups.length - 4} grup daha</li> : null}
            </ul>
          ) : null}
          {rules ? (
            <div className="template-rules">
              <span>Geçiş {rules.gates.length}</span>
              <span>Baraj {rules.thresholds.length}</span>
              <span>Ceza {rules.penalties.length}</span>
              <span>Eleme {rules.eliminations.length}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="template-structure pending">
          <span className="preview-label">Değerlendirme yapısı</span>
          <p>
            Kriterler, puan grupları ve baraj/ceza kuralları kaynak belge analiz edildikten
            sonra burada listelenir.
          </p>
        </div>
      )}

      <div className="preview-note">
        <span>i</span>
        <p>Sayfa, yazı tipi ve içerik kuralları burada varsayılmaz; resmî belgeden çıkarılır.</p>
      </div>
    </div>
  );
}
