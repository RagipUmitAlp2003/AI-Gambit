"use client";

import type { AdminAccount } from "./admin-types";
import type { CompetitionEntry } from "./competitions";
import type { JudgeReview, PreCheck, ProfileExport, ReportEvaluation } from "./types";
import type {
  CompetitionApplication,
  CompetitionOverview,
  CompetitionStatus,
  CompetitionWorkflow,
  CompetitionProfile,
  CriteriaExtractionRun,
  OperationsSummary,
  JudgeWorkload,
  ProfileReviewDecision,
  TimelineEntry,
} from "./workflow-types";

export class WorkflowApiError extends Error {
  status: number;
  /** Sunucu günlüğündeki satırla eşleşen kısa referans kodu (yalnızca 500'lerde). */
  reference: string;
  /** Geçici bir aksaklık mı (yeniden denemeye değer) yoksa kalıcı bir ret mi? */
  retryable: boolean;
  constructor(message: string, status: number, reference = "", retryable = false) {
    super(message);
    this.name = "WorkflowApiError";
    this.status = status;
    this.reference = reference;
    this.retryable = retryable;
  }
}

/** Sunucu bir neden vermediyse en azından HTTP durumunu okunur hâle getirir. */
function statusReason(status: number): string {
  if (status === 401) return "Oturumunuz sona ermiş; yeniden giriş yapın.";
  if (status === 403) return "Bu işlem için yetkiniz yok.";
  if (status === 404) return "Kayıt bulunamadı.";
  if (status === 409) return "Kayıt başka bir işlemle çakışıyor.";
  if (status === 413) return "Gönderilen veri sunucu sınırını aşıyor.";
  if (status >= 500) return `Sunucu ${status} hatası döndürdü.`;
  return `İstek reddedildi (HTTP ${status}).`;
}

async function responseJson<T>(response: Response): Promise<T> {
  let payload: Record<string, unknown> = {};
  let parsed = true;
  try { payload = await response.json() as Record<string, unknown>; } catch { parsed = false; }
  if (!response.ok) {
    // Sunucunun gerekçesi varsa o gösterilir; yoksa HTTP durumu okunur bir cümleye
    // çevrilir. "İşlem tamamlanamadı." gibi boş bir mesaj artık üretilmez.
    const message = typeof payload.error === "string" && payload.error.trim()
      ? payload.error
      : parsed ? statusReason(response.status) : `Sunucu okunamayan bir yanıt döndürdü (HTTP ${response.status}).`;
    throw new WorkflowApiError(
      message,
      response.status,
      typeof payload.reference === "string" ? payload.reference : "",
      payload.retryable === true,
    );
  }
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
  /** `openCompetitions`: şu anda başvuruya açık yarışmalar (yayımlanmış profili olanlar). */
  applications: () => jsonRequest<{ applications: CompetitionApplication[]; openCompetitions?: CompetitionEntry[] }>("/api/applications"),
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
  /** `notificationWarning`: karar kaydedildi ama yarışmacıya e-posta gönderilemedi. */
  updateApplication: (id: string, action: string, value: { evaluation?: ReportEvaluation; review?: JudgeReview; judgeId?: string; note?: string; archived?: boolean } = {}) =>
    jsonRequest<{ application: CompetitionApplication; notificationWarning?: string }>(`/api/applications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...value }),
    }),
  submitRevision: async (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return responseJson<{ application: CompetitionApplication }>(await fetch(`/api/applications/${encodeURIComponent(id)}/versions`, {
      method: "POST", credentials: "same-origin", body: form,
    }));
  },
  similarityCheck: (id: string, text: string) => jsonRequest<{ check: PreCheck }>(
    `/api/applications/${encodeURIComponent(id)}/similarity`,
    { method: "POST", body: JSON.stringify({ text }) },
  ),
  profiles: () => jsonRequest<{ profiles: CompetitionProfile[] }>("/api/profiles"),
  extractions: () => jsonRequest<{ extractions: CriteriaExtractionRun[] }>("/api/extractions"),
  profile: (id: string) => jsonRequest<{ profile: CompetitionProfile }>(`/api/profiles?id=${encodeURIComponent(id)}`),
  /**
   * Yarışma yöneticisi doğruladığı kriter profilini yayımlar.
   *
   * `sourceFile` verilirse şartname PDF'i de sunucuya yazılır; kaynak sayfa
   * bağlantısı profil geçmişten açıldığında ancak bu kopya sayesinde çalışır.
   */
  submitProfileForReview: async (profile: ProfileExport, sourceFile?: File | null) => {
    type PublishResponse = {
      profile: CompetitionProfile;
      criteriaVersion: { criteriaVersion: number; criteriaHash: string; criteriaCount: number };
      versionCreated: boolean;
      /** Kaynak sayfa/alıntı değiştirilmeye çalışıldıysa sunucunun uyarısı (madde 12). */
      sourceLockWarning?: string;
    };
    if (!sourceFile) {
      return jsonRequest<PublishResponse>("/api/profiles", {
        method: "POST",
        body: JSON.stringify({ profile }),
      });
    }
    const form = new FormData();
    form.set("profile", JSON.stringify(profile));
    form.set("sourceFile", sourceFile);
    return responseJson<PublishResponse>(
      await fetch("/api/profiles", { method: "POST", credentials: "same-origin", body: form }),
    );
  },
  /** Yayımlanmış profilin kaynak şartname PDF'i; `#page=N` ile açılır. */
  profileFileUrl: (profileId: string) => `/api/profiles/${encodeURIComponent(profileId)}/file`,
  /** Hakemin ikinci aşama doğrulaması: onay veya düzeltme talebi. */
  reviewProfile: (input: { id: string; decision: ProfileReviewDecision; note: string; profile?: ProfileExport }) =>
    jsonRequest<{ profile: CompetitionProfile }>("/api/profiles", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  timeline: (subject: "application" | "profile", id: string) =>
    jsonRequest<{ timeline: TimelineEntry[] }>(`/api/timeline?subject=${subject}&id=${encodeURIComponent(id)}`),
  operations: () => jsonRequest<{
    summary: OperationsSummary;
    recent: TimelineEntry[];
    judges: JudgeWorkload[];
    competitions: CompetitionWorkflow[];
    /** Yarışma bazlı sayısal izleme satırları (katılımcı adı ve rapor içeriği taşımaz). */
    overview: CompetitionOverview[];
    /** Kim neyi ne zaman ve neden arşivledi (madde 11); yalnızca görüntülenir. */
    archiveTrail: Array<{
      id: string;
      kind: "competition" | "application";
      subject: string;
      actorName: string;
      at: string;
      reason: string;
      previousStatus: string;
      nextStatus: string;
    }>;
    audit: Array<{
      id: string;
      actorEmail: string | null;
      actorRole: string | null;
      action: string;
      targetType: string | null;
      targetId: string | null;
      detail: string;
      createdAt: string;
    }>;
  }>("/api/operations"),
  /** Role göre yarışma listesi; 02 öncelik rozetini buradan okur. */
  competitions: () => jsonRequest<{ competitions: CompetitionWorkflow[] }>("/api/competitions"),
  /** Başvuruyu açma/kapatma ve sonuç yayımlama — yalnızca yarışmanın sahibi 01. */
  changeCompetitionStage: (competitionId: string, nextStatus: CompetitionStatus, reason = "", force = false) =>
    jsonRequest<{ competition: CompetitionWorkflow }>("/api/competitions", {
      method: "PATCH", body: JSON.stringify({ action: "stage", competitionId, nextStatus, reason, force }),
    }),
  /**
   * Yarışmayı AKTİF / PASİF yap — Yarışma Yöneticisi (kendi yarışması) ve
   * Değerlendirme Yöneticisi. Süreç aşamasını değiştirmez; yalnızca yeni
   * başvuru ve yeni değerlendirme kuyruğu üretimini durdurur/açar (madde 6).
   */
  setCompetitionActive: (competitionId: string, active: boolean, note = "") =>
    jsonRequest<{ competition: CompetitionWorkflow }>("/api/competitions", {
      method: "PATCH", body: JSON.stringify({ action: "activation", competitionId, active, note }),
    }),
  /** Yarışmayı arşivle (soft delete) — yalnızca yarışmanın sahibi 01 (madde 11). */
  archiveCompetition: (competitionId: string, archived: boolean, reason = "") =>
    jsonRequest<{ competition: CompetitionWorkflow }>("/api/competitions", {
      method: "PATCH", body: JSON.stringify({ action: "archive", competitionId, archived, reason }),
    }),
  /** ÖNCELİKLİ işareti koy/kaldır — yalnızca 04. */
  setCompetitionPriority: (competitionId: string, priority: boolean, note = "") =>
    jsonRequest<{ competition: CompetitionWorkflow }>("/api/competitions", {
      method: "PATCH", body: JSON.stringify({ action: "priority", competitionId, priority, note }),
    }),
  registerParticipant: (fullName: string, email: string, password: string) =>
    jsonRequest<{ account: AdminAccount; expiresAt: string }>("/api/participant/register", {
      method: "POST",
      body: JSON.stringify({ fullName, email, password }),
    }),
};
