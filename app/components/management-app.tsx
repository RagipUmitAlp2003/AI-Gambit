"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccessLogin from "./access-login";
import AdminAccountsPanel from "./admin-accounts-panel";
import AuditPanel from "./audit-panel";
import OperationsPanel from "./operations-panel";
import ParticipantPortal from "./participant-portal";
import ManagerProfileHistory from "./manager-profile-history";
import { AdminApiError, adminApi } from "../lib/admin-client";
import type { AuditEntryView } from "../lib/admin-client";
import { ROLES, roleByCode } from "../lib/admin-roles";
import type { AdminAccount, MailDelivery } from "../lib/admin-types";

type Section = "overview" | "extractions" | "approved" | "accounts" | "audit";

type AdminData = {
  accounts: AdminAccount[];
  mail: MailDelivery[];
  audit: AuditEntryView[];
  mailReady: boolean;
  production: boolean;
};

const EMPTY: AdminData = { accounts: [], mail: [], audit: [], mailReady: false, production: false };

const ROLE_WORKSPACES = {
  "00": {
    title: "Baş yönetim merkezi",
    intro: "Hesap ve yetki yönetimini yürütün; yarışma hazırlığı ile değerlendirme alanlarına kontrollü geçiş yapın.",
  },
  "01": {
    title: "Yarışma hazırlık alanı",
    intro: "Güncel kriter PDF'sini yükleyin, çıkarımları kaynaklarıyla doğrulayın ve onaylı değerlendirme profilini oluşturun.",
  },
  "02": {
    title: "Hakem çalışma alanı",
    intro: "Katılımcı raporundaki AI bulgularını ve kanıtları inceleyin; nihai uzman kararını siz verin.",
  },
  "03": {
    title: "Yarışmacı alanı",
    intro: "Bu rol yönetici panelinde kullanılmaz.",
  },
  "04": {
    title: "Değerlendirme operasyonları",
    intro: "Analizlerin ve hakem akışının durumunu izleyin; geciken veya insan incelemesi bekleyen işleri takip edin.",
  },
} as const;

export default function ManagementApp() {
  const [session, setSession] = useState<AdminAccount | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<AdminData>(EMPTY);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isHeadAdmin = session?.roleCode === "00";

  const loadAdminData = useCallback(async (account: AdminAccount) => {
    if (account.roleCode !== "00") {
      setData(EMPTY);
      setError("");
      setLoading(false);
      return;
    }
    try {
      const [accounts, outbox, audit] = await Promise.all([
        adminApi.accounts(),
        adminApi.outbox(),
        adminApi.audit(),
      ]);
      setData({
        accounts: accounts.accounts,
        mail: outbox.mail,
        audit: audit.entries,
        mailReady: accounts.mailReady,
        production: accounts.production,
      });
      setError("");
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.needsLogin) setSession(null);
      else setError(caught instanceof Error ? caught.message : "Yönetim bilgileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    adminApi.me()
      .then(async (current) => {
        if (!active) return;
        setSession(current.account);
        setLoading(true);
        await loadAdminData(current.account);
      })
      .catch(() => { /* Oturum yoksa giriş ekranı gösterilir. */ })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [loadAdminData]);

  async function signedIn(account: AdminAccount) {
    setSession(account);
    setSection("overview");
    setChecking(false);
    setLoading(true);
    await loadAdminData(account);
  }

  async function refresh() {
    if (session) await loadAdminData(session);
  }

  async function signOut() {
    try { await adminApi.logout(); } catch { /* Çerez istemcide yine temizlenir. */ }
    setSession(null);
    setSection("overview");
    setData(EMPTY);
  }

  if (checking) {
    return <main className="session-check"><span className="session-spinner" /><p>Güvenli oturum denetleniyor…</p></main>;
  }
  if (!session) return <AccessLogin onSignedIn={signedIn} />;
  if (session.roleCode === "03") return <ParticipantPortal account={session} onSignOut={signOut} />;

  const role = roleByCode(session.roleCode);
  const workspace = ROLE_WORKSPACES[session.roleCode];
  const sections: Array<{ id: Section; label: string; detail: string }> = [
    { id: "overview", label: "Çalışma alanım", detail: role?.area ?? "Rol görünümü" },
    ...(session.roleCode === "00" || session.roleCode === "01" ? [
      { id: "extractions" as const, label: "Geçmiş ayıklamalar", detail: "Analiz edilen kriter PDF'leri" },
      { id: "approved" as const, label: "Onayladığı projeler", detail: "Kesinleşen kriter profilleri" },
    ] : []),
    ...(isHeadAdmin ? [
      { id: "accounts" as const, label: "Hesap ve yetkiler", detail: "Yönetici hesaplarını yönet" },
      { id: "audit" as const, label: "İşlem geçmişi", detail: "Yönetim hareketlerini izle" },
    ] : []),
  ];

  return (
    <div className="management-shell">
      <aside className="management-sidebar">
        <Link href="/" className="management-brand">
          <span>T3</span>
          <div><strong>Kriter Atölyesi</strong><small>Yönetim sistemi</small></div>
        </Link>
        <nav aria-label="Yönetim bölümleri">
          {sections.map((item) => (
            <button key={item.id} type="button" className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </nav>
        <div className="signed-user">
          <span>{session.roleCode}</span>
          <div><strong>{session.fullName}</strong><small>{role?.title}</small></div>
        </div>
      </aside>

      <div className="management-main">
        <header className="management-topbar">
          <div><span>{role?.title}</span><strong>{workspace.title}</strong></div>
          <div>
            <span className="session-email">{session.email}</span>
            <button type="button" className="text-button" onClick={signOut}>Çıkış yap</button>
          </div>
        </header>

        {data.production && !data.mailReady && isHeadAdmin ? (
          <p className="access-warning">Üretim ortamında e-posta sağlayıcısı tanımlı değil; yeni hesap bildirimleri gönderilemez.</p>
        ) : null}
        {error ? <p className="admin-error page-error">{error}</p> : null}
        {loading ? <p className="page-note">Yönetim bilgileri yükleniyor…</p> : null}

        {!loading && section === "overview" ? (
          <section className="role-workspace" aria-labelledby="role-workspace-title">
            <header>
              <span className="role-code">Rol {session.roleCode}</span>
              <h1 id="role-workspace-title">{workspace.title}</h1>
              <p>{workspace.intro}</p>
            </header>

            <div className="role-action-list">
              {(session.roleCode === "00" || session.roleCode === "01") ? (
                <Link href="/kriter-atolyesi" className="role-action primary">
                  <span>01</span>
                  <div><strong>Kriter Atölyesi&apos;ni aç</strong><p>Resmî PDF&apos;yi analiz et, kriterleri doğrula ve profili onayla.</p></div>
                  <b aria-hidden="true">→</b>
                </Link>
              ) : null}
              {(session.roleCode === "00" || session.roleCode === "02") ? (
                <Link href="/degerlendirme" className="role-action">
                  <span>02</span>
                  <div><strong>Değerlendirme Atölyesi&apos;ni aç</strong><p>Katılımcı raporunu, AI bulgularını ve kaynak kanıtlarını incele.</p></div>
                  <b aria-hidden="true">→</b>
                </Link>
              ) : null}
              {session.roleCode === "04" ? (
                <OperationsPanel />
              ) : null}
            </div>

            <div className="role-boundary">
              <strong>Bu rolün karar sınırı</strong>
              <p>{role?.summary}</p>
              {session.roleCode === "02" ? <small>AI sonucu öneridir; nihai değerlendirme hakeme aittir.</small> : null}
              {session.roleCode === "04" ? <small>Hakem puanı ve nihai karar bu rolden değiştirilemez.</small> : null}
            </div>

            {isHeadAdmin ? (
              <>
                <div className="admin-snapshot">
                  <div><strong>{data.accounts.filter((item) => item.status === "active").length}</strong><span>aktif yönetici</span></div>
                  <div><strong>{data.accounts.filter((item) => item.status === "revoked").length}</strong><span>pasif hesap</span></div>
                  <div><strong>{data.audit.length}</strong><span>yakın işlem kaydı</span></div>
                </div>
                <OperationsPanel />
              </>
            ) : null}
          </section>
        ) : null}

        {!loading && section === "accounts" && isHeadAdmin ? (
          <AdminAccountsPanel
            accounts={data.accounts}
            roles={ROLES}
            mailReady={data.mailReady}
            mail={data.mail}
            viewerId={session.id}
            onChanged={refresh}
          />
        ) : null}

        {!loading && section === "extractions" && (session.roleCode === "00" || session.roleCode === "01") ? <ManagerProfileHistory mode="extractions" /> : null}
        {!loading && section === "approved" && (session.roleCode === "00" || session.roleCode === "01") ? <ManagerProfileHistory mode="approved" /> : null}

        {!loading && section === "audit" && isHeadAdmin ? <AuditPanel entries={data.audit} /> : null}
      </div>
    </div>
  );
}
