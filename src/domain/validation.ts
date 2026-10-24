import { z } from "zod";
import {
  actionStatuses,
  caseStatuses,
  evidenceKinds,
  executionModes,
  priorities,
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
  status: z.enum(["in_progress", "completed", "failed"]),
  evidence: evidenceSchema.optional(),
  note: z.string().optional(),
});
