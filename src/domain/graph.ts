/**
 * graph.ts – pure functions for converting persisted TRESTLE actions into
 * React Flow nodes and edges.  No React/browser imports; safe to use in tests.
 */

import type { Action, ActionStatus } from "./types";

// ─── React Flow shape stubs (avoid importing @xyflow/react here) ─────────────

export interface GraphNode {
  id: string;
  type: "actionNode";
  position: { x: number; y: number };
  data: ActionNodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "smoothstep";
  animated: boolean;
  markerEnd: { type: "arrowclosed" };
  style: { stroke: string; strokeWidth: number };
  label?: string;
}

export interface ActionNodeData extends Record<string, unknown> {
  action: Action;
  prerequisitesSatisfied: boolean;
}

// ─── Topological sort (Kahn's algorithm) ─────────────────────────────────────

/**
 * Returns a topological ordering of action IDs, or the original order if the
 * graph is invalid (cyclic / missing references).  Never throws.
 */
export function topoSort(
  actions: Pick<Action, "id" | "dependencies">[],
): string[] {
  const ids = new Set(actions.map((a) => a.id));
  // filter out dangling references so we are robust against missing deps
  const adjIn = new Map<string, number>();
  const adjOut = new Map<string, string[]>();
  for (const a of actions) {
    adjIn.set(a.id, 0);
    adjOut.set(a.id, []);
  }
  for (const a of actions) {
    for (const dep of a.dependencies) {
      if (ids.has(dep)) {
        adjIn.set(a.id, (adjIn.get(a.id) ?? 0) + 1);
        adjOut.get(dep)!.push(a.id);
      }
    }
  }
  const queue = [...adjIn.entries()].filter(([, v]) => v === 0).map(([k]) => k);
  const order: string[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    order.push(node);
    for (const succ of adjOut.get(node) ?? []) {
      const next = (adjIn.get(succ) ?? 1) - 1;
      adjIn.set(succ, next);
      if (next === 0) queue.push(succ);
    }
  }
  // If there is a cycle, fall back to original order
  return order.length === actions.length ? order : actions.map((a) => a.id);
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const NODE_W = 240;
const NODE_H = 160;
const GAP_X = 80;
const GAP_Y = 60;

/**
 * Assigns (x, y) positions using a layered layout.
 * Each node is placed in the earliest column that comes after all its
 * dependencies, then rows are distributed evenly within each column.
 */
export function computeLayout(
  actions: Pick<Action, "id" | "dependencies">[],
): Map<string, { x: number; y: number }> {
  const ids = new Set(actions.map((a) => a.id));
  const column = new Map<string, number>();

  // Assign column = max(column of deps) + 1
  const order = topoSort(actions);
  for (const id of order) {
    const action = actions.find((a) => a.id === id)!;
    const deps = action.dependencies.filter((d) => ids.has(d));
    const col = deps.length
      ? Math.max(...deps.map((d) => column.get(d) ?? 0)) + 1
      : 0;
    column.set(id, col);
  }

  // Group by column
  const cols = new Map<number, string[]>();
  for (const [id, col] of column) {
    if (!cols.has(col)) cols.set(col, []);
    cols.get(col)!.push(id);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [col, nodeIds] of cols) {
    const x = col * (NODE_W + GAP_X);
    nodeIds.forEach((id, row) => {
      const totalH = nodeIds.length * NODE_H + (nodeIds.length - 1) * GAP_Y;
      const y = row * (NODE_H + GAP_Y) - totalH / 2;
      positions.set(id, { x, y });
    });
  }
  return positions;
}

// ─── Edge colour by status ────────────────────────────────────────────────────

const EDGE_COLORS: Record<ActionStatus, string> = {
  completed: "#34d399", // emerald-400
  in_progress: "#a78bfa", // violet-400
  awaiting_approval: "#fb923c", // orange-400
  ready: "#60a5fa", // blue-400
  pending: "#475569", // slate-600
  blocked: "#fbbf24", // amber-400
  failed: "#f87171", // rose-400
};

function edgeColor(sourceStatus: ActionStatus): string {
  return EDGE_COLORS[sourceStatus] ?? "#475569";
}

// ─── Public builders ─────────────────────────────────────────────────────────

/**
 * Map persisted actions to React Flow nodes with a deterministic layout.
 * Returns an empty array for empty input; never throws.
 */
export function buildNodes(actions: Action[]): GraphNode[] {
  if (!actions.length) return [];
  const positions = computeLayout(actions);

  return actions.map((action) => {
    const prereqsSatisfied = action.dependencies.every(
      (dep) => actions.find((a) => a.id === dep)?.status === "completed",
    );
    return {
      id: action.id,
      type: "actionNode" as const,
      position: positions.get(action.id) ?? { x: 0, y: 0 },
      data: { action, prerequisitesSatisfied: prereqsSatisfied },
    };
  });
}

/**
 * Map persisted actions to React Flow edges.
 * Edge direction: prerequisite → dependent (left to right in layout).
 * Silently skips edges where the dependency ID is not present in actions.
 */
export function buildEdges(actions: Action[]): GraphEdge[] {
  const ids = new Set(actions.map((a) => a.id));
  const edges: GraphEdge[] = [];

  for (const action of actions) {
    for (const dep of action.dependencies) {
      if (!ids.has(dep)) continue; // missing dep – skip gracefully
      const source = actions.find((a) => a.id === dep)!;
      edges.push({
        id: `${dep}→${action.id}`,
        source: dep,
        target: action.id,
        type: "smoothstep",
        animated: source.status === "in_progress",
        markerEnd: { type: "arrowclosed" },
        style: { stroke: edgeColor(source.status), strokeWidth: 1.5 },
      });
    }
  }
  return edges;
}
