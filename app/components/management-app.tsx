"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccessLogin from "./access-login";
import AdminAccountsPanel from "./admin-accounts-panel";
import AuditPanel from "./audit-panel";
import JudgeQueuePanel from "./judge-queue-panel";
import OperationsPanel from "./operations-panel";
import ParticipantPortal from "./participant-portal";
import ProfileReviewPanel from "./profile-review-panel";
import ManagerProfileHistory from "./manager-profile-history";
import { AdminApiError, adminApi } from "../lib/admin-client";
import type { AuditEntryView } from "../lib/admin-client";
import { PARTICIPANT_ROLE, ROLES, roleByCode } from "../lib/admin-roles";
import type { AdminAccount, MailDelivery, RoleCode } from "../lib/admin-types";
import { can } from "../lib/authorization";

type Section = "overview" | "profile-review" | "extractions" | "profiles" | "accounts" | "audit";

type AdminData = {
  accounts: AdminAccount[];
  mail: MailDelivery[];
  audit: AuditEntryView[];
  mailReady: boolean;
  production: boolean;
};

const EMPTY: AdminData = { accounts: [], mail: [], audit: [], mailReady: false, production: false };

/**
 * Rol çalışma alanları. Başlıklar merkezi rol katalogundan (admin-roles.ts)
 * beslenir; bu tablo yalnızca o rolün ekranda ne yaptığını anlatır.
 */
const ROLE_WORKSPACES: Record<RoleCode, { title: string; intro: string }> = {
  "00": {
    title: "Sistem yönetimi",
    intro: "Kullanıcı hesabı açın, rol atayın veya kaldırın, hesapları pasife alın. Değerlendirme kararları bu alandan verilmez.",
  },
  "01": {
    title: "Yarışma hazırlık alanı",
    intro: "Şartnameyi ve rapor şablonunu yükleyin, kriterleri ve puan yapısını oluşturun, hazırladığınız profili hakem incelemesine gönderin.",
  },
  "02": {
    title: "Hakem çalışma alanı",
    intro: "Yarışma yöneticisinin hazırladığı profili ikinci aşamada doğrulayın; AI ön değerlendirmesini inceleyip nihai kararı siz verin.",
  },
  "03": {
    title: "Değerlendirme operasyonları",
    intro: "AI analiz durumlarını, hakem kuyruğunu ve tamamlanma oranını izleyin. Bu alandan kriter, puan veya karar değiştirilemez.",
  },
  "04": {
    title: "Yarışmacı alanı",
    intro: "Bu rol yönetim panelinde kullanılmaz; yarışmacı kendi portalını görür.",
  },
};

export default function ManagementApp() {
  const [session, setSession] = useState<AdminAccount | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<AdminData>(EMPTY);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isModerator = session?.roleCode === "00";

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
  if (session.roleCode === PARTICIPANT_ROLE) return <ParticipantPortal account={session} onSignOut={signOut} />;

  const role = roleByCode(session.roleCode);
  const workspace = ROLE_WORKSPACES[session.roleCode];
  const canAuthorProfile = can(session, "author_profile");
  const canReviewProfile = can(session, "review_profile");
  const canJudge = can(session, "final_judgement");
  const canOpenEvaluation = can(session, "run_ai_prescreen");
  const canOperate = can(session, "operations_dashboard");

  // Bölümler yetki matrisinden türetilir; hiçbir rol adı burada sabitlenmez.
  const sections: Array<{ id: Section; label: string; detail: string }> = [
    { id: "overview", label: "Çalışma alanım", detail: role?.area ?? "Rol görünümü" },
    ...(canReviewProfile ? [
      { id: "profile-review" as const, label: "Profil doğrulama", detail: "Hakem onayı bekleyen değerlendirme profilleri" },
    ] : []),
    ...(canAuthorProfile ? [
      { id: "extractions" as const, label: "Geçmiş ayıklamalar", detail: "Analiz edilen şartname PDF'leri" },
      { id: "profiles" as const, label: "Profillerim", detail: "Hakem onay durumu" },
    ] : []),
    ...(isModerator ? [
      { id: "accounts" as const, label: "Hesap ve yetkiler", detail: "Kullanıcı hesaplarını yönet" },
      { id: "audit" as const, label: "İşlem geçmişi", detail: "Yönetim hareketlerini izle" },
    ] : []),
  ];

  return (
    <div className="management-shell">
      <aside className="management-sidebar">
        <Link href="/" className="management-brand">
          <span>T3</span>
          <div><strong>Kriter Atölyesi</strong><small>Değerlendirme karar destek sistemi</small></div>
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

        {data.production && !data.mailReady && isModerator ? (
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

            {/* Atölye kısayolları yalnızca o alanda işlem yapabilen rollere gösterilir. */}
            {canAuthorProfile || canOpenEvaluation ? (
              <div className="role-action-list">
                {canAuthorProfile ? (
                  <Link href="/kriter-atolyesi" className="role-action primary">
                    <span>01</span>
                    <div><strong>Kriter Atölyesi&apos;ni aç</strong><p>Şartnameyi analiz et, kriterleri ve puan yapısını doğrula, profili hakem incelemesine gönder.</p></div>
                    <b aria-hidden="true">→</b>
                  </Link>
                ) : null}
                {canOpenEvaluation ? (
                  <Link href="/degerlendirme" className="role-action">
                    <span>02</span>
                    <div><strong>Değerlendirme Atölyesi&apos;ni aç</strong><p>AI ön değerlendirmesini, kanıtları ve kriter bazlı bulguları inceleyip nihai kararı ver.</p></div>
                    <b aria-hidden="true">→</b>
                  </Link>
                ) : null}
              </div>
            ) : null}

            {canReviewProfile ? <ProfileReviewPanel compact onChanged={refresh} /> : null}
            {canJudge ? <JudgeQueuePanel /> : null}
            {canOperate ? <OperationsPanel /> : null}
            {canAuthorProfile ? <ManagerProfileHistory mode="profiles" compact /> : null}

            <div className="role-boundary">
              <strong>Bu rolün karar sınırı</strong>
              <p>{role?.summary}</p>
              {role?.boundary ? <small>{role.boundary}</small> : null}
            </div>

            {isModerator ? (
              <div className="admin-snapshot">
                <div><strong>{data.accounts.filter((item) => item.status === "active").length}</strong><span>aktif hesap</span></div>
                <div><strong>{data.accounts.filter((item) => item.status === "revoked").length}</strong><span>pasif hesap</span></div>
                <div><strong>{data.audit.length}</strong><span>yakın işlem kaydı</span></div>
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && section === "profile-review" && canReviewProfile ? <ProfileReviewPanel onChanged={refresh} /> : null}
        {!loading && section === "extractions" && canAuthorProfile ? <ManagerProfileHistory mode="extractions" /> : null}
        {!loading && section === "profiles" && canAuthorProfile ? <ManagerProfileHistory mode="profiles" /> : null}

        {!loading && section === "accounts" && isModerator ? (
          <AdminAccountsPanel
            accounts={data.accounts}
            roles={ROLES}
            mailReady={data.mailReady}
            mail={data.mail}
            viewerId={session.id}
            onChanged={refresh}
          />
        ) : null}

        {!loading && section === "audit" && isModerator ? <AuditPanel entries={data.audit} /> : null}
      </div>
    </div>
  );
}
