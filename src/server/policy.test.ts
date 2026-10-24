import { describe, expect, it } from "vitest";
import type { Action, ProposedOperation } from "../domain/types";
import { classifyOperation, evaluatePolicy } from "./policy";

const createMockAction = (overrides: Partial<Action> = {}): Action => ({
  id: "test-action",
  caseId: "case-1",
  title: "Test Action",
  description: "Test action description",
  status: "ready",
  priority: "medium",
  riskLevel: "low",
  approvalRequired: false,
  dependencies: [],
  requiredInputs: [],
  successCriteria: ["Outcome verified."],
  evidence: [],
  executionMode: "assisted",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("Risk and Permission Policy", () => {
  it("classifies low risk operations correctly and permits automatic execution", () => {
    const action = createMockAction({ riskLevel: "low", approvalRequired: false });
    const op: ProposedOperation = {
      operationType: "read_public_info",
      description: "Read official documentation",
      payload: { url: "https://example.gov" },
    };

    const classification = classifyOperation(action, op);
    expect(classification.category).toBe("low_risk");
    expect(classification.prohibitsAutomation).toBe(false);

    const evaluation = evaluatePolicy(action, op);
    expect(evaluation.category).toBe("low_risk");
    expect(evaluation.requiresApproval).toBe(false);
    expect(evaluation.canExecuteAutomatically).toBe(true);
  });

  it("classifies form population and document uploads as requires_review", () => {
    const action = createMockAction({ riskLevel: "medium" });
    const op: ProposedOperation = {
      operationType: "enter_form_details",
      description: "Populate personal details into form",
      payload: { fullName: "Jane Doe", address: "123 High St" },
    };

    const evaluation = evaluatePolicy(action, op);
    expect(evaluation.category).toBe("requires_review");
    expect(evaluation.requiresApproval).toBe(true);
    expect(evaluation.canExecuteAutomatically).toBe(false);
  });

  it("classifies payments, declarations, and final submissions as high_consequence", () => {
    const action = createMockAction({ riskLevel: "high" });
    const op: ProposedOperation = {
      operationType: "make_payment",
      description: "Pay application fee",
      payload: { amount: 35.0, currency: "GBP" },
    };

    const evaluation = evaluatePolicy(action, op);
    expect(evaluation.category).toBe("high_consequence");
    expect(evaluation.requiresApproval).toBe(true);
    expect(evaluation.canExecuteAutomatically).toBe(false);
  });

  it("strictly enforces prohibition when a service prohibits automation or requires personal action", () => {
    const action = createMockAction();
    const op: ProposedOperation = {
      operationType: "submit_application",
      description: "Submit to restricted portal",
      destination: "https://restricted.gov",
      payload: {},
      prohibitsAutomation: true,
    };

    const evaluation = evaluatePolicy(action, op);
    expect(evaluation.prohibitsAutomation).toBe(true);
    expect(evaluation.canExecuteAutomatically).toBe(false);
    expect(evaluation.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Automation is prohibited")])
    );
  });

  it("requires approval if action has approvalRequired set even with generic operation", () => {
    const action = createMockAction({ approvalRequired: true, riskLevel: "medium" });
    const evaluation = evaluatePolicy(action);
    expect(evaluation.requiresApproval).toBe(true);
    expect(evaluation.canExecuteAutomatically).toBe(false);
  });
});
