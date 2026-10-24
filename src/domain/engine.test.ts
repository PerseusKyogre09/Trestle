import { describe, expect, it } from "vitest";
import { RuleBasedWorkflowCompiler } from "./compiler";
import { assertTransition, readiness, validateGraph } from "./engine";

describe("rule-based workflow compiler", () => {
  it("compiles a lost wallet", () => {
    const result = new RuleBasedWorkflowCompiler().compile(
      "I lost my wallet containing my debit card and driving licence.",
    );
    expect(result.workflow?.actions.length).toBeGreaterThan(3);
    expect(
      result.workflow?.actions.find((a) => a.id === "check-transactions")
        ?.dependencies,
    ).toEqual(["secure-cards"]);
  });
  it("rejects unsupported events", () => {
    expect(
      new RuleBasedWorkflowCompiler().compile("I need a recipe for dinner")
        .workflow,
    ).toBeUndefined();
  });
});
describe("dependency engine", () => {
  it("rejects cycles and cross-graph references", () => {
    expect(
      validateGraph([{ id: "a", dependencies: ["b"] }, {
        id: "b",
        dependencies: ["a"],
      }]).ok,
    ).toBe(false);
    expect(validateGraph([{ id: "a", dependencies: ["other-case-action"] }]).ok)
      .toBe(false);
  });
  it("keeps independent branches ready", () => {
    const result = readiness([{
      id: "a",
      dependencies: [],
      status: "pending",
      approvalRequired: false,
      riskLevel: "low",
    }, {
      id: "b",
      dependencies: ["a"],
      status: "pending",
      approvalRequired: false,
      riskLevel: "low",
    }, {
      id: "c",
      dependencies: [],
      status: "pending",
      approvalRequired: false,
      riskLevel: "low",
    }]);
    expect(result.find((x) => x.id === "a")?.ready).toBe(true);
    expect(result.find((x) => x.id === "b")?.ready).toBe(false);
    expect(result.find((x) => x.id === "c")?.ready).toBe(true);
  });
  it("requires evidence for completion and rejects invalid transitions", () => {
    expect(() => assertTransition("pending", "completed")).toThrow();
    expect(() => assertTransition("completed", "in_progress")).toThrow();
    expect(() =>
      assertTransition("in_progress", "completed", { kind: "user_provided" })
    ).not.toThrow();
  });
});
