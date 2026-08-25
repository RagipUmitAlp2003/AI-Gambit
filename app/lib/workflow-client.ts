"use client";

import type { AdminAccount } from "./admin-types";
import type { JudgeReview, ProfileExport, ReportEvaluation } from "./types";
import type { CompetitionApplication, CriteriaExtractionRun, PublishedProfile } from "./workflow-types";

export class WorkflowApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkflowApiError";
    this.status = status;
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  let payload: Record<string, unknown> = {};
  try { payload = await response.json() as Record<string, unknown>; } catch { /* Aşağıda anlamlı hata üretilir. */ }
  if (!response.ok) throw new WorkflowApiError(typeof payload.error === "string" ? payload.error : "İşlem tamamlanamadı.", response.status);
  return payload as T;
}

async function jsonRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  return responseJson<T>(await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  }));
}

export const workflowApi = {
  applications: () => jsonRequest<{ applications: CompetitionApplication[] }>("/api/applications"),
  submitApplication: async (input: {
    competitionName: string;
    applicantFullName: string;
    teamName: string;
    teamMembers: string[];
    file: File;
  }) => {
    const form = new FormData();
    form.set("competitionName", input.competitionName);
    form.set("applicantFullName", input.applicantFullName);
    form.set("teamName", input.teamName);
    form.set("teamMembers", JSON.stringify(input.teamMembers));
    form.set("file", input.file);
    return responseJson<{ application: CompetitionApplication }>(await fetch("/api/applications", { method: "POST", credentials: "same-origin", body: form }));
  },
  applicationFile: async (id: string, fileName: string) => {
    const response = await fetch(`/api/applications/${encodeURIComponent(id)}/file`, { credentials: "same-origin" });
    if (!response.ok) await responseJson(response);
    return new File([await response.blob()], fileName, { type: "application/pdf" });
  },
  updateApplication: (id: string, action: string, value: { evaluation?: ReportEvaluation; review?: JudgeReview } = {}) =>
    jsonRequest<{ application: CompetitionApplication }>(`/api/applications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...value }),
    }),
  profiles: () => jsonRequest<{ profiles: PublishedProfile[] }>("/api/profiles"),
  extractions: () => jsonRequest<{ extractions: CriteriaExtractionRun[] }>("/api/extractions"),
  profile: (id: string) => jsonRequest<{ profile: PublishedProfile }>(`/api/profiles?id=${encodeURIComponent(id)}`),
  publishProfile: (profile: ProfileExport) => jsonRequest<{ profile: PublishedProfile }>("/api/profiles", {
    method: "POST",
    body: JSON.stringify({ profile }),
  }),
  registerParticipant: (fullName: string, email: string, password: string) =>
    jsonRequest<{ account: AdminAccount; expiresAt: string }>("/api/participant/register", {
      method: "POST",
      body: JSON.stringify({ fullName, email, password }),
    }),
};
