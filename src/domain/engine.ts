import type { Action, ActionStatus } from "./types";

export function validateGraph(
  actions: Array<Pick<Action, "id" | "dependencies">>,
) {
  const ids = new Set(actions.map((a) => a.id));
  if (ids.size !== actions.length) {
    return { ok: false as const, error: "Action IDs must be unique." };
  }
  for (const a of actions) {
    if (a.dependencies.includes(a.id)) {
      return {
        ok: false as const,
        error: `Action ${a.id} cannot depend on itself.`,
      };
    }
    if (new Set(a.dependencies).size !== a.dependencies.length) {
      return {
        ok: false as const,
        error: `Action ${a.id} contains duplicate dependencies.`,
      };
    }
    if (a.dependencies.some((d) => !ids.has(d))) {
      return {
        ok: false as const,
        error: `Action ${a.id} references an action outside this case.`,
      };
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const a = actions.find((x) => x.id === id)!;
    if (!a.dependencies.every(visit)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  if (!actions.every((a) => visit(a.id))) {
    return {
      ok: false as const,
      error: "The action graph contains a dependency cycle.",
    };
  }
  return { ok: true as const };
}

export function readiness(
  actions: Pick<
    Action,
    "id" | "dependencies" | "status" | "approvalRequired" | "riskLevel"
  >[],
) {
  const valid = validateGraph(actions);
  if (!valid.ok) throw new Error(valid.error);
  return actions.map((a) => ({
    id: a.id,
    ready: a.status !== "completed" && a.status !== "failed" &&
      a.dependencies.every((d) =>
        actions.find((x) => x.id === d)?.status === "completed"
      ) &&
      !(a.approvalRequired && ["high", "critical"].includes(a.riskLevel) &&
        a.status === "awaiting_approval"),
    blockedBy: a.dependencies.filter((d) =>
      actions.find((x) => x.id === d)?.status !== "completed"
    ),
  }));
}

const allowed: Record<ActionStatus, ActionStatus[]> = {
  pending: ["ready", "in_progress", "failed"],
  ready: ["in_progress", "failed"],
  in_progress: ["completed", "failed", "awaiting_approval"],
  awaiting_approval: ["in_progress", "failed"],
  blocked: ["ready", "failed"],
  completed: [],
  failed: ["in_progress"],
};
export function assertTransition(
  from: ActionStatus,
  to: ActionStatus,
  evidence?: { kind: string },
) {
  if (!allowed[from].includes(to)) {
    throw new Error(`Invalid action transition: ${from} → ${to}.`);
  }
  if (to === "completed" && !evidence) {
    throw new Error("Completion requires explicit evidence.");
  }
}
