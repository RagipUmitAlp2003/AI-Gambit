import type { JudgeReview, ProfileExport, ReportEvaluation } from "./types";

export type ApplicationStatus =
  | "submitted"
  | "analyzing"
  | "awaiting_judge"
  | "completed"
  | "analysis_failed";

export type ApplicationOutcome = "pending" | "accepted" | "rejected" | "revision_required";

export type ApplicationTeamMember = {
  id: string;
  fullName: string;
};

export type PublishedProfile = {
  id: string;
  competitionKey: string;
  competitionName: string;
  category: string;
  stage: string;
  reportType: string;
  sourceDocumentName: string;
  profile: ProfileExport;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CompetitionApplication = {
  id: string;
  participantId: string;
  participantName: string;
  participantEmail: string | null;
  applicantFullName: string;
  teamName: string;
  teamMembers: ApplicationTeamMember[];
  competitionKey: string;
  competitionName: string;
  profileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: ApplicationStatus;
  evaluation: ReportEvaluation | null;
  review: JudgeReview | null;
  judgeId: string | null;
  judgeName: string | null;
  outcome: ApplicationOutcome;
  outcomeNote: string;
  decidedAt: string | null;
  submittedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CriteriaExtractionRun = {
  id: string;
  sourceDocumentName: string;
  competitionName: string;
  criteriaCount: number;
  status: "analyzed" | "approved";
  profileId: string | null;
  createdBy: string;
  createdByName: string;
  analyzedAt: string;
  updatedAt: string;
};
