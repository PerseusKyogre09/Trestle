"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Action, Approval, WorkflowMode, WorkflowRun } from "../../domain/types";
import SharedBrowserPanel from "./SharedBrowserPanel";
import type { LiveBrowserFrame } from "./SharedBrowserPanel";

/* eslint-disable @next/next/no-img-element -- live remote frame is a data URL from the existing shared browser. */

type Props = {
  caseId: string;
  actions: Action[];
  approvals: Approval[];
  jurisdiction: string;
  documentType: string;
  supplementalResearchDefault?: string;
  onCaseRefresh: () => Promise<void>;
  onTransition: (
    action: Action,
    status: "in_progress" | "completed" | "failed",
    userReport?: string,
  ) => Promise<boolean>;
};

const travelDetailQuestions = [
  { id: "passport-country", label: "Which country issued your passport?", help: "Country only. Never enter a passport number.", optional: false },
  { id: "trip-purpose", label: "What is the main purpose of your trip?", help: "For example, tourism, business, study, or visiting family.", optional: false },
  { id: "trip-length", label: "How long do you plan to stay?", help: "A rough duration is enough, such as two weeks.", optional: false },
  { id: "transit-countries", label: "Will you transit through another country?", help: "List the country or countries, or choose “No transit”.", optional: true },
] as const;

function questionAndAnswer(note: string, action: Action): { question: string; answer: string } | null {
  const travelMatch = note.match(/^Travel detail \[([a-z-]+)\]:\s*([\s\S]*)$/);
  if (travelMatch) {
    const question = travelDetailQuestions.find((item) => item.id === travelMatch[1]);
    return question ? { question: question.label, answer: travelMatch[2] } : null;
  }

  const guidedMatch = note.match(/^Step answer \[(\d+)\]:\s*([\s\S]*)$/);
  if (!guidedMatch) return null;
  const index = Number(guidedMatch[1]);
  const question = action.requiredInputs[index];
  return question ? { question, answer: guidedMatch[2] } : null;
}

type CopilotAnswer = {
  observed: string[];
  guidance: string;
  limits: string;
};

const runLabels: Record<string, string> = {
  starting: "STARTING",
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
  starting: "border-amber-700 bg-amber-950/30 text-amber-200",
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

function hasVerifiedResearchForAction(action: Action, actions: Action[]): boolean {
  const byId = new Map(actions.map((item) => [item.id, item]));
  const relevant = new Set<string>([action.id]);
  const visit = (item: Action) => {
    for (const dependency of item.dependencies) {
      if (relevant.has(dependency)) continue;
      relevant.add(dependency);
      const parent = byId.get(dependency);
      if (parent) visit(parent);
    }
  };
  visit(action);
  return actions.some((candidate) => {
    if (!relevant.has(candidate.id)) return false;
    return (candidate.executionAttempts ?? []).some((attempt) => {
      if (attempt.provider !== "tinyfish" || attempt.status !== "succeeded" || attempt.isSimulated || !attempt.resultDetails) return false;
      try {
        const result = JSON.parse(attempt.resultDetails) as { officialSourceUrls?: unknown };
        return Array.isArray(result.officialSourceUrls) && result.officialSourceUrls.some((url) => typeof url === "string" && url.startsWith("https://"));
      } catch {
        return false;
      }
    });
  });
}

export default function WorkflowRunPanel({
  caseId,
  actions,
  approvals,
  jurisdiction,
  documentType,
  supplementalResearchDefault = "",
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
  const [spamRoute, setSpamRoute] = useState("");
  const [confirmSpamReview, setConfirmSpamReview] = useState(false);
  const [liveBrowserFrames, setLiveBrowserFrames] = useState<Record<string, LiveBrowserFrame>>({});
  const [supplementalJurisdiction, setSupplementalJurisdiction] = useState(supplementalResearchDefault);
  const [supplementalResearchBusy, setSupplementalResearchBusy] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [travelAnswer, setTravelAnswer] = useState("");
  const [guidedActionCompleted, setGuidedActionCompleted] = useState(false);
  const isSpamReporting = actions.some((action) => action.id === "classify-reporting-route");

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
  const orderedActions = [...actions].sort((left, right) =>
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.title.localeCompare(right.title)
  );
  const scheduledAction = actions.find((action) => action.id === run?.currentActionId);
  const readyAction = run?.status === "running"
    ? orderedActions.find((action) => action.status === "ready")
    : undefined;
  const currentAction = scheduledAction && !["completed", "failed"].includes(scheduledAction.status)
    ? scheduledAction
    : readyAction ?? scheduledAction;
  const captureLiveBrowserFrame = useCallback((frame: LiveBrowserFrame | null) => {
    if (!frame) return;
    const frameKey = frame.actionId ?? "unassigned";
    setLiveBrowserFrames((current) => ({ ...current, [frameKey]: frame }));
  }, []);
  const relevantBrowserFrame = currentAction ? liveBrowserFrames[currentAction.id] ?? null : null;
  const selectedWorkflowStep = orderedActions.find((action) => action.id === selectedStepId) ?? null;
  const selectedStepResult = readResult(selectedWorkflowStep ?? undefined);
  const selectedStepAttempt = selectedWorkflowStep?.executionAttempts
    ?.slice()
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
  useEffect(() => {
    setGuidedActionCompleted(false);
    setTravelAnswer("");
    setUserReport("");
  }, [currentAction?.id]);
  const actionAwaitingAssignment = Boolean(readyAction && currentAction?.id === readyAction.id && run?.currentActionId !== readyAction.id);
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
  const spamRouteEvidence = actions.find((action) => action.id === "classify-reporting-route")?.evidence.find((item) => item.kind === "user_provided")?.note.replace(/^User reports:\s*/i, "") ?? "";
  const ordinaryUccRoute = spamRouteEvidence.toLowerCase().includes("ordinary unsolicited");
  const spamIdentifierEvidence = actions.find((action) => action.id === "record-suspicious-identifier")?.evidence.find((item) => item.kind === "user_provided")?.note.replace(/^User reports:\s*/i, "") ?? "";
  const spamDescriptionEvidence = actions.find((action) => action.id === "record-spam-details")?.evidence.find((item) => item.kind === "user_provided")?.note.replace(/^User reports:\s*/i, "") ?? "";
  const spamStateEvidence = actions.find((action) => action.id === "record-reporting-state")?.evidence.find((item) => item.kind === "user_provided")?.note.replace(/^User reports:\s*/i, "") ?? "";
  const spamEvidenceNote = actions.find((action) => action.id === "prepare-report-evidence")?.evidence.find((item) => item.kind === "user_provided")?.note.replace(/^User reports:\s*/i, "") ?? "";
  const spamOfficialUrl = spamRouteEvidence.toLowerCase().includes("ordinary unsolicited")
    ? "https://trai.gov.in/complain-or-report-against-ucc"
    : spamRouteEvidence.toLowerCase().includes("money lost")
    ? "https://cybercrime.gov.in/"
    : "https://cybercrime.gov.in/webform/cyber_suspect.aspx";
  const waitingForUser = run?.status === "waiting_for_user" ||
    (latestGateEvent?.type === "WAITING_FOR_USER" && run?.status === "running");
  const waitingForApproval = run?.status === "waiting_for_approval" ||
    (latestGateEvent?.type === "WAITING_FOR_APPROVAL" && run?.status === "running");
  const displayStatus = waitingForUser
    ? "waiting_for_user"
    : waitingForApproval
    ? "waiting_for_approval"
    : run?.status === "running" && actionAwaitingAssignment
    ? "starting"
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
        body: JSON.stringify(isSpamReporting
          ? { mode, jurisdiction: "India", documentType: "spam caller identifier" }
          : { mode, jurisdiction, documentType }),
      });
      const responseText = await response.text();
      let data: { error?: string } = {};
      try {
        data = responseText ? JSON.parse(responseText) as { error?: string } : {};
      } catch {
        // Surface an HTTP error below when the server returns an empty or non-JSON response.
      }
      if (!response.ok) {
        throw new Error(data.error ?? `Could not start workflow (HTTP ${response.status}).`);
      }
      await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start workflow.");
    } finally {
      setBusy(false);
    }
  }

  async function startSupplementalResearch() {
    setSupplementalResearchBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/cases/${caseId}/jurisdiction-research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jurisdiction: supplementalJurisdiction }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start jurisdiction research.");
      await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start jurisdiction research.");
    } finally {
      setSupplementalResearchBusy(false);
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
    const started = await onTransition(currentAction, "in_progress");
    setBusy(false);
    if (started) await refreshRuns();
  }

  const savedGuidedAnswers = useMemo(() => {
    const saved: Record<string, string> = {};
    for (const item of currentAction?.evidence ?? []) {
      if (item.kind !== "user_provided") continue;
      const travelMatch = item.note.match(/^Travel detail \[([a-z-]+)\]:\s*([\s\S]*)$/);
      const guidedMatch = item.note.match(/^Step answer \[(\d+)\]:\s*([\s\S]*)$/);
      if (travelMatch) saved[travelMatch[1]] = travelMatch[2];
      else if (guidedMatch) saved[`step-${guidedMatch[1]}`] = guidedMatch[2];
    }
    return saved;
  }, [currentAction?.evidence]);
  const isTravelDetailsStep = currentAction?.id === "confirm-travel-details";
  const customQuestionSteps = new Set(["classify-reporting-route", "review-report-manually"]);
  const isSequentialQuestionStep = Boolean(currentAction && !customQuestionSteps.has(currentAction.id) && (isTravelDetailsStep || currentAction.requiredInputs.length > 1));
  const guidedQuestions = isTravelDetailsStep
    ? travelDetailQuestions
    : (currentAction?.requiredInputs ?? []).map((requirement, index) => ({
      id: `step-${index}`,
      label: requirement,
      help: `${/if known|if any|optional/i.test(requirement) ? "Optional. Share this only if you know it. " : "Answer only what you know; do not guess. "}Never enter passwords, OTPs, or full account or identity numbers.`,
      optional: /if known|if any|optional/i.test(requirement),
    }));
  const nextGuidedQuestion = isSequentialQuestionStep
    ? guidedQuestions.find((field) => !savedGuidedAnswers[field.id])
    : undefined;

  async function saveGuidedAnswer(value: string) {
    if (!currentAction || !nextGuidedQuestion || !value.trim()) return;
    setBusy(true);
    setError("");
    const marker = isTravelDetailsStep
      ? `Travel detail [${nextGuidedQuestion.id}]: ${value.trim()}`
      : `Step answer [${nextGuidedQuestion.id.replace("step-", "")}]: ${value.trim()}`;
    const persisted = await onTransition(currentAction, "in_progress", marker);
    if (!persisted) {
      setBusy(false);
      return;
    }
    const updatedAnswers = { ...savedGuidedAnswers, [nextGuidedQuestion.id]: value.trim() };
    setTravelAnswer("");
    const nextQuestion = guidedQuestions.find((field) => !updatedAnswers[field.id]);
    if (!nextQuestion) {
      await refreshRuns();
      if (isTravelDetailsStep) {
        const report = `Traveler details provided: passport country: ${updatedAnswers["passport-country"]}; trip purpose: ${updatedAnswers["trip-purpose"]}; planned stay: ${updatedAnswers["trip-length"]}; transit: ${updatedAnswers["transit-countries"]}. These are user-provided and are not independently verified.`;
        const completed = await onTransition(currentAction, "completed", report);
        if (completed) await refreshRuns();
      }
    } else {
      await refreshRuns();
    }
    setBusy(false);
  }

  async function finishTravelDetails() {
    if (!currentAction || !isTravelDetailsStep) return;
    const report = `Traveler details provided: passport country: ${savedGuidedAnswers["passport-country"]}; trip purpose: ${savedGuidedAnswers["trip-purpose"]}; planned stay: ${savedGuidedAnswers["trip-length"]}; transit: ${savedGuidedAnswers["transit-countries"]}. These are user-provided and are not independently verified.`;
    setBusy(true);
    const completed = await onTransition(currentAction, "completed", report);
    if (completed) await refreshRuns();
    setBusy(false);
  }

  async function saveGuidedProgress() {
    if (!currentAction || !userReport.trim()) return;
    setBusy(true);
    const saved = await onTransition(currentAction, "in_progress", `User update: ${userReport.trim()}`);
    if (saved) {
      setUserReport("");
      await refreshRuns();
    }
    setBusy(false);
  }

  async function completeUserTask() {
    if (!currentAction) return;
    const report = currentAction.id === "classify-reporting-route"
      ? spamRoute
      : currentAction.id === "review-report-manually"
      ? "I confirm I reviewed this exact report summary. I will submit it myself on the official site; TRESTLE did not submit it."
      : currentAction.id === "record-reporting-state" && ordinaryUccRoute
      ? "Not applicable: the selected ordinary UCC route does not require an incident State/UT in this workflow."
      : userReport.trim();
    if (!report.trim()) return;
    if (currentAction.id === "classify-reporting-route" && spamRoute.toLowerCase().includes("money lost")) {
      setError("This spam-identifier workflow is not for reporting a financial cybercrime victimization. Report immediately at the official National Cyber Crime Reporting Portal or call 1930; start a victim-reporting case for that process.");
      return;
    }
    if (currentAction.id === "review-report-manually" && !confirmSpamReview) return;
    if (currentAction.id === "prepare-report-evidence" && spamRouteEvidence.toLowerCase().includes("suspected cybercrime") && /\b(none|no evidence|unavailable|don't have)\b/i.test(userReport)) {
      setError("The NCRP Report Suspect form requires supporting evidence. Keep a relevant screenshot or other accepted evidence ready, or stop here and do not submit.");
      return;
    }
    setBusy(true);
    setError("");
    const completed = await onTransition(currentAction, "completed", report);
    if (!completed) {
      setBusy(false);
      return;
    }
    setUserReport("");
    setSpamRoute(currentAction.id === "review-report-manually" ? spamRoute : "");
    setConfirmSpamReview(false);
    setBusy(false);
    await refreshRuns();
  }

  const canStart = !run || ["completed", "failed", "uncertain"].includes(run.status);
  const elapsed = run
    ? Math.max(0, Math.floor(((run.finishedAt ? Date.parse(run.finishedAt) : clockNow) - Date.parse(run.createdAt)) / 1000))
    : 0;
  const latestActivity = [...(run?.events ?? [])].reverse().find((event) =>
    event.actionId === currentAction?.id && (event.message || event.purpose || event.url)
  );
  const liveResearchEvents = (run?.events ?? [])
    .filter((event) => event.actionId === currentAction?.id && (
      event.type === "ACTION_STARTED" || event.type === "SCHEDULER_STARTED" || event.purpose || event.url || event.status
    ))
    .slice(-6)
    .reverse();
  const showingLiveResearch = Boolean(run?.status === "running" && currentAction?.executionAttempts?.some((attempt) => attempt.provider === "tinyfish" && attempt.status === "running"));
  const lastSchedulerProgress = [...(run?.events ?? [])].reverse().find((event) =>
    ["WORKFLOW_RESUMED", "SCHEDULER_STARTED", "ACTION_STARTED"].includes(event.type)
  );
  const schedulerAppearsStalled = Boolean(
    run?.status === "running" && currentAction && !showingLiveResearch && lastSchedulerProgress &&
    Date.now() - Date.parse(lastSchedulerProgress.timestamp) > 15_000
  );

  return (
    <section className="trestle-workflow-panel mt-7 rounded-2xl border border-cyan-900/50 bg-slate-900/70 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Your progress</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">One clear next step at a time</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Groq drafts the plan; it does not perform the work. When you start, TinyFish runs supported read-only public research. Steps without a real provider are handed to you for action and recorded as user-reported, never simulated as real.
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
                  {option === "autonomous" ? "TRESTLE handles public research" : "Guide me through each step"}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={start}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? "Getting things ready…" : mode === "autonomous" ? "Start my case" : "Start with guidance"}
            </button>
            {!isSpamReporting && <span className="text-xs text-slate-500">{actions.some((action) => action.id === "confirm-property-jurisdiction") && !jurisdiction ? `Location will be requested first · ${documentType}` : `Research context: ${jurisdiction} · ${documentType}`}</span>}
            {isSpamReporting && <span className="max-w-xl text-xs text-slate-400">First choose what happened. TRESTLE will use that to distinguish ordinary spam guidance from the cybercrime reporting route.</span>}
          </div>
        )
        : (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-300">
              {currentAction ? `Next step: ${currentAction.title}` : "TRESTLE is checking the workflow."}
              {run.pauseRequested && " Pause requested; the current provider action is allowed to finish."}
            </p>
            {run.status === "running" && !waitingForUser && !waitingForApproval && !run.pauseRequested
              ? <button type="button" disabled={busy} onClick={() => control("pause")} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">Pause after current task</button>
              : run.mode === "autonomous" && !waitingForApproval && !waitingForUser && !["waiting_for_approval", "waiting_for_user", "blocked"].includes(run.status)
              ? <button type="button" disabled={busy} onClick={() => control("resume")} className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-100 disabled:opacity-50">Resume</button>
              : null}
            {schedulerAppearsStalled && <button type="button" disabled={busy} onClick={() => control("resume", run.mode)} className="rounded-lg border border-amber-700 px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-50">{busy ? "Rechecking…" : "Recheck workflow"}</button>}
            {!["running", "waiting_for_approval", "waiting_for_user", "completed", "failed", "uncertain"].includes(run.status) && (
              <button type="button" disabled={busy} onClick={() => control("resume", "autonomous")} className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-100 disabled:opacity-50">
                Continue with autonomous research
              </button>
            )}
          </div>
        )}

      {run && (
        <section className="mt-6" aria-label="Workflow progress">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><div><h3 className="font-semibold text-slate-400">Your steps</h3><p className="mt-1">Select a step to review its saved evidence and research.</p></div><span>{orderedActions.filter((action) => action.status === "completed").length} of {orderedActions.length} done</span></div>
          <ol className="workflow-stepper">
            {orderedActions.map((action) => {
              const isCurrent = action.id === currentAction?.id && !["completed", "failed"].includes(action.status);
              const statusLabel = isCurrent
                ? actionAwaitingAssignment ? "NEXT" : "CURRENT"
                : action.status === "completed"
                ? hasOnlySimulatedEvidence(action) ? "SIMULATED" : "COMPLETED"
                : action.status.replaceAll("_", " ").toUpperCase();
              return (
                <li key={action.id} data-current={isCurrent} data-state={action.status} className="workflow-stepper-item">
                  <button
                    type="button"
                    onClick={() => setSelectedStepId((selected) => selected === action.id ? null : action.id)}
                    aria-label={`Review ${action.title}, ${statusLabel.toLowerCase()}`}
                    aria-expanded={selectedStepId === action.id}
                    className="group w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm leading-5 text-slate-200 group-hover:text-teal-700">{action.title}</span>
                      <span className="shrink-0 text-[9px] font-bold tracking-wide text-slate-400">{statusLabel}</span>
                    </span>
                    {action.status === "completed" && <span className="mt-1 block text-[10px] text-teal-700 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">View saved details</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          {selectedWorkflowStep && (
            <section className="mt-4 rounded-xl border border-teal-200 bg-white/80 p-4 sm:p-5" aria-label={`Saved details for ${selectedWorkflowStep.title}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">Step record · {selectedWorkflowStep.status.replaceAll("_", " ")}</p>
                  <h4 className="mt-1 text-lg font-semibold text-slate-800">{selectedWorkflowStep.title}</h4>
                </div>
                <button type="button" onClick={() => setSelectedStepId(null)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Close details</button>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{selectedWorkflowStep.description}</p>
              {selectedWorkflowStep.successCriteria.length > 0 && <p className="mt-3 text-sm leading-6 text-slate-600"><strong>Completion check:</strong> {selectedWorkflowStep.successCriteria.join(" ")}</p>}
              {selectedStepAttempt && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="font-semibold uppercase text-slate-700">{selectedStepAttempt.provider}</span>
                    <span>{selectedStepAttempt.status.replaceAll("_", " ")}</span>
                    <span>{selectedStepAttempt.isSimulated ? "Simulated result" : "Real provider attempt"}</span>
                    <time>{new Date(selectedStepAttempt.startedAt).toLocaleString()}</time>
                  </div>
                  {selectedStepAttempt.resultSummary && <p className="mt-2 text-sm leading-6 text-slate-700">{selectedStepAttempt.resultSummary}</p>}
                  {selectedStepResult && (
                    <div className="mt-3 space-y-3">
                      {(["requirements", "requiredDocuments", "nextSteps", "unknowns"] as const).map((key) => {
                        const values = Array.isArray(selectedStepResult[key])
                          ? (selectedStepResult[key] as unknown[]).filter((value): value is string => typeof value === "string")
                          : [];
                        if (values.length === 0) return null;
                        const label = key === "requiredDocuments" ? "Documents mentioned" : key === "nextSteps" ? "Guidance returned" : key === "unknowns" ? "Not verified" : "Requirements returned";
                        return <div key={key}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">{values.map((value, index) => <li key={index}>{value}</li>)}</ul></div>;
                      })}
                      {Array.isArray(selectedStepResult.sourceUrls) && selectedStepResult.sourceUrls.some((url) => typeof url === "string") && (
                        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources returned</p><ul className="mt-1 space-y-1">{(selectedStepResult.sourceUrls as unknown[]).filter((url): url is string => typeof url === "string" && url.startsWith("https://")).map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all text-sm text-teal-800 underline">{url}</a></li>)}</ul></div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {selectedWorkflowStep.evidence.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved evidence · {selectedWorkflowStep.evidence.length}</p>
                  <ul className="mt-2 space-y-2">{selectedWorkflowStep.evidence.map((evidence, index) => {
                    const response = questionAndAnswer(evidence.note, selectedWorkflowStep);
                    return (
                      <li key={index} className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{evidence.kind.replaceAll("_", " ")}</span>
                        {response ? (
                          <dl className="mt-2 space-y-2">
                            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question</dt><dd className="mt-0.5">{response.question}</dd></div>
                            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Answer</dt><dd className="mt-0.5 whitespace-pre-wrap">{response.answer}</dd></div>
                          </dl>
                        ) : <p className="mt-2 whitespace-pre-wrap">{evidence.note}</p>}
                        <time className="mt-1 block text-xs text-slate-400">{new Date(evidence.recordedAt).toLocaleString()}</time>
                      </li>
                    );
                  })}</ul>
                </div>
              ) : !selectedStepAttempt && <p className="mt-3 text-sm text-slate-500">No evidence or execution record has been saved for this step yet.</p>}
              {liveBrowserFrames[selectedWorkflowStep.id] && (
                <figure className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <figcaption className="border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">Live page captured for this step: {liveBrowserFrames[selectedWorkflowStep.id].pageTitle || liveBrowserFrames[selectedWorkflowStep.id].currentUrl}</figcaption>
                  <img src={`data:image/jpeg;base64,${liveBrowserFrames[selectedWorkflowStep.id].data}`} alt={`Live browser page for ${selectedWorkflowStep.title}`} className="block max-h-96 w-full object-contain object-top" />
                </figure>
              )}
              <p className="mt-3 text-xs text-slate-500">Research results and user reports are records of what TRESTLE observed or the user said; they do not prove an outside organization completed an action.</p>
            </section>
          )}
        </section>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}

      {run?.status === "completed" && (
        <section className="mt-5 border-t border-slate-800 pt-4" aria-label="Workflow outcome">
          <p className="text-sm font-semibold text-emerald-700">Workflow steps complete</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">TRESTLE recorded {orderedActions.filter((action) => action.status === "completed").length} completed steps for this case. A completed workflow step is not, by itself, proof that an outside organization accepted a report or changed an account; review the saved evidence below.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
            <div className="min-w-56 flex-1">
              <label htmlFor={`supplemental-jurisdiction-${caseId}`} className="block text-sm font-medium text-slate-700">Research this case in another jurisdiction</label>
              <p className="mt-1 text-xs text-slate-500">Adds a separate read-only research step and preserves this case’s existing history.</p>
              <input id={`supplemental-jurisdiction-${caseId}`} value={supplementalJurisdiction} onChange={(event) => setSupplementalJurisdiction(event.target.value)} maxLength={80} placeholder="Country, state, or region" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
            </div>
            <button type="button" disabled={supplementalResearchBusy || supplementalJurisdiction.trim().length < 2} onClick={() => void startSupplementalResearch()} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{supplementalResearchBusy ? "Starting research…" : `Research ${supplementalJurisdiction.trim() || "jurisdiction"}`}</button>
          </div>
        </section>
      )}
      {run && ["failed", "uncertain", "blocked"].includes(run.status) && (
        <section className="mt-5 border-t border-slate-800 pt-4" aria-label="Workflow outcome">
          <p className="text-sm font-semibold text-rose-700">TRESTLE stopped before the next step</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{run.errorMessage ?? "The workflow needs review before it can safely continue."} No external outcome is assumed.</p>
        </section>
      )}

      {run && (
        <section className="mt-5 rounded-xl border border-teal-200 bg-white/70 p-4" aria-live="polite" aria-label="Live research activity">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Live research activity</h3>
            <span className="text-xs text-slate-500">Updates from this workflow run</span>
          </div>
          {liveResearchEvents.length > 0 ? (
            <ol className="mt-3 space-y-3">
              {liveResearchEvents.map((event) => (
                <li key={event.id} className="border-l-2 border-teal-500 pl-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-xs font-semibold text-teal-800">{event.purpose ? "TinyFish update" : event.type === "ACTION_STARTED" ? "Research started" : event.type === "SCHEDULER_STARTED" ? "Workflow check started" : event.type.replaceAll("_", " ")}</span>
                    <time className="text-xs text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</time>
                    {event.status && <span className="text-xs text-slate-500">Status: {event.status}</span>}
                  </div>
                  {event.purpose && <p className="mt-1 text-sm leading-5 text-slate-700">{event.purpose}</p>}
                  {event.message && <p className="mt-1 text-sm leading-5 text-slate-700">{event.message}</p>}
                  {event.url && <p className="mt-1 break-all text-xs text-slate-600">Page reported by TinyFish: <a href={event.url} target="_blank" rel="noreferrer" className="text-teal-800 underline">{event.url}</a></p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {showingLiveResearch
                ? "TinyFish is running this research step, but has not reported a search or page update yet. This panel will show its actual progress events as they arrive."
                : latestActivity?.message ?? "No research activity has been recorded for the current step yet."}
            </p>
          )}
        </section>
      )}

      <SharedBrowserPanel
        caseId={caseId}
        actions={actions}
        isSpamReporting={isSpamReporting}
        workflowStarted={Boolean(run && !['completed', 'failed', 'uncertain', 'paused'].includes(run.status))}
        workflowActionId={currentAction?.id ?? null}
        autoStartForWorkflow={Boolean(run && run.status !== "paused" && run.mode === "autonomous" && currentAction && hasVerifiedResearchForAction(currentAction, actions))}
        onLiveFrame={captureLiveBrowserFrame}
      />

      {run && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span>{run.mode === "autonomous" ? "TRESTLE is working" : "Guided mode"} · {elapsed}s</span>
                <span>Started {new Date(run.createdAt).toLocaleTimeString()}</span>
              </div>
              {currentAction && <p className="mt-3 text-base font-semibold text-slate-100">{currentAction.title}</p>}
              {latestActivity && <p className="mt-2 text-sm leading-6 text-slate-500">{latestActivity.purpose ?? latestActivity.message}</p>}
              {actionAwaitingAssignment && currentAction && (
                <div className="mt-4 rounded-xl border border-amber-700/70 bg-amber-950/30 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-300">First ready step · what to do</p>
                  <h3 className="mt-1 text-lg font-semibold text-amber-100">{currentAction.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-200">{currentAction.description}</p>
                  {currentAction.requiredInputs.length > 0 && <p className="mt-2 text-sm text-slate-300"><strong>Have ready:</strong> {currentAction.requiredInputs.join(", ")}</p>}
                  {currentAction.successCriteria.length > 0 && <p className="mt-2 text-sm text-slate-300"><strong>This step is done when:</strong> {currentAction.successCriteria.join(" ")}</p>}
                  <p className="mt-3 text-xs text-amber-200">The scheduler has not attached this step to the run yet, so it has not started. Refresh the workflow status; do not treat the RUNNING badge as proof that this task is underway.</p>
                  <button type="button" disabled={busy} onClick={() => void refreshRuns()} className="mt-3 rounded-lg border border-amber-700 px-3 py-2 text-sm font-medium text-amber-100 disabled:opacity-50">Refresh workflow status</button>
                </div>
              )}
              {run && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Technical run details</summary><p className="mt-2 break-all">Workflow run {run.id}{streamingEvent?.runId ? ` · TinyFish run ${streamingEvent.runId}` : ""}</p></details>}
              {isSpamReporting && currentAction?.id === "research-reporting-route" && <p className="mt-2 rounded-lg border border-cyan-900 bg-cyan-950/30 p-3 text-sm text-cyan-100">This step is only checking public guidance. You do not need to enter the number in the browser; the next step will give you a private TRESTLE input field.</p>}
              {run.errorMessage && <p className="mt-2 text-sm text-rose-300">{run.errorMessage}</p>}
              {waitingForUser && currentAction && (
                <div className="mt-4 rounded-xl border border-amber-700/70 bg-amber-950/30 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Your step · TRESTLE is waiting for you</p>
                  <h3 className="mt-1 text-lg font-semibold text-amber-100">{currentAction.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-200">{isTravelDetailsStep ? "A few quick questions help match the official US guidance to your trip. We’ll ask one at a time; country and trip details only—no passport number." : isSequentialQuestionStep ? "We’ll collect the details one at a time. Your answers are saved to this case as you go." : currentAction.description}</p>
                  {relevantBrowserFrame ? (
                    <details className="mt-3 rounded-lg border border-amber-200 bg-white">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">View live page screenshot</summary>
                      <figure className="border-t border-slate-200">
                        <img src={`data:image/jpeg;base64,${relevantBrowserFrame.data}`} alt={`Live page: ${relevantBrowserFrame.pageTitle || relevantBrowserFrame.currentUrl}`} className="block max-h-72 w-full object-contain object-top" />
                        <figcaption className="px-3 py-2 text-xs text-slate-600">Live page for this step: {relevantBrowserFrame.pageTitle || relevantBrowserFrame.currentUrl} · The frame can show an access block or security challenge; follow the official site’s instructions.</figcaption>
                      </figure>
                    </details>
                  ) : !isSequentialQuestionStep && <p className="mt-2 text-xs text-slate-500">No live official-page screenshot has been captured for this step yet. TRESTLE will attach one when the verified page for this step opens in the shared browser.</p>}
                  {!isSequentialQuestionStep && <p className="mt-2 text-sm text-slate-300"><strong>Completion means:</strong> {currentAction.successCriteria.join(" ")}</p>}
                  {!isSequentialQuestionStep && currentAction.requiredInputs.length > 0 && <p className="mt-2 text-sm text-slate-300"><strong>Next information needed:</strong> {currentAction.requiredInputs.join(", ")}. These answers remain in the local case and are not sent to Groq; TinyFish receives generic research instructions only.</p>}
                  {!isSequentialQuestionStep && <p className="mt-2 text-xs text-amber-200">TRESTLE cannot perform this task with the configured real providers. Complete it yourself; no mock action will be presented as real.</p>}
                  {currentAction.status !== "in_progress" && !isSequentialQuestionStep
                    ? <button type="button" disabled={busy} onClick={() => void startUserTask()} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Updating…" : "I’ll handle this step"}</button>
                    : (
                      <div className="mt-3 space-y-2">
                        {currentAction.id === "classify-reporting-route" ? (
                          <fieldset className="space-y-2">
                            <legend className="text-sm text-slate-200">Which best describes what happened?</legend>
                            {[
                              ["Route: Ordinary unsolicited commercial communication (UCC/spam)", "Ordinary unwanted promotion / UCC"],
                              ["Route: Suspected cybercrime or impersonation attempt", "Suspected impersonation, phishing, or attempted cybercrime"],
                              ["Route: Money lost or unauthorized financial transaction", "Money lost / unauthorized transaction"],
                            ].map(([value, label]) => <label key={value} className="flex items-start gap-2 rounded-lg border border-slate-700 p-3 text-sm text-slate-200"><input type="radio" name="spam-route" value={value} checked={spamRoute === value} onChange={() => setSpamRoute(value)} className="mt-1" />{label}</label>)}
                            <p className="text-xs text-amber-200">A 10-digit number alone does not establish that it is fraudulent. Choose based on what you actually observed.</p>
                            {spamRoute.toLowerCase().includes("money lost") && <p className="text-sm text-rose-200">Stop this spam-number flow. For money already lost or an unauthorized transaction, report as a cybercrime victim at <a className="underline" href="https://cybercrime.gov.in/" target="_blank" rel="noreferrer">cybercrime.gov.in</a> or call <a className="underline" href="tel:1930">1930</a>.</p>}
                          </fieldset>
                        ) : isSequentialQuestionStep ? (
                          <div className="space-y-3 rounded-lg border border-slate-200 bg-white/80 p-4 text-slate-800">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">{nextGuidedQuestion ? `Question ${Object.keys(savedGuidedAnswers).length + 1} of ${guidedQuestions.length}` : "Details collected"}</p>
                              <span className="text-xs text-slate-500">Saved as you go</span>
                            </div>
                            <p className="text-xs text-slate-500">Answers stay with this case and are not sent to Groq or TinyFish.</p>
                            {nextGuidedQuestion ? (
                              <>
                                <label htmlFor="guided-step-answer" className="block text-base font-semibold">{nextGuidedQuestion.label}</label>
                                <p className="text-sm text-slate-600">{nextGuidedQuestion.help}</p>
                                <input id="guided-step-answer" value={travelAnswer} onChange={(event) => setTravelAnswer(event.target.value)} maxLength={500} autoComplete="off" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base" placeholder="Your answer" />
                                <div className="flex flex-wrap gap-2">
                                  <button type="button" disabled={busy || !travelAnswer.trim()} onClick={() => void saveGuidedAnswer(travelAnswer)} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : nextGuidedQuestion.id === "transit-countries" ? "Save and finish" : "Continue"}</button>
                                  {nextGuidedQuestion.optional && <button type="button" disabled={busy} onClick={() => void saveGuidedAnswer(isTravelDetailsStep ? "No transit countries" : "Not applicable")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50">{isTravelDetailsStep ? "No transit" : "Not applicable"}</button>}
                                </div>
                              </>
                            ) : (
                              isTravelDetailsStep ? <button type="button" disabled={busy} onClick={() => void finishTravelDetails()} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Continue to checklist"}</button> : (
                                <div className="space-y-2">
                                  <p className="text-sm text-slate-700">Now complete “{currentAction.title}” yourself, if you can. Saving answers alone does not complete this task.</p>
                                  <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" checked={guidedActionCompleted} onChange={(event) => setGuidedActionCompleted(event.target.checked)} className="mt-1" /><span>I completed this step myself</span></label>
                                  <label htmlFor="guided-step-outcome" className="block text-sm font-medium">{guidedActionCompleted ? "What was the result?" : "What remains or where are you stuck?"}</label>
                                  <textarea id="guided-step-outcome" value={userReport} onChange={(event) => setUserReport(event.target.value)} rows={2} maxLength={500} className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm" placeholder="Briefly describe the result, or where you got stuck." />
                                  <button type="button" disabled={busy || !userReport.trim()} onClick={() => void (guidedActionCompleted ? completeUserTask() : saveGuidedProgress())} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : guidedActionCompleted ? "Record as completed by me" : "Save update and keep step open"}</button>
                                  <p className="text-xs text-slate-500">TRESTLE records your statement; it does not independently verify an outside result.</p>
                                </div>
                              )
                            )}
                            {Object.keys(savedGuidedAnswers).length > 0 && <details className="pt-1"><summary className="cursor-pointer text-sm font-medium text-slate-600">Answers saved ({Object.keys(savedGuidedAnswers).length})</summary><ul className="mt-2 space-y-1 text-sm text-slate-600">{guidedQuestions.filter((field) => savedGuidedAnswers[field.id]).map((field) => <li key={field.id}><strong>{field.label}:</strong> {savedGuidedAnswers[field.id]}</li>)}</ul></details>}
                          </div>
                        ) : (
                          <>
                            <label htmlFor={`user-report-${currentAction.id}`} className="block text-sm text-slate-200">{currentAction.id === "confirm-property-jurisdiction" ? "Where is the property? Country and state/province or city only" : currentAction.id === "record-suspicious-identifier" ? "Enter the number or sender ID here in TRESTLE" : currentAction.id === "record-reporting-state" ? "Which State/UT did this happen in? For TRAI UCC, enter ‘Not applicable’ if the provider does not request it." : currentAction.id === "record-spam-details" ? "What happened? Include whether it was call/SMS and date/time if known" : currentAction.id === "prepare-report-evidence" ? "What relevant evidence do you have ready? Do not upload it here." : "After reviewing the official route, what did you do?"}</label>
                            {currentAction.id === "confirm-property-jurisdiction" && <p className="text-xs leading-5 text-cyan-100">This is needed because property-document rules vary by location. Enter only a jurisdiction such as “Austin, Texas” or “Pune, Maharashtra.” Do not include a street address, owner name, deed number, or property ID. Only the jurisdiction is passed to TinyFish; your full answer is not sent to Groq.</p>}
                            {currentAction.id === "record-suspicious-identifier" && <p className="text-xs leading-5 text-cyan-100">You do not need to type it into the browser. This answer is saved in this TRESTLE case and is not sent to Groq or TinyFish. The browser is only for public guidance; you choose what to enter on an official reporting channel.</p>}
                            {currentAction.id === "record-reporting-state" && ordinaryUccRoute
                              ? <p className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">Not needed for this selected route. TRAI UCC complaints are handled through your telecom provider.</p>
                              : currentAction.id === "record-suspicious-identifier"
                              ? <input id={`user-report-${currentAction.id}`} type="text" inputMode="tel" autoComplete="off" spellCheck={false} value={userReport} onChange={(event) => setUserReport(event.target.value)} maxLength={160} placeholder="Type the exact number or sender ID" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 placeholder:text-slate-600" />
                              : <textarea id={`user-report-${currentAction.id}`} value={userReport} onChange={(event) => setUserReport(event.target.value)} maxLength={500} rows={2} placeholder={currentAction.id === "confirm-property-jurisdiction" ? "Country, state/province, or city only" : currentAction.id === "record-reporting-state" ? "State/UT where it happened" : currentAction.id === "prepare-report-evidence" ? "For example: screenshot of the SMS saved for the official form; or evidence unavailable" : "Only facts you personally observed. Never include passwords, OTPs, or financial account details."} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 placeholder:text-slate-600" />}
                            {currentAction.id === "record-suspicious-identifier" && ordinaryUccRoute && <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-xs leading-5 text-slate-300"><p className="font-semibold text-slate-100">Other ways to report ordinary UCC</p><p className="mt-1">Use your telecom provider’s app or complaint site, call 1909, or use the TRAI DND app. <a href="https://trai.gov.in/complain-or-report-against-ucc" target="_blank" rel="noreferrer" className="text-cyan-300 underline">Read TRAI’s official complaint/report guidance</a>. TRESTLE will not submit it for you.</p></div>}
                            {currentAction.id === "review-report-manually" && <div className="space-y-3 rounded-lg border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
                              <h4 className="font-semibold">Review this exact report before proceeding</h4>
                              <dl className="grid gap-2 sm:grid-cols-[150px_1fr]">
                                <dt className="text-amber-200">Your selected route</dt><dd>{spamRouteEvidence || "Not recorded"}</dd>
                                <dt className="text-amber-200">Incident State/UT</dt><dd>{spamStateEvidence || "Not recorded"}</dd>
                                <dt className="text-amber-200">Identifier supplied</dt><dd className="break-all">{spamIdentifierEvidence || "Not recorded"}</dd>
                                <dt className="text-amber-200">Your description</dt><dd>{spamDescriptionEvidence || "Not recorded"}</dd>
                                <dt className="text-amber-200">Evidence note</dt><dd>{spamEvidenceNote || "Not recorded; you must select any required file on the official portal."}</dd>
                                <dt className="text-amber-200">Official destination</dt><dd><a href={spamOfficialUrl} target="_blank" rel="noreferrer" className="underline">{spamOfficialUrl}</a></dd>
                              </dl>
                              <p><strong>Submission is not automated in this demo.</strong> You must review and submit on the official site, select the required evidence there, complete CAPTCHA/authentication yourself, and check for a genuine acknowledgement. TRESTLE will not claim the report was filed.</p>
                              <label className="flex items-start gap-2"><input type="checkbox" checked={confirmSpamReview} onChange={(event) => setConfirmSpamReview(event.target.checked)} className="mt-1" /><span>I have reviewed this exact summary and confirm it is ready for me to submit manually on the official site. This does not authorize TRESTLE to submit it.</span></label>
                            </div>}
                          </>
                        )}
                        {!isSequentialQuestionStep && <>
                          <p className="text-xs text-slate-400">Saved as your report in this local case, not independently verified. Never enter passwords, OTPs, or credentials.</p>
                          <button type="button" disabled={busy || (currentAction.id === "classify-reporting-route" ? !spamRoute : currentAction.id === "review-report-manually" ? !confirmSpamReview : currentAction.id === "record-reporting-state" && ordinaryUccRoute ? false : !userReport.trim())} onClick={() => void completeUserTask()} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : currentAction.id === "confirm-property-jurisdiction" ? "Save location and continue to official research" : currentAction.id === "classify-reporting-route" ? "Use this reporting route" : currentAction.id === "record-suspicious-identifier" ? "Save number and continue" : currentAction.id === "record-reporting-state" && ordinaryUccRoute ? "Continue · not required for this route" : currentAction.id === "review-report-manually" ? "Confirm review · submission remains manual" : "Record answer and continue"}</button>
                        </>}
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
              {!isSpamReporting && run.mode === "autonomous" && currentActionHasTinyFishHistory && (
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

            <details className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-200">Activity history <span className="ml-1 text-xs font-normal text-slate-500">{run.events.length} updates</span></summary>
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
            </details>

            {researchSummary && (
              <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4">
                <h3 className="text-sm font-semibold text-cyan-100">Research result · LIVE TINYFISH{latestResearchAction ? ` · ${latestResearchAction.title}` : ""}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-200">{researchSummary}</p>
                {typeof latestResearch?.requestedUrl === "string" && (
                  <p className="mt-3 text-xs text-slate-400">Research search used (not a reporting destination): <span className="break-all">{latestResearch.requestedUrl}</span></p>
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
                    {isSpamReporting && <div className="mt-3 flex flex-wrap gap-2">
                      <a href="https://trai.gov.in/complain-or-report-against-ucc" target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg border border-cyan-800 px-3 py-2 text-sm font-medium text-cyan-200 underline">Open TRAI official UCC guidance</a>
                      <a href="https://cybercrime.gov.in/webform/cyber_suspect.aspx" target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 underline">Open cybercrime suspect-report page</a>
                    </div>}
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
    </section>
  );
}
