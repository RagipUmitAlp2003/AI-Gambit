"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-client";
import { roleByCode } from "../lib/admin-roles";
import type { AdminAccount, RoleCode } from "../lib/admin-types";

type Props = { allowed: RoleCode[]; areaName: string; children: React.ReactNode };

export default function RoleGate({ allowed, areaName, children }: Props) {
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    adminApi.me()
      .then((result) => { if (active) setAccount(result.account); })
      .catch(() => { if (active) setAccount(null); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  if (checking) return <main className="session-check"><span className="session-spinner" /><p>Yetkiniz denetleniyor…</p></main>;
  if (!account) {
    return (
      <main className="permission-page"><section>
        <span className="permission-mark">T3</span>
        <h1>Yönetici girişi gerekli</h1>
        <p>{areaName} yalnızca yetkili yönetici oturumuyla açılır.</p>
        <Link href="/" className="primary-button">Giriş sayfasına dön</Link>
      </section></main>
    );
  }
  if (!allowed.includes(account.roleCode)) {
    const role = roleByCode(account.roleCode);
    return (
      <main className="permission-page"><section>
        <span className="permission-mark">{account.roleCode}</span>
        <h1>Bu alan rolünüze açık değil</h1>
        <p>{role?.title ?? "Mevcut rol"} hesabı {areaName} içinde işlem yapamaz.</p>
        <Link href="/" className="primary-button">Çalışma alanıma dön</Link>
      </section></main>
    );
  }
  return children;
}
