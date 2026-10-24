import type {
  Action,
  Approval,
  Evidence,
  ProposedOperation,
} from "../domain/types";
import { canonicalizeJson, hashPayload, scrubSensitiveData } from "./crypto";
import { evaluatePolicy } from "./policy";
import { prisma } from "./db";
import {
  createApproval,
  decideApprovalAtomically,
  getApprovalById,
  getApprovalsByCaseId,
  mapApproval,
  updateAction,
  updateApproval,
} from "./repository";

export class ApprovalError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "ApprovalError";
  }
}

/**
 * Creates a persistent approval request for a proposed operation on an action.
 */
export async function requestApproval(
  caseId: string,
  actionId: string,
  operation: ProposedOperation,
  expiresInSeconds: number = 86400, // Default 24 hours
): Promise<Approval> {
  const caseItem = await prisma.case.findUnique({
    where: { id: caseId },
    include: { actions: true },
  });

  if (!caseItem) {
    throw new ApprovalError("Case not found.", 404);
  }

  const action = caseItem.actions.find((a: { id: string }) =>
    a.id === actionId
  );
  if (!action) {
    throw new ApprovalError("Action does not belong to this case.", 404);
  }

  // Parse action fields to evaluate policy
  const mappedAction = {
    ...action,
    dependencies: JSON.parse(action.dependencies) as string[],
    requiredInputs: JSON.parse(action.requiredInputs) as string[],
    successCriteria: JSON.parse(action.successCriteria) as string[],
    evidence: JSON.parse(action.evidence) as Evidence[],
    status: action.status as Action["status"],
    priority: action.priority as Action["priority"],
    riskLevel: action.riskLevel as Action["riskLevel"],
    executionMode: action.executionMode as Action["executionMode"],
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
  };

  const policy = evaluatePolicy(mappedAction, operation);
  const payloadHash = hashPayload(operation.payload);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);

  // Invalidate all undecided and previously approved authorizations for this
  // action. A new request may change the operation contract, so an older
  // approval must never remain usable for that action.
  const pendingApprovals = await prisma.approval.findMany({
    where: { caseId, actionId, status: { in: ["pending", "approved"] } },
  });
  for (const pending of pendingApprovals) {
    await updateApproval(pending.id, {
      status: "invalidated",
      decisionReason: "Superseded by a new approval request.",
      decisionAudit: JSON.stringify({
        event: "invalidated",
        reason: "Superseded by a new approval request.",
        at: now.toISOString(),
      }),
    });
  }

  // Scrub sensitive fields for stored payload representation
  const sanitizedPayload = scrubSensitiveData(operation.payload);
  const canonicalPayloadStr = canonicalizeJson(sanitizedPayload);

  const approval = await createApproval({
    caseId,
    actionId,
    status: "pending",
    operationType: operation.operationType,
    operationDescription: operation.description,
    destination: operation.destination ?? null,
    payload: canonicalPayloadStr,
    payloadHash,
    riskCategory: policy.category,
    prohibitsAutomation: policy.prohibitsAutomation,
    expiresAt,
    decisionAudit: JSON.stringify({
      event: "requested",
      operationType: operation.operationType,
      riskCategory: policy.category,
      prohibitsAutomation: policy.prohibitsAutomation,
      policyReasons: policy.reasons,
      requestedAt: now.toISOString(),
    }),
  });

  // If action is in pending or ready, transition to awaiting_approval
  if (action.status === "pending" || action.status === "ready") {
    await updateAction(actionId, "awaiting_approval");
  }

  return approval;
}

/**
 * Checks and marks any pending approvals past their expiry timestamp as "expired".
 */
async function expireStaleApprovals(caseId: string): Promise<void> {
  const now = new Date();
  const stale = await prisma.approval.findMany({
    where: {
      caseId,
      status: "pending",
      expiresAt: { lte: now },
    },
  });

  for (const item of stale) {
    await updateApproval(item.id, {
      status: "expired",
      decisionReason: "Approval request expired before a decision was made.",
      decisionAudit: JSON.stringify({
        event: "expired",
        expiredAt: now.toISOString(),
      }),
    });
  }
}

/**
 * Retrieves all approvals for a given case, expiring stale requests first.
 */
export async function getApprovalsForCase(
  caseId: string,
  options?: { actionId?: string; status?: Approval["status"] },
): Promise<Approval[]> {
  await expireStaleApprovals(caseId);
  return getApprovalsByCaseId(caseId, options);
}

/**
 * Retrieves a single approval by ID with strict case ownership enforcement.
 */
export async function getApproval(
  caseId: string,
  approvalId: string,
): Promise<Approval | null> {
  await expireStaleApprovals(caseId);
  const approval = await getApprovalById(approvalId);
  if (!approval || approval.caseId !== caseId) {
    return null;
  }
  return approval;
}

/**
 * Approves a specific pending approval request.
 */
export async function approveRequest(
  caseId: string,
  approvalId: string,
  audit: { decidedBy?: string; notes?: string } = {},
): Promise<Approval> {
  await expireStaleApprovals(caseId);

  const approval = await getApprovalById(approvalId);
  if (!approval || approval.caseId !== caseId) {
    throw new ApprovalError("Approval request not found in this case.", 404);
  }

  if (approval.status !== "pending") {
    throw new ApprovalError(
      `Cannot approve request: status is already "${approval.status}".`,
      409,
    );
  }

  const now = new Date();
  if (new Date(approval.expiresAt) <= now) {
    await updateApproval(approvalId, {
      status: "expired",
      decisionReason: "Approval request expired.",
    });
    throw new ApprovalError("Cannot approve: request has expired.", 409);
  }

  if (approval.prohibitsAutomation) {
    throw new ApprovalError(
      "Cannot approve automated execution: this service prohibits automation and requires personal action by the user.",
      400,
    );
  }

  const updated = await decideApprovalAtomically(approvalId, "approved", {
    decidedAt: now,
    decisionReason: audit.notes ?? "Approved by user.",
    decisionAudit: JSON.stringify({
      event: "approved",
      decidedBy: audit.decidedBy ?? "user",
      notes: audit.notes ?? null,
      decidedAt: now.toISOString(),
    }),
  });

  if (!updated) {
    throw new ApprovalError(
      "Cannot approve request: it was already decided or expired.",
      409,
    );
  }
  return updated;
}

/**
 * Rejects a specific pending approval request.
 */
export async function rejectRequest(
  caseId: string,
  approvalId: string,
  audit: { decidedBy?: string; reason?: string } = {},
): Promise<Approval> {
  await expireStaleApprovals(caseId);

  const approval = await getApprovalById(approvalId);
  if (!approval || approval.caseId !== caseId) {
    throw new ApprovalError("Approval request not found in this case.", 404);
  }

  if (approval.status !== "pending") {
    throw new ApprovalError(
      `Cannot reject request: status is already "${approval.status}".`,
      409,
    );
  }

  const now = new Date();
  const updated = await decideApprovalAtomically(approvalId, "rejected", {
    decidedAt: now,
    decisionReason: audit.reason ?? "Rejected by user.",
    decisionAudit: JSON.stringify({
      event: "rejected",
      decidedBy: audit.decidedBy ?? "user",
      reason: audit.reason ?? null,
      decidedAt: now.toISOString(),
    }),
  });

  if (!updated) {
    throw new ApprovalError(
      "Cannot reject request: it was already decided or expired.",
      409,
    );
  }
  return updated;
}

/**
 * Invalidates an approval if its payload, destination, or consequences change.
 */
export async function invalidateApproval(
  caseId: string,
  approvalId: string,
  reason: string,
): Promise<Approval> {
  const approval = await getApprovalById(approvalId);
  if (!approval || approval.caseId !== caseId) {
    throw new ApprovalError("Approval request not found in this case.", 404);
  }

  const now = new Date();
  const updated = await updateApproval(approvalId, {
    status: "invalidated",
    decisionReason: reason,
    decisionAudit: JSON.stringify({
      event: "invalidated",
      reason,
      invalidatedAt: now.toISOString(),
    }),
  });

  return updated!;
}

/**
 * Verifies that an approved authorization remains valid immediately before execution.
 * Checks:
 * - Approval exists and belongs to case and action.
 * - Approval status is "approved".
 * - Approval has not expired.
 * - Approval payloadHash matches the exact hash of the current operation payload.
 * - Destination prohibits automation check.
 */
export async function verifyApprovalForExecution(
  caseId: string,
  actionId: string,
  operation: ProposedOperation,
): Promise<{ valid: boolean; approval?: Approval; reason?: string }> {
  await expireStaleApprovals(caseId);

  // Find the latest approved approval for this action in this case
  const latestApproved = await prisma.approval.findFirst({
    where: {
      caseId,
      actionId,
      status: "approved",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!latestApproved) {
    return {
      valid: false,
      reason: "No approved authorization found for this action.",
    };
  }

  const now = new Date();
  if (latestApproved.expiresAt <= now) {
    await updateApproval(latestApproved.id, {
      status: "expired",
      decisionReason: "Approval expired before execution took place.",
    });
    return {
      valid: false,
      reason: "The approval for this action has expired.",
    };
  }

  if (latestApproved.prohibitsAutomation) {
    return {
      valid: false,
      reason:
        "This service prohibits automated execution. The user must complete this step personally.",
    };
  }

  // Verify that the payload hash exactly matches
  const currentHash = hashPayload(operation.payload);
  if (latestApproved.payloadHash !== currentHash) {
    // Material consequences or payload changed!
    await updateApproval(latestApproved.id, {
      status: "invalidated",
      decisionReason:
        "Payload changed after approval was granted. Prior authorization invalidated.",
      decisionAudit: JSON.stringify({
        event: "invalidated",
        reason: "Payload hash mismatch immediately prior to execution.",
        expectedHash: latestApproved.payloadHash,
        actualHash: currentHash,
        at: now.toISOString(),
      }),
    });

    return {
      valid: false,
      reason:
        "The proposed operation payload has changed since approval was granted. Approval has been invalidated.",
    };
  }

  if (
    latestApproved.operationType !== operation.operationType ||
    latestApproved.operationDescription !== operation.description ||
    (latestApproved.destination ?? null) !== (operation.destination ?? null)
  ) {
    await updateApproval(latestApproved.id, {
      status: "invalidated",
      decisionReason:
        "Operation type, description, or destination changed after approval was granted.",
      decisionAudit: JSON.stringify({
        event: "invalidated",
        reason:
          "Approved operation contract mismatch immediately before execution.",
        at: now.toISOString(),
      }),
    });

    return {
      valid: false,
      reason:
        "The proposed operation changed since approval was granted. Approval has been invalidated.",
    };
  }

  return {
    valid: true,
    approval: mapApproval(latestApproved),
  };
}
