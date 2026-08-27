"use client";

import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-client";
import type { AdminAccount } from "../lib/admin-types";

/**
 * Üst çubuğun sağ bloğu: açık oturumun sahibi ve çıkış düğmesi.
 * Oturum bilgisi sunucudan okunur; çıkışta çerez sunucuda düşürülür ve
 * kullanıcı giriş sayfasına döner.
 */
export default function TopbarSession() {
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    adminApi.me()
      .then((result) => { if (active) setAccount(result.account); })
      .catch(() => { if (active) setAccount(null); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    setBusy(true);
    try { await adminApi.logout(); } catch { /* Çerez istemcide yine temizlenir. */ }
    window.location.href = "/";
  }

  return (
    <div className="topbar-status">
      <span className="topbar-user session-email">{account ? account.email : "Oturum okunuyor…"}</span>
      <button type="button" className="text-button" onClick={signOut} disabled={busy}>
        {busy ? "Çıkılıyor…" : "Çıkış yap"}
      </button>
    </div>
  );
}
