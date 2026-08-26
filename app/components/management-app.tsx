"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccessLogin from "./access-login";
import AdminAccountsPanel from "./admin-accounts-panel";
import CompetitionStagePanel from "./competition-stage-panel";
import JudgeQueuePanel from "./judge-queue-panel";
import OperationsPanel from "./operations-panel";
import ParticipantPortal from "./participant-portal";
import ManagerProfileHistory from "./manager-profile-history";
import { AdminApiError, adminApi } from "../lib/admin-client";
import { PARTICIPANT_ROLE, ROLES, roleByCode } from "../lib/admin-roles";
import type { AdminAccount, MailDelivery, RoleCode } from "../lib/admin-types";
import { can } from "../lib/authorization";

/**
 * `history`: Yarışma Yöneticisinin TEK geçmiş ekranı — geçmiş ayıklamalar ve
 * yayımlanan profiller birlikte. Daha önce iki ayrı bölümdü ve yayımlanmış bir
 * profil hiçbirinden düzenlenemiyordu.
 */
type Section = "overview" | "history" | "accounts";

type AdminData = {
  accounts: AdminAccount[];
  mail: MailDelivery[];
  mailReady: boolean;
  production: boolean;
};

const EMPTY: AdminData = { accounts: [], mail: [], mailReady: false, production: false };

/**
 * Rol çalışma alanları. Başlıklar merkezi rol katalogundan (admin-roles.ts)
 * beslenir; bu tablo yalnızca o rolün ekranda ne yaptığını anlatır.
 */
const ROLE_WORKSPACES: Record<RoleCode, { title: string; intro: string }> = {
  "00": {
    title: "Yetkili hesap yönetimi",
    intro: "01, 02 ve 04 rollerinde personel hesabı açın, rol değiştirin veya hesabı pasife alın. Yeni Admin ve Yarışmacı hesabı bu panelden açılamaz; kriter, değerlendirme ve operasyon alanları bu hesaba kapalıdır.",
  },
  "01": {
    title: "Yarışma hazırlık alanı",
    intro: "Şartname PDF'sini yükleyin; dört aşamalı kontrol için çıkarılan kriterleri doğrulayıp yayımlayın. Ayrı bir rapor şablonu yüklenmez.",
  },
  "02": {
    title: "Hakem çalışma alanı",
    intro: "Yayımlanmış kriter profiline göre AI ön değerlendirmesini başlatın; kanıtları inceleyip nihai kararı verin.",
  },
  "03": {
    title: "Yarışmacı alanı",
    intro: "Bu rol yönetim panelinde kullanılmaz; yarışmacı kendi başvuru ve sonuç portalını görür.",
  },
  "04": {
    title: "Değerlendirme operasyonları",
    intro: "Başvurulara ilk hakemi atayın; hakem yüklerini, analiz hatalarını ve tamamlanma oranını izleyin; tıkanıklıkları giderip sonuç yayın akışını yönetin.",
  },
};

export default function ManagementApp() {
  const [session, setSession] = useState<AdminAccount | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<AdminData>(EMPTY);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = can(session, "manage_accounts");

  const loadAdminData = useCallback(async (account: AdminAccount) => {
    if (!can(account, "manage_accounts")) {
      setData(EMPTY);
      setError("");
      setLoading(false);
      return;
    }
    try {
      // Denetim izi Admin ekranında GÖSTERİLMEZ (İşlem Geçmişi paneli kaldırıldı);
      // kayıtlar sunucuda tutulmaya devam eder ve /api/admin/audit ucundan okunur.
      const [accounts, outbox] = await Promise.all([
        adminApi.accounts(),
        adminApi.outbox(),
      ]);
      setData({
        accounts: accounts.accounts,
        mail: outbox.mail,
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
        setSection(can(current.account, "manage_accounts") ? "accounts" : "overview");
        setLoading(true);
        await loadAdminData(current.account);
      })
      .catch(() => { /* Oturum yoksa giriş ekranı gösterilir. */ })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [loadAdminData]);

  async function signedIn(account: AdminAccount) {
    setSession(account);
    setSection(can(account, "manage_accounts") ? "accounts" : "overview");
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
  const canJudge = can(session, "final_judgement");
  const canOpenEvaluation = can(session, "run_ai_prescreen");
  const canOperate = can(session, "operations_dashboard");
  const canInitialAssign = can(session, "assign_judge");
  const canManageStage = can(session, "manage_competition_stage");

  // Bölümler yetki matrisinden türetilir; hiçbir rol adı burada sabitlenmez.
  // Admin yalnızca yönetici atama panelini görür; başka bölüm listelenmez.
  const sections: Array<{ id: Section; label: string; detail: string }> = isAdmin
    ? [{ id: "accounts", label: "Yönetici atama", detail: "Hesap aç, rol ata veya kaldır" }]
    : [
      { id: "overview", label: "Çalışma alanım", detail: role?.area ?? "Rol görünümü" },
      ...(canAuthorProfile ? [
        { id: "history" as const, label: "Kriter Geçmişi", detail: "Analiz edilen şartnameler ve yayımlanan profiller" },
      ] : []),
    ];
  const activeSection: Section = isAdmin ? "accounts" : section === "accounts" ? "overview" : section;

  return (
    <div className="management-shell">
      <aside className="management-sidebar">
        <Link href="/" className="management-brand">
          <span>T3</span>
          <div><strong>Kriter Atölyesi</strong><small>Değerlendirme karar destek sistemi</small></div>
        </Link>
        <nav aria-label="Yönetim bölümleri">
          {sections.map((item) => (
            <button key={item.id} type="button" className={activeSection === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
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

        {data.production && !data.mailReady && isAdmin ? (
          <p className="access-warning">Üretim ortamında e-posta sağlayıcısı tanımlı değil; yeni hesap bildirimleri gönderilemez.</p>
        ) : null}
        {error ? <p className="admin-error page-error">{error}</p> : null}
        {loading ? <p className="page-note">Yönetim bilgileri yükleniyor…</p> : null}

        {!loading && activeSection === "overview" && !isAdmin ? (
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
                    <div><strong>Kriter Atölyesi&apos;ni aç</strong><p>Şartnameyi tek AI çağrısıyla analiz et, dört aşamalı kriterleri doğrula ve profili yayımla.</p></div>
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

            {canJudge ? <JudgeQueuePanel /> : null}
            {canOperate ? <OperationsPanel canInitialAssign={canInitialAssign} /> : null}
            {/* Başvurunun açık/kapalı olması yarışmanın sahibinin kararıdır. */}
            {canManageStage ? <CompetitionStagePanel /> : null}
            {canAuthorProfile ? <ManagerProfileHistory compact /> : null}

            <div className="role-boundary">
              <strong>Bu rolün karar sınırı</strong>
              <p>{role?.summary}</p>
              {role?.boundary ? <small>{role.boundary}</small> : null}
            </div>
          </section>
        ) : null}

        {!loading && activeSection === "history" && canAuthorProfile ? <ManagerProfileHistory /> : null}

        {!loading && activeSection === "accounts" && isAdmin ? (
          <>
            <AdminAccountsPanel
              accounts={data.accounts}
              roles={ROLES}
              mailReady={data.mailReady}
              mail={data.mail}
              viewerId={session.id}
              onChanged={refresh}
            />
            <div className="role-boundary admin-boundary">
              <strong>Bu rolün karar sınırı</strong>
              <p>{role?.summary}</p>
              {role?.boundary ? <small>{role.boundary}</small> : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
