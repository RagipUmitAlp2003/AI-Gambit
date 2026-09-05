"use client";

import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-client";
import type { BootstrapStatus } from "../lib/admin-client";
import type { AdminAccount } from "../lib/admin-types";
import { workflowApi } from "../lib/workflow-client";
import {
  DEMO_INSTITUTIONS,
  DISCOVERY_SOURCE_LABELS,
  DISCOVERY_SOURCE_VALUES,
  EDUCATION_GRADE_OPTIONS,
  EDUCATION_STATUS_LABELS,
  EDUCATION_STATUS_VALUES,
  GENDER_LABELS,
  GENDER_VALUES,
  TEKNOFEST_HISTORY_LABELS,
  TEKNOFEST_HISTORY_VALUES,
  TURKEY_CITIES,
  validateParticipantProfileInput,
} from "../lib/participant-profile";
import SearchSelect from "./search-select";
import T3Lockup from "./t3-lockup";

type Props = { onSignedIn: (account: AdminAccount) => void | Promise<void> };
type Panel = "signin" | "register";

/**
 * Giriş ekranı (madde 7).
 *
 * TEK giriş formu vardır: kullanıcı adı (veya e-posta) + şifre. Rol seçimi ve
 * şifresiz rol kısayolları KALDIRILDI. Sistem hesabı veri tabanından doğrular
 * ve rolüne göre doğru paneli otomatik açar (bkz. management-app · ManagementApp).
 *
 * Yarışmacılar da aynı formdan girer; hesabı olmayan yarışmacı ikinci
 * sekmeden kendi kaydını açar.
 */
export default function AccessLogin({ onSignedIn }: Props) {
  const [panel, setPanel] = useState<Panel>("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [bootstrap, setBootstrap] = useState({ token: "", fullName: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerProfile, setRegisterProfile] = useState({
    educationStatus: "",
    educationGrade: "",
    institutionName: "",
    city: "",
    gender: "",
    discoverySource: "",
    teknofestHistory: "",
  });

  useEffect(() => {
    let active = true;
    adminApi.bootstrapStatus()
      .then((value) => { if (active) setStatus(value); })
      .catch(() => { /* Giriş formu her hâlükârda çalışır. */ });
    return () => { active = false; };
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Rol GÖNDERİLMEZ: sunucu hesabın rolünü kendisi okur ve panel ona göre açılır.
      const result = await adminApi.login(identifier.trim(), password);
      await onSignedIn(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function registerParticipant(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const validation = validateParticipantProfileInput(registerProfile);
      if (!validation.ok) {
        setError(validation.error);
        return;
      }
      const result = await workflowApi.registerParticipant(
        registerName.trim(),
        registerEmail.trim(),
        registerPassword,
        validation.value,
      );
      await onSignedIn(result.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Yarışmacı hesabı oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  /** Geliştirme/demo kurulumu: `admin` / `1234`. İkinci çağrıda yeni hesap açmaz. */
  async function createDevAdmin() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await adminApi.bootstrapDevAdmin();
      setIdentifier(result.username);
      setNotice(result.created
        ? `Bootstrap Admin hesabı oluşturuldu. Kullanıcı adı: ${result.username} · geçici şifre: ${result.oneTimePassword}. ${result.warning}`
        : result.warning);
      setStatus((current) => current ? { ...current, required: false, devBootstrapAvailable: false } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kurulum hesabı oluşturulamadı.");
    } finally {
      setBusy(false);
    }
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
      setNotice(`Admin hesabı oluşturuldu. Tek kullanımlık şifre: ${result.oneTimePassword}`);
      setStatus((current) => current ? { ...current, required: false } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "İlk hesap oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

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
        <T3Lockup className="access-hero-logo" />
        <div className="access-principle">
          <strong>Yetki görünür, karar izlenebilir.</strong>
          <span>Rolünüz hesabınıza bağlıdır; giriş sırasında rol seçilmez.</span>
        </div>
      </section>

      <section className="access-panel" aria-labelledby="access-title">
        <div className="audience-switch" role="tablist" aria-label="Giriş türü">
          <button
            type="button"
            role="tab"
            aria-selected={panel === "signin"}
            className={panel === "signin" ? "active" : ""}
            onClick={() => { setPanel("signin"); setError(""); }}
          >
            Giriş yap
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panel === "register"}
            className={panel === "register" ? "active" : ""}
            onClick={() => { setPanel("register"); setError(""); }}
          >
            Yarışmacı kaydı
          </button>
        </div>

        {panel === "signin" ? (
          <div className="admin-entry">
            <header>
              <span className="section-kicker">Hesap girişi</span>
              <h2 id="access-title">Kullanıcı adınız ve şifrenizle girin</h2>
              <p>Panel, hesabınızın rolüne göre otomatik açılır. Giriş sırasında rol seçmezsiniz.</p>
            </header>

            <form className="signin-form" onSubmit={signIn}>
              <label className="field">
                <span className="field-label">Kullanıcı adı veya e-posta</span>
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Şifre</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {error ? <p className="admin-error login-feedback" role="alert">{error}</p> : null}
              {notice ? <p className="success-note login-feedback" role="status">{notice}</p> : null}
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "Giriş yapılıyor…" : "Giriş yap"}
              </button>
            </form>

            {/*
              Geliştirme/demo kurulumu. Üretimde sunucu bu ucu 404 ile kapatır ve
              buton hiç görünmez; hesap yalnızca bir kez açılır.
            */}
            {status?.devBootstrapAvailable ? (
              <div className="dev-bootstrap-box">
                <strong>Sistemde henüz Admin hesabı yok</strong>
                <p>
                  Geliştirme/demo ortamı için tek tıkla bir kurulum Admini oluşturabilirsiniz:
                  kullanıcı adı <code>{status.devUsername}</code>, geçici şifre <code>1234</code>.
                  Bu hesap yalnızca geliştirme ve demo içindir; üretimde kullanılmamalıdır.
                </p>
                <button type="button" className="secondary-button" disabled={busy} onClick={createDevAdmin}>
                  Kurulum Admini oluştur (admin / 1234)
                </button>
              </div>
            ) : null}

            {status?.required && status.tokenConfigured ? (
              <details className="real-login-disclosure setup-disclosure">
                <summary>Üretim kurulumu · anahtarla ilk Admin hesabı</summary>
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
        ) : (
          <div className="participant-entry">
            <header>
              <span className="section-kicker">Yarışmacı portalı</span>
              <h2 id="access-title">Yarışmacı hesabı oluştur</h2>
              <p>Hesabınızı açtıktan sonra yarışma seçip PDF raporunuzu gönderebilirsiniz.</p>
            </header>
            <form className="participant-login-form" onSubmit={registerParticipant}>
              <div className="registration-account-grid">
                <label className="field">
                  <span className="field-label">İsim Soyisim</span>
                  <input value={registerName} onChange={(event) => setRegisterName(event.target.value)} autoComplete="name" required />
                </label>
                <label className="field">
                  <span className="field-label">E-posta</span>
                  <input type="email" value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} autoComplete="username" required />
                </label>
                <label className="field registration-password-field">
                  <span className="field-label">Şifre</span>
                  <input type="password" minLength={8} value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} autoComplete="new-password" required />
                  <span className="field-hint">En az 8 karakter.</span>
                </label>
              </div>

              <fieldset className="registration-profile">
                <legend>Katılım profili</legend>
                <p>Bu bilgiler yalnızca toplu katılım ve başarı istatistiklerinde kullanılır; hakem kararını etkilemez.</p>
                <div className="registration-profile-grid">
                  <label className="field">
                    <span className="field-label">Eğitim durumu</span>
                    <select
                      value={registerProfile.educationStatus}
                      required
                      onChange={(event) => setRegisterProfile((current) => ({ ...current, educationStatus: event.target.value, educationGrade: "" }))}
                    >
                      <option value="">Seçin</option>
                      {EDUCATION_STATUS_VALUES.map((value) => <option key={value} value={value}>{EDUCATION_STATUS_LABELS[value]}</option>)}
                    </select>
                  </label>
                  {registerProfile.educationStatus && registerProfile.educationStatus !== "mezun" ? (
                    <label className="field">
                      <span className="field-label">Sınıf / eğitim aşaması</span>
                      <select
                        value={registerProfile.educationGrade}
                        required
                        onChange={(event) => setRegisterProfile((current) => ({ ...current, educationGrade: event.target.value }))}
                      >
                        <option value="">Seçin</option>
                        {EDUCATION_GRADE_OPTIONS[registerProfile.educationStatus as keyof typeof EDUCATION_GRADE_OPTIONS]
                          .map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <label className="field registration-combo-field">
                    <span className="field-label">Okul / kurum</span>
                    <SearchSelect
                      value={registerProfile.institutionName}
                      onChange={(value) => setRegisterProfile((current) => ({ ...current, institutionName: value }))}
                      options={[...DEMO_INSTITUTIONS]}
                      placeholder="Kurumunuzu arayın veya yazın"
                      ariaLabel="Okul veya kurum seçimi"
                    />
                    <span className="field-hint">Listede yoksa kurum adını kendiniz yazabilirsiniz.</span>
                  </label>
                  <label className="field registration-combo-field">
                    <span className="field-label">Şehir</span>
                    <SearchSelect
                      value={registerProfile.city}
                      onChange={(value) => setRegisterProfile((current) => ({ ...current, city: value }))}
                      options={[...TURKEY_CITIES]}
                      placeholder="Şehir ara"
                      ariaLabel="Şehir seçimi"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Cinsiyet <small>(isteğe bağlı)</small></span>
                    <select value={registerProfile.gender} onChange={(event) => setRegisterProfile((current) => ({ ...current, gender: event.target.value }))}>
                      <option value="">Seçmek istemiyorum</option>
                      {GENDER_VALUES.map((value) => <option key={value} value={value}>{GENDER_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">TEKNOFEST&apos;i nereden duydunuz?</span>
                    <select value={registerProfile.discoverySource} required onChange={(event) => setRegisterProfile((current) => ({ ...current, discoverySource: event.target.value }))}>
                      <option value="">Seçin</option>
                      {DISCOVERY_SOURCE_VALUES.map((value) => <option key={value} value={value}>{DISCOVERY_SOURCE_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Kaçıncı TEKNOFEST katılımınız?</span>
                    <select value={registerProfile.teknofestHistory} required onChange={(event) => setRegisterProfile((current) => ({ ...current, teknofestHistory: event.target.value }))}>
                      <option value="">Seçin</option>
                      {TEKNOFEST_HISTORY_VALUES.map((value) => <option key={value} value={value}>{TEKNOFEST_HISTORY_LABELS[value]}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>
              {error ? <p className="admin-error login-feedback" role="alert">{error}</p> : null}
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "Hesap oluşturuluyor…" : "Hesabımı oluştur"}
              </button>
            </form>
            <p className="page-note">
              Hesabınız zaten varsa <button type="button" className="text-button" onClick={() => { setPanel("signin"); setError(""); }}>giriş yapın</button>.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
