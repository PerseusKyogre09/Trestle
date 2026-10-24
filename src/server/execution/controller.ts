import { assertTransition } from "../../domain/engine";
import type {
  Action,
  Evidence,
  ExecutionStatus,
  ProposedOperation,
} from "../../domain/types";
import { verifyApprovalForExecution } from "../approvalService";
import { evaluatePolicy } from "../policy";
import {
  claimActionForExecution,
  createExecutionAttempt,
  getCase,
  updateAction,
  updateExecutionAttempt,
} from "../repository";
import { providerRegistry } from "./registry";
import type {
  ExecutionContext,
  ProviderExecutionResult,
  ProviderProgressEvent,
} from "./types";

export class ExecutionControllerError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "ExecutionControllerError";
  }
}

export type ExecutionOutcome =
  | "verified"
  | "unverified"
  | "uncertain"
  | "failed";

export interface ExecutionControllerResult {
  attemptId: string;
  actionId: string;
  caseId: string;
  status: ExecutionStatus;
  outcome: ExecutionOutcome;
  provider: string;
  isSimulated: boolean;
  resultSummary: string;
  evidence?: Evidence | null;
  uncertaintyReason?: string | null;
  policyReasons: string[];
}

function meetsConfiguredSuccessCriteria(
  action: Action,
  operation: ProposedOperation,
  providerResult: ProviderExecutionResult,
): boolean {
  if (
    operation.operationType === "enter_form_details" ||
    operation.operationType === "populate_form" ||
    operation.operationType === "select_document_upload" ||
    operation.operationType === "click_element" ||
    operation.payload.isIntermediateStep === true ||
    !providerResult.canVerifyOutcome ||
    !providerResult.evidence
  ) {
    return false;
  }

  if (operation.operationType !== "lost_document_research") return true;

  const details = providerResult.details ?? {};
  const sourceUrls = Array.isArray(details.sourceUrls)
    ? details.sourceUrls.filter((url): url is string => {
      if (typeof url !== "string") return false;
      try {
        return new URL(url).protocol === "https:";
      } catch {
        return false;
      }
    })
    : [];
  const hasProcedureDetails = [details.requirements, details.nextSteps].some(
    (items) => Array.isArray(items) && items.some(
      (item) => typeof item === "string" && item.trim().length > 0,
    ),
  );

  return action.successCriteria.every((criterion) => {
    const normalized = criterion.toLowerCase();
    if (normalized.includes("official source")) return sourceUrls.length > 0;
    if (normalized.includes("procedure")) return hasProcedureDetails;
    return false;
  });
}

// In-memory concurrency locks to prevent duplicate concurrent executions on the same action
const activeExecutionLocks = new Set<string>();

export class ExecutionController {
  /**
   * Executes an action within a case according to safety policy,
   * approval verification, and provider outcome verification.
   */
  async execute(
    caseId: string,
    actionId: string,
    options: {
      operation?: ProposedOperation;
      providerName?: string;
      onProgress?: (event: ProviderProgressEvent) => Promise<void>;
    } = {},
  ): Promise<ExecutionControllerResult> {
    // 1. Prevent duplicate concurrent execution
    if (activeExecutionLocks.has(actionId)) {
      throw new ExecutionControllerError(
        "An execution attempt is already in progress for this action.",
        409,
      );
    }
    activeExecutionLocks.add(actionId);

    try {
      // 2. Load case and action
      const caseItem = await getCase(caseId);
      if (!caseItem) {
        throw new ExecutionControllerError("Case not found.", 404);
      }

      const action = caseItem.actions.find((a) => a.id === actionId);
      if (!action) {
        throw new ExecutionControllerError(
          "Action not found in this case.",
          404,
        );
      }

      // 3. Workflow engine eligibility check: dependencies
      const blockedBy = action.dependencies.filter((depId) => {
        const dep = caseItem.actions.find((a) => a.id === depId);
        return dep?.status !== "completed";
      });

      if (blockedBy.length > 0) {
        throw new ExecutionControllerError(
          `This action is blocked by incomplete prerequisites: ${
            blockedBy.join(", ")
          }.`,
          409,
        );
      }

      if (action.status === "completed") {
        throw new ExecutionControllerError(
          "Action has already been completed.",
          409,
        );
      }

      if (
        action.status === "in_progress" &&
        (action.executionAttempts?.length ?? 0) > 0
      ) {
        throw new ExecutionControllerError(
          "Action already has an execution in progress or requires manual reconciliation.",
          409,
        );
      }

      // 4. Construct proposed operation if not provided
      let operation: ProposedOperation = options.operation ?? {
        operationType: action.approvalRequired
          ? "review_action"
          : "read_public_info",
        description: action.description,
        destination: undefined,
        payload: { actionId: action.id, title: action.title },
      };

      const approvedOperation = action.approvals?.find((approval) =>
        approval.status === "approved"
      );
      if (!options.operation && approvedOperation) {
        try {
          operation = {
            operationType: approvedOperation.operationType,
            description: approvedOperation.operationDescription,
            destination: approvedOperation.destination ?? undefined,
            payload: JSON.parse(approvedOperation.payload) as Record<string, unknown>,
          };
        } catch {
          throw new ExecutionControllerError(
            "The approved operation could not be read safely.",
            409,
          );
        }
      }

      // 5. Evaluate central permission policy
      const policy = evaluatePolicy(action, operation);

      if (policy.prohibitsAutomation) {
        // Record failed attempt
        await createExecutionAttempt({
          caseId,
          actionId,
          provider: options.providerName ?? "mock-provider",
          status: "failed",
          isSimulated: true,
          resultSummary: "Execution blocked: service prohibits automation.",
          uncertaintyReason: "User must perform this step manually.",
        });

        throw new ExecutionControllerError(
          "This service prohibits automation or requires personal user action. Automated execution is blocked.",
          400,
        );
      }

      // 6. Check for valid, current approval when required
      let approvalId: string | undefined;
      if (policy.requiresApproval) {
        const verification = await verifyApprovalForExecution(
          caseId,
          actionId,
          operation,
        );

        if (!verification.valid) {
          throw new ExecutionControllerError(
            `Execution requires valid approval: ${verification.reason}`,
            403,
          );
        }

        approvalId = verification.approval?.id;
      }

      // 7. Atomically claim the action immediately before provider work. The
      // in-memory lock helps within one process; this conditional update also
      // prevents duplicate execution across multiple application instances.
      if (!(await claimActionForExecution(caseId, actionId))) {
        throw new ExecutionControllerError(
          "The action is no longer eligible for execution.",
          409,
        );
      }

      // 8. Select provider and check eligibility
      const provider = providerRegistry.get(options.providerName);
      const executionContext: ExecutionContext = {
        caseId,
        actionId,
        approvalId,
        operation,
        onProgress: options.onProgress,
      };

      const eligibility = await provider.checkEligibility(executionContext);
      if (!eligibility.eligible) {
        await createExecutionAttempt({
          caseId,
          actionId,
          approvalId,
          provider: provider.name,
          status: "failed",
          resultSummary: `Provider rejected execution: ${eligibility.reason}`,
        });
        await updateAction(actionId, "failed");

        throw new ExecutionControllerError(
          `Execution provider rejected operation: ${eligibility.reason}`,
          400,
        );
      }

      // 9. Record running execution attempt
      const attempt = await createExecutionAttempt({
        caseId,
        actionId,
        approvalId,
        provider: provider.name,
        status: "running",
        isSimulated: provider.name === "mock-provider",
      });

      const progressTrace: ProviderProgressEvent[] = [];
      executionContext.onProgress = async (event) => {
        progressTrace.push(event);
        await updateExecutionAttempt(attempt.id, {
          resultDetails: JSON.stringify({ trace: progressTrace }),
        });
        await options.onProgress?.(event);
      };

      // 10. Execute operation through provider
      let providerResult: ProviderExecutionResult;
      try {
        providerResult = await provider.execute(executionContext);
      } catch (err) {
        const errMsg = err instanceof Error
          ? err.message
          : "Provider runtime error";
        await updateExecutionAttempt(attempt.id, {
          status: "failed",
          finishedAt: new Date(),
          resultSummary: `Execution failed: ${errMsg}`,
        });
        await updateAction(actionId, "failed");
        throw new ExecutionControllerError(`Execution failed: ${errMsg}`, 500);
      }

      // 11. Outcome Verification and state updates
      return await this.verifyAndRecordOutcome(
        attempt.id,
        caseItem.id,
        action,
        operation,
        providerResult,
        policy.reasons,
      );
    } finally {
      activeExecutionLocks.delete(actionId);
    }
  }

  /**
   * Verifies execution result against success criteria, records outcomes accurately,
   * handles uncertainty, and never prematurely marks completed.
   */
  private async verifyAndRecordOutcome(
    attemptId: string,
    caseId: string,
    action: Action,
    operation: ProposedOperation,
    providerResult: ProviderExecutionResult,
    policyReasons: string[],
  ): Promise<ExecutionControllerResult> {
    const now = new Date();

    // Case 1: Uncertain outcome
    if (providerResult.status === "uncertain") {
      await updateExecutionAttempt(attemptId, {
        status: "uncertain",
        finishedAt: now,
        resultSummary: providerResult.resultSummary,
        resultDetails: JSON.stringify(providerResult.details ?? {}),
        uncertaintyReason: providerResult.uncertaintyReason,
      });

      // Do NOT retry automatically; keep in_progress for manual reconciliation
      return {
        attemptId,
        actionId: action.id,
        caseId,
        status: "uncertain",
        outcome: "uncertain",
        provider: providerResult.providerName,
        isSimulated: providerResult.isSimulated,
        resultSummary: providerResult.resultSummary,
        uncertaintyReason: providerResult.uncertaintyReason,
        policyReasons,
      };
    }

    // Case 2: Failed outcome
    if (providerResult.status === "failed") {
      await updateExecutionAttempt(attemptId, {
        status: "failed",
        finishedAt: now,
        resultSummary: providerResult.resultSummary,
        resultDetails: JSON.stringify(providerResult.details ?? {}),
      });

      try {
        assertTransition(action.status, "failed");
        await updateAction(action.id, "failed");
      } catch {
        // In case transition rule forbids, action remains in current state
      }

      return {
        attemptId,
        actionId: action.id,
        caseId,
        status: "failed",
        outcome: "failed",
        provider: providerResult.providerName,
        isSimulated: providerResult.isSimulated,
        resultSummary: providerResult.resultSummary,
        policyReasons,
      };
    }

    // Case 3: Provider reported success -> Verify against success criteria
    // Rule: "Never mark an action completed merely because the provider returned a successful click or form-fill response."
    if (!meetsConfiguredSuccessCriteria(action, operation, providerResult)) {
      // Operation succeeded at the provider, but cannot verify complete action satisfaction yet
      await updateExecutionAttempt(attemptId, {
        status: "succeeded",
        finishedAt: now,
        resultSummary:
          `${providerResult.resultSummary} (Outcome unverified against final action completion criteria)`,
        resultDetails: JSON.stringify(providerResult.details ?? {}),
        evidence: providerResult.evidence ?? null,
      });

      // Keep action in_progress, do NOT mark completed
      return {
        attemptId,
        actionId: action.id,
        caseId,
        status: "succeeded",
        outcome: "unverified",
        provider: providerResult.providerName,
        isSimulated: providerResult.isSimulated,
        resultSummary:
          `${providerResult.resultSummary} (Intermediate step complete; final outcome unverified)`,
        evidence: providerResult.evidence ?? null,
        policyReasons,
      };
    }

    // Outcome is verified with explicit evidence
    await updateExecutionAttempt(attemptId, {
      status: "succeeded",
      finishedAt: now,
      resultSummary: providerResult.resultSummary,
      resultDetails: JSON.stringify(providerResult.details ?? {}),
      evidence: providerResult.evidence,
    });

    try {
      assertTransition("in_progress", "completed", providerResult.evidence);
      await updateAction(action.id, "completed", providerResult.evidence);
    } catch {
      // If direct transition assertion fails, record and leave in progress
    }

    return {
      attemptId,
      actionId: action.id,
      caseId,
      status: "succeeded",
      outcome: "verified",
      provider: providerResult.providerName,
      isSimulated: providerResult.isSimulated,
      resultSummary: providerResult.resultSummary,
      evidence: providerResult.evidence,
      policyReasons,
    };
  }
}

export const executionController = new ExecutionController();
