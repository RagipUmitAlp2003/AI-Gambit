"use client";

import { useMemo, useState } from "react";
import { adminApi, formatDateTime } from "../lib/admin-client";
import { ROLES, roleLabel } from "../lib/admin-roles";
import type {
  AdminAccount,
  DocumentFlow,
  DocumentFlowInput,
  FlowActorRole,
  HandoffInput,
  RoleCode,
} from "../lib/admin-types";

/**
 * Kısım 2 — Yarışmalara özel belge akışı.
 * Belgeyi kimin oluşturduğu, özeti, 01→02→03→04 devir zinciri ve 04 sonrası
 * güncel belge tek kayıtta tutulur; liste yarışmaya göre gruplanır.
 */

type Props = {
  flows: DocumentFlow[];
  accounts: AdminAccount[];
  /** Rol 00 dışındaki roller kaydı yalnızca okur. */
  readOnly?: boolean;
  onChanged: () => Promise<void>;
};

type DraftHandoff = HandoffInput & { key: string };

type DraftFlow = {
  competition: string;
  title: string;
  authorName: string;
  summary: string;
  finalNote: string;
  finalDocument: string;
  status: "in_progress" | "completed";
  handoffs: DraftHandoff[];
};

const ASSIGNABLE_ROLES = ROLES.filter((role) => role.code !== "00");

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Zincirdeki bir sonraki adımı önerir: 01→02, 02→03, 03→04. */
function suggestNext(previous: DraftHandoff | undefined): { fromRole: FlowActorRole; toRole: RoleCode } {
  if (!previous) return { fromRole: "author", toRole: "01" };
  const index = ASSIGNABLE_ROLES.findIndex((role) => role.code === previous.toRole);
  const next = ASSIGNABLE_ROLES[index + 1] ?? ASSIGNABLE_ROLES[ASSIGNABLE_ROLES.length - 1];
  return { fromRole: previous.toRole, toRole: next.code };
}

function emptyDraft(): DraftFlow {
  return {
    competition: "",
    title: "",
    authorName: "",
    summary: "",
    finalNote: "",
    finalDocument: "",
    status: "in_progress",
    handoffs: [],
  };
}

function draftFromFlow(flow: DocumentFlow): DraftFlow {
  return {
    competition: flow.competition,
    title: flow.title,
    authorName: flow.authorName,
    summary: flow.summary,
    finalNote: flow.finalNote,
    finalDocument: flow.finalDocument,
    status: flow.status,
    handoffs: flow.handoffs.map((handoff) => ({
      key: handoff.id,
      // Kimliği olan devir kaydedilmiştir; sunucu bunu değiştirmez.
      id: handoff.id,
      fromRole: handoff.fromRole,
      fromName: handoff.fromName,
      toRole: handoff.toRole,
      toName: handoff.toName,
      note: handoff.note,
      handedAt: handoff.handedAt,
    })),
  };
}

function toInput(draft: DraftFlow): DocumentFlowInput {
  return {
    competition: draft.competition,
    title: draft.title,
    authorName: draft.authorName,
    summary: draft.summary,
    status: draft.status,
    finalNote: draft.finalNote,
    finalDocument: draft.finalDocument,
    handoffs: draft.handoffs.map((handoff) => ({
      id: handoff.id,
      fromRole: handoff.fromRole,
      fromName: handoff.fromName,
      toRole: handoff.toRole,
      toName: handoff.toName,
      note: handoff.note,
      handedAt: handoff.handedAt,
    })),
  };
}

export default function DocumentFlowPanel({ flows, accounts, readOnly = false, onChanged }: Props) {
  const [draft, setDraft] = useState<DraftFlow>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Rol atanmış kişiler ad önerisi olarak sunulur; serbest metin de yazılabilir. */
  const namesByRole = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const account of accounts) {
      if (account.status !== "active") continue;
      const list = map.get(account.roleCode) ?? [];
      list.push(account.fullName);
      map.set(account.roleCode, list);
    }
    return map;
  }, [accounts]);

  const grouped = useMemo(() => {
    const map = new Map<string, DocumentFlow[]>();
    for (const flow of flows) {
      const list = map.get(flow.competition) ?? [];
      list.push(flow);
      map.set(flow.competition, list);
    }
    return [...map.entries()];
  }, [flows]);

  function patch(update: Partial<DraftFlow>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchHandoff(key: string, update: Partial<DraftHandoff>) {
    setDraft((current) => ({
      ...current,
      handoffs: current.handoffs.map((handoff) => (handoff.key === key ? { ...handoff, ...update } : handoff)),
    }));
  }

  function addHandoff() {
    setDraft((current) => {
      const previous = current.handoffs[current.handoffs.length - 1];
      const suggestion = suggestNext(previous);
      return {
        ...current,
        handoffs: [
          ...current.handoffs,
          {
            key: newKey(),
            fromRole: suggestion.fromRole,
            fromName: suggestion.fromRole === "author" ? current.authorName : (previous?.toName ?? ""),
            toRole: suggestion.toRole,
            toName: namesByRole.get(suggestion.toRole)?.[0] ?? "",
            note: "",
            handedAt: "",
          },
        ],
      };
    });
  }

  function removeHandoff(key: string) {
    setDraft((current) => ({ ...current, handoffs: current.handoffs.filter((handoff) => handoff.key !== key) }));
  }

  function startEdit(flow: DocumentFlow) {
    setEditingId(flow.id);
    setDraft(draftFromFlow(flow));
    setError("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const input = toInput(draft);
      if (editingId) await adminApi.updateFlow(editingId, input);
      else await adminApi.createFlow(input);
      await onChanged();
      cancelEdit();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Belge akışı kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    setError("");
    try {
      await adminApi.deleteFlow(id);
      if (editingId === id) cancelEdit();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Belge akışı silinemedi.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="workspace" aria-labelledby="flows-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Kısım 2 · Belge akışı</span>
          <h1 id="flows-title">Yarışma bazlı belge ve devir kaydı</h1>
          <p>
            Her yarışma için belgeyi kimin oluşturduğu, belgenin özeti, hangi yöneticiden hangi yöneticiye aktarıldığı ve
            04 sonrası güncel belge tek kayıtta izlenir.
          </p>
        </div>
        <span className="step-fraction">{flows.length} kayıt</span>
      </div>

      {readOnly ? (
        <p className="readonly-note">
          Bu bölümü yalnızca okuyabilirsiniz. Belge akışı kayıtlarını moderatör (00) tutar.
        </p>
      ) : (
      <form className="setup-form" onSubmit={submit}>
        <fieldset>
          <legend>
            <span>{editingId ? "✎" : "1"}</span>
            {editingId ? "Kaydı düzenle" : "Belge künyesi"}
          </legend>
          <div className="form-grid two-col">
            <label className="field">
              <span className="field-label">Yarışma adı</span>
              <input
                value={draft.competition}
                onChange={(event) => patch({ competition: event.target.value })}
                placeholder="Ör. Elektrikli Araç"
                list="flow-competitions"
                required
              />
              <datalist id="flow-competitions">
                {grouped.map(([competition]) => (
                  <option key={competition} value={competition} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span className="field-label">Belge başlığı (opsiyonel)</span>
              <input
                value={draft.title}
                onChange={(event) => patch({ title: event.target.value })}
                placeholder="Ör. Kritik Tasarım Raporu değerlendirmesi"
              />
            </label>
          </div>

          <div className="form-grid two-col" style={{ marginTop: 18 }}>
            <label className="field">
              <span className="field-label">Belgeyi oluşturan</span>
              <input
                value={draft.authorName}
                onChange={(event) => patch({ authorName: event.target.value })}
                placeholder="Ör. X"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Durum</span>
              <select
                value={draft.status}
                onChange={(event) => patch({ status: event.target.value as DraftFlow["status"] })}
              >
                <option value="in_progress">Süreç devam ediyor</option>
                <option value="completed">Tamamlandı</option>
              </select>
            </label>
          </div>

          <label className="field" style={{ marginTop: 18 }}>
            <span className="field-label">Belgenin özeti</span>
            <textarea
              value={draft.summary}
              onChange={(event) => patch({ summary: event.target.value })}
              placeholder="PDF dosyasının özellikleri ve belge üzerinde neler yapıldı"
              required
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>
            <span>2</span>Devir zinciri
          </legend>
          {draft.handoffs.length === 0 ? (
            <p className="empty-note">
              Henüz devir eklenmedi. İlk devir belgeyi oluşturandan 01&apos;e, sonrakiler 01→02, 02→03, 03→04 biçiminde
              önerilir.
            </p>
          ) : (
            <ol className="handoff-editor">
              {draft.handoffs.map((handoff, index) =>
                // Kaydedilmiş devirler geçmiştir: bu ekrandan değiştirilemez
                // veya silinemez; sunucu da güncellemede onları yok sayar.
                handoff.id ? (
                  <li key={handoff.key} className="handoff-locked">
                    <span className="handoff-index">{index + 1}</span>
                    <div>
                      <strong>
                        {roleLabel(handoff.fromRole)} ({handoff.fromName}) → {roleLabel(handoff.toRole)} (
                        {handoff.toName})
                      </strong>
                      <small>Kayıtlı devir · değiştirilemez</small>
                      {handoff.note ? <p>{handoff.note}</p> : null}
                    </div>
                  </li>
                ) : (
                <li key={handoff.key}>
                  <span className="handoff-index">{index + 1}</span>
                  <div className="handoff-fields">
                    <label className="field">
                      <span className="field-label">Gönderen rol</span>
                      <select
                        value={handoff.fromRole}
                        onChange={(event) => patchHandoff(handoff.key, { fromRole: event.target.value as FlowActorRole })}
                      >
                        <option value="author">Belgeyi oluşturan</option>
                        {ROLES.map((role) => (
                          <option key={role.code} value={role.code}>
                            {role.code} · {role.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">Gönderen kişi</span>
                      <input
                        value={handoff.fromName}
                        onChange={(event) => patchHandoff(handoff.key, { fromName: event.target.value })}
                        list={`names-${handoff.fromRole}`}
                        required
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Alıcı rol</span>
                      <select
                        value={handoff.toRole}
                        onChange={(event) => patchHandoff(handoff.key, { toRole: event.target.value as RoleCode })}
                      >
                        {ROLES.map((role) => (
                          <option key={role.code} value={role.code}>
                            {role.code} · {role.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">Alıcı kişi</span>
                      <input
                        value={handoff.toName}
                        onChange={(event) => patchHandoff(handoff.key, { toName: event.target.value })}
                        list={`names-${handoff.toRole}`}
                        required
                      />
                      <span className="field-hint">Sistemde kayıtlı ve aktif bir hesap olmalıdır.</span>
                    </label>
                    <label className="field handoff-note">
                      <span className="field-label">Ne yapıldı / not</span>
                      <input
                        value={handoff.note ?? ""}
                        onChange={(event) => patchHandoff(handoff.key, { note: event.target.value })}
                        placeholder="Ör. Format düzeltmeleri tamamlandı"
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Devir tarihi</span>
                      <input
                        type="date"
                        value={(handoff.handedAt ?? "").slice(0, 10)}
                        onChange={(event) =>
                          patchHandoff(handoff.key, {
                            handedAt: event.target.value ? new Date(event.target.value).toISOString() : "",
                          })
                        }
                      />
                      <span className="field-hint">Boş bırakılırsa kayıt anı yazılır.</span>
                    </label>
                  </div>
                  <button type="button" className="text-button" onClick={() => removeHandoff(handoff.key)}>
                    Kaldır
                  </button>
                </li>
                ),
              )}
            </ol>
          )}

          {ROLES.map((role) => (
            <datalist key={role.code} id={`names-${role.code}`}>
              {(namesByRole.get(role.code) ?? []).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          ))}
          <datalist id="names-author">
            <option value={draft.authorName} />
          </datalist>

          <button type="button" className="secondary-button" style={{ marginTop: 16 }} onClick={addHandoff}>
            Devir ekle
          </button>
        </fieldset>

        <fieldset>
          <legend>
            <span>3</span>04 · Nihai belge
          </legend>
          <label className="field">
            <span className="field-label">04 ne yaptı</span>
            <textarea
              value={draft.finalNote}
              onChange={(event) => patch({ finalNote: event.target.value })}
              placeholder="Nihai onay aşamasında yapılan düzeltmeler"
            />
          </label>
          <label className="field" style={{ marginTop: 18 }}>
            <span className="field-label">En son güncel belge</span>
            <input
              value={draft.finalDocument}
              onChange={(event) => patch({ finalDocument: event.target.value })}
              placeholder="Dosya adı veya bağlantı — ör. elektrikli_arac_KTR_v4_final.pdf"
            />
            <span className="field-hint">Belge değiştiğinde güncelleme damgası yenilenir.</span>
          </label>
        </fieldset>

        {error ? <p className="admin-error">{error}</p> : null}

        <div className="form-actions">
          {editingId ? (
            <button type="button" className="text-button" onClick={cancelEdit}>
              Düzenlemeden çık
            </button>
          ) : (
            <span className="save-note">Kayıt yönetici veri tabanına yazılır.</span>
          )}
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? "Kaydediliyor…" : editingId ? "Kaydı güncelle" : "Belge akışını kaydet"}
          </button>
        </div>
      </form>
      )}

      <div className="admin-list">
        <div className="sample-library-heading">
          <div>
            <h2>Kayıtlı belge akışları</h2>
            <p>Yarışmaya göre gruplanır; her kayıt oluşturandan 04&apos;e kadar zinciri gösterir.</p>
          </div>
          <span>{grouped.length} yarışma</span>
        </div>

        {flows.length === 0 ? (
          <p className="empty-note">Henüz belge akışı kaydedilmedi.</p>
        ) : (
          grouped.map(([competition, list]) => (
            <div key={competition} className="flow-group">
              <h3>{competition}</h3>
              {list.map((flow) => (
                <article key={flow.id} className="flow-card">
                  <header>
                    <div>
                      <strong>{flow.title || "Başlıksız belge"}</strong>
                      <small>
                        Belgeyi oluşturan: {flow.authorName} · Kayıt: {formatDateTime(flow.createdAt)}
                      </small>
                    </div>
                    <div className="flow-card-actions">
                      <span className={`status-chip ${flow.status === "completed" ? "success" : "neutral"}`}>
                        {flow.status === "completed" ? "Tamamlandı" : "Devam ediyor"}
                      </span>
                      {readOnly ? null : (
                        <>
                          <button type="button" className="text-button" onClick={() => startEdit(flow)}>
                            Düzenle
                          </button>
                          <button
                            type="button"
                            className="text-button danger"
                            disabled={deletingId === flow.id}
                            onClick={() => remove(flow.id)}
                          >
                            {deletingId === flow.id ? "Siliniyor…" : "Sil"}
                          </button>
                        </>
                      )}
                    </div>
                  </header>

                  <p className="flow-summary">{flow.summary}</p>

                  {flow.handoffs.length === 0 ? (
                    <p className="empty-note">Devir kaydı yok.</p>
                  ) : (
                    <ol className="flow-chain">
                      {flow.handoffs.map((handoff) => (
                        <li key={handoff.id}>
                          <span className="chain-mark">{handoff.order}</span>
                          <div>
                            <strong>
                              {roleLabel(handoff.fromRole)} ({handoff.fromName}) → {roleLabel(handoff.toRole)} (
                              {handoff.toName})
                            </strong>
                            <small>{formatDateTime(handoff.handedAt)}</small>
                            {handoff.note ? <p>{handoff.note}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}

                  <div className="flow-final">
                    <span className="section-kicker">04 · En son güncel hâli</span>
                    {flow.finalNote ? <p>{flow.finalNote}</p> : <p className="muted-note">04 notu girilmedi.</p>}
                    {flow.finalDocument ? (
                      <strong>
                        {flow.finalDocument}
                        <small> · {formatDateTime(flow.finalUpdatedAt)}</small>
                      </strong>
                    ) : (
                      <p className="muted-note">Nihai belge henüz kaydedilmedi.</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
