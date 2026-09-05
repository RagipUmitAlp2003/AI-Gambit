export type PreparationState = "missing" | "queued" | "running" | "ready" | "partial" | "empty" | "failed";
export type SimilarityAiLevel = "common" | "technical_common" | "conceptual" | "strong" | "insufficient";
export type SimilarityAiReview = {
 level: SimilarityAiLevel;
 label: string;
 explanation: string;
 confidence: "low" | "medium" | "high";
};
export type BulkPair = {
 key: string; leftId: string; rightId: string; leftLabel: string; rightLabel: string;
 percent: number; directCount: number; semanticCount: number;
 evidence: Array<{ kind: "direct" | "semantic"; leftPage: number; rightPage: number;
 leftSection: string; rightSection: string; leftText: string; rightText: string }>;
 aiReview?: SimilarityAiReview;
 /** Yalnızca oturumdaki hakemin kendisine atanmış, onaylı raporu için true olur. */
 canMarkLeftNegative?: boolean;
 canMarkRightNegative?: boolean;
};
export type BulkOverview = {
 poolSize: number; readyCount: number; missingCount: number; emptyCount: number;
 reports: Array<{ id: string; label: string; state: PreparationState; canPrepare: boolean; message: string }>;
 run: null | { status: "running" | "completed" | "stale"; processed: number; total: number;
 possiblePairs: number; screened: boolean; pairs: BulkPair[]; updatedAt: string;
 aiStatus: "not_started" | "completed" | "failed" | "skipped";
 aiCandidateCount: number; aiMessage: string; aiModel: string; aiReviewedAt: string | null };
 notice?: string;
};
