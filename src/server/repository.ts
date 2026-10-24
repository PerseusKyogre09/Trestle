import { prisma } from "./db";
import type {
  Action,
  Approval,
  ApprovalStatus,
  Case,
  Evidence,
  ExecutionAttempt,
  ExecutionStatus,
  RiskCategory,
  Workflow,
} from "../domain/types";
import { readiness } from "../domain/engine";

const parse = <T>(value: string): T => JSON.parse(value) as T;

export const mapApproval = (
  a: Awaited<ReturnType<typeof prisma.approval.findMany>>[number],
): Approval => ({
  id: a.id,
  caseId: a.caseId,
  actionId: a.actionId,
  status: a.status as ApprovalStatus,
  operationDescription: a.operationDescription,
  operationType: a.operationType,
  destination: a.destination,
  payload: a.payload,
  payloadHash: a.payloadHash,
  riskCategory: a.riskCategory as RiskCategory,
  prohibitsAutomation: a.prohibitsAutomation,
  createdAt: a.createdAt.toISOString(),
  expiresAt: a.expiresAt.toISOString(),
  decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
  decisionReason: a.decisionReason,
  decisionAudit: a.decisionAudit,
});

export const mapExecutionAttempt = (
  e: Awaited<ReturnType<typeof prisma.executionAttempt.findMany>>[number],
): ExecutionAttempt => ({
  id: e.id,
  caseId: e.caseId,
  actionId: e.actionId,
  approvalId: e.approvalId,
  provider: e.provider,
  status: e.status as ExecutionStatus,
  startedAt: e.startedAt.toISOString(),
  finishedAt: e.finishedAt ? e.finishedAt.toISOString() : null,
  isSimulated: e.isSimulated,
  resultSummary: e.resultSummary,
  resultDetails: e.resultDetails,
  evidence: e.evidence ? parse<Evidence>(e.evidence) : null,
  uncertaintyReason: e.uncertaintyReason,
});

export const mapAction = (
  a: Awaited<ReturnType<typeof prisma.action.findMany>>[number] & {
    approvals?: Awaited<ReturnType<typeof prisma.approval.findMany>>;
    executionAttempts?: Awaited<
      ReturnType<typeof prisma.executionAttempt.findMany>
    >;
  },
): Action => ({
  id: a.id,
  caseId: a.caseId,
  title: a.title,
  description: a.description,
  status: a.status as Action["status"],
  priority: a.priority as Action["priority"],
  riskLevel: a.riskLevel as Action["riskLevel"],
  approvalRequired: a.approvalRequired,
  executionMode: a.executionMode as Action["executionMode"],
  dependencies: parse<string[]>(a.dependencies),
  requiredInputs: parse<string[]>(a.requiredInputs),
  successCriteria: parse<string[]>(a.successCriteria),
  evidence: parse<Evidence[]>(a.evidence),
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
  approvals: a.approvals ? a.approvals.map(mapApproval) : undefined,
  executionAttempts: a.executionAttempts
    ? a.executionAttempts.map(mapExecutionAttempt)
    : undefined,
});

export async function createCase(
  input: string,
  workflow: Workflow,
): Promise<Case> {
  const id = crypto.randomUUID();
  const result = await prisma.case.create({
    data: {
      id,
      title: workflow.title,
      description: workflow.description,
      originalInput: input,
      actions: {
        create: workflow.actions.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          status: a.status,
          priority: a.priority,
          riskLevel: a.riskLevel,
          approvalRequired: a.approvalRequired,
          requiredInputs: JSON.stringify(a.requiredInputs),
          successCriteria: JSON.stringify(a.successCriteria),
          evidence: JSON.stringify(a.evidence),
          executionMode: a.executionMode,
          dependencies: JSON.stringify(a.dependencies),
        })),
      },
    },
    include: {
      actions: {
        include: {
          approvals: true,
          executionAttempts: true,
        },
      },
      approvals: true,
    },
  });

  return {
    ...result,
    status: result.status as Case["status"],
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
    actions: result.actions.map(mapAction),
    approvals: result.approvals ? result.approvals.map(mapApproval) : undefined,
  };
}

const mapCase = (
  result: NonNullable<Awaited<ReturnType<typeof prisma.case.findUnique>>> & {
    actions: Array<
      Awaited<ReturnType<typeof prisma.action.findMany>>[number] & {
        approvals?: Awaited<ReturnType<typeof prisma.approval.findMany>>;
        executionAttempts?: Awaited<
          ReturnType<typeof prisma.executionAttempt.findMany>
        >;
      }
    >;
    approvals?: Awaited<ReturnType<typeof prisma.approval.findMany>>;
  },
): Case => {
  const actions = result.actions.map(mapAction);
  const ready = readiness(actions);
  return {
    ...result,
    status: result.status as Case["status"],
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
    actions: actions.map((a: Action) =>
      a.status === "pending"
        ? {
          ...a,
          status: ready.find((r) => r.id === a.id)?.ready ? "ready" : "blocked",
        }
        : a
    ),
    approvals: result.approvals ? result.approvals.map(mapApproval) : undefined,
  };
};

export async function listCases(): Promise<Case[]> {
  const results = await prisma.case.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      actions: {
        include: {
          approvals: true,
          executionAttempts: true,
        },
      },
      approvals: true,
    },
  });
  return results.map(mapCase);
}

export async function getCase(id: string): Promise<Case | null> {
  const result = await prisma.case.findUnique({
    where: { id },
    include: {
      actions: {
        include: {
          approvals: true,
          executionAttempts: true,
        },
      },
      approvals: true,
    },
  });
  return result ? mapCase(result) : null;
}

export async function updateAction(
  id: string,
  status: string,
  evidence?: Evidence,
) {
  const a = await prisma.action.findUnique({ where: { id } });
  if (!a) return null;
  const nextEvidence = evidence
    ? [...parse<Evidence[]>(a.evidence), evidence]
    : parse<Evidence[]>(a.evidence);
  return prisma.action.update({
    where: { id },
    data: { status, evidence: JSON.stringify(nextEvidence) },
  });
}

// Approval Database Helpers
export async function createApproval(data: {
  id?: string;
  caseId: string;
  actionId: string;
  status?: ApprovalStatus;
  operationDescription: string;
  operationType: string;
  destination?: string | null;
  payload: string;
  payloadHash: string;
  riskCategory: RiskCategory;
  prohibitsAutomation?: boolean;
  expiresAt: Date;
  decisionReason?: string | null;
  decisionAudit?: string | null;
}): Promise<Approval> {
  const id = data.id ?? crypto.randomUUID();
  const created = await prisma.approval.create({
    data: {
      id,
      caseId: data.caseId,
      actionId: data.actionId,
      status: data.status ?? "pending",
      operationType: data.operationType,
      operationDescription: data.operationDescription,
      destination: data.destination ?? null,
      payload: data.payload,
      payloadHash: data.payloadHash,
      riskCategory: data.riskCategory,
      prohibitsAutomation: data.prohibitsAutomation ?? false,
      expiresAt: data.expiresAt,
      decisionReason: data.decisionReason ?? null,
      decisionAudit: data.decisionAudit ?? null,
    },
  });
  return mapApproval(created);
}

export async function getApprovalById(id: string): Promise<Approval | null> {
  const found = await prisma.approval.findUnique({ where: { id } });
  return found ? mapApproval(found) : null;
}

export async function getApprovalsByCaseId(
  caseId: string,
  options?: { actionId?: string; status?: ApprovalStatus },
): Promise<Approval[]> {
  const where: { caseId: string; actionId?: string; status?: string } = {
    caseId,
  };
  if (options?.actionId) where.actionId = options.actionId;
  if (options?.status) where.status = options.status;

  const found = await prisma.approval.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return found.map(mapApproval);
}

export async function updateApproval(
  id: string,
  data: Partial<{
    status: ApprovalStatus;
    decidedAt: Date | null;
    decisionReason: string | null;
    decisionAudit: string | null;
  }>,
): Promise<Approval | null> {
  const updated = await prisma.approval.update({
    where: { id },
    data,
  });
  return mapApproval(updated);
}

export async function decideApprovalAtomically(
  id: string,
  status: ApprovalStatus,
  data: {
    decidedAt: Date;
    decisionReason: string;
    decisionAudit: string;
  },
): Promise<Approval | null> {
  const result = await prisma.approval.updateMany({
    where: {
      id,
      status: "pending",
      expiresAt: { gt: data.decidedAt },
    },
    data: { status, ...data },
  });
  if (result.count !== 1) return null;
  return getApprovalById(id);
}

export async function claimActionForExecution(
  caseId: string,
  actionId: string,
): Promise<boolean> {
  const result = await prisma.action.updateMany({
    where: {
      id: actionId,
      caseId,
      status: { in: ["pending", "ready", "awaiting_approval", "in_progress"] },
    },
    data: { status: "in_progress" },
  });
  return result.count === 1;
}

// Execution Attempt Database Helpers
export async function createExecutionAttempt(data: {
  id?: string;
  caseId: string;
  actionId: string;
  approvalId?: string | null;
  provider: string;
  status: ExecutionStatus;
  isSimulated?: boolean;
  resultSummary?: string | null;
  resultDetails?: string | null;
  evidence?: Evidence | null;
  uncertaintyReason?: string | null;
}): Promise<ExecutionAttempt> {
  const id = data.id ?? crypto.randomUUID();
  const created = await prisma.executionAttempt.create({
    data: {
      id,
      caseId: data.caseId,
      actionId: data.actionId,
      approvalId: data.approvalId ?? null,
      provider: data.provider,
      status: data.status,
      isSimulated: data.isSimulated ?? true,
      resultSummary: data.resultSummary ?? null,
      resultDetails: data.resultDetails ?? null,
      evidence: data.evidence ? JSON.stringify(data.evidence) : null,
      uncertaintyReason: data.uncertaintyReason ?? null,
    },
  });
  return mapExecutionAttempt(created);
}

export async function updateExecutionAttempt(
  id: string,
  data: Partial<{
    status: ExecutionStatus;
    finishedAt: Date | null;
    resultSummary: string | null;
    resultDetails: string | null;
    evidence: Evidence | null;
    uncertaintyReason: string | null;
  }>,
): Promise<ExecutionAttempt | null> {
  const updated = await prisma.executionAttempt.update({
    where: { id },
    data: {
      status: data.status,
      finishedAt: data.finishedAt,
      resultSummary: data.resultSummary,
      resultDetails: data.resultDetails,
      evidence: data.evidence ? JSON.stringify(data.evidence) : undefined,
      uncertaintyReason: data.uncertaintyReason,
    },
  });
  return mapExecutionAttempt(updated);
}

export async function getExecutionAttemptsByActionId(
  actionId: string,
): Promise<ExecutionAttempt[]> {
  const attempts = await prisma.executionAttempt.findMany({
    where: { actionId },
    orderBy: { startedAt: "desc" },
  });
  return attempts.map(mapExecutionAttempt);
}

export async function resetCaseForDemo(caseId: string): Promise<boolean> {
  const result = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.case.findUnique({ where: { id: caseId } });
    if (!existing) return false;

    await transaction.executionAttempt.deleteMany({ where: { caseId } });
    await transaction.approval.deleteMany({ where: { caseId } });
    await transaction.action.updateMany({
      where: { caseId },
      data: { status: "pending", evidence: "[]" },
    });
    return true;
  });

  return result;
}
