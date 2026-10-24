export const caseStatuses = ["active", "completed", "archived"] as const;
export const actionStatuses = [
  "pending",
  "ready",
  "in_progress",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
] as const;
export const priorities = ["low", "medium", "high", "urgent"] as const;
export const riskLevels = ["low", "medium", "high", "critical"] as const;
export const executionModes = ["manual", "assisted", "automated"] as const;
export const evidenceKinds = [
  "simulated",
  "user_provided",
  "verified",
] as const;
export const approvalStatuses = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "invalidated",
] as const;
export const riskCategories = [
  "low_risk",
  "requires_review",
  "high_consequence",
] as const;
export const executionStatuses = [
  "running",
  "succeeded",
  "failed",
  "uncertain",
] as const;

export type CaseStatus = (typeof caseStatuses)[number];
export type ActionStatus = (typeof actionStatuses)[number];
export type Priority = (typeof priorities)[number];
export type RiskLevel = (typeof riskLevels)[number];
export type ExecutionMode = (typeof executionModes)[number];
export type EvidenceKind = (typeof evidenceKinds)[number];
export type ApprovalStatus = (typeof approvalStatuses)[number];
export type RiskCategory = (typeof riskCategories)[number];
export type ExecutionStatus = (typeof executionStatuses)[number];

export type Evidence = { kind: EvidenceKind; note: string; recordedAt: string };

export type ProposedOperation = {
  operationType: string;
  description: string;
  destination?: string;
  payload: Record<string, unknown>;
  prohibitsAutomation?: boolean;
};

export type Approval = {
  id: string;
  caseId: string;
  actionId: string;
  status: ApprovalStatus;
  operationDescription: string;
  operationType: string;
  destination?: string | null;
  payload: string;
  payloadHash: string;
  riskCategory: RiskCategory;
  prohibitsAutomation: boolean;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string | null;
  decisionReason?: string | null;
  decisionAudit?: string | null;
};

export type ExecutionAttempt = {
  id: string;
  caseId: string;
  actionId: string;
  approvalId?: string | null;
  provider: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string | null;
  isSimulated: boolean;
  resultSummary?: string | null;
  resultDetails?: string | null;
  evidence?: Evidence | null;
  uncertaintyReason?: string | null;
};

export type Action = {
  id: string;
  caseId: string;
  title: string;
  description: string;
  status: ActionStatus;
  priority: Priority;
  dependencies: string[];
  requiredInputs: string[];
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  successCriteria: string[];
  evidence: Evidence[];
  executionMode: ExecutionMode;
  createdAt: string;
  updatedAt: string;
  approvals?: Approval[];
  executionAttempts?: ExecutionAttempt[];
};

export type Case = {
  id: string;
  title: string;
  description: string;
  originalInput: string;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  actions: Action[];
  approvals?: Approval[];
};

export type Workflow = Pick<Case, "title" | "description"> & {
  actions: Omit<Action, "caseId" | "createdAt" | "updatedAt">[];
};
