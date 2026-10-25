import { describe, expect, it } from "vitest";
import type { Action } from "../domain/types";
import { buildOperationForAction } from "./operationFactory";

const action = {
  id: "identify-reporting",
  caseId: "case-1",
  title: "Identify official guidance",
  description: "Research official guidance.",
  status: "ready",
  priority: "medium",
  dependencies: [],
  requiredInputs: ["Jurisdiction", "Document type"],
  riskLevel: "medium",
  approvalRequired: false,
  successCriteria: ["Official guidance is recorded."],
  evidence: [],
  executionMode: "assisted",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Action;

describe("server operation factory", () => {
  it("derives the live research operation from safe context", () => {
    expect(buildOperationForAction(action, {
      jurisdiction: "India",
      documentType: "Indian driving licence",
    })).toEqual({
      operationType: "lost_document_research",
      description: "Find official reporting guidance for a lost Indian driving licence in India.",
      payload: { jurisdiction: "India", documentType: "Indian driving licence", researchTask: "identify-reporting" },
    });
  });

  it("rejects private or missing research context", () => {
    expect(() => buildOperationForAction(action, {
      jurisdiction: "India",
      documentType: "Aadhaar number 123456789012",
    })).toThrow(/generic/);
  });

  it("builds generic spam-route research without the identifier", () => {
    const operation = buildOperationForAction({ ...action, id: "research-reporting-route" } as Action);
    expect(operation.operationType).toBe("public_reporting_research");
    expect(operation.payload).toEqual({ jurisdiction: "India", researchTask: "spam-reporting-guidance", personalDataIncluded: false });
    expect(JSON.stringify(operation)).not.toMatch(/\d{10}/);
  });
});
