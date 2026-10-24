import { z } from "zod";
import {
  actionStatuses,
  approvalStatuses,
  caseStatuses,
  evidenceKinds,
  executionModes,
  executionStatuses,
  priorities,
  riskCategories,
  riskLevels,
} from "./types";

export const evidenceSchema = z.object({
  kind: z.enum(evidenceKinds),
  note: z.string().min(1),
  recordedAt: z.string(),
});

export const actionSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(actionStatuses),
  priority: z.enum(priorities),
  dependencies: z.array(z.string()),
  requiredInputs: z.array(z.string()),
  riskLevel: z.enum(riskLevels),
  approvalRequired: z.boolean(),
  successCriteria: z.array(z.string().min(1)),
  evidence: z.array(evidenceSchema),
  executionMode: z.enum(executionModes),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const caseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  originalInput: z.string().min(1),
  status: z.enum(caseStatuses),
  createdAt: z.string(),
  updatedAt: z.string(),
  actions: z.array(actionSchema),
});

export const createCaseSchema = z.object({
  originalInput: z.string().trim().min(
    10,
    "Describe the life event in more detail.",
  ),
});

export const transitionSchema = z.object({
  status: z.enum(["in_progress", "completed", "failed", "awaiting_approval", "ready"]),
  evidence: evidenceSchema.optional(),
  note: z.string().optional(),
});

export const approvalStatusSchema = z.enum(approvalStatuses);
export const riskCategorySchema = z.enum(riskCategories);
export const executionStatusSchema = z.enum(executionStatuses);

export const proposedOperationSchema = z.object({
  operationType: z.string().min(1, "Operation type is required."),
  description: z.string().min(1, "Description is required."),
  destination: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  prohibitsAutomation: z.boolean().optional(),
});

export const requestApprovalSchema = z.object({
  operation: proposedOperationSchema,
  expiresInSeconds: z.number().int().positive().optional(),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
  reason: z.string().optional(),
  decidedBy: z.string().optional(),
});

export const executeActionSchema = z.object({
  operation: proposedOperationSchema.optional(),
  provider: z.string().optional(),
});
