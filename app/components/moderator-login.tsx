"use client";

import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-client";
import type { BootstrapStatus } from "../lib/admin-client";
import type { AdminAccount } from "../lib/admin-types";

/**
 * Yönetici girişi ve ilk kurulum ekranı.
 *
 * Kurulum sekmesi yalnızca veri tabanında hiç hesap yokken ve sunucuda
 * kurulum anahtarı tanımlıyken görünür; kararı sunucu verir.
 */

type Props = { onSignedIn: (account: AdminAccount) => void | Promise<void> };

export default function ModeratorLogin({ onSignedIn }: Props) {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ email: string; oneTimePassword: string } | null>(null);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const value = await adminApi.bootstrapStatus();
        if (!active) return;
        setStatus(value);
        if (value.required && value.tokenConfigured) setMode("bootstrap");
      } catch {
        // Durum okunamazsa yalnızca giriş formu gösterilir.
      }
    }
    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await adminApi.login(email.trim(), password);
      await onSignedIn(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function submitBootstrap(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await adminApi.bootstrap({ token: token.trim(), fullName: fullName.trim(), email: email.trim() });
      setCreated({ email: result.account.email, oneTimePassword: result.oneTimePassword });
      setStatus((current) => (current ? { ...current, required: false } : current));
      setMode("login");
      setToken("");
      setFullName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kurulum tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.authConfigured) {
    return (
      <main className="key-gate">
        <div className="login-card">
          <span className="section-kicker">Rol 00 · Moderatör</span>
          <h1>Yönetim devre dışı</h1>
          <p>
            Sunucuda <code>MODERATOR_SECRET</code> tanımlı değil. Güvenlik gereği yönetici uçları açık bırakılmaz;
            anahtar tanımlanana kadar tüm istekler reddedilir.
          </p>
        </div>
      </main>
    );
  }

  const canBootstrap = Boolean(status?.required && status?.tokenConfigured);

  return (
    <main className="key-gate">
      <div className="login-card">
        <span className="section-kicker">Rol 00 · Moderatör</span>
        <h1>{mode === "bootstrap" ? "İlk moderatör hesabı" : "Yönetici girişi"}</h1>

        {created ? (
          <div className="credential-secret login-secret">
            <div>
              <span className="field-label">{created.email} · tek kullanımlık şifre</span>
              <code>{created.oneTimePassword}</code>
            </div>
          </div>
        ) : null}

        {mode === "bootstrap" ? (
          <form onSubmit={submitBootstrap}>
            <p>
              Veri tabanında hesap yok. Sunucudaki kurulum anahtarıyla ilk Rol 00 hesabını açın; kurulum sonrası
              <code>MODERATOR_BOOTSTRAP_TOKEN</code> değişkenini boşaltın.
            </p>
            <label className="field">
              <span className="field-label">Kurulum anahtarı</span>
              <input type="password" value={token} onChange={(event) => setToken(event.target.value)} required autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">İsim Soyisim</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} required autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">E-posta</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="off" />
            </label>
            {error ? <p className="admin-error">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Kuruluyor…" : "Moderatör hesabını oluştur"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitLogin}>
            <p>E-posta adresiniz ve size iletilen şifreyle giriş yapın.</p>
            <label className="field">
              <span className="field-label">E-posta</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span className="field-label">Şifre</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            {error ? <p className="admin-error">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Giriş yapılıyor…" : "Giriş yap"}
            </button>
          </form>
        )}

        {canBootstrap ? (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setError("");
              setMode(mode === "bootstrap" ? "login" : "bootstrap");
            }}
          >
            {mode === "bootstrap" ? "Girişe dön" : "İlk kurulumu yap"}
          </button>
        ) : null}
      </div>
    </main>
  );
}
