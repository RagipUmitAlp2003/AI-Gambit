"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminAccountsPanel from "./admin-accounts-panel";
import AuditPanel from "./audit-panel";
import DocumentFlowPanel from "./document-flow-panel";
import ModeratorLogin from "./moderator-login";
import { AdminApiError, adminApi } from "../lib/admin-client";
import type { AuditEntryView } from "../lib/admin-client";
import { ROLES, roleByCode } from "../lib/admin-roles";
import type { RoleDefinition } from "../lib/admin-roles";
import type { AdminAccount, DocumentFlow, MailDelivery } from "../lib/admin-types";

/**
 * Rol 00 · Moderatör paneli.
 *
 * Bu bileşen yalnızca görünürlüğü yönetir; asıl yetki kararı sunucudadır.
 * Rol 00 hesap yönetimini ve denetim izini görür, diğer roller yalnızca
 * belge akışını okur.
 */

type Section = "accounts" | "flows" | "audit";

type Data = {
  accounts: AdminAccount[];
  roles: RoleDefinition[];
  mail: MailDelivery[];
  flows: DocumentFlow[];
  audit: AuditEntryView[];
  mailReady: boolean;
  production: boolean;
};

const EMPTY: Data = {
  accounts: [],
  roles: ROLES,
  mail: [],
  flows: [],
  audit: [],
  mailReady: false,
  production: false,
};

const SECTIONS: Array<{ id: Section; title: string; summary: string; moderatorOnly: boolean }> = [
  { id: "accounts", title: "Yönetici atama", summary: "Hesap aç, rol ata, rol kaldır", moderatorOnly: true },
  { id: "flows", title: "Belge akışı", summary: "Yarışma bazlı devir kaydı", moderatorOnly: false },
  { id: "audit", title: "Denetim izi", summary: "Kim, ne zaman, ne yaptı", moderatorOnly: true },
];

export default function ModeratorApp() {
  const [session, setSession] = useState<AdminAccount | null>(null);
  const [section, setSection] = useState<Section>("flows");
  const [data, setData] = useState<Data>(EMPTY);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isModerator = session?.roleCode === "00";

  const load = useCallback(async (account: AdminAccount) => {
    try {
      const flowsResponse = await adminApi.flows();
      if (account.roleCode !== "00") {
        setError("");
        setData({ ...EMPTY, flows: flowsResponse.flows });
        return;
      }
      const [accountsResponse, outboxResponse, auditResponse] = await Promise.all([
        adminApi.accounts(),
        adminApi.outbox(),
        adminApi.audit(),
      ]);
      setError("");
      setData({
        accounts: accountsResponse.accounts,
        roles: accountsResponse.roles.length ? accountsResponse.roles : ROLES,
        mail: outboxResponse.mail,
        flows: flowsResponse.flows,
        audit: auditResponse.entries,
        mailReady: accountsResponse.mailReady,
        production: accountsResponse.production,
      });
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.needsLogin) {
        setSession(null);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Veriler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (session) await load(session);
  }, [load, session]);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const current = await adminApi.me();
        if (!active) return;
        setSession(current.account);
        setSection(current.account.roleCode === "00" ? "accounts" : "flows");
        setLoading(true);
        await load(current.account);
      } catch {
        // Oturum yoksa giriş ekranı gösterilir; hata olarak yansıtılmaz.
      } finally {
        if (active) setChecking(false);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, [load]);

  async function handleSignedIn(account: AdminAccount) {
    setSession(account);
    setSection(account.roleCode === "00" ? "accounts" : "flows");
    setLoading(true);
    await load(account);
  }

  async function signOut() {
    try {
      await adminApi.logout();
    } catch {
      // Çerez sunucu tarafında zaten temizlenir.
    }
    setSession(null);
    setData(EMPTY);
  }

  if (checking) {
    return (
      <main className="key-gate">
        <p className="empty-note">Oturum denetleniyor…</p>
      </main>
    );
  }

  if (!session) {
    return <ModeratorLogin onSignedIn={handleSignedIn} />;
  }

  const visibleSections = SECTIONS.filter((item) => !item.moderatorOnly || isModerator);
  const activeSection = visibleSections.some((item) => item.id === section) ? section : "flows";
  const role = roleByCode(session.roleCode);

  return (
    <div className="app-shell">
      <nav className="step-rail" aria-label="Moderatör paneli bölümleri">
        <div className="rail-heading">
          <span className="rail-mark">{session.roleCode}</span>
          <div>
            <strong>{role?.title ?? "Yönetici"}</strong>
            <span>{session.fullName}</span>
          </div>
        </div>
        <ol>
          {visibleSections.map((item, index) => (
            <li key={item.id} className={`rail-step ${activeSection === item.id ? "active" : ""}`}>
              <button type="button" onClick={() => setSection(item.id)}>
                <span className="step-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.summary}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="rail-note">
          <span className="status-dot" />
          <div>
            <strong>Oturum</strong>
            <p>{session.email}</p>
          </div>
        </div>
      </nav>

      <div className="app-main">
        <header className="topbar">
          <div>
            <span className="topbar-context">Rol {session.roleCode} · Yönetim</span>
            <strong>Kriter Atölyesi yönetici sistemi</strong>
          </div>
          <div className="topbar-status">
            {isModerator ? (
              <span className={`status-chip ${data.mailReady ? "success" : "neutral"}`}>
                {data.mailReady ? "Mail gönderimi açık" : "Mail giden kutusunda"}
              </span>
            ) : null}
            <Link className="text-button" href="/">
              Kriter Atölyesi&apos;ne dön
            </Link>
            <button type="button" className="text-button" onClick={signOut}>
              Çıkış
            </button>
            <span className="operator-avatar" aria-label={`Rol ${session.roleCode}`}>
              {session.roleCode}
            </span>
          </div>
        </header>

        {isModerator && data.production && !data.mailReady ? (
          <p className="access-warning">
            Üretim ortamında mail sağlayıcı tanımlı değil. Hesap bildirimleri gönderilemez ve
            &quot;başarısız&quot; olarak işaretlenir.
          </p>
        ) : null}

        {error ? <p className="admin-error page-error">{error}</p> : null}

        {loading ? (
          <p className="empty-note page-note">Yükleniyor…</p>
        ) : activeSection === "accounts" && isModerator ? (
          <AdminAccountsPanel
            accounts={data.accounts}
            roles={data.roles}
            mailReady={data.mailReady}
            mail={data.mail}
            viewerId={session.id}
            onChanged={refresh}
          />
        ) : activeSection === "audit" && isModerator ? (
          <AuditPanel entries={data.audit} />
        ) : (
          <DocumentFlowPanel
            flows={data.flows}
            accounts={data.accounts}
            readOnly={!isModerator}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  );
}
