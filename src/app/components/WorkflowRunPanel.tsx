"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Action, Approval, WorkflowMode, WorkflowRun } from "../../domain/types";
import SharedBrowserPanel from "./SharedBrowserPanel";

type Props = {
  caseId: string;
  actions: Action[];
  approvals: Approval[];
  jurisdiction: string;
  documentType: string;
  onCaseRefresh: () => Promise<void>;
  onTransition: (
    action: Action,
    status: "in_progress" | "completed" | "failed",
    userReport?: string,
  ) => Promise<void>;
};

type CopilotAnswer = {
  observed: string[];
  guidance: string;
  limits: string;
};

const runLabels: Record<string, string> = {
  running: "RUNNING",
  waiting_for_user: "WAITING FOR YOU",
  waiting_for_approval: "WAITING FOR APPROVAL",
  blocked: "BLOCKED",
  failed: "FAILED",
  uncertain: "NEEDS REVIEW",
  completed: "COMPLETED",
  paused: "PAUSED",
};

const runStyles: Record<string, string> = {
  running: "border-cyan-700 bg-cyan-950/30 text-cyan-200",
  waiting_for_user: "border-amber-700 bg-amber-950/30 text-amber-200",
  waiting_for_approval: "border-orange-700 bg-orange-950/30 text-orange-200",
  blocked: "border-amber-700 bg-amber-950/30 text-amber-200",
  failed: "border-rose-700 bg-rose-950/30 text-rose-200",
  uncertain: "border-violet-700 bg-violet-950/30 text-violet-200",
  completed: "border-emerald-700 bg-emerald-950/30 text-emerald-200",
  paused: "border-slate-600 bg-slate-800/70 text-slate-200",
};

function safeStreamingUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".tinyfish.unikraft.app")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function readResult(action?: Action): Record<string, unknown> | null {
  const attempt = action?.executionAttempts
    ?.filter((item) => item.provider === "tinyfish")
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
  if (!attempt?.resultDetails) return null;
  try {
    return JSON.parse(attempt.resultDetails) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function prettyApprovalPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return "Operation details could not be displayed. Reject this request and ask for a new one.";
  }
}

function hasOnlySimulatedEvidence(action: Action): boolean {
  const latestAttempt = action.executionAttempts
    ?.slice()
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
  return Boolean(latestAttempt?.isSimulated || (
    action.evidence.length > 0 && action.evidence.every((item) => item.kind === "simulated")
  ));
}

export default function WorkflowRunPanel({
  caseId,
  actions,
  approvals,
  jurisdiction,
  documentType,
  onCaseRefresh,
  onTransition,
}: Props) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [mode, setMode] = useState<WorkflowMode>("autonomous");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [clockNow, setClockNow] = useState(0);
  const [userReport, setUserReport] = useState("");

  const refreshRuns = useCallback(async () => {
    const response = await fetch(`/api/cases/${caseId}/workflow-runs`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not refresh workflow status.");
    setRuns(data as WorkflowRun[]);
    await onCaseRefresh();
    return data as WorkflowRun[];
  }, [caseId, onCaseRefresh]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const latestRuns = await refreshRuns();
        if (disposed) return;
        if (latestRuns[0] && ["running", "waiting_for_approval"].includes(latestRuns[0].status)) {
          timer = window.setTimeout(() => void poll(), 1800);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not refresh workflow status.");
        if (!disposed) timer = window.setTimeout(() => void poll(), 4000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshRuns]);

  const run = runs[0];
  const latestGateEvent = [...(run?.events ?? [])].reverse().find((event) =>
    ["WAITING_FOR_USER", "WAITING_FOR_APPROVAL", "APPROVAL_GRANTED", "WORKFLOW_RESUMED", "ACTION_STARTED", "ACTION_COMPLETED", "ACTION_FAILED", "WORKFLOW_COMPLETED", "WORKFLOW_FAILED", "WORKFLOW_UNCERTAIN", "WORKFLOW_PAUSED", "WORKFLOW_BLOCKED"].includes(event.type)
  );
  const isRunRunning = run?.status === "running" &&
    !["WAITING_FOR_USER", "WAITING_FOR_APPROVAL"].includes(latestGateEvent?.type ?? "");
  useEffect(() => {
    if (!isRunRunning) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunRunning]);
  const currentAction = actions.find((action) => action.id === run?.currentActionId);
  const waitingForUser = run?.status === "waiting_for_user" ||
    (latestGateEvent?.type === "WAITING_FOR_USER" && run?.status === "running");
  const waitingForApproval = run?.status === "waiting_for_approval" ||
    (latestGateEvent?.type === "WAITING_FOR_APPROVAL" && run?.status === "running");
  const displayStatus = waitingForUser
    ? "waiting_for_user"
    : waitingForApproval
    ? "waiting_for_approval"
    : run?.status;
  const currentApproval = approvals.find((approval) =>
    approval.actionId === currentAction?.id && approval.status === "pending"
  );
  const streamingEvent = useMemo(
    () => [...(run?.events ?? [])].reverse().find((event) => event.streamingUrl && event.actionId === run?.currentActionId),
    [run?.events, run?.currentActionId],
  );
  const streamingUrl = safeStreamingUrl(streamingEvent?.streamingUrl);
  const currentActionHasTinyFishHistory = currentAction?.executionAttempts?.some((attempt) => attempt.provider === "tinyfish") ?? false;
  const latestResearchItem = useMemo(() => actions
    .flatMap((action) => action.executionAttempts ?? [])
    .filter((attempt) => attempt.provider === "tinyfish" && attempt.resultDetails)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0], [actions]);
  const latestResearchAction = latestResearchItem
    ? actions.find((action) => action.id === latestResearchItem.actionId)
    : undefined;
  const latestResearch = readResult(latestResearchAction);
  const sourceUrls = Array.isArray(latestResearch?.sourceUrls)
    ? latestResearch.sourceUrls.filter((url): url is string => typeof url === "string" && url.startsWith("https://"))
    : [];
  const officialSourceUrls = Array.isArray(latestResearch?.officialSourceUrls)
    ? latestResearch.officialSourceUrls.filter((url): url is string => typeof url === "string" && url.startsWith("https://"))
    : [];
  const otherSourceUrls = sourceUrls.filter((url) => !officialSourceUrls.includes(url));
  const researchSummary = typeof latestResearch?.summary === "string" ? latestResearch.summary : "";

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/cases/${caseId}/workflow-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, jurisdiction, documentType }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start workflow.");
      await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start workflow.");
    } finally {
      setBusy(false);
    }
  }

  async function control(action: "pause" | "resume", requestedMode?: WorkflowMode) {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/cases/${caseId}/workflow-runs/${run.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(requestedMode ? { mode: requestedMode } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Could not ${action} workflow.`);
      await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} workflow.`);
    } finally {
      setBusy(false);
    }
  }

  async function askCopilot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!run || !question.trim()) return;
    setAsking(true);
    setError("");
    try {
      const response = await fetch(`/api/cases/${caseId}/workflow-runs/${run.id}/help`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not prepare guidance.");
      setAnswer(data as CopilotAnswer);
      setQuestion("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare guidance.");
    } finally {
      setAsking(false);
    }
  }

  async function decideCurrentApproval(decision: "approve" | "reject") {
    if (!currentApproval) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/cases/${caseId}/approvals/${currentApproval.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Could not ${decision} this request.`);
      await onCaseRefresh();
      await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record your decision.");
    } finally {
      setBusy(false);
    }
  }

  async function startUserTask() {
    if (!currentAction) return;
    setBusy(true);
    await onTransition(currentAction, "in_progress");
    setBusy(false);
    await refreshRuns();
  }

  async function completeUserTask() {
    if (!currentAction || !userReport.trim()) return;
    setBusy(true);
    await onTransition(currentAction, "completed", userReport.trim());
    setUserReport("");
    setBusy(false);
    await refreshRuns();
  }

  const canStart = !run || ["completed", "failed", "uncertain"].includes(run.status);
  const orderedActions = [...actions].sort((left, right) =>
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.title.localeCompare(right.title)
  );
  const elapsed = run
    ? Math.max(0, Math.floor(((run.finishedAt ? Date.parse(run.finishedAt) : clockNow) - Date.parse(run.createdAt)) / 1000))
    : 0;

  return (
    <section className="mt-7 rounded-2xl border border-cyan-900/50 bg-slate-900/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Workflow copilot</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-100">Start once. TRESTLE works through the plan.</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            TRESTLE checks prerequisites and policy between tasks. It runs supported public research, then pauses for your decisions or actions. It never submits an application or marks one complete from research alone.
          </p>
        </div>
        {run && (
          <span className={`rounded-full border px-3 py-1.5 text-xs font-bold tracking-wide ${runStyles[displayStatus ?? "blocked"] ?? runStyles.blocked}`}>
            {runLabels[displayStatus ?? "blocked"] ?? displayStatus?.toUpperCase()}
          </span>
        )}
      </div>

      {!run || canStart
        ? (
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="flex gap-2" role="group" aria-label="Workflow mode">
              {(["autonomous", "guided"] as WorkflowMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={`rounded-lg border px-3 py-2 text-sm ${mode === option ? "border-cyan-500 bg-cyan-950/60 text-cyan-100" : "border-slate-700 text-slate-400"}`}
                >
                  {option === "autonomous" ? "Autonomous" : "Guided"}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={start}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? "Starting…" : mode === "autonomous" ? "Start workflow" : "Start guided mode"}
            </button>
            <span className="text-xs text-slate-500">Research context: {jurisdiction} · {documentType}</span>
          </div>
        )
        : (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-300">
              {currentAction ? `Current task: ${currentAction.title}` : "TRESTLE is checking the workflow."}
              {run.pauseRequested && " Pause requested; the current provider action is allowed to finish."}
            </p>
            {run.status === "running" && !waitingForUser && !waitingForApproval && !run.pauseRequested
              ? <button type="button" disabled={busy} onClick={() => control("pause")} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">Pause after current task</button>
              : run.mode === "autonomous" && !waitingForApproval && !waitingForUser && !["waiting_for_approval", "waiting_for_user", "blocked"].includes(run.status)
              ? <button type="button" disabled={busy} onClick={() => control("resume")} className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-100 disabled:opacity-50">Resume</button>
              : null}
            {!["running", "waiting_for_approval", "completed", "failed", "uncertain"].includes(run.status) && (
              <button type="button" disabled={busy} onClick={() => control("resume", "autonomous")} className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-100 disabled:opacity-50">
                Continue with autonomous research
              </button>
            )}
          </div>
        )}

      {run && (
        <section className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4" aria-label="Workflow task order">
          <h3 className="text-sm font-semibold text-slate-200">Workflow steps</h3>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {orderedActions.map((action) => {
              const isCurrent = action.id === run.currentActionId && !["completed", "failed"].includes(action.status);
              const statusLabel = isCurrent
                ? "CURRENT"
                : action.status === "completed"
                ? hasOnlySimulatedEvidence(action) ? "SIMULATED" : "COMPLETED"
                : action.status.replaceAll("_", " ").toUpperCase();
              return (
                <li key={action.id} className={`rounded-lg border p-3 ${isCurrent ? "border-cyan-700 bg-cyan-950/30" : "border-slate-800 bg-slate-900/60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-slate-200">{action.title}</span>
                    <span className="shrink-0 text-[10px] font-bold tracking-wide text-slate-400">{statusLabel}</span>
                  </div>
                  {action.dependencies.length > 0 && <p className="mt-1 text-xs text-slate-500">After: {action.dependencies.map((id) => actions.find((item) => item.id === id)?.title ?? id).join(", ")}</p>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}

      {run && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-400">
                <span>Run <code className="text-slate-300">{run.id}</code></span>
                {(streamingEvent?.runId || (typeof latestResearch?.runId === "string" ? latestResearch.runId : null)) && (
                  <span>TinyFish run <code className="text-slate-300">{streamingEvent?.runId ?? String(latestResearch?.runId)}</code></span>
                )}
                <span>{run.mode === "autonomous" ? "AUTONOMOUS" : "GUIDED"} · {elapsed}s elapsed</span>
              </div>
              {currentAction && <p className="mt-3 text-sm font-medium text-slate-100">{currentAction.title}</p>}
              {run.errorMessage && <p className="mt-2 text-sm text-rose-300">{run.errorMessage}</p>}
              {waitingForUser && currentAction && (
                <div className="mt-4 rounded-xl border border-amber-700/70 bg-amber-950/30 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Your step · TRESTLE is waiting for you</p>
                  <h3 className="mt-1 text-lg font-semibold text-amber-100">{currentAction.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-200">{currentAction.description}</p>
                  <p className="mt-2 text-sm text-slate-300"><strong>Completion means:</strong> {currentAction.successCriteria.join(" ")}</p>
                  {currentAction.requiredInputs.length > 0 && <p className="mt-2 text-sm text-slate-300"><strong>Have ready:</strong> {currentAction.requiredInputs.join(", ")}. Do not enter card, account, or document numbers here.</p>}
                  <p className="mt-2 text-xs text-amber-200">TRESTLE cannot perform this task with the configured real providers. Complete it yourself; no mock action will be presented as real.</p>
                  {currentAction.status !== "in_progress"
                    ? <button type="button" disabled={busy} onClick={() => void startUserTask()} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Updating…" : "I’ll handle this step"}</button>
                    : (
                      <div className="mt-3 space-y-2">
                        <label htmlFor={`user-report-${currentAction.id}`} className="block text-sm text-slate-200">After you finish, briefly note what you did</label>
                        <textarea id={`user-report-${currentAction.id}`} value={userReport} onChange={(event) => setUserReport(event.target.value)} maxLength={500} rows={2} placeholder="For example: I contacted the card issuer and followed their instructions." className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 placeholder:text-slate-600" />
                        <p className="text-xs text-slate-400">This stays in TRESTLE as your report. Avoid sensitive numbers; it is not independent verification.</p>
                        <button type="button" disabled={busy || !userReport.trim()} onClick={() => void completeUserTask()} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Record my update and continue"}</button>
                      </div>
                    )}
                </div>
              )}
              {waitingForApproval && currentAction && (
                <div className="mt-4 rounded-xl border border-orange-700/70 bg-orange-950/30 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-orange-300">Your decision · approval required</p>
                  <h3 className="mt-1 text-lg font-semibold text-orange-100">{currentAction.title}</h3>
                  {currentApproval
                    ? <>
                      <p className="mt-2 text-sm leading-6 text-slate-200">{currentApproval.operationDescription}</p>
                      <p className="mt-2 text-xs text-slate-300">Risk: {currentApproval.riskCategory.replaceAll("_", " ")}{currentApproval.destination ? ` · Destination: ${currentApproval.destination}` : ""}</p>
                      <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">Inspect operation details</summary><pre className="mt-2 overflow-auto rounded bg-slate-950 p-3 text-slate-300">{prettyApprovalPayload(currentApproval.payload)}</pre></details>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={busy} onClick={() => void decideCurrentApproval("approve")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Approve and continue"}</button>
                        <button type="button" disabled={busy} onClick={() => void decideCurrentApproval("reject")} className="rounded-lg border border-rose-700 px-4 py-2 text-sm text-rose-200 disabled:opacity-50">Reject</button>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">Approval authorizes only this displayed operation. If approved, TRESTLE rechecks it and starts execution automatically.</p>
                    </>
                    : <p className="mt-2 text-sm text-orange-100">The approval request is still loading. This task will not run until you approve its exact operation.</p>}
                </div>
              )}
              {run.status === "uncertain" && <p className="mt-2 text-sm text-violet-200">Review the latest attempt before continuing. TRESTLE will not retry the external run automatically.</p>}
              {run.mode === "autonomous" && currentActionHasTinyFishHistory && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">LIVE TINYFISH browser preview · read-only</p>
                  {streamingUrl
                    ? (
                      <>
                        <div className="mt-2 aspect-video overflow-hidden rounded-lg border border-slate-700 bg-black">
                          <iframe title="Live TinyFish browser preview" src={streamingUrl} className="h-full w-full" referrerPolicy="no-referrer" />
                        </div>
                        <a href={streamingUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm text-cyan-300 underline">Open live browser in a new tab</a>
                        <p className="mt-1 text-xs text-slate-500">The stream link comes from TinyFish and may expire after the run. The embedded preview is watch-only; user interaction is not supported in this view.</p>
                      </>
                    )
                    : <p className="mt-2 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">{run.status === "running" ? "Waiting for TinyFish to provide its real browser stream URL. No browser preview is available yet." : "TinyFish did not provide an available browser stream URL for this run."}</p>}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <h3 className="text-sm font-semibold text-slate-200">Persisted workflow timeline</h3>
              <ol className="mt-3 max-h-64 space-y-2 overflow-auto">
                {run.events.slice().reverse().map((event) => (
                  <li key={event.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300">{event.type.replaceAll("_", " ")}</span>
                      <time className="text-[11px] text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</time>
                    </div>
                    {event.purpose && <p className="mt-1 text-sm text-slate-200">{event.purpose}</p>}
                    {event.url && <p className="mt-1 text-xs text-slate-400">TinyFish-reported page: <a href={event.url} target="_blank" rel="noreferrer" className="break-all text-cyan-300 underline">{event.url}</a></p>}
                    {event.message && <p className="mt-1 text-sm text-slate-300">{event.message}</p>}
                    {event.status && <p className="mt-1 text-xs text-slate-400">Provider status: {event.status}</p>}
                  </li>
                ))}
              </ol>
            </div>

            {researchSummary && (
              <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4">
                <h3 className="text-sm font-semibold text-cyan-100">Research result · LIVE TINYFISH{latestResearchAction ? ` · ${latestResearchAction.title}` : ""}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-200">{researchSummary}</p>
                {typeof latestResearch?.requestedUrl === "string" && (
                  <p className="mt-3 text-xs text-slate-400">Requested start page: <a href={latestResearch.requestedUrl} target="_blank" rel="noreferrer" className="break-all text-cyan-300 underline">{latestResearch.requestedUrl}</a></p>
                )}
                {sourceUrls.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">URLs returned by TinyFish</p>
                    <ul className="mt-1 space-y-1">
                    {sourceUrls.map((url) => <li key={url} className="text-sm">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${officialSourceUrls.includes(url) ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{officialSourceUrls.includes(url) ? "Official domain" : "Not verified as official"}</span>
                      <a href={url} target="_blank" rel="noreferrer" className="break-all text-cyan-300 underline">{url}</a>
                    </li>)}
                    </ul>
                    {otherSourceUrls.length > 0 && <p className="mt-2 text-xs text-amber-200">These returned links are visible for review, but they do not count toward TRESTLE’s official-source verification.</p>}
                  </div>
                )}
                <p className="mt-3 text-xs text-slate-400">Research findings do not mean an application was submitted, accepted, or completed.</p>
              </div>
            )}
          </div>

          <aside className="rounded-xl border border-violet-900/50 bg-violet-950/15 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Guided help</p>
            <h3 className="mt-1 font-semibold text-slate-100">Ask about the current step</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">Help is generated locally from the workflow definition and persisted TinyFish progress. Do not include names, document numbers, passwords, or form values.</p>
            <form onSubmit={askCopilot} className="mt-4 space-y-2">
              <label htmlFor={`workflow-question-${run.id}`} className="sr-only">Ask for workflow guidance</label>
              <textarea id={`workflow-question-${run.id}`} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={3} placeholder="What is TRESTLE doing? What should I do next?" className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 placeholder:text-slate-600" />
              <button type="submit" disabled={asking || !question.trim()} className="rounded-lg border border-violet-700 px-3 py-2 text-sm text-violet-100 disabled:opacity-50">{asking ? "Preparing guidance…" : "Ask TRESTLE"}</button>
            </form>
            {answer && (
              <div className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                {answer.observed.length > 0 && <div><p className="text-xs font-semibold uppercase text-cyan-300">Observed provider activity</p><ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-300">{answer.observed.map((text) => <li key={text}>{text}</li>)}</ul></div>}
                <div><p className="text-xs font-semibold uppercase text-violet-300">Guidance</p><p className="mt-1 text-sm leading-6 text-slate-200">{answer.guidance}</p></div>
                <p className="text-xs leading-5 text-slate-500">{answer.limits}</p>
              </div>
            )}
          </aside>
        </div>
      )}
      <SharedBrowserPanel caseId={caseId} actions={actions} />
    </section>
  );
}
