"use client";

/**
 * ActionDetailPanel – slide-in panel shown when a graph node is selected.
 *
 * Displays the full action details (description, dependencies, success
 * criteria, risk, approval, evidence, current status) and exposes the same
 * Start / Complete / Record failure transitions that the list view uses.
 * Uses the existing /api/cases/[id]/actions/[actionId] PATCH endpoint.
 */

import type { Action, Case } from "../../domain/types";

const tone: Record<string, string> = {
  completed: "text-emerald-300",
  failed: "text-rose-300",
  blocked: "text-amber-300",
  ready: "text-blue-300",
  in_progress: "text-violet-300",
  pending: "text-slate-400",
  awaiting_approval: "text-orange-300",
};

const riskColor: Record<string, string> = {
  low: "text-slate-400",
  medium: "text-amber-300",
  high: "text-orange-300",
  critical: "text-rose-300",
};

interface Props {
  action: Action;
  caseItem: Case;
  onClose: () => void;
  onTransition: (
    action: Action,
    status: "in_progress" | "completed" | "failed",
  ) => Promise<void>;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs text-slate-500 uppercase tracking-wide">
      {children}
    </span>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-sm text-slate-300">{children}</p>;
}

export default function ActionDetailPanel(
  { action, caseItem, onClose, onTransition }: Props,
) {
  const blockedBy = action.dependencies.filter(
    (d) => caseItem.actions.find((a) => a.id === d)?.status !== "completed",
  );
  const canStart = blockedBy.length === 0 &&
    ["pending", "ready", "failed"].includes(action.status);
  const isInProgress = action.status === "in_progress";

  return (
    <aside
      className="flex h-full w-full flex-col overflow-y-auto border-l border-slate-800 bg-slate-950"
      aria-label="Action detail panel"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
        <div className="min-w-0 flex-1 pr-4">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-300">
            Action
          </p>
          <h2 className="mt-1 text-base font-semibold leading-snug text-slate-100">
            {action.title}
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close action detail panel"
          className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-5 px-5 py-4">
        {/* Status */}
        <div>
          <Label>Status</Label>
          <p
            className={`mt-1 text-sm font-medium ${
              tone[action.status] ?? "text-slate-300"
            }`}
          >
            {action.status.replace(/_/g, " ")}
          </p>
        </div>

        {/* Description */}
        <div>
          <Label>Description</Label>
          <Value>{action.description}</Value>
        </div>

        {/* Dependencies */}
        <div>
          <Label>Prerequisites</Label>
          {action.dependencies.length === 0
            ? <Value>None — this action is independent.</Value>
            : (
              <ul className="mt-1 space-y-1">
                {action.dependencies.map((dep) => {
                  const depAction = caseItem.actions.find((a) => a.id === dep);
                  const depStatus = depAction?.status ?? "unknown";
                  return (
                    <li key={dep} className="flex items-center gap-2 text-sm">
                      <span
                        className={`${
                          tone[depStatus] ?? "text-slate-400"
                        } text-xs`}
                      >
                        ●
                      </span>
                      <span className="text-slate-300">
                        {depAction?.title ?? dep}
                      </span>
                      <span
                        className={`ml-auto text-xs ${
                          tone[depStatus] ?? "text-slate-400"
                        }`}
                      >
                        {depStatus.replace(/_/g, " ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          {blockedBy.length > 0 && (
            <p className="mt-2 text-xs text-amber-400">
              ⚠ Blocked by {blockedBy.length} incomplete prerequisite
              {blockedBy.length > 1 ? "s" : ""}.
            </p>
          )}
        </div>

        {/* Success criteria */}
        <div>
          <Label>Success criteria</Label>
          <ul className="mt-1 space-y-1">
            {action.successCriteria.map((c, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300">
                <span className="text-slate-600">—</span>
                {c}
              </li>
            ))}
          </ul>
        </div>

        {/* Risk & Approval */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Risk level</Label>
            <p
              className={`mt-1 text-sm font-medium ${
                riskColor[action.riskLevel] ?? "text-slate-300"
              }`}
            >
              {action.riskLevel}
            </p>
          </div>
          <div>
            <Label>Approval</Label>
            <p
              className={`mt-1 text-sm ${
                action.approvalRequired ? "text-orange-300" : "text-slate-400"
              }`}
            >
              {action.approvalRequired
                ? "Human approval required"
                : "None flagged"}
            </p>
          </div>
        </div>

        {/* Priority & Execution mode */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Priority</Label>
            <Value>{action.priority}</Value>
          </div>
          <div>
            <Label>Execution mode</Label>
            <Value>{action.executionMode}</Value>
          </div>
        </div>

        {/* Evidence */}
        {action.evidence.length > 0 && (
          <div>
            <Label>Evidence ({action.evidence.length})</Label>
            <ul className="mt-1 space-y-2">
              {action.evidence.map((ev, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs"
                >
                  <span className="text-blue-300">{ev.kind}</span>
                  <p className="mt-0.5 text-slate-400">{ev.note}</p>
                  <p className="mt-0.5 text-slate-600">
                    {new Date(ev.recordedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Transition actions */}
      <div className="border-t border-slate-800 px-5 py-4">
        <Label>Transition</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {canStart && (
            <button
              onClick={() => onTransition(action, "in_progress")}
              className="rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-400"
            >
              Start
            </button>
          )}
          {isInProgress && (
            <>
              <button
                onClick={() => onTransition(action, "completed")}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Complete
              </button>
              <button
                onClick={() => onTransition(action, "failed")}
                className="rounded-md border border-rose-400/40 px-3 py-2 text-sm text-rose-300 hover:border-rose-400/70"
              >
                Record failure
              </button>
            </>
          )}
          {!canStart && !isInProgress && (
            <p className="text-xs text-slate-500">
              No transitions available for current status.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
