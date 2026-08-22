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
 * Sağ panel canlı önizlemesi: seçilen yarışma, belge, girilen değerler ve
 * kriterlerden oluşan değerlendirme şablonunun küçük bir görünümü.
 * Soldaki her değişiklik bu panele anında yansır.
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

  return (
    <div className="template-preview">
      <span className="preview-label">Canlı önizleme</span>
      <div className="template-head">
        <FileBadge fileName={file?.name ?? "sablon.pdf"} mimeType={file?.type} size="lg" />
        <div>
          <h2>{setup.reportType || "Rapor türü bekleniyor"}</h2>
          <p>{setup.competition || "Yarışma adı bekleniyor"}</p>
          <small>{[setup.category, setup.stage, setup.year].filter(Boolean).join(" · ")}</small>
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
        <div><dt>Format</dt><dd>PDF</dd></div>
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
      ) : null}

      <div className="preview-note">
        <span>i</span>
        <p>Sayfa, yazı tipi ve içerik kuralları burada varsayılmaz; resmî belgeden çıkarılır.</p>
      </div>
    </div>
  );
}
