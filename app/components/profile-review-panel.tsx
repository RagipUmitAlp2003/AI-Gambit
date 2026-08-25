"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../lib/admin-client";
import { workflowApi } from "../lib/workflow-client";
import type { Criterion, ProfileExport } from "../lib/types";
import { PROFILE_STATUS_LABELS, type CompetitionProfile, type ProfileReviewDecision } from "../lib/workflow-types";

/**
 * Aşama A · ikinci doğrulama (Rol 02).
 *
 * Hakem, yarışma yöneticisinin hazırladığı şartname/kriter/puan yapısını inceler.
 * Eksik kriteri ekleyebilir, yanlışı düzeltebilir, gereksizi kapatabilir ve
 * puanlama hatasını giderebilir. Sonuçta profili onaylar ya da düzeltme için
 * yarışma yöneticisine geri gönderir. Hakem onaylamadan profil aktif olmaz.
 */

const STATUS_CHIP: Record<CompetitionProfile["status"], string> = {
  draft: "neutral",
  judge_review_pending: "warning",
  changes_requested: "danger",
  approved: "success",
};

/** Hakemin eklediği kriter; kaynağı belge değil görevlidir. */
function newCriterion(name: string, maxScore: number | null): Criterion {
  return {
    id: `hakem-${crypto.randomUUID().slice(0, 8)}`,
    name,
    type: maxScore === null ? "mandatory_content" : "qualitative_score",
    maxScore,
    weight: null,
    required: true,
    violationOutcome: "Belgede belirtilmemiş",
    evaluationMethod: "human",
    sourcePage: null,
    sourceText: "",
    aiInterpretation: "Hakem tarafından ikinci doğrulamada eklendi.",
    confidence: "high",
    active: true,
    origin: "manager",
    effect: maxScore === null ? "gate" : "score",
    reviewStatus: "confirmed",
  };
}

export default function ProfileReviewPanel({ compact = false, onChanged }: {
  compact?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [profiles, setProfiles] = useState<CompetitionProfile[]>([]);
  const [openId, setOpenId] = useState("");
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [note, setNote] = useState("");
  const [newName, setNewName] = useState("");
  const [newScore, setNewScore] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Karar verildikten sonra listeyi tazelemek için artırılır. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    workflowApi.profiles()
      .then((result) => { if (active) { setProfiles(result.profiles); setError(""); } })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Değerlendirme profilleri yüklenemedi."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  const pending = useMemo(() => profiles.filter((item) => item.status === "judge_review_pending"), [profiles]);
  const decided = useMemo(() => profiles.filter((item) => item.status !== "judge_review_pending"), [profiles]);
  const open = useMemo(() => profiles.find((item) => item.id === openId) ?? null, [profiles, openId]);
  const edited = useMemo(
    () => !!open && JSON.stringify(criteria) !== JSON.stringify(open.profile.criteria),
    [criteria, open],
  );

  function openProfile(profile: CompetitionProfile) {
    setOpenId(profile.id);
    setCriteria(profile.profile.criteria.map((item) => ({ ...item })));
    setNote("");
    setNewName("");
    setNewScore("");
    setNotice("");
    setError("");
  }

  function patchCriterion(id: string, patch: Partial<Criterion>) {
    setCriteria((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function addCriterion() {
    const name = newName.trim();
    if (!name) return;
    const parsed = newScore.trim() === "" ? null : Number(newScore);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Azami puan 0 veya daha büyük bir sayı olmalıdır.");
      return;
    }
    setCriteria((current) => [...current, newCriterion(name, parsed)]);
    setNewName("");
    setNewScore("");
    setError("");
  }

  async function decide(decision: ProfileReviewDecision) {
    if (!open || busy) return;
    if (decision === "request_changes" && !note.trim()) {
      setError("Düzeltme talebinde gerekçe zorunludur; yarışma yöneticisi neyi düzelteceğini bilmelidir.");
      return;
    }
    if (decision === "approve" && !criteria.some((item) => item.active)) {
      setError("Onay için en az bir etkin kriter gerekir.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextProfile: ProfileExport | undefined = edited
        ? { ...open.profile, criteria }
        : undefined;
      await workflowApi.reviewProfile({ id: open.id, decision, note, profile: nextProfile });
      setNotice(decision === "approve"
        ? "Profil onaylandı ve değerlendirme için aktif hâle geldi."
        : "Profil düzeltme için yarışma yöneticisine geri gönderildi.");
      setOpenId("");
      setReloadKey((current) => current + 1);
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "İşlem tamamlanamadı.");
    } finally { setBusy(false); }
  }

  if (loading) return <p className="page-note">Değerlendirme profilleri yükleniyor…</p>;

  return (
    <section className="profile-review-workspace" aria-labelledby="profile-review-title">
      <header>
        <span className="role-code">Aşama A · ikinci doğrulama</span>
        <h1 id="profile-review-title">Hakem onayı bekleyen değerlendirme profilleri</h1>
        <p>Şartname, kriterler ve puan yapısı yarışma yöneticisi tarafından hazırlanır. Onaylamadan önce kriterlerin şartnameyle uyumunu kontrol edin; profil siz onaylayana kadar değerlendirmede kullanılamaz.</p>
      </header>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}

      {!pending.length ? (
        <div className="participant-empty"><strong>Onay bekleyen profil yok</strong><p>Yarışma yöneticisi bir profili incelemeye gönderdiğinde burada görünecek.</p></div>
      ) : (
        <div className="profile-review-list">
          {pending.map((profile) => (
            <article key={profile.id} className={openId === profile.id ? "open" : ""}>
              <div className="profile-review-line">
                <div>
                  <span className={`status-chip ${STATUS_CHIP[profile.status]}`}>{PROFILE_STATUS_LABELS[profile.status]}</span>
                  <strong>{profile.competitionName}</strong>
                  <p>{profile.category} · {profile.stage} · {profile.reportType}</p>
                  <small>Hazırlayan: {profile.createdByName || "Yarışma yöneticisi"} · Kaynak: {profile.sourceDocumentName} · {profile.profile.criteria.length} kriter · {formatDateTime(profile.submittedAt ?? profile.updatedAt)}</small>
                </div>
                <button type="button" className="secondary-button" onClick={() => openId === profile.id ? setOpenId("") : openProfile(profile)}>
                  {openId === profile.id ? "Kapat" : "İncele"}
                </button>
              </div>

              {openId === profile.id ? (
                <div className="profile-review-detail">
                  <div className="profile-review-criteria" role="table" aria-label="Kriterler">
                    <div className="profile-review-head" role="row"><span>Kriter</span><span>Azami puan</span><span>Kaynak</span><span>Durum</span></div>
                    {criteria.map((criterion) => (
                      <div key={criterion.id} className={`profile-review-row${criterion.active ? "" : " inactive"}`} role="row">
                        <label>
                          <span className="sr-only-label">Kriter adı</span>
                          <input value={criterion.name} maxLength={240} onChange={(event) => patchCriterion(criterion.id, { name: event.target.value })} />
                        </label>
                        <label>
                          <span className="sr-only-label">Azami puan</span>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={criterion.maxScore ?? ""}
                            placeholder="—"
                            onChange={(event) => patchCriterion(criterion.id, { maxScore: event.target.value === "" ? null : Number(event.target.value) })}
                          />
                        </label>
                        <small>{criterion.sourcePage ? `Şartname s. ${criterion.sourcePage}` : criterion.origin === "manager" ? "Görevli eklemesi" : "Kaynak sayfası yok"}</small>
                        <button type="button" className="text-button" onClick={() => patchCriterion(criterion.id, { active: !criterion.active })}>
                          {criterion.active ? "Kaldır" : "Geri al"}
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="profile-review-add">
                    <label className="field"><span className="field-label">Eksik kriter ekle</span><input value={newName} maxLength={240} placeholder="Kriter adı" onChange={(event) => setNewName(event.target.value)} /></label>
                    <label className="field"><span className="field-label">Azami puan</span><input type="number" min={0} step="any" value={newScore} placeholder="Puansız ise boş" onChange={(event) => setNewScore(event.target.value)} /></label>
                    <button type="button" className="secondary-button" disabled={!newName.trim()} onClick={addCriterion}>Kriteri ekle</button>
                  </div>

                  <label className="field">
                    <span className="field-label">Hakem notu</span>
                    <textarea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Onay gerekçeniz veya düzeltilmesi gereken maddeler" />
                    <span className="field-hint">Düzeltme talebinde bu alan zorunludur; yarışma yöneticisine aynen iletilir.</span>
                  </label>

                  {edited ? <p className="page-note">Kriterlerde değişiklik yaptınız. Kararınızla birlikte kaydedilecek ve süreç kaydına düşecek.</p> : null}

                  <div className="profile-review-actions">
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => decide("request_changes")}>Düzeltme için geri gönder</button>
                    <button type="button" className="primary-button" disabled={busy} onClick={() => decide("approve")}>{busy ? "Kaydediliyor…" : "Profili onayla"}</button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {!compact && decided.length ? (
        <section className="published-profile-list">
          <div><h2>Karara bağlanan profiller</h2><p>Onayladığınız ve düzeltmeye gönderdiğiniz profiller.</p></div>
          {decided.map((profile) => (
            <article key={profile.id}>
              <div>
                <span className={`status-chip ${STATUS_CHIP[profile.status]}`}>{PROFILE_STATUS_LABELS[profile.status]}</span>
                <strong>{profile.competitionName}</strong>
                <span>{profile.sourceDocumentName} · {profile.profile.criteria.length} kriter</span>
                {profile.reviewNote ? <p>{profile.reviewNote}</p> : null}
              </div>
              <small>{profile.reviewedByName ? `${profile.reviewedByName} · ` : ""}{formatDateTime(profile.reviewedAt ?? profile.updatedAt)}</small>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
