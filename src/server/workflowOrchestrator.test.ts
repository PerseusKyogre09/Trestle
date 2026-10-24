import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, Approval, Case, WorkflowRun } from "../domain/types";
import { buildOperationForAction } from "./operationFactory";
import { hashPayload } from "./crypto";

const repository = vi.hoisted(() => ({
  appendWorkflowRunEvent: vi.fn(),
  claimWorkflowRunner: vi.fn(),
  createWorkflowRun: vi.fn(),
  getCase: vi.fn(),
  getWorkflowRun: vi.fn(),
  getWorkflowRunRecord: vi.fn(),
  listActiveWorkflowRuns: vi.fn(),
  listWorkflowRuns: vi.fn(),
  releaseWorkflowRunner: vi.fn(),
  updateAction: vi.fn(),
  updateExecutionAttempt: vi.fn(),
  updateWorkflowRun: vi.fn(),
}));
const execution = vi.hoisted(() => ({ execute: vi.fn() }));
const provider = vi.hoisted(() => ({ name: "tinyfish", checkEligibility: vi.fn() }));
const approvalService = vi.hoisted(() => ({
  requestApproval: vi.fn(),
  verifyApprovalForExecution: vi.fn(),
}));

vi.mock("./repository", () => repository);
vi.mock("./execution/controller", () => ({ executionController: execution }));
vi.mock("./execution/registry", () => ({ providerRegistry: {
  get: () => provider,
  list: () => ["tinyfish"],
} }));
vi.mock("./approvalService", () => approvalService);
vi.mock("./db", () => ({ prisma: { executionAttempt: { findFirst: vi.fn() } } }));

function makeAction(
  id: string,
  dependencies: string[] = [],
  sequence = 0,
): Action {
  return {
    id,
    caseId: "case-1",
    sequence,
    title: id,
    description: `Action ${id}`,
    status: "pending",
    priority: "medium",
    dependencies,
    requiredInputs: [],
    riskLevel: "medium",
    approvalRequired: false,
    successCriteria: ["An official source and applicable procedure are recorded for verification."],
    evidence: [],
    executionMode: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvals: [],
    executionAttempts: [],
  };
}

const workflowRun: WorkflowRun = {
  id: "workflow-1",
  caseId: "case-1",
  status: "running",
  mode: "autonomous",
  currentActionId: null,
  pauseRequested: false,
  errorMessage: null,
  events: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  finishedAt: null,
};

describe("workflow orchestration", () => {
  let caseItem: Case;
  let runRecord: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    caseItem = {
      id: "case-1",
      title: "Lost document",
      description: "Lost a driving licence",
      originalInput: "private original input",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      actions: [
        makeAction("replacement-requirements", ["identify-reporting"], 1),
        makeAction("identify-reporting", [], 0),
      ],
    };
    runRecord = {
      ...workflowRun,
      context: JSON.stringify({ jurisdiction: "India", documentType: "driving licence" }),
      events: "[]",
    };
    repository.createWorkflowRun.mockResolvedValue({ run: workflowRun, created: true });
    repository.claimWorkflowRunner.mockResolvedValue(true);
    repository.getWorkflowRunRecord.mockImplementation(async () => runRecord);
    repository.getWorkflowRun.mockImplementation(async () => ({
      ...workflowRun,
      status: runRecord.status,
      currentActionId: runRecord.currentActionId ?? null,
    }));
    repository.getCase.mockImplementation(async () => caseItem);
    repository.listActiveWorkflowRuns.mockImplementation(async () => [{
      id: workflowRun.id,
      status: runRecord.status,
      currentActionId: runRecord.currentActionId,
    }]);
    repository.updateWorkflowRun.mockImplementation(async (_id, data) => {
      Object.assign(runRecord, data);
      return { ...workflowRun, ...data };
    });
    repository.appendWorkflowRunEvent.mockResolvedValue(null);
    provider.checkEligibility.mockImplementation(async (context) => ({
      eligible: context.operation.operationType === "lost_document_research",
      supportsOperation: context.operation.operationType === "lost_document_research",
      reason: "This provider supports read-only lost-document research only.",
    }));
    approvalService.verifyApprovalForExecution.mockResolvedValue({
      valid: false,
      reason: "No approved authorization found for this action.",
    });
    approvalService.requestApproval.mockResolvedValue({ id: "approval-1", status: "pending" });
    execution.execute.mockImplementation(async (_caseId, actionId, options) => {
      const action = caseItem.actions.find((item) => item.id === actionId)!;
      action.status = "completed";
      await options.onProgress?.({ type: "COMPLETE", runId: `provider-${actionId}`, status: "COMPLETED" });
      return {
        attemptId: `attempt-${actionId}`,
        actionId,
        caseId: "case-1",
        status: "succeeded",
        outcome: "verified",
        provider: "tinyfish",
        isSimulated: false,
        resultSummary: "Research verified",
        policyReasons: [],
      };
    });
  });

  it("selects the earliest dependency-ready action by persisted sequence, not array order or action ID", async () => {
    const manualFirst = makeAction("secure-cards", [], -1);
    manualFirst.title = "Secure affected bank cards";
    manualFirst.requiredInputs = ["Card issuer contact details"];
    caseItem.actions.find((action) => action.id === "identify-reporting")!.sequence = 2;
    caseItem.actions.find((action) => action.id === "replacement-requirements")!.sequence = 3;
    caseItem.actions = [caseItem.actions[0], manualFirst, caseItem.actions[1]];

    const { startWorkflow } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });

    await vi.waitFor(() => expect(runRecord.status).toBe("waiting_for_user"));
    expect(runRecord.currentActionId).toBe("secure-cards");
    expect(execution.execute).not.toHaveBeenCalled();
    expect(repository.appendWorkflowRunEvent).toHaveBeenCalledWith(
      workflowRun.id,
      expect.objectContaining({ type: "WAITING_FOR_USER" }),
    );
  });

  it("resumes from the next dependency-ready task after the user records the current step", async () => {
    const manualFirst = makeAction("secure-cards", [], -1);
    manualFirst.requiredInputs = ["Card issuer contact details"];
    caseItem.actions = [...caseItem.actions, manualFirst];

    const { startWorkflow, resumeAfterUserAction } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });
    await vi.waitFor(() => expect(runRecord.status).toBe("waiting_for_user"));

    manualFirst.status = "completed";
    await resumeAfterUserAction("case-1");
    await vi.waitFor(() => expect(runRecord.status).toBe("completed"));

    expect(execution.execute.mock.calls.map((call) => call[1])).toEqual([
      "identify-reporting",
      "replacement-requirements",
    ]);
    expect(repository.appendWorkflowRunEvent).toHaveBeenCalledWith(
      workflowRun.id,
      expect.objectContaining({ type: "WORKFLOW_RESUMED" }),
    );
  });

  it("runs safe actions automatically in persisted dependency order", async () => {
    const { startWorkflow } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });

    await vi.waitFor(() => expect(runRecord.status).toBe("completed"));
    expect(execution.execute.mock.calls.map((call) => call[1])).toEqual([
      "identify-reporting",
      "replacement-requirements",
    ]);
    expect(caseItem.actions.every((action) => action.status === "completed")).toBe(true);
  });

  it("pauses for exact authorization and automatically executes after approval", async () => {
    const action = makeAction("review-action", [], 0);
    action.title = "Review a consequential operation";
    action.riskLevel = "high";
    action.approvalRequired = true;
    caseItem.actions = [action];
    provider.checkEligibility.mockResolvedValue({ eligible: true, supportsOperation: true });

    const { startWorkflow, resumeApprovalGates } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });
    await vi.waitFor(() => expect(runRecord.status).toBe("waiting_for_approval"));
    expect(approvalService.requestApproval).toHaveBeenCalledTimes(1);
    expect(execution.execute).not.toHaveBeenCalled();

    action.status = "ready";
    action.approvals = [{
      id: "approval-1",
      caseId: "case-1",
      actionId: action.id,
      status: "approved",
      operationDescription: "Review a consequential operation",
      operationType: "review_action",
      destination: null,
      payload: "{}",
      payloadHash: "approved-hash",
      riskCategory: "requires_review",
      prohibitsAutomation: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as Approval];
    approvalService.verifyApprovalForExecution.mockResolvedValue({ valid: true });
    repository.listActiveWorkflowRuns.mockResolvedValue([{ id: workflowRun.id, status: "waiting_for_approval", currentActionId: action.id }]);

    await resumeApprovalGates("case-1");
    await vi.waitFor(() => expect(runRecord.status).toBe("completed"));
    expect(execution.execute).toHaveBeenCalledTimes(1);
    expect(execution.execute.mock.calls[0][2].providerName).toBe("tinyfish");
  });

  it("does not repeat an approval request after the user rejected that exact operation", async () => {
    const action = makeAction("review-action", [], 0);
    action.title = "Review a consequential operation";
    action.riskLevel = "high";
    action.approvalRequired = true;
    caseItem.actions = [action];
    provider.checkEligibility.mockResolvedValue({ eligible: true, supportsOperation: true });
    const operation = buildOperationForAction(action);
    action.approvals = [{
      id: "approval-rejected",
      caseId: "case-1",
      actionId: action.id,
      status: "rejected",
      operationDescription: operation.description,
      operationType: operation.operationType,
      destination: null,
      payload: JSON.stringify(operation.payload),
      payloadHash: hashPayload(operation.payload),
      riskCategory: "requires_review",
      prohibitsAutomation: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as Approval];

    const { startWorkflow } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });

    await vi.waitFor(() => expect(runRecord.status).toBe("waiting_for_user"));
    expect(approvalService.requestApproval).not.toHaveBeenCalled();
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it("stops after an uncertain provider outcome", async () => {
    execution.execute.mockImplementationOnce(async () => ({
      attemptId: "attempt-uncertain",
      actionId: "identify-reporting",
      caseId: "case-1",
      status: "uncertain",
      outcome: "uncertain",
      provider: "tinyfish",
      isSimulated: false,
      resultSummary: "TinyFish run is inconclusive",
      uncertaintyReason: "No terminal result was received.",
      policyReasons: [],
    }));
    const { startWorkflow } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });

    await vi.waitFor(() => expect(runRecord.status).toBe("uncertain"));
    expect(execution.execute).toHaveBeenCalledTimes(1);
  });

  it("never treats a simulated result as workflow completion", async () => {
    execution.execute.mockImplementationOnce(async (_caseId, actionId) => {
      const action = caseItem.actions.find((item) => item.id === actionId)!;
      action.status = "completed";
      return {
        attemptId: "attempt-simulated",
        actionId,
        caseId: "case-1",
        status: "succeeded",
        outcome: "verified",
        provider: "mock-provider",
        isSimulated: true,
        resultSummary: "Simulated only",
        policyReasons: [],
      };
    });
    provider.checkEligibility.mockResolvedValue({ eligible: true, supportsOperation: true });

    const { startWorkflow } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });

    await vi.waitFor(() => expect(runRecord.status).toBe("uncertain"));
    expect(execution.execute).toHaveBeenCalledTimes(1);
    expect(runRecord.status).not.toBe("completed");
  });

  it("stops after a failed result and does not run a dependent action", async () => {
    execution.execute.mockImplementationOnce(async () => ({
      attemptId: "attempt-1",
      actionId: "identify-reporting",
      caseId: "case-1",
      status: "failed",
      outcome: "failed",
      provider: "tinyfish",
      isSimulated: false,
      resultSummary: "Provider failed",
      policyReasons: [],
    }));
    const { startWorkflow } = await import("./workflowOrchestrator");
    await startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" });

    await vi.waitFor(() => expect(runRecord.status).toBe("failed"));
    expect(execution.execute).toHaveBeenCalledTimes(1);
    expect(caseItem.actions.find((action) => action.id === "replacement-requirements")?.status).toBe("pending");
  });

  it("does not launch duplicate executions for duplicate workflow starts", async () => {
    repository.createWorkflowRun
      .mockResolvedValueOnce({ run: workflowRun, created: true })
      .mockResolvedValueOnce({ run: workflowRun, created: false });
    const { startWorkflow } = await import("./workflowOrchestrator");
    await Promise.all([
      startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" }),
      startWorkflow("case-1", { mode: "autonomous", jurisdiction: "India", documentType: "driving licence" }),
    ]);

    await vi.waitFor(() => expect(runRecord.status).toBe("completed"));
    expect(execution.execute).toHaveBeenCalledTimes(2);
  });
});
