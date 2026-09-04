"use client";

import { useState } from "react";
import { adminApi } from "../lib/admin-client";
import type { AdminAccount } from "../lib/admin-types";
import T3Lockup from "./t3-lockup";

type Props = {
  account: AdminAccount;
  onChanged: (account: AdminAccount) => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
};

/**
 * Zorunlu parola değişim ekranı (madde 10 · must_change_password gerçek akışı).
 *
 * Geçici şifreyle açılan hesap, ilk girişte panele geçmeden önce bu ekrana
 * yönlendirilir: eski (geçici) şifre sunucuda doğrulanır, yeni şifre politika
 * kontrolünden geçer, başarılı değişimde bayrak temizlenir ve hesabın diğer
 * oturumları iptal edilir (bkz. app/api/admin/password/route.ts). Mevcut
 * oturum korunur; kullanıcı ekrandan atılmaz.
 */
export default function PasswordChangeGate({ account, onChanged, onSignOut }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== repeatPassword) {
      setError("Yeni şifre iki alana da aynı yazılmalıdır.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await adminApi.changePassword(currentPassword, newPassword);
      await onChanged(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Şifre değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="password-gate-page">
      <div className="password-gate-shell">
        <T3Lockup className="password-gate-logo" />
        <section className="password-gate-card" aria-labelledby="password-gate-title">
          <div className="admin-entry">
            <header>
              <span className="section-kicker">Güvenlik adımı</span>
              <h2 id="password-gate-title">Geçici şifrenizi değiştirin</h2>
              <p>
                {account.fullName}, hesabınız geçici bir şifreyle açıldı. Panele geçmeden önce
                kendi şifrenizi belirlemeniz gerekiyor; eski şifreniz bir daha kullanılamaz.
              </p>
            </header>

            <form className="signin-form" onSubmit={submit}>
              <label className="field">
                <span className="field-label">Mevcut (geçici) şifre</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Yeni şifre (en az 8 karakter)</span>
                <input
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Yeni şifre (tekrar)</span>
                <input
                  type="password"
                  minLength={8}
                  value={repeatPassword}
                  onChange={(event) => setRepeatPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              {error ? <p className="admin-error login-feedback" role="alert">{error}</p> : null}
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "Şifre değiştiriliyor…" : "Şifreyi değiştir ve devam et"}
              </button>
            </form>

            <p className="page-note">
              Şifrenizi şimdi değiştirmek istemiyorsanız{" "}
              <button type="button" className="text-button" onClick={() => onSignOut()}>çıkış yapın</button>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
