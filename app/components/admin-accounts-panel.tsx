"use client";

import { useState } from "react";
import { adminApi, formatDateTime } from "../lib/admin-client";
import type { RoleDefinition } from "../lib/admin-roles";
import type { AdminAccount, CreateAccountResult, MailDelivery, RoleCode } from "../lib/admin-types";

/**
 * Kısım 1 — Yönetici atama paneli.
 * Hesap açar, rolü değiştirir, rolü kaldırır ve gönderilen bildirimleri gösterir.
 */

type Props = {
  accounts: AdminAccount[];
  roles: RoleDefinition[];
  mailReady: boolean;
  mail: MailDelivery[];
  /** Oturumdaki hesabın kimliği; kendi satırını işaretlemek için. */
  viewerId: string;
  onChanged: () => Promise<void>;
};

type FormState = {
  fullName: string;
  email: string;
  roleCode: RoleCode;
  autoPassword: boolean;
  password: string;
};

const EMPTY_FORM: FormState = {
  fullName: "",
  email: "",
  roleCode: "01",
  autoPassword: true,
  password: "",
};

function roleTitle(roles: RoleDefinition[], code: RoleCode): string {
  return roles.find((role) => role.code === code)?.title ?? code;
}

function mailStatusLabel(mail: MailDelivery): { text: string; tone: string } {
  if (mail.status === "sent") return { text: "E-posta gönderildi", tone: "success" };
  if (mail.status === "queued") return { text: "Giden kutusunda bekliyor", tone: "warning" };
  return { text: "Gönderim başarısız", tone: "danger" };
}

export default function AdminAccountsPanel({ accounts, roles, mailReady, mail, viewerId, onChanged }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [created, setCreated] = useState<CreateAccountResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const [showOutbox, setShowOutbox] = useState(false);

  const activeCount = accounts.filter((account) => account.status === "active").length;

  function patch(update: Partial<FormState>) {
    setForm((current) => ({ ...current, ...update }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setCreating(true);
    try {
      const result = await adminApi.createAccount({
        fullName: form.fullName,
        email: form.email,
        roleCode: form.roleCode,
        ...(form.autoPassword ? {} : { password: form.password }),
      });
      setCreated(result);
      setCopied(false);
      setForm(EMPTY_FORM);
      await onChanged();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Hesap oluşturulamadı.");
    } finally {
      setCreating(false);
    }
  }

  async function runRowAction(id: string, action: () => Promise<unknown>) {
    setPendingId(id);
    setRowError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "İşlem tamamlanamadı." });
      return false;
    } finally {
      setPendingId(null);
    }
  }

  async function copyPassword(password: string) {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="workspace" aria-labelledby="accounts-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Kısım 1 · Rol atayıcı</span>
          <h1 id="accounts-title">Yönetici atama paneli</h1>
          <p>
            Atanacak kişinin bilgilerini girin. Sistem 8 haneli tek kullanımlık şifreyi üretir, hesabı yönetici veri
            tabanına kaydeder ve rol bilgisini içeren bildirimi e-posta adresine gönderir.
          </p>
        </div>
        <span className="step-fraction">{activeCount} aktif hesap</span>
      </div>

      <form className="setup-form" onSubmit={submit}>
        <fieldset>
          <legend>
            <span>1</span>Hesap bilgileri
          </legend>
          <div className="form-grid two-col">
            <label className="field">
              <span className="field-label">İsim Soyisim</span>
              <input
                value={form.fullName}
                onChange={(event) => patch({ fullName: event.target.value })}
                placeholder="Ör. Umut Yılmaz"
                autoComplete="off"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">E-posta</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => patch({ email: event.target.value })}
                placeholder="ornek@kurum.org"
                autoComplete="off"
                required
              />
              <span className="field-hint">Hesap bilgileri ve rol bu adrese gönderilir.</span>
            </label>
          </div>

          <div className="form-grid two-col" style={{ marginTop: 18 }}>
            <label className="field">
              <span className="field-label">Rol numarası</span>
              <select value={form.roleCode} onChange={(event) => patch({ roleCode: event.target.value as RoleCode })}>
                {roles
                  .filter((role) => role.assignable)
                  .map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.code} · {role.title}
                    </option>
                  ))}
              </select>
              <span className="field-hint">{roles.find((role) => role.code === form.roleCode)?.summary}</span>
            </label>
            <div className="field">
              <span className="field-label">Atamayı yapan</span>
              <div className="fixed-value">
                <span>OTURUM</span>
                <small>Kayıt izine oturumdaki hesap yazılır</small>
              </div>
              <span className="field-hint">İstemciden gelen değer kabul edilmez.</span>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <span>2</span>Tek kullanımlık şifre
          </legend>
          <div className="password-choice">
            <label className={`action-option ${form.autoPassword ? "selected" : ""}`}>
              <input
                type="radio"
                name="password-mode"
                checked={form.autoPassword}
                onChange={() => patch({ autoPassword: true, password: "" })}
              />
              <span className="radio-mark" />
              <span>
                <strong>Sistem oluştursun</strong>
                <small>8 haneli, karışabilen karakterler dışarıda bırakılmış rastgele şifre üretilir.</small>
              </span>
            </label>
            <label className={`action-option ${form.autoPassword ? "" : "selected"}`}>
              <input
                type="radio"
                name="password-mode"
                checked={!form.autoPassword}
                onChange={() => patch({ autoPassword: false })}
              />
              <span className="radio-mark" />
              <span>
                <strong>Kendim gireyim</strong>
                <small>En az 8 karakter. Yine tek kullanımlık kabul edilir.</small>
              </span>
            </label>
          </div>

          {!form.autoPassword ? (
            <label className="field" style={{ marginTop: 16, maxWidth: 320 }}>
              <span className="field-label">Şifre</span>
              <input
                value={form.password}
                onChange={(event) => patch({ password: event.target.value })}
                minLength={8}
                required
                autoComplete="off"
              />
            </label>
          ) : null}

          <p className="field-hint" style={{ marginTop: 14 }}>
            Şifre veri tabanında yalnızca PBKDF2 özeti olarak tutulur. Açık hâli bir kez, hesap oluşturulduktan hemen
            sonra bu ekranda gösterilir.
          </p>
        </fieldset>

        {formError ? <p className="admin-error">{formError}</p> : null}

        <div className="form-actions">
          <span className="save-note">
            {mailReady
              ? "Mail sağlayıcı tanımlı: bildirim doğrudan gönderilir."
              : "Mail sağlayıcı tanımlı değil: bildirim giden kutusuna alınır ve aşağıda görünür."}
          </span>
          <button className="primary-button" type="submit" disabled={creating}>
            {creating ? "Oluşturuluyor…" : "Hesap oluştur"}
          </button>
        </div>
      </form>

      {created ? (
        <div className="credential-card">
          <div className="credential-head">
            <div>
              <span className="section-kicker">Hesap oluşturuldu</span>
              <strong>
                {created.account.fullName} · {created.account.roleCode} · {roleTitle(roles, created.account.roleCode)}
              </strong>
              <p>{created.account.email}</p>
            </div>
            <button type="button" className="text-button" onClick={() => setCreated(null)}>
              Kapat
            </button>
          </div>
          <div className="credential-secret">
            <div>
              <span className="field-label">Tek kullanımlık şifre</span>
              <code>{created.oneTimePassword}</code>
            </div>
            <button type="button" className="secondary-button" onClick={() => copyPassword(created.oneTimePassword)}>
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
          <p className="credential-note">
            Bu şifre bir daha gösterilmez. {mailStatusLabel(created.mail).text}
            {created.mail.error ? ` — ${created.mail.error}` : ""}
          </p>
        </div>
      ) : null}

      <div className="admin-list">
        <div className="sample-library-heading">
          <div>
            <h2>Kayıtlı yönetici hesapları</h2>
            <p>Rol değiştirme, rol kaldırma ve kalıcı silme işlemleri buradan yapılır.</p>
          </div>
          <span>{accounts.length} kayıt</span>
        </div>

        {accounts.length === 0 ? (
          <p className="empty-note">Henüz hesap oluşturulmadı.</p>
        ) : (
          <div className="admin-table" role="table">
            <div className="admin-row admin-row-head" role="row">
              <span role="columnheader">Kişi</span>
              <span role="columnheader">Rol</span>
              <span role="columnheader">Durum</span>
              <span role="columnheader">İşlem</span>
            </div>
            {accounts.map((account) => {
              const busy = pendingId === account.id;
              const error = rowError?.id === account.id ? rowError : null;
              const confirming = removing?.id === account.id;
              return (
                <div key={account.id} className={`admin-row ${account.status === "revoked" ? "revoked" : ""}`} role="row">
                  <span role="cell">
                    <strong>
                      {account.fullName}
                      {account.id === viewerId ? <span className="self-badge">bu sizsiniz</span> : null}
                    </strong>
                    <small>{account.email}</small>
                    <small>Oluşturma: {formatDateTime(account.createdAt)}</small>
                    {account.createdBy ? <small>Atayan: {account.createdBy}</small> : null}
                  </span>
                  <span role="cell">
                    {roles.find((role) => role.code === account.roleCode)?.assignable === false ? (
                      // Yarışmacı hesabı yönetici rolüne çevrilmez; kendi kaydıyla açılır.
                      <>
                        <span className="fixed-value"><span>{account.roleCode}</span><small>{roleTitle(roles, account.roleCode)}</small></span>
                        <small>Yarışmacı rolü yönetici rolüne çevrilemez.</small>
                      </>
                    ) : (
                      <>
                        <select
                          value={account.roleCode}
                          disabled={busy}
                          onChange={(event) =>
                            runRowAction(account.id, () => adminApi.changeRole(account.id, event.target.value as RoleCode))
                          }
                          aria-label={`${account.fullName} rolü`}
                        >
                          {roles.filter((role) => role.assignable).map((role) => (
                            <option key={role.code} value={role.code}>
                              {role.code} · {role.title}
                            </option>
                          ))}
                        </select>
                        {account.status === "revoked" ? (
                          <small>Rol seçimi hesabı yeniden aktifleştirir.</small>
                        ) : null}
                      </>
                    )}
                  </span>
                  <span role="cell">
                    <span className={`status-chip ${account.status === "active" ? "success" : "neutral"}`}>
                      {account.status === "active" ? "Aktif" : "Rolü kaldırıldı"}
                    </span>
                    {account.status === "active" && account.mustChangePassword ? (
                      <small>Tek kullanımlık şifre henüz değiştirilmedi.</small>
                    ) : null}
                    {account.status === "revoked" ? (
                      <small>
                        {formatDateTime(account.revokedAt)}
                        {account.revokedReason ? ` · ${account.revokedReason}` : ""}
                      </small>
                    ) : null}
                  </span>
                  <span role="cell" className="admin-actions">
                    {account.status === "active" ? (
                      confirming ? (
                        <div className="remove-confirm">
                          <input
                            value={removing.reason}
                            onChange={(event) => setRemoving({ id: account.id, reason: event.target.value })}
                            placeholder="Gerekçe (opsiyonel)"
                            aria-label="Rol kaldırma gerekçesi"
                          />
                          <div>
                            <button
                              type="button"
                              className="danger-button"
                              disabled={busy}
                              onClick={async () => {
                                const done = await runRowAction(account.id, () =>
                                  adminApi.revokeAccount(account.id, removing.reason),
                                );
                                if (done) setRemoving(null);
                              }}
                            >
                              Rolü kaldır
                            </button>
                            <button type="button" className="text-button" onClick={() => setRemoving(null)}>
                              Vazgeç
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setRemoving({ id: account.id, reason: "" })}
                        >
                          Rolü kaldır
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        className="danger-button"
                        disabled={busy}
                        onClick={() => runRowAction(account.id, () => adminApi.purgeAccount(account.id))}
                      >
                        Kalıcı sil
                      </button>
                    )}
                    {error ? <small className="admin-error">{error.message}</small> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="admin-list">
        <div className="sample-library-heading">
          <div>
            <h2>Bildirim kayıtları</h2>
            <p>
              {mailReady
                ? "Sağlayıcı tanımlı; bu liste gönderim geçmişidir."
                : "Sağlayıcı tanımlı olmadığı için bildirimler burada bekletilir. Gövdelerde şifre maskelidir."}
            </p>
          </div>
          <button type="button" className="text-button" onClick={() => setShowOutbox((value) => !value)}>
            {showOutbox ? "Gizle" : `Göster (${mail.length})`}
          </button>
        </div>

        {showOutbox ? (
          mail.length === 0 ? (
            <p className="empty-note">Henüz bildirim üretilmedi.</p>
          ) : (
            <ul className="outbox-list">
              {mail.map((item) => {
                const label = mailStatusLabel(item);
                return (
                  <li key={item.id}>
                    <div>
                      <strong>{item.subject}</strong>
                      <small>
                        {item.toEmail} · {formatDateTime(item.createdAt)}
                      </small>
                    </div>
                    <span className={`status-chip ${label.tone === "success" ? "success" : "neutral"}`}>{label.text}</span>
                    <pre>{item.body}</pre>
                    {item.error ? <small className="admin-error">{item.error}</small> : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
