import type {
  WorkflowMode,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "../domain/types";
import { readiness } from "../domain/engine";
import { buildOperationForAction } from "./operationFactory";
import { evaluatePolicy } from "./policy";
import { requestApproval, verifyApprovalForExecution } from "./approvalService";
import { hashPayload } from "./crypto";
import type { Action, ProposedOperation } from "../domain/types";
import {
  appendWorkflowRunEvent,
  claimWorkflowRunner,
  createWorkflowRun,
  getCase,
  getWorkflowRun,
  getWorkflowRunRecord,
  listActiveWorkflowRuns,
  listWorkflowRuns,
  updateAction,
  updateExecutionAttempt,
  updateWorkflowRun,
  releaseWorkflowRunner,
} from "./repository";
import { prisma } from "./db";
import { executionController } from "./execution/controller";
import { providerRegistry } from "./execution/registry";
import type { ProviderProgressEvent } from "./execution/types";
import { normalizeJurisdictionAnswer } from "./privacyBoundary";

const activeOrchestrators = new Set<string>();
const queuedOrchestratorRuns = new Set<string>();
const terminalStatuses = new Set<WorkflowRunStatus>([
  "completed",
  "failed",
  "uncertain",
]);

function makeEvent(
  type: string,
  fields: Partial<WorkflowRunEvent> = {},
): WorkflowRunEvent {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    ...fields,
  };
}

async function appendEvent(runId: string, event: WorkflowRunEvent) {
  await appendWorkflowRunEvent(runId, event);
}

function workflowOrder(actions: Action[]): Action[] {
  return [...actions].sort((left, right) =>
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.title.localeCompare(right.title)
  );
}

function approvalMatches(
  action: Action,
  operation: ProposedOperation,
  status: "pending" | "rejected",
): boolean {
  const expectedHash = hashPayload(operation.payload);
  return Boolean(action.approvals?.some((approval) =>
    approval.status === status &&
    approval.operationType === operation.operationType &&
    approval.operationDescription === operation.description &&
    (approval.destination ?? null) === (operation.destination ?? null) &&
    approval.payloadHash === expectedHash &&
    (status !== "pending" || Date.parse(approval.expiresAt) > Date.now())
  ));
}

function hasOnlySimulatedCompletion(action: Action): boolean {
  const latestAttempt = action.executionAttempts
    ?.slice()
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
  return Boolean(latestAttempt?.isSimulated || (
    action.evidence.length > 0 && action.evidence.every((item) => item.kind === "simulated")
  ));
}

async function findRealProvider(action: Action, operation: ProposedOperation, caseId: string) {
  for (const providerName of providerRegistry.list()) {
    if (providerName === "mock-provider") continue;
    const provider = providerRegistry.get(providerName);
    const eligibility = await provider.checkEligibility({ caseId, actionId: action.id, operation });
    if (eligibility.eligible && eligibility.supportsOperation) return provider;
  }
  return null;
}

async function setRunStatus(
  runId: string,
  status: WorkflowRunStatus,
  extra: { actionId?: string | null; message?: string; error?: string | null } = {},
) {
  await updateWorkflowRun(runId, {
    status,
    currentActionId: extra.actionId,
    errorMessage: extra.error,
    finishedAt: terminalStatuses.has(status) ? new Date() : null,
    pauseRequested: false,
  });
  if (extra.message) {
    const eventType: Record<WorkflowRunStatus, string> = {
      running: "WORKFLOW_RESUMED",
      waiting_for_user: "WAITING_FOR_USER",
      waiting_for_approval: "WAITING_FOR_APPROVAL",
      blocked: "WORKFLOW_BLOCKED",
      failed: "WORKFLOW_FAILED",
      uncertain: "WORKFLOW_UNCERTAIN",
      completed: "WORKFLOW_COMPLETED",
      paused: "WORKFLOW_PAUSED",
    };
    await appendEvent(runId, makeEvent(eventType[status], {
      actionId: extra.actionId ?? undefined,
      message: extra.message,
    }));
  }
}

async function orchestrate(runId: string): Promise<void> {
  if (activeOrchestrators.has(runId)) {
    queuedOrchestratorRuns.add(runId);
    return;
  }
  activeOrchestrators.add(runId);
  let claimed = false;
  try {
    claimed = await claimWorkflowRunner(runId);
    if (!claimed) return;
    await appendEvent(runId, makeEvent("SCHEDULER_STARTED", {
      message: "Workflow runner started checking prerequisites and selecting the next eligible step.",
    }));
    while (true) {
      const runRecord = await getWorkflowRunRecord(runId);
      if (!runRecord || runRecord.status !== "running") return;
      if (runRecord.pauseRequested) {
        await setRunStatus(runId, "paused", {
          actionId: runRecord.currentActionId,
          message: runRecord.currentActionId
            ? "Pause requested. The current provider action was allowed to finish; no next action will start."
            : "Workflow paused. No new action will start until resumed.",
        });
        return;
      }

      const caseItem = await getCase(runRecord.caseId);
      if (!caseItem) {
        await setRunStatus(runId, "failed", { error: "Case no longer exists." });
        return;
      }
      const simulatedCompletion = caseItem.actions.find((action) =>
        action.status === "completed" && hasOnlySimulatedCompletion(action)
      );
      if (simulatedCompletion) {
        await setRunStatus(runId, "waiting_for_user", {
          actionId: simulatedCompletion.id,
          message: `${simulatedCompletion.title} has only simulated completion evidence. It cannot count as a real-world result; verify it yourself before continuing.`,
        });
        return;
      }
      if (caseItem.actions.every((action) => action.status === "completed")) {
        await setRunStatus(runId, "completed", {
          message: "Every workflow action has independently met its completion criteria.",
        });
        return;
      }
      if (caseItem.actions.some((action) => action.status === "failed")) {
        await setRunStatus(runId, "failed", {
          message: "A workflow action failed. Review its execution history before continuing.",
        });
        return;
      }

      const activeAction = caseItem.actions.find((action) => action.status === "in_progress");
      if (activeAction) {
        await setRunStatus(runId, "uncertain", {
          actionId: activeAction.id,
          message: "An action is already in progress. Review its persisted execution history; TRESTLE will not start another attempt.",
        });
        return;
      }

      const readinessById = new Map(readiness(caseItem.actions).map((entry) => [entry.id, entry]));
      const nextAction = workflowOrder(caseItem.actions).find((action) =>
        !["completed", "failed", "in_progress"].includes(action.status) &&
        readinessById.get(action.id)?.blockedBy.length === 0
      );

      if (nextAction) {
        const context = JSON.parse(runRecord.context) as {
          jurisdiction: string;
          documentType: string;
        };
        const operation = buildOperationForAction(nextAction, context);
        const provider = await findRealProvider(nextAction, operation, runRecord.caseId);

        if (!provider) {
          const inputHint = nextAction.requiredInputs.length > 0
            ? ` User information or action needed: ${nextAction.requiredInputs.join(", ")}.`
            : "";
          await setRunStatus(runId, "waiting_for_user", {
            actionId: nextAction.id,
            message: `${nextAction.title} is the next eligible workflow task, but no real provider supports this operation.${inputHint} TRESTLE will not use the simulated provider as a substitute.`,
          });
          return;
        }

        const policy = evaluatePolicy(nextAction, operation);
        if (policy.prohibitsAutomation) {
          await setRunStatus(runId, "waiting_for_user", {
            actionId: nextAction.id,
            message: `${nextAction.title} must be completed by you personally under the current policy.`,
          });
          return;
        }

        if (policy.requiresApproval) {
          const approved = await verifyApprovalForExecution(runRecord.caseId, nextAction.id, operation);
          if (!approved.valid) {
            if (approvalMatches(nextAction, operation, "rejected")) {
              await setRunStatus(runId, "waiting_for_user", {
                actionId: nextAction.id,
                message: `The exact operation for ${nextAction.title} was rejected. TRESTLE stopped here and will not bypass the decision.`,
              });
              return;
            }
            if (!approvalMatches(nextAction, operation, "pending")) {
              await requestApproval(runRecord.caseId, nextAction.id, operation);
            }
            await setRunStatus(runId, "waiting_for_approval", {
              actionId: nextAction.id,
              message: `Review the exact proposed operation for ${nextAction.title} in the Human Approval Queue. Approval will resume this workflow automatically; you will not need to press Execute.`,
            });
            return;
          }
        }

        await updateWorkflowRun(runId, { currentActionId: nextAction.id });
        await appendEvent(runId, makeEvent("ACTION_STARTED", {
          actionId: nextAction.id,
          message: `Starting ${provider.name === "tinyfish" ? "LIVE TINYFISH" : provider.name} for: ${nextAction.title}`,
        }));
        const result = await executionController.execute(
          runRecord.caseId,
          nextAction.id,
          {
            operation,
            providerName: provider.name,
            onProgress: async (event: ProviderProgressEvent) => {
              await appendEvent(runId, makeEvent(event.type, {
                actionId: nextAction.id,
                runId: event.runId,
                purpose: event.purpose,
                streamingUrl: event.streamingUrl,
                url: event.url,
                status: event.status,
              }));
            },
          },
        );
        await appendEvent(runId, makeEvent(result.outcome === "verified" && !result.isSimulated ? "ACTION_COMPLETED" : result.outcome === "failed" ? "ACTION_FAILED" : "ACTION_FINISHED", {
          actionId: nextAction.id,
          status: result.status,
          message: result.resultSummary,
        }));

        if (result.outcome === "verified" && !result.isSimulated) continue;
        if (result.outcome === "verified" && result.isSimulated) {
          await setRunStatus(runId, "uncertain", {
            actionId: nextAction.id,
            message: "The provider returned a simulated result. It cannot verify a real-world action, so the workflow stopped.",
          });
          return;
        }
        if (result.outcome === "uncertain" || result.outcome === "unverified") {
          await setRunStatus(runId, "uncertain", {
            actionId: nextAction.id,
            message: result.uncertaintyReason ?? "Research finished without enough evidence to verify the task.",
          });
          return;
        }
        await setRunStatus(runId, "failed", {
          actionId: nextAction.id,
          message: result.resultSummary,
          error: result.resultSummary,
        });
        return;
      }

      await setRunStatus(runId, "blocked", {
        message: "No action is currently eligible. Resolve the listed prerequisite or user-input gate to continue.",
      });
      return;
    }
  } catch (error) {
    await setRunStatus(runId, "failed", {
      error: error instanceof Error ? error.message : "Workflow orchestration failed.",
      message: "The workflow stopped because TRESTLE encountered an execution error.",
    });
  } finally {
    if (claimed) await releaseWorkflowRunner(runId);
    activeOrchestrators.delete(runId);
    if (queuedOrchestratorRuns.delete(runId)) {
      const latest = await getWorkflowRunRecord(runId).catch(() => null);
      if (latest?.status === "running") void orchestrate(runId);
    }
  }
}

export async function startWorkflow(
  caseId: string,
  input: {
    mode: WorkflowMode;
    jurisdiction: string;
    documentType: string;
  },
): Promise<{ run: WorkflowRun; created: boolean }> {
  const created = await createWorkflowRun({
    caseId,
    mode: input.mode,
    context: {
      jurisdiction: input.jurisdiction.trim(),
      documentType: input.documentType.trim(),
    },
  });
  if (created.created && input.mode === "autonomous") {
    void orchestrate(created.run.id);
  }
  return created;
}

export async function pauseWorkflow(runId: string): Promise<WorkflowRun | null> {
  const current = await getWorkflowRun(runId);
  if (!current) return null;
  if (current.status !== "running") return current;
  const isExecuting = current.currentActionId !== null;
  const updated = await updateWorkflowRun(runId, {
    pauseRequested: true,
    status: isExecuting ? "running" : "paused",
  });
  if (!isExecuting) {
    await appendEvent(runId, makeEvent("workflow_paused", {
      message: "Workflow paused. No new action will start until resumed.",
    }));
  }
  return updated;
}

export async function resumeWorkflow(
  runId: string,
  mode: WorkflowMode = "autonomous",
): Promise<WorkflowRun | null> {
  const current = await getWorkflowRun(runId);
  if (!current || terminalStatuses.has(current.status)) return current;
  const updated = await updateWorkflowRun(runId, {
    mode,
    status: "running",
    pauseRequested: false,
    errorMessage: null,
  });
  await appendEvent(runId, makeEvent("WORKFLOW_RESUMED", {
    actionId: current.currentActionId ?? undefined,
    message: "Workflow resumed. TRESTLE is rechecking the persisted action graph before scheduling work.",
  }));
  void orchestrate(runId);
  return updated;
}

export async function resumeApprovalGates(caseId: string): Promise<void> {
  const runs = await listActiveWorkflowRuns(caseId);
  for (const run of runs) {
    if (run.status !== "waiting_for_approval") continue;
    await updateWorkflowRun(run.id, { status: "running", pauseRequested: false });
    await appendEvent(run.id, makeEvent("APPROVAL_GRANTED", {
      actionId: run.currentActionId ?? undefined,
      message: "Approval recorded. TRESTLE is resuming and will revalidate the exact operation before execution.",
    }));
    void orchestrate(run.id);
  }
}

export async function stopRejectedApprovalGates(
  caseId: string,
  actionId: string,
): Promise<void> {
  const runs = await listActiveWorkflowRuns(caseId);
  for (const run of runs) {
    if (run.status !== "waiting_for_approval" || run.currentActionId !== actionId) continue;
    await setRunStatus(run.id, "waiting_for_user", {
      actionId,
      message: "The approval was rejected. TRESTLE will not execute this operation; review the task and decide whether to prepare a different request or complete it yourself.",
    });
  }
}

export async function resumeAfterUserAction(caseId: string): Promise<void> {
  const runs = await listActiveWorkflowRuns(caseId);
  const caseItem = await getCase(caseId);
  if (!caseItem) return;
  for (const run of runs) {
    if (run.status !== "waiting_for_user" || !run.currentActionId) continue;
    const action = caseItem.actions.find((item) => item.id === run.currentActionId);
    if (action?.status !== "completed") continue;
    if (action.id === "confirm-property-jurisdiction") {
      const locationEvidence = [...action.evidence].reverse().find((item) => item.kind === "user_provided");
      const jurisdiction = locationEvidence ? normalizeJurisdictionAnswer(locationEvidence.note) : null;
      const runRecord = await getWorkflowRunRecord(run.id);
      if (!jurisdiction || !runRecord) continue;
      const context = JSON.parse(runRecord.context) as { jurisdiction: string; documentType: string };
      await updateWorkflowRun(run.id, {
        context: { ...context, jurisdiction, documentType: "property purchase documents and registration" },
      });
    }
    await updateWorkflowRun(run.id, { status: "running", pauseRequested: false, errorMessage: null });
    await appendEvent(run.id, makeEvent("WORKFLOW_RESUMED", {
      actionId: run.currentActionId ?? undefined,
      message: "Your reported completion was saved. TRESTLE is checking dependencies for the next step.",
    }));
    void orchestrate(run.id);
  }
}

export async function listWorkflowRunsWithRecovery(caseId: string): Promise<WorkflowRun[]> {
  const runs = await listWorkflowRuns(caseId);
  for (const run of runs) {
    if (run.status !== "running" || activeOrchestrators.has(run.id)) continue;
    const attempt = run.currentActionId
      ? await prisma.executionAttempt.findFirst({
        where: { caseId, actionId: run.currentActionId, status: "running" },
        orderBy: { startedAt: "desc" },
      })
      : null;
    if (attempt) {
      await updateExecutionAttempt(attempt.id, {
        status: "uncertain",
        finishedAt: new Date(),
        uncertaintyReason: "The server restarted during provider execution. TRESTLE did not retry the action.",
      });
      await updateAction(run.currentActionId!, "in_progress");
    }
    await setRunStatus(run.id, "uncertain", {
      actionId: run.currentActionId,
      message: "The server stopped while this workflow was active. Review execution history; TRESTLE will not automatically repeat the provider run.",
    });
  }
  return listWorkflowRuns(caseId);
}

export function isWorkflowActive(runId: string): boolean {
  return activeOrchestrators.has(runId);
}

export async function helpWithWorkflow(
  runId: string,
  question: string,
): Promise<{ observed: string[]; guidance: string; limits: string }> {
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error("Workflow run not found.");
  const caseItem = await getCase(run.caseId);
  if (!caseItem) throw new Error("Case not found.");
  const action = run.currentActionId
    ? caseItem.actions.find((item) => item.id === run.currentActionId)
    : undefined;
  const currentActionEvents = run.events.filter((event) => event.actionId === run.currentActionId);
  const observed = currentActionEvents.slice(-12).flatMap((event) => {
    if (event.purpose) return [`TinyFish reported: ${event.purpose}`];
    if (event.type === "STREAMING_URL") return ["TinyFish provided a live browser preview URL."];
    if (event.type === "COMPLETE") return ["TinyFish reported that its browser run completed."];
    return [];
  });
  const normalizedQuestion = question.toLowerCase();
  let guidance: string;
  if (normalizedQuestion.includes("what") || normalizedQuestion.includes("doing") || normalizedQuestion.includes("current")) {
    guidance = observed.at(-1) ?? (action
      ? `The current workflow task is “${action.title}”. TRESTLE has no live page observation to report yet.`
      : "No action is currently running. Check the workflow status for the next step.");
  } else if (action) {
    guidance = `The current task is “${action.title}”: ${action.description} If you are on a government or issuing-authority site, use its own navigation and do not submit an application, upload a document, or pay a fee through this research workflow. For field-specific help, share only the field label; do not paste personal values or document numbers.`;
  } else {
    guidance = "Use the current task's official-source links and follow the issuing authority's instructions. TRESTLE will pause for actions that need your decision or personal information.";
  }
  return {
    observed: [...new Set(observed)],
    guidance,
    limits: "The TinyFish preview is read-only. TRESTLE cannot inspect its live page DOM or see user-entered browser content; this guidance is based only on persisted workflow definitions and provider-reported progress.",
  };
}
