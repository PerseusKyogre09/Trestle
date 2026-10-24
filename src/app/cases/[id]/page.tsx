"use client";

/**
 * Case detail page – refactored to support a list/graph view toggle.
 *
 * The graph view reuses the same data, state, and transition logic as the
 * list view. No separate sources of truth.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { Action, Case } from "../../../domain/types";
import ActionDetailPanel from "../../components/ActionDetailPanel";

// Lazily load the graph to avoid SSR issues with React Flow
const ActionGraph = dynamic(() => import("../../components/ActionGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-slate-500">
      Loading graph…
    </div>
  ),
});

// ─── Constants ────────────────────────────────────────────────────────────────

const tone: Record<string, string> = {
  completed:         "text-emerald-300",
  failed:            "text-rose-300",
  blocked:           "text-amber-300",
  ready:             "text-blue-300",
  in_progress:       "text-violet-300",
  pending:           "text-slate-400",
  awaiting_approval: "text-orange-300",
};

type ViewMode = "list" | "graph";

// ─── Component ────────────────────────────────────────────────────────────────

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Case | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/cases/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      })
      .then(setItem)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  // ── Status transition (shared by list and graph views) ───────────────────
  const transition = useCallback(
    async (action: Action, status: "in_progress" | "completed" | "failed") => {
      const evidence =
        status === "completed"
          ? {
              kind: "user_provided" as const,
              note: "User marked this task complete after reviewing the result.",
              recordedAt: new Date().toISOString(),
            }
          : undefined;

      const r = await fetch(`/api/cases/${id}/actions/${action.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, evidence }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error);
        return;
      }
      // Re-read the case so the server remains the source of truth and all
      // dependent actions are recalculated after this state change.
      const refreshed = await fetch(`/api/cases/${id}`);
      if (!refreshed.ok) {
        setError("The action changed, but the case could not be refreshed.");
        return;
      }
      setItem(await refreshed.json());
    },
    [id]
  );

  const handleNodeSelect = useCallback(
    (action: Action | null) => setSelectedActionId(action?.id ?? null),
    []
  );

  const selectedAction = item?.actions.find((a) => a.id === selectedActionId) ?? null;

  // ── Error / loading ──────────────────────────────────────────────────────
  if (error)
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-rose-300">{error}</p>
        <Link href="/" className="mt-6 inline-block text-blue-300">
          ← Back to cases
        </Link>
      </main>
    );

  if (!item)
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-slate-400">
        Loading case…
      </main>
    );

  const completed = item.actions.filter((a) => a.status === "completed").length;
  const counts = (status: string) =>
    item.actions.filter((a) => a.status === status).length;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <main className="flex min-h-screen flex-col">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
        <Link href="/" className="text-sm text-blue-300">
          ← All cases
        </Link>

        <header className="mt-10 border-b border-slate-800 pb-8">
          <p className="text-sm uppercase tracking-[0.25em] text-blue-300">
            {item.status} case
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-slate-100">{item.title}</h1>
          <p className="mt-4 max-w-3xl text-slate-300">{item.originalInput}</p>

          {/* Stats */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ["Progress", `${completed}/${item.actions.length}`],
                ["Ready", counts("ready")],
                ["Pending", counts("pending")],
                ["Blocked", counts("blocked")],
                ["Failed", counts("failed")],
              ] as [string, string | number][]
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"
              >
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          {/* View toggle */}
          <div
            className="mt-6 inline-flex rounded-lg border border-slate-800 bg-slate-900/50 p-1"
            role="group"
            aria-label="View mode"
          >
            {(["list", "graph"] as ViewMode[]).map((v) => (
              <button
                key={v}
                id={`view-toggle-${v}`}
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  if (v === "list") setSelectedActionId(null);
                }}
                className={[
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                  view === v
                    ? "bg-blue-500 text-white"
                    : "text-slate-400 hover:text-slate-200",
                ].join(" ")}
              >
                {v === "list" ? "☰ List" : "⬡ Graph"}
              </button>
            ))}
          </div>
        </header>
      </div>

      {/* ── Content area ────────────────────────────────────────────── */}
      {view === "list" ? (
        <div className="mx-auto w-full max-w-7xl px-6 pb-10 sm:px-10">
          <section className="mt-8 space-y-4">
            {item.actions.map((action) => {
              const blockedBy = action.dependencies.filter(
                (d) => item.actions.find((a) => a.id === d)?.status !== "completed"
              );
              const canStart =
                blockedBy.length === 0 &&
                ["pending", "ready", "failed"].includes(action.status);

              return (
                <article
                  key={action.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 p-5"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="font-medium text-slate-100">{action.title}</h2>
                        <span
                          className={`text-xs font-medium uppercase tracking-wide ${tone[action.status]}`}
                        >
                          {action.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        {action.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {canStart && (
                        <button
                          onClick={() => transition(action, "in_progress")}
                          className="rounded-md bg-blue-500 px-3 py-2 text-sm text-white"
                        >
                          Start
                        </button>
                      )}
                      {action.status === "in_progress" && (
                        <>
                          <button
                            onClick={() => transition(action, "completed")}
                            className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white"
                          >
                            Complete
                          </button>
                          <button
                            onClick={() => transition(action, "failed")}
                            className="rounded-md border border-rose-400/40 px-3 py-2 text-sm text-rose-300"
                          >
                            Record failure
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 text-sm sm:grid-cols-3">
                    <div>
                      <span className="text-slate-500">Prerequisites</span>
                      <p className="mt-1 text-slate-300">
                        {action.dependencies.length
                          ? action.dependencies.join(", ")
                          : "None"}
                        {blockedBy.length > 0 && (
                          <span className="block text-amber-300">
                            Blocked by incomplete prerequisite
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Risk / approval</span>
                      <p className="mt-1 text-slate-300">
                        {action.riskLevel} ·{" "}
                        {action.approvalRequired
                          ? "Human approval required"
                          : "No approval flagged"}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Success criteria</span>
                      <p className="mt-1 text-slate-300">
                        {action.successCriteria.join(" ")}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      ) : (
        /* Graph view */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Canvas */}
          <div
            className="flex-1"
            style={{ height: "calc(100vh - 380px)", minHeight: "400px" }}
            role="region"
            aria-label="Action dependency graph"
          >
            <ActionGraph
              actions={item.actions}
              selectedActionId={selectedActionId}
              onNodeSelect={handleNodeSelect}
            />
          </div>

          {/* Detail panel */}
          {selectedAction && (
            <div className="min-h-80 w-full shrink-0 overflow-y-auto lg:min-h-0 lg:w-80">
              <ActionDetailPanel
                action={selectedAction}
                caseItem={item}
                onClose={() => setSelectedActionId(null)}
                onTransition={transition}
              />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
