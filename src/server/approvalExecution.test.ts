import { beforeEach, describe, expect, it } from "vitest";
import { RuleBasedWorkflowCompiler } from "../domain/compiler";
import {
  approveRequest,
  getApproval,
  rejectRequest,
  requestApproval,
  verifyApprovalForExecution,
} from "./approvalService";
import { executionController } from "./execution/controller";
import { MockExecutionProvider } from "./execution/mockProvider";
import { TinyFishExecutionProvider } from "./execution/tinyfishProvider";
import { providerRegistry } from "./execution/registry";
import { createCase, getCase, updateAction } from "./repository";
import { prisma } from "./db";

describe("Human Approval & Action Execution Framework", () => {
  let caseId: string;
  let secureCardsActionId: string;
  let checkTxActionId: string;

  beforeEach(async () => {
    // Reset test database records before each test
    await prisma.executionAttempt.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.action.deleteMany();
    await prisma.case.deleteMany();

    const compiled = new RuleBasedWorkflowCompiler().compile(
      "I lost my wallet containing my debit card and driving licence.",
    );
    const created = await createCase(
      "I lost my wallet containing my debit card and driving licence.",
      compiled.workflow!,
    );
    caseId = created.id;
    secureCardsActionId = created.actions.find((a) =>
      a.id === "secure-cards"
    )!.id;
    checkTxActionId =
      created.actions.find((a) => a.id === "check-transactions")!.id;
  });

  describe("Approval Creation & Lifecycle", () => {
    it("creates a pending approval with canonical payload hash and transitions action", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate card freeze request details",
        destination: "https://bank.example/cards/freeze",
        payload: {
          issuer: "BankCorp",
          cardEnding: "1234",
          freezeType: "temporary",
        },
      };

      const approval = await requestApproval(
        caseId,
        secureCardsActionId,
        operation,
      );
      expect(approval.status).toBe("pending");
      expect(approval.caseId).toBe(caseId);
      expect(approval.actionId).toBe(secureCardsActionId);
      expect(approval.payloadHash).toBeTruthy();
      expect(approval.riskCategory).toBe("requires_review");

      // Action transitions to awaiting_approval
      const updatedCase = await prisma.case.findUnique({
        where: { id: caseId },
        include: { actions: true },
      });
      const action = updatedCase?.actions.find((a: { id: string }) =>
        a.id === secureCardsActionId
      );
      expect(action?.status).toBe("awaiting_approval");
    });

    it("approves a pending request and stores audit trail", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate card freeze details",
        payload: { issuer: "BankCorp" },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      const approved = await approveRequest(caseId, req.id, {
        decidedBy: "test-user",
        notes: "Approved after verifying card details",
      });

      expect(approved.status).toBe("approved");
      expect(approved.decidedAt).toBeTruthy();
      expect(approved.decisionReason).toBe(
        "Approved after verifying card details",
      );
      expect(approved.decisionAudit).toContain("test-user");
    });

    it("rejects a pending request and stores rejection reason", async () => {
      const operation = {
        operationType: "make_payment",
        description: "Pay £100 unauthorized fee",
        payload: { amount: 100 },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      const rejected = await rejectRequest(caseId, req.id, {
        decidedBy: "test-user",
        reason: "Suspicious unexpected fee",
      });

      expect(rejected.status).toBe("rejected");
      expect(rejected.decidedAt).toBeTruthy();
      expect(rejected.decisionReason).toBe("Suspicious unexpected fee");
    });

    it("prevents duplicate decisions on already decided requests", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate form",
        payload: { item: 1 },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      await expect(approveRequest(caseId, req.id)).rejects.toThrow(
        /Cannot approve request: status is already "approved"/,
      );
      await expect(rejectRequest(caseId, req.id)).rejects.toThrow(
        /Cannot reject request: status is already "approved"/,
      );
    });

    it("rejects approval of an expired request", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Expiring operation",
        payload: { test: true },
      };
      // Expires immediately in negative seconds
      const req = await requestApproval(
        caseId,
        secureCardsActionId,
        operation,
        -10,
      );

      await expect(approveRequest(caseId, req.id)).rejects.toThrow(
        /expired/i,
      );
      const fetched = await getApproval(caseId, req.id);
      expect(fetched?.status).toBe("expired");
    });

    it("rejects approving automated execution for services that prohibit automation", async () => {
      const operation = {
        operationType: "submit_application",
        description: "Apply in personal portal",
        payload: {},
        prohibitsAutomation: true,
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await expect(approveRequest(caseId, req.id)).rejects.toThrow(
        /prohibits automation and requires personal action/,
      );
    });
  });

  describe("Security, Cross-Case Isolation & Payload Tampering", () => {
    it("rejects cross-case approval access", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Some operation",
        payload: { val: 1 },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);

      const otherCase = await createCase("Other case for cross-case test", {
        title: "Other case",
        description: "Other description",
        actions: [],
      });

      // Attempting to access or decide approval with wrong caseId
      const fetched = await getApproval(otherCase.id, req.id);
      expect(fetched).toBeNull();

      await expect(approveRequest(otherCase.id, req.id)).rejects.toThrow(
        /Approval request not found in this case/,
      );
      await expect(rejectRequest(otherCase.id, req.id)).rejects.toThrow(
        /Approval request not found in this case/,
      );
    });

    it("invalidates approval immediately if payload is altered before execution", async () => {
      const approvedPayload = { formId: "A1", amount: 50 };
      const operation = {
        operationType: "enter_form_details",
        description: "Draft form filling",
        payload: approvedPayload,
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      // Verify with identical payload -> valid
      const checkValid = await verifyApprovalForExecution(
        caseId,
        secureCardsActionId,
        operation,
      );
      expect(checkValid.valid).toBe(true);

      // Now verify with altered payload -> invalid and marked invalidated!
      const alteredPayload = { formId: "A1", amount: 999 };
      const checkAltered = await verifyApprovalForExecution(
        caseId,
        secureCardsActionId,
        { ...operation, payload: alteredPayload },
      );
      expect(checkAltered.valid).toBe(false);
      expect(checkAltered.reason).toContain(
        "changed since approval was granted",
      );

      // Verify that the approval record status is now invalidated in DB
      const updatedReq = await getApproval(caseId, req.id);
      expect(updatedReq?.status).toBe("invalidated");
    });

    it("invalidates approval when operation type or destination changes", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate card details",
        destination: "https://bank.example/freeze",
        payload: { issuer: "BankCorp" },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      const result = await verifyApprovalForExecution(
        caseId,
        secureCardsActionId,
        {
          ...operation,
          operationType: "submit_application",
          destination: "https://different.example/submit",
        },
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("operation changed");
      expect((await getApproval(caseId, req.id))?.status).toBe("invalidated");
    });

    it("invalidates an older approved request when a new request is created", async () => {
      const first = await requestApproval(caseId, secureCardsActionId, {
        operationType: "enter_form_details",
        description: "First operation",
        payload: { version: 1 },
      });
      await approveRequest(caseId, first.id);

      const second = await requestApproval(caseId, secureCardsActionId, {
        operationType: "enter_form_details",
        description: "Replacement operation",
        payload: { version: 2 },
      });

      expect((await getApproval(caseId, first.id))?.status).toBe("invalidated");
      expect((await getApproval(caseId, second.id))?.status).toBe("pending");
    });
  });

  describe("Execution Controller & Outcome Verification", () => {
    it.each([
      { name: "failure", status: "failed" as const },
      { name: "timeout", status: "uncertain" as const },
      { name: "uncertain result", status: "uncertain" as const },
    ])("never completes live research after $name", async ({ status }) => {
      const researchActionId = "identify-reporting";
      const operation = {
        operationType: "lost_document_research",
        description: "Research official lost document guidance.",
        payload: {
          jurisdiction: "India",
          documentType: "Indian driving licence",
        },
      };
      const approval = await requestApproval(caseId, researchActionId, operation);
      await approveRequest(caseId, approval.id);

      providerRegistry.register({
        name: "tinyfish",
        checkEligibility: async () => ({ eligible: true, supportsOperation: true }),
        execute: async () => ({
          attemptId: `live-${status}`,
          status,
          providerName: "tinyfish",
          isSimulated: false,
          resultSummary: status === "failed" ? "Research failed." : "Research is inconclusive.",
          ...(status === "uncertain" ? { uncertaintyReason: "Provider timed out before final verification." } : {}),
          canVerifyOutcome: false,
        }),
        getStatus: async () => null,
      });

      try {
        const result = await executionController.execute(caseId, researchActionId, {
          operation,
          providerName: "tinyfish",
        });
        expect(result.status).toBe(status);

        const persisted = await prisma.action.findUnique({
          where: { id: researchActionId },
        });
        expect(persisted?.status).not.toBe("completed");
        if (status === "failed") expect(persisted?.status).toBe("failed");
        if (status === "uncertain") expect(persisted?.status).toBe("in_progress");

        const refreshedCase = await getCase(caseId);
        expect(refreshedCase?.actions.find((a) => a.id === "replacement-requirements")?.status)
          .toBe("blocked");
      } finally {
        providerRegistry.register(new TinyFishExecutionProvider());
      }
    });

    it("completes successful TinyFish research and makes its dependent action ready", async () => {
      const researchActionId = "identify-reporting";
      const dependentActionId = "replacement-requirements";
      const operation = {
        operationType: "lost_document_research",
        description: "Research official lost document guidance.",
        payload: {
          jurisdiction: "India",
          documentType: "Indian driving licence",
        },
      };
      const approval = await requestApproval(caseId, researchActionId, operation);
      await approveRequest(caseId, approval.id);
      await prisma.action.update({
        where: { id: dependentActionId },
        data: { status: "blocked" },
      });

      providerRegistry.register({
        name: "tinyfish",
        checkEligibility: async () => ({ eligible: true, supportsOperation: true }),
        execute: async () => ({
          attemptId: "live-run-test",
          status: "succeeded",
          providerName: "tinyfish",
          isSimulated: false,
          resultSummary: "Official replacement guidance found.",
          details: {
            sourceUrls: ["https://parivahan.gov.in/example"],
            requirements: ["Follow the issuing authority's process"],
            nextSteps: ["Review the official guidance"],
          },
          evidence: {
            kind: "verified",
            note: "TinyFish research returned official source and procedure details.",
            recordedAt: new Date().toISOString(),
          },
          canVerifyOutcome: true,
        }),
        getStatus: async () => null,
      });

      try {
        const result = await executionController.execute(caseId, researchActionId, {
          operation,
          providerName: "tinyfish",
        });

        expect(result.status).toBe("succeeded");
        expect(result.outcome).toBe("verified");
        expect(result.isSimulated).toBe(false);
        const persisted = await prisma.action.findUnique({
          where: { id: researchActionId },
        });
        expect(persisted?.status).toBe("completed");

        const refreshedCase = await getCase(caseId);
        expect(refreshedCase?.actions.find((a) => a.id === dependentActionId)?.status)
          .toBe("ready");
        expect(refreshedCase?.actions.find((a) => a.id === dependentActionId)?.status)
          .not.toBe("completed");
      } finally {
        providerRegistry.register(new TinyFishExecutionProvider());
      }
    });

    it("blocks execution when action prerequisites are incomplete", async () => {
      // check-transactions depends on secure-cards, which is currently pending
      await expect(
        executionController.execute(caseId, checkTxActionId),
      ).rejects.toThrow(/blocked by incomplete prerequisites/);
    });

    it("prevents execution of sensitive actions when approval is missing", async () => {
      const operation = {
        operationType: "final_action_completion",
        description: "Populate card details",
        payload: { issuer: "BankCorp" },
      };

      // No approval has been requested or approved yet
      await expect(
        executionController.execute(caseId, secureCardsActionId, { operation }),
      ).rejects.toThrow(/Execution requires valid approval/);
    });

    it("prevents execution when an approval request was rejected", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate card details",
        payload: { issuer: "BankCorp" },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await rejectRequest(caseId, req.id, {
        reason: "User declined to proceed.",
      });

      await expect(
        executionController.execute(caseId, secureCardsActionId, { operation }),
      ).rejects.toThrow(/No approved authorization found/);
    });

    it("prevents execution when an approval has expired prior to execution", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate card details",
        payload: { issuer: "BankCorp" },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      // Artificially expire the approval in the database
      await prisma.approval.update({
        where: { id: req.id },
        data: { expiresAt: new Date(Date.now() - 60000) },
      });

      await expect(
        executionController.execute(caseId, secureCardsActionId, { operation }),
      ).rejects.toThrow(/approval for this action has expired/i);
    });

    it("prevents reusing approval granted for one action on a different action", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate card details",
        payload: { issuer: "BankCorp" },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      // Attempting to use this for checkTxActionId (even if checkTxActionId had prerequisites completed)
      await updateAction(secureCardsActionId, "completed", {
        kind: "simulated",
        note: "prereq done",
        recordedAt: new Date().toISOString(),
      });
      await updateAction(checkTxActionId, "ready");

      await expect(
        executionController.execute(caseId, checkTxActionId, { operation }),
      ).rejects.toThrow(/No approved authorization found for this action/);
    });

    it("executes authorised action successfully with mock provider and records verified outcome", async () => {
      const operation = {
        operationType: "final_action_completion",
        description: "Populate card details",
        payload: { issuer: "BankCorp" },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      const result = await executionController.execute(
        caseId,
        secureCardsActionId,
        {
          operation,
        },
      );

      expect(result.status).toBe("succeeded");
      expect(result.outcome).toBe("verified");
      expect(result.isSimulated).toBe(true);
      expect(result.provider).toBe("mock-provider");
      expect(result.resultSummary).toContain("[SIMULATED]");
      expect(result.evidence?.kind).toBe("simulated");

      // Check database: action is completed with evidence
      const updatedAction = await prisma.action.findUnique({
        where: { id: secureCardsActionId },
      });
      expect(updatedAction?.status).toBe("completed");
      expect(updatedAction?.evidence).toContain("[SIMULATED]");
    });

    it("does not mark action completed for intermediate operations (e.g. form filling only)", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Populate form inputs only",
        payload: { form: "xyz" },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      const result = await executionController.execute(
        caseId,
        secureCardsActionId,
        {
          operation,
        },
      );

      expect(result.status).toBe("succeeded");
      expect(result.outcome).toBe("unverified"); // Intermediate step complete, but action not completed!

      // Action remains in_progress
      const updatedAction = await prisma.action.findUnique({
        where: { id: secureCardsActionId },
      });
      expect(updatedAction?.status).toBe("in_progress");
    });

    it("records uncertain provider outcomes accurately without blindly retrying", async () => {
      const operation = {
        operationType: "execute_step",
        description: "Potentially fragile network operation",
        payload: { simulateUncertainty: true },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      const result = await executionController.execute(
        caseId,
        secureCardsActionId,
        {
          operation,
        },
      );

      expect(result.status).toBe("uncertain");
      expect(result.outcome).toBe("uncertain");
      expect(result.uncertaintyReason).toContain("manual reconciliation");

      // Action remains in_progress, not marked failed or retried
      const updatedAction = await prisma.action.findUnique({
        where: { id: secureCardsActionId },
      });
      expect(updatedAction?.status).toBe("in_progress");

      // Attempt in DB recorded as uncertain
      const attempts = await prisma.executionAttempt.findMany({
        where: { actionId: secureCardsActionId },
      });
      expect(attempts[0]?.status).toBe("uncertain");
    });

    it("records provider failures accurately and transitions action to failed", async () => {
      const operation = {
        operationType: "execute_step",
        description: "Failing operation",
        payload: { simulateFailure: true },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      const result = await executionController.execute(
        caseId,
        secureCardsActionId,
        {
          operation,
        },
      );

      expect(result.status).toBe("failed");
      expect(result.outcome).toBe("failed");

      const updatedAction = await prisma.action.findUnique({
        where: { id: secureCardsActionId },
      });
      expect(updatedAction?.status).toBe("failed");
    });

    it("stops execution if the service prohibits automation", async () => {
      const operation = {
        operationType: "manual_step",
        description: "User must act in person",
        payload: {},
        prohibitsAutomation: true,
      };

      await expect(
        executionController.execute(caseId, secureCardsActionId, { operation }),
      ).rejects.toThrow(/Automated execution is blocked/i);
    });

    it("prevents duplicate concurrent execution of the same action", async () => {
      const operation = {
        operationType: "enter_form_details",
        description: "Review operation",
        payload: { x: 1 },
      };
      const req = await requestApproval(caseId, secureCardsActionId, operation);
      await approveRequest(caseId, req.id);

      // Execute two concurrently
      const promise1 = executionController.execute(
        caseId,
        secureCardsActionId,
        {
          operation,
        },
      );
      // The second simultaneous invocation should be rejected due to active concurrency lock
      const promise2 = executionController.execute(
        caseId,
        secureCardsActionId,
        {
          operation,
        },
      );

      const results = await Promise.allSettled([promise1, promise2]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain(
        "already in progress",
      );
    });

    it("rejects execution on already completed actions", async () => {
      await updateAction(secureCardsActionId, "completed", {
        kind: "simulated",
        note: "Done",
        recordedAt: new Date().toISOString(),
      });

      await expect(
        executionController.execute(caseId, secureCardsActionId),
      ).rejects.toThrow(/already been completed/);
    });
  });

  describe("Mock Provider Labelling", () => {
    it("clearly labels all outcomes, evidence, and details as simulated", async () => {
      const provider = new MockExecutionProvider();
      const context = {
        caseId,
        actionId: secureCardsActionId,
        operation: {
          operationType: "read_public_info",
          description: "Read documentation",
          payload: {},
        },
      };

      const result = await provider.execute(context);
      expect(result.isSimulated).toBe(true);
      expect(result.providerName).toBe("mock-provider");
      expect(result.resultSummary).toMatch(/\[SIMULATED\]/);
      expect(result.evidence?.kind).toBe("simulated");
      expect(result.evidence?.note).toMatch(/\[SIMULATED\]/);
      expect((result.details as Record<string, unknown>)?.simulated).toBe(true);
    });
  });
});
