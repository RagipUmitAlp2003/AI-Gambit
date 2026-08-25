"use client";

import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-client";
import type { BootstrapStatus } from "../lib/admin-client";
import { ROLES } from "../lib/admin-roles";
import type { AdminAccount, RoleCode } from "../lib/admin-types";
import { workflowApi } from "../lib/workflow-client";

type Props = { onSignedIn: (account: AdminAccount) => void | Promise<void> };
type Audience = "admin" | "participant";

const QUICK_ROLES = ROLES.filter((role) => role.code !== "03");

export default function AccessLogin({ onSignedIn }: Props) {
  const [audience, setAudience] = useState<Audience>("admin");
  const [selectedRole, setSelectedRole] = useState<RoleCode>("00");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [bootstrap, setBootstrap] = useState({ token: "", fullName: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [participantMode, setParticipantMode] = useState<"login" | "register">("login");
  const [participantName, setParticipantName] = useState("");

  useEffect(() => {
    let active = true;
    adminApi.bootstrapStatus()
      .then((value) => { if (active) setStatus(value); })
      .catch(() => { /* Giriş seçenekleri çalışmaya devam eder. */ });
    return () => { active = false; };
  }, []);

  async function quickLogin() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await adminApi.devLogin(selectedRole);
      await onSignedIn(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hızlı giriş tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function realLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await adminApi.login(email.trim(), password);
      await onSignedIn(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function participantLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await adminApi.login(email.trim(), password);
      if (result.account.roleCode !== "03") {
        await adminApi.logout();
        throw new Error("Bu hesap yarışmacı hesabı değil. Yönetici girişini kullanın.");
      }
      await onSignedIn(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Yarışmacı girişi yapılamadı.");
    } finally { setBusy(false); }
  }

  async function participantRegister(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await workflowApi.registerParticipant(participantName.trim(), email.trim(), password);
      await onSignedIn(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Yarışmacı hesabı oluşturulamadı.");
    } finally { setBusy(false); }
  }

  async function participantQuickLogin() {
    setBusy(true);
    setError("");
    try { await onSignedIn((await adminApi.devLogin("03")).account); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Deneme girişi tamamlanamadı."); }
    finally { setBusy(false); }
  }

  async function createFirstAdmin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await adminApi.bootstrap({
        token: bootstrap.token.trim(),
        fullName: bootstrap.fullName.trim(),
        email: bootstrap.email.trim(),
      });
      setNotice(`Baş Yönetici hesabı oluşturuldu. Tek kullanımlık şifre: ${result.oneTimePassword}`);
      setStatus((current) => current ? { ...current, required: false } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "İlk hesap oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  const chosen = QUICK_ROLES.find((role) => role.code === selectedRole) ?? QUICK_ROLES[0];

  return (
    <main className="access-page">
      <section className="access-story" aria-labelledby="access-story-title">
        <div className="access-brand">
          <span className="access-brand-mark">T3</span>
          <span>Kriter Atölyesi</span>
        </div>
        <div className="access-story-copy">
          <span className="section-kicker">Yapay zekâ destekli değerlendirme sistemi</span>
          <h1 id="access-story-title">Her görevli, yalnızca kendi karar alanında.</h1>
          <p>
            Kriter hazırlama, hakem değerlendirmesi ve operasyon takibi tek yönetim alanında birleşir.
            Yapay zekâ kanıt sunar; nihai karar yetkili kullanıcıda kalır.
          </p>
        </div>
        <div className="access-principle">
          <strong>Yetki görünür, karar izlenebilir.</strong>
          <span>Oturum ve rol bilgileri yönetici veri tabanında saklanır.</span>
        </div>
      </section>

      <section className="access-panel" aria-labelledby="access-title">
        <div className="audience-switch" role="tablist" aria-label="Giriş türü">
          <button
            type="button"
            role="tab"
            aria-selected={audience === "admin"}
            className={audience === "admin" ? "active" : ""}
            onClick={() => { setAudience("admin"); setError(""); }}
          >
            Yönetici
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={audience === "participant"}
            className={audience === "participant" ? "active" : ""}
            onClick={() => { setAudience("participant"); setError(""); }}
          >
            Yarışmacı
          </button>
        </div>

        {audience === "participant" ? (
          <div className="participant-entry">
            <header>
              <span className="section-kicker">Yarışmacı portalı</span>
              <h2 id="access-title">Başvurularına eriş</h2>
              <p>Yarışma seçin, PDF raporunuzu gönderin ve hakem onaylı sonucunu takip edin.</p>
            </header>
            <div className="participant-mode-switch" role="tablist" aria-label="Yarışmacı hesap işlemi">
              <button type="button" role="tab" aria-selected={participantMode === "login"} className={participantMode === "login" ? "active" : ""} onClick={() => { setParticipantMode("login"); setError(""); }}>Giriş yap</button>
              <button type="button" role="tab" aria-selected={participantMode === "register"} className={participantMode === "register" ? "active" : ""} onClick={() => { setParticipantMode("register"); setError(""); }}>Hesap oluştur</button>
            </div>
            <form className="participant-login-form" onSubmit={participantMode === "login" ? participantLogin : participantRegister}>
              {participantMode === "register" ? <label className="field"><span className="field-label">İsim Soyisim</span><input value={participantName} onChange={(event) => setParticipantName(event.target.value)} autoComplete="name" required /></label> : null}
              <label className="field"><span className="field-label">E-posta</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
              <label className="field"><span className="field-label">Şifre</span><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={participantMode === "register" ? "new-password" : "current-password"} required /></label>
              {error ? <p className="admin-error login-feedback">{error}</p> : null}
              <button type="submit" className="primary-button" disabled={busy}>{busy ? "İşlem yapılıyor…" : participantMode === "login" ? "Yarışmacı olarak giriş yap" : "Hesabımı oluştur"}</button>
            </form>
            <div className="participant-demo-entry"><span>Yerel deneme</span><button type="button" className="secondary-button" disabled={busy} onClick={participantQuickLogin}>Şifresiz yarışmacı girişi</button></div>
          </div>
        ) : (
          <div className="admin-entry">
            <header>
              <span className="section-kicker">Yerel geliştirme girişi</span>
              <h2 id="access-title">Yönetim alanına gir</h2>
              <p>Şimdilik kullanıcı adı ve şifre gerekmeden denemek istediğiniz rolü seçin.</p>
            </header>

            <div className="quick-role-list" role="radiogroup" aria-label="Hızlı giriş rolü">
              {QUICK_ROLES.map((role) => (
                <button
                  key={role.code}
                  type="button"
                  role="radio"
                  aria-checked={selectedRole === role.code}
                  className={selectedRole === role.code ? "selected" : ""}
                  onClick={() => setSelectedRole(role.code)}
                >
                  <span>{role.code}</span>
                  <strong>{role.shortTitle}</strong>
                  <small>{role.area}</small>
                </button>
              ))}
            </div>

            <div className="chosen-role-summary" aria-live="polite">
              <span>{chosen.code}</span>
              <div>
                <strong>{chosen.title}</strong>
                <p>{chosen.summary}</p>
              </div>
            </div>

            {error ? <p className="admin-error login-feedback">{error}</p> : null}
            {notice ? <p className="success-note login-feedback">{notice}</p> : null}

            <button type="button" className="primary-button quick-login-button" disabled={busy} onClick={quickLogin}>
              {busy ? "Giriş hazırlanıyor…" : `${chosen.shortTitle} olarak giriş yap`}
            </button>
            <p className="development-note">
              Bu şifresiz kısayol yalnızca geliştirme ortamında çalışır ve üretimde otomatik olarak kapanır.
            </p>

            <details className="real-login-disclosure">
              <summary>Gerçek yönetici hesabıyla giriş</summary>
              <form onSubmit={realLogin}>
                <label className="field">
                  <span className="field-label">E-posta</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
                </label>
                <label className="field">
                  <span className="field-label">Şifre</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                </label>
                <button type="submit" className="secondary-button" disabled={busy}>Güvenli giriş yap</button>
              </form>
            </details>

            {status?.required && status.tokenConfigured ? (
              <details className="real-login-disclosure setup-disclosure">
                <summary>İlk Baş Yönetici hesabını oluştur</summary>
                <form onSubmit={createFirstAdmin}>
                  <label className="field">
                    <span className="field-label">Kurulum anahtarı</span>
                    <input type="password" value={bootstrap.token} onChange={(event) => setBootstrap({ ...bootstrap, token: event.target.value })} required />
                  </label>
                  <label className="field">
                    <span className="field-label">İsim Soyisim</span>
                    <input value={bootstrap.fullName} onChange={(event) => setBootstrap({ ...bootstrap, fullName: event.target.value })} required />
                  </label>
                  <label className="field">
                    <span className="field-label">E-posta</span>
                    <input type="email" value={bootstrap.email} onChange={(event) => setBootstrap({ ...bootstrap, email: event.target.value })} required />
                  </label>
                  <button type="submit" className="secondary-button" disabled={busy}>İlk hesabı oluştur</button>
                </form>
              </details>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
