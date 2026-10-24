"use client";

/**
 * ActionNode – the custom React Flow node for a TRESTLE action.
 *
 * Displays: title, status badge, priority, risk level, approval flag,
 * and whether prerequisites are satisfied.
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { ActionNodeData } from "../../domain/graph";
import type { ActionStatus, Priority, RiskLevel } from "../../domain/types";

// ─── Colour maps ──────────────────────────────────────────────────────────────

const statusStyles: Record<ActionStatus, { dot: string; badge: string; border: string }> = {
  ready:             { dot: "bg-blue-400",    badge: "text-blue-300 bg-blue-400/10",    border: "border-blue-400/30" },
  pending:           { dot: "bg-slate-500",   badge: "text-slate-400 bg-slate-700/50",  border: "border-slate-700" },
  in_progress:       { dot: "bg-violet-400",  badge: "text-violet-300 bg-violet-400/10",border: "border-violet-400/30" },
  awaiting_approval: { dot: "bg-orange-400",  badge: "text-orange-300 bg-orange-400/10",border: "border-orange-400/30" },
  blocked:           { dot: "bg-amber-400",   badge: "text-amber-300 bg-amber-400/10",  border: "border-amber-400/30" },
  completed:         { dot: "bg-emerald-400", badge: "text-emerald-300 bg-emerald-400/10", border: "border-emerald-400/30" },
  failed:            { dot: "bg-rose-400",    badge: "text-rose-300 bg-rose-400/10",    border: "border-rose-400/30" },
};

const priorityColors: Record<Priority, string> = {
  low:    "text-slate-400",
  medium: "text-blue-300",
  high:   "text-amber-300",
  urgent: "text-rose-300",
};

const riskColors: Record<RiskLevel, string> = {
  low:      "text-slate-400",
  medium:   "text-amber-300",
  high:     "text-orange-300",
  critical: "text-rose-300",
};

function humanise(s: string) {
  return s.replace(/_/g, " ");
}

// ─── Node component ──────────────────────────────────────────────────────────

function ActionNode({ data, selected }: NodeProps & { data: ActionNodeData }) {
  const { action, prerequisitesSatisfied } = data;
  const styles = statusStyles[action.status] ?? statusStyles.pending;

  return (
    <div
      role="article"
      aria-label={`Action: ${action.title}, status: ${action.status}`}
      className={[
        "relative w-60 rounded-xl border bg-slate-900 p-4 shadow-lg transition-all",
        styles.border,
        selected ? "ring-2 ring-blue-400/60 ring-offset-1 ring-offset-slate-950" : "",
      ].join(" ")}
    >
      {/* ── Handles ─────────────────────────────────────────────────── */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-slate-600 !bg-slate-700"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-slate-600 !bg-slate-700"
      />

      {/* ── Status dot + title ──────────────────────────────────────── */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${styles.dot}`}
          aria-hidden="true"
        />
        <p className="text-sm font-medium leading-snug text-slate-100">{action.title}</p>
      </div>

      {/* ── Status badge ────────────────────────────────────────────── */}
      <span
        className={`mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles.badge}`}
      >
        {humanise(action.status)}
      </span>

      {/* ── Meta row ────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span className={priorityColors[action.priority]}>
          ↑ {action.priority}
        </span>
        <span className={riskColors[action.riskLevel]}>
          ⚠ {action.riskLevel} risk
        </span>
        {action.approvalRequired && (
          <span className="text-orange-300">✓ approval</span>
        )}
      </div>

      {/* ── Prerequisites indicator ──────────────────────────────────── */}
      <div className="mt-3 border-t border-slate-800 pt-2">
        {action.dependencies.length > 0 ? (
          <span
            className={`text-[10px] ${prerequisitesSatisfied ? "text-emerald-400" : "text-amber-400"}`}
          >
            {prerequisitesSatisfied ? "✓ Prerequisites met" : "⏳ Awaiting prerequisites"}
          </span>
        ) : (
          <span className="text-[10px] text-slate-500">
            ✓ Independent (no prerequisites)
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(ActionNode);
