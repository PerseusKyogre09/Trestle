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
  WorkflowMode,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunStatus,
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
  sequence: a.sequence,
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
        create: workflow.actions.map((a, sequence) => ({
          id: a.id,
          sequence,
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
      a.status === "pending" || a.status === "blocked"
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
      status: { in: ["pending", "ready", "blocked", "awaiting_approval"] },
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

function mapWorkflowRun(run: {
  id: string;
  caseId: string;
  status: string;
  mode: string;
  currentActionId: string | null;
  pauseRequested: boolean;
  errorMessage: string | null;
  events: string;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}): WorkflowRun {
  return {
    id: run.id,
    caseId: run.caseId,
    status: run.status as WorkflowRunStatus,
    mode: run.mode as WorkflowMode,
    currentActionId: run.currentActionId,
    pauseRequested: run.pauseRequested,
    errorMessage: run.errorMessage,
    events: parse<WorkflowRunEvent[]>(run.events),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

const terminalWorkflowStatuses = new Set<WorkflowRunStatus>([
  "failed",
  "uncertain",
  "completed",
]);

export async function createWorkflowRun(input: {
  caseId: string;
  mode: WorkflowMode;
  context: { jurisdiction: string; documentType: string };
}): Promise<{ run: WorkflowRun; created: boolean }> {
  const existing = await prisma.workflowRun.findFirst({
    where: { activeLock: input.caseId },
  });
  if (existing) return { run: mapWorkflowRun(existing), created: false };

  try {
    const created = await prisma.workflowRun.create({
      data: {
        id: crypto.randomUUID(),
        caseId: input.caseId,
        mode: input.mode,
        status: input.mode === "autonomous" ? "running" : "waiting_for_user",
        activeLock: input.caseId,
        context: JSON.stringify(input.context),
        events: JSON.stringify([{
          id: crypto.randomUUID(),
          type: "WORKFLOW_STARTED",
          timestamp: new Date().toISOString(),
          message: input.mode === "autonomous"
            ? "Autonomous workflow started. TRESTLE will run eligible read-only research and pause at user or approval gates."
            : "Guided workflow started. TRESTLE will provide instructions without controlling your browser.",
        } satisfies WorkflowRunEvent]),
      },
    });
    return { run: mapWorkflowRun(created), created: true };
  } catch (error) {
    const raced = await prisma.workflowRun.findFirst({
      where: { activeLock: input.caseId },
    });
    if (raced) return { run: mapWorkflowRun(raced), created: false };
    throw error;
  }
}

export async function getWorkflowRun(id: string): Promise<WorkflowRun | null> {
  const run = await prisma.workflowRun.findUnique({ where: { id } });
  return run ? mapWorkflowRun(run) : null;
}

export async function getWorkflowRunRecord(id: string) {
  return prisma.workflowRun.findUnique({ where: { id } });
}

export async function claimWorkflowRunner(id: string): Promise<boolean> {
  const result = await prisma.workflowRun.updateMany({
    where: { id, status: "running", runnerClaimed: false },
    data: { runnerClaimed: true },
  });
  return result.count === 1;
}

export async function releaseWorkflowRunner(id: string): Promise<void> {
  await prisma.workflowRun.updateMany({
    where: { id },
    data: { runnerClaimed: false },
  });
}

export async function listWorkflowRuns(caseId: string): Promise<WorkflowRun[]> {
  const runs = await prisma.workflowRun.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
  });
  return runs.map(mapWorkflowRun);
}

export async function listActiveWorkflowRuns(caseId: string) {
  return prisma.workflowRun.findMany({
    where: { caseId, activeLock: caseId },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateWorkflowRun(
  id: string,
  data: Partial<{
    status: WorkflowRunStatus;
    mode: WorkflowMode;
    currentActionId: string | null;
    pauseRequested: boolean;
    errorMessage: string | null;
    finishedAt: Date | null;
  }>,
): Promise<WorkflowRun | null> {
  const status = data.status;
  const updated = await prisma.workflowRun.update({
    where: { id },
    data: {
      ...data,
      activeLock: status && terminalWorkflowStatuses.has(status) ? null : undefined,
      runnerClaimed: status && terminalWorkflowStatuses.has(status) ? false : undefined,
    },
  });
  return mapWorkflowRun(updated);
}

export async function appendWorkflowRunEvent(
  id: string,
  event: WorkflowRunEvent,
): Promise<WorkflowRun | null> {
  const run = await prisma.workflowRun.findUnique({ where: { id } });
  if (!run) return null;
  const events = parse<WorkflowRunEvent[]>(run.events);
  events.push(event);
  await prisma.workflowRun.update({
    where: { id },
    data: { events: JSON.stringify(events.slice(-300)) },
  });
  return getWorkflowRun(id);
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
