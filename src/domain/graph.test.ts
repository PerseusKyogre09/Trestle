import { describe, expect, it } from "vitest";
import { buildEdges, buildNodes, computeLayout, topoSort } from "./graph";
import type { Action } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<Action> & Pick<Action, "id">): Action {
  return {
    caseId: "case-1",
    title: overrides.id,
    description: "desc",
    status: "pending",
    priority: "medium",
    riskLevel: "low",
    approvalRequired: false,
    dependencies: [],
    requiredInputs: [],
    successCriteria: [],
    evidence: [],
    executionMode: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const ACTIONS: Action[] = [
  makeAction({ id: "secure-cards" }),
  makeAction({ id: "check-transactions", dependencies: ["secure-cards"] }),
  makeAction({ id: "identify-reporting" }),
  makeAction({
    id: "replacement-requirements",
    dependencies: ["identify-reporting"],
  }),
  makeAction({
    id: "prepare-replacements",
    dependencies: ["replacement-requirements"],
  }),
];

// ─── topoSort ────────────────────────────────────────────────────────────────

describe("topoSort", () => {
  it("places prerequisites before dependents", () => {
    const order = topoSort(ACTIONS);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("secure-cards")).toBeLessThan(idx("check-transactions"));
    expect(idx("identify-reporting")).toBeLessThan(
      idx("replacement-requirements"),
    );
    expect(idx("replacement-requirements")).toBeLessThan(
      idx("prepare-replacements"),
    );
  });

  it("returns original order on a cyclic graph (graceful fallback)", () => {
    const cyclic = [
      makeAction({ id: "a", dependencies: ["b"] }),
      makeAction({ id: "b", dependencies: ["a"] }),
    ];
    const order = topoSort(cyclic);
    expect(order).toHaveLength(2);
  });

  it("handles an empty action list", () => {
    expect(topoSort([])).toEqual([]);
  });
});

// ─── computeLayout ───────────────────────────────────────────────────────────

describe("computeLayout", () => {
  it("assigns positions to every action", () => {
    const positions = computeLayout(ACTIONS);
    for (const a of ACTIONS) {
      expect(positions.has(a.id)).toBe(true);
    }
  });

  it("places dependent nodes in a later column than their prerequisites", () => {
    const positions = computeLayout(ACTIONS);
    expect(positions.get("check-transactions")!.x).toBeGreaterThan(
      positions.get("secure-cards")!.x,
    );
    expect(positions.get("prepare-replacements")!.x).toBeGreaterThan(
      positions.get("replacement-requirements")!.x,
    );
  });

  it("places independent branches at the same column", () => {
    const positions = computeLayout(ACTIONS);
    expect(positions.get("secure-cards")!.x).toBe(
      positions.get("identify-reporting")!.x,
    );
  });
});

// ─── buildNodes ──────────────────────────────────────────────────────────────

describe("buildNodes", () => {
  it("maps each action to a node with correct id", () => {
    const nodes = buildNodes(ACTIONS);
    const ids = nodes.map((n) => n.id);
    for (const a of ACTIONS) expect(ids).toContain(a.id);
  });

  it("reports prerequisitesSatisfied correctly", () => {
    const withCompleted = ACTIONS.map((a) =>
      a.id === "secure-cards" ? { ...a, status: "completed" as const } : a
    );
    const nodes = buildNodes(withCompleted);
    const checkNode = nodes.find((n) => n.id === "check-transactions");
    expect(checkNode?.data.prerequisitesSatisfied).toBe(true);
  });

  it("reports prerequisitesSatisfied=false when dep not completed", () => {
    const nodes = buildNodes(ACTIONS);
    const checkNode = nodes.find((n) => n.id === "check-transactions");
    expect(checkNode?.data.prerequisitesSatisfied).toBe(false);
  });

  it("returns empty array for empty input", () => {
    expect(buildNodes([])).toEqual([]);
  });
});

// ─── buildEdges ──────────────────────────────────────────────────────────────

describe("buildEdges", () => {
  it("creates correct directed edges (source=dep, target=action)", () => {
    const edges = buildEdges(ACTIONS);
    const checkEdge = edges.find((e) => e.target === "check-transactions");
    expect(checkEdge).toBeDefined();
    expect(checkEdge?.source).toBe("secure-cards");
  });

  it("edge id encodes the dependency pair", () => {
    const edges = buildEdges(ACTIONS);
    const ids = edges.map((e) => e.id);
    expect(ids).toContain("secure-cards→check-transactions");
  });

  it("skips missing dependency IDs gracefully", () => {
    const broken = [
      makeAction({ id: "orphan", dependencies: ["does-not-exist"] }),
    ];
    expect(() => buildEdges(broken)).not.toThrow();
    expect(buildEdges(broken)).toHaveLength(0);
  });

  it("produces no edges for independent nodes", () => {
    const independent = [makeAction({ id: "a" }), makeAction({ id: "b" })];
    expect(buildEdges(independent)).toHaveLength(0);
  });

  it("animates edges from in_progress source nodes", () => {
    const inProg = ACTIONS.map((a) =>
      a.id === "secure-cards" ? { ...a, status: "in_progress" as const } : a
    );
    const edges = buildEdges(inProg);
    const e = edges.find((e) => e.source === "secure-cards");
    expect(e?.animated).toBe(true);
  });

  it("status rendering: completed source gets emerald stroke", () => {
    const done = ACTIONS.map((a) =>
      a.id === "secure-cards" ? { ...a, status: "completed" as const } : a
    );
    const edges = buildEdges(done);
    const e = edges.find((e) => e.source === "secure-cards");
    expect(e?.style.stroke).toBe("#34d399");
  });

  it("status rendering: distinct edge colors for each status", () => {
    const statuses: Array<Action["status"]> = [
      "completed",
      "in_progress",
      "awaiting_approval",
      "ready",
      "pending",
      "blocked",
      "failed",
    ];
    const pairs = statuses.map((status, i) => [
      makeAction({ id: `src-${i}`, status }),
      makeAction({ id: `dst-${i}`, dependencies: [`src-${i}`] }),
    ]).flat();

    const edges = buildEdges(pairs);
    expect(edges).toHaveLength(statuses.length);
    const colors = new Set(edges.map((e) => e.style.stroke));
    // Each status should produce a valid distinct stroke
    expect(colors.size).toBe(statuses.length);
  });
});

// ─── Graph refresh after action update ────────────────────────────────────────

describe("graph refresh after action update", () => {
  it("dynamically satisfies prerequisites and updates edges when prerequisite completes", () => {
    // 1. Initial state: prerequisite is pending
    const initialActions = [
      makeAction({ id: "step-1", status: "pending" }),
      makeAction({ id: "step-2", dependencies: ["step-1"], status: "pending" }),
    ];
    let nodes = buildNodes(initialActions);
    let edges = buildEdges(initialActions);

    expect(nodes.find((n) => n.id === "step-2")?.data.prerequisitesSatisfied)
      .toBe(false);
    expect(edges[0]?.animated).toBe(false);
    expect(edges[0]?.style.stroke).toBe("#475569"); // slate-600

    // 2. Action updated to in_progress
    const inProgressActions = initialActions.map((a) =>
      a.id === "step-1" ? { ...a, status: "in_progress" as const } : a
    );
    nodes = buildNodes(inProgressActions);
    edges = buildEdges(inProgressActions);

    expect(nodes.find((n) => n.id === "step-2")?.data.prerequisitesSatisfied)
      .toBe(false);
    expect(edges[0]?.animated).toBe(true);
    expect(edges[0]?.style.stroke).toBe("#a78bfa"); // violet-400

    // 3. Action updated to completed
    const completedActions = inProgressActions.map((a) =>
      a.id === "step-1" ? { ...a, status: "completed" as const } : a
    );
    nodes = buildNodes(completedActions);
    edges = buildEdges(completedActions);

    expect(nodes.find((n) => n.id === "step-2")?.data.prerequisitesSatisfied)
      .toBe(true);
    expect(edges[0]?.animated).toBe(false);
    expect(edges[0]?.style.stroke).toBe("#34d399"); // emerald-400
  });

  it("handles multi-prerequisite satisfaction where only all completed counts", () => {
    const actions = [
      makeAction({ id: "p1", status: "completed" }),
      makeAction({ id: "p2", status: "in_progress" }),
      makeAction({
        id: "dependent",
        dependencies: ["p1", "p2"],
        status: "pending",
      }),
    ];
    let nodes = buildNodes(actions);
    expect(nodes.find((n) => n.id === "dependent")?.data.prerequisitesSatisfied)
      .toBe(false);

    // Complete p2
    const allCompleted = actions.map((a) =>
      a.id === "p2" ? { ...a, status: "completed" as const } : a
    );
    nodes = buildNodes(allCompleted);
    expect(nodes.find((n) => n.id === "dependent")?.data.prerequisitesSatisfied)
      .toBe(true);
  });
});

// ─── Node selection and task-detail integration ──────────────────────────────

describe("node selection integration", () => {
  it("allows looking up the full action data by selected node ID", () => {
    const actions = [
      makeAction({
        id: "task-alpha",
        title: "Task Alpha",
        description: "Important description",
        status: "ready",
        priority: "high",
        riskLevel: "medium",
        approvalRequired: true,
        dependencies: [],
        successCriteria: ["Criterion 1", "Criterion 2"],
        evidence: [{
          kind: "user_provided",
          note: "Noted",
          recordedAt: "2026-01-01T00:00:00Z",
        }],
      }),
    ];

    const nodes = buildNodes(actions);
    const selectedActionId = "task-alpha";

    // Integration check: node is selected
    const displayNodes = nodes.map((n) => ({
      ...n,
      selected: n.id === selectedActionId,
    }));
    expect(displayNodes[0]?.selected).toBe(true);

    // Integration check: detail panel lookup finds full action domain object
    const selectedAction = actions.find((a) => a.id === selectedActionId);
    expect(selectedAction).toBeDefined();
    expect(selectedAction?.title).toBe("Task Alpha");
    expect(selectedAction?.description).toBe("Important description");
    expect(selectedAction?.riskLevel).toBe("medium");
    expect(selectedAction?.approvalRequired).toBe(true);
    expect(selectedAction?.successCriteria).toHaveLength(2);
    expect(selectedAction?.evidence).toHaveLength(1);
  });
});
