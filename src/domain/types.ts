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

export type CaseStatus = (typeof caseStatuses)[number];
export type ActionStatus = (typeof actionStatuses)[number];
export type Priority = (typeof priorities)[number];
export type RiskLevel = (typeof riskLevels)[number];
export type ExecutionMode = (typeof executionModes)[number];
export type EvidenceKind = (typeof evidenceKinds)[number];

export type Evidence = { kind: EvidenceKind; note: string; recordedAt: string };

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
};

export type Workflow = Pick<Case, "title" | "description"> & {
  actions: Omit<Action, "caseId" | "createdAt" | "updatedAt">[];
};
