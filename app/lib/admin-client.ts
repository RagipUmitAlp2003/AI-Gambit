"use client";

import type {
  AdminAccount,
  CreateAccountResult,
  MailDelivery,
  RoleCode,
} from "./admin-types";
import type { RoleDefinition } from "./admin-roles";

/**
 * Moderatör panelinin sunucu uçlarına bağlantısı.
 *
 * Kimlik doğrulama HttpOnly oturum çerezi ile yapılır; jeton istemci
 * koduna hiç görünmez ve yetki kararı tamamen sunucuda verilir.
 */

export class AdminApiError extends Error {
  status: number;
  needsLogin: boolean;
  forbidden: boolean;
  authUnavailable: boolean;
  databaseUnavailable: boolean;
  lastModerator: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      needsLogin?: boolean;
      authUnavailable?: boolean;
      databaseUnavailable?: boolean;
      lastModerator?: boolean;
    },
  ) {
    super(message);
    this.name = "AdminApiError";
    this.status = options.status;
    this.needsLogin = options.needsLogin ?? false;
    this.forbidden = options.status === 403;
    this.authUnavailable = options.authUnavailable ?? false;
    this.databaseUnavailable = options.databaseUnavailable ?? false;
    this.lastModerator = options.lastModerator ?? false;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    if (response.ok) throw new AdminApiError("Sunucu yanıtı okunamadı.", { status: response.status });
  }

  if (!response.ok) {
    throw new AdminApiError(
      typeof payload.error === "string" ? payload.error : `İstek ${response.status} ile sonuçlandı.`,
      {
        status: response.status,
        needsLogin: payload.needsLogin === true,
        authUnavailable: payload.authUnavailable === true,
        databaseUnavailable: payload.databaseUnavailable === true,
        lastModerator: payload.lastModerator === true,
      },
    );
  }

  return payload as T;
}

export type SessionResponse = { account: AdminAccount; role: RoleDefinition | null; expiresAt?: string };

export type AccountsResponse = {
  accounts: AdminAccount[];
  roles: RoleDefinition[];
  mailReady: boolean;
  production: boolean;
  viewer: AdminAccount;
};

export type AuditEntryView = {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string;
  createdAt: string;
};

export type BootstrapStatus = { required: boolean; tokenConfigured: boolean; authConfigured: boolean };

export const adminApi = {
  me: () => request<SessionResponse>("/api/admin/session"),

  login: (email: string, password: string) =>
    request<SessionResponse>("/api/admin/session", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  devLogin: (roleCode: RoleCode) =>
    request<SessionResponse>("/api/admin/dev-session", {
      method: "POST",
      body: JSON.stringify({ roleCode }),
    }),

  logout: () => request<{ signedOut: boolean }>("/api/admin/session", { method: "DELETE" }),

  bootstrapStatus: () => request<BootstrapStatus>("/api/admin/bootstrap"),

  bootstrap: (input: { token: string; fullName: string; email: string; password?: string }) =>
    request<{ account: AdminAccount; oneTimePassword: string }>("/api/admin/bootstrap", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  accounts: () => request<AccountsResponse>("/api/admin/accounts"),

  createAccount: (input: { fullName: string; email: string; roleCode: RoleCode; password?: string }) =>
    request<CreateAccountResult>("/api/admin/accounts", { method: "POST", body: JSON.stringify(input) }),

  changeRole: (id: string, roleCode: RoleCode) =>
    request<{ account: AdminAccount }>(`/api/admin/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ roleCode }),
    }),

  revokeAccount: (id: string, reason: string) =>
    request<{ account: AdminAccount; mail: MailDelivery }>(
      `/api/admin/accounts/${id}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" },
    ),

  purgeAccount: (id: string) =>
    request<{ purged: boolean }>(`/api/admin/accounts/${id}?purge=1`, { method: "DELETE" }),

  outbox: () => request<{ mail: MailDelivery[]; mailReady: boolean; production: boolean }>("/api/admin/outbox"),

  /**
   * Denetim izi. Admin ekranındaki "İşlem Geçmişi" paneli kaldırıldı; kayıtlar
   * sunucuda tutulmaya devam eder ve gerektiğinde bu uçtan okunur.
   */
  audit: () => request<{ entries: AuditEntryView[] }>("/api/admin/audit"),
};

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}
