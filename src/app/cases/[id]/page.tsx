"use client";

/**
 * Case detail page – supports list/graph view toggle and human approval / execution framework.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  Action,
  Approval,
  Case,
  ExecutionAttempt,
} from "../../../domain/types";
import ActionDetailPanel from "../../components/ActionDetailPanel";
import WorkflowRunPanel from "../../components/WorkflowRunPanel";
import { createPlanningBrief } from "../../../server/privacyBoundary";

const ActionGraph = dynamic(() => import("../../components/ActionGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-slate-500">
      Loading graph…
    </div>
  ),
});

const tone: Record<string, string> = {
  completed: "text-emerald-300",
  failed: "text-rose-300",
  blocked: "text-amber-300",
  ready: "text-blue-300",
  in_progress: "text-violet-300",
  pending: "text-slate-400",
  awaiting_approval: "text-orange-300",
};

const riskTone: Record<string, string> = {
  low_risk: "bg-emerald-950/60 text-emerald-300 border-emerald-800/60",
  requires_review: "bg-amber-950/60 text-amber-300 border-amber-800/60",
  high_consequence: "bg-rose-950/60 text-rose-300 border-rose-800/60",
};

const operationLabels: Record<string, string> = {
  enter_form_details: "Prepare information for a service",
  select_document_upload: "Choose documents for upload",
  modify_record: "Change an existing record",
  submit_declaration: "Submit an official declaration",
  make_payment: "Make a payment",
  cancel_service: "Cancel a service",
  read_public_info: "Read public information",
};

function friendlyOperationLabel(operationType: string): string {
  return operationLabels[operationType] ?? operationType.replaceAll("_", " ");
}

type ViewMode = "list" | "graph";

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Case | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  // Review modal state
  const [reviewApproval, setReviewApproval] = useState<Approval | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [deciding, setDeciding] = useState(false);

  // Prepare & Request Approval modal state
  const [preparingAction, setPreparingAction] = useState<Action | null>(null);
  const [prepOpType, setPrepOpType] = useState("enter_form_details");
  const [prepDesc, setPrepDesc] = useState("");
  const [prepDest, setPrepDest] = useState("");
  const [prepPayloadStr, setPrepPayloadStr] = useState("{}");
  const [prepProhibitsAuto, setPrepProhibitsAuto] = useState(false);
  const [submittingReq, setSubmittingReq] = useState(false);

  // Execution state
  const [researchJurisdiction, setResearchJurisdiction] = useState("");
  const [researchDocumentType, setResearchDocumentType] = useState("");

  const syncResearchContext = (originalInput: string) => {
    const planning = createPlanningBrief(originalInput);
    if (!planning.ok) return;
    if (planning.brief.jurisdiction) setResearchJurisdiction(planning.brief.jurisdiction);
    if (planning.brief.documentTypes[0]) setResearchDocumentType(planning.brief.documentTypes[0]);
  };

  // Execution history modal
  const [historyAction, setHistoryAction] = useState<Action | null>(null);
  const [actionHistory, setActionHistory] = useState<ExecutionAttempt[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        const [caseRes, approvalsRes] = await Promise.all([
          fetch(`/api/cases/${id}`),
          fetch(`/api/cases/${id}/approvals`),
        ]);
        const caseData = await caseRes.json();
        if (!caseRes.ok) {
          throw new Error(caseData.error || "Failed to load case");
        }
        if (isMounted) {
          setItem(caseData);
          syncResearchContext(caseData.originalInput);
        }

        if (approvalsRes.ok) {
          const approvalsData = await approvalsRes.json();
          if (isMounted) setApprovals(approvalsData);
        }
      } catch (e: unknown) {
        if (isMounted) {
          setError(e instanceof Error ? e.message : "Failed to load case");
        }
      }
    };

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const refreshData = useCallback(async () => {
    try {
      const [caseRes, approvalsRes] = await Promise.all([
        fetch(`/api/cases/${id}`, { cache: "no-store" }),
        fetch(`/api/cases/${id}/approvals`, { cache: "no-store" }),
      ]);
      const caseData = await caseRes.json();
      if (!caseRes.ok) throw new Error(caseData.error || "Failed to load case");
      setItem(caseData);
      syncResearchContext(caseData.originalInput);

      if (approvalsRes.ok) {
        const approvalsData = await approvalsRes.json();
        setApprovals(approvalsData);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to refresh case data");
    }
  }, [id]);

  // Status transition (shared by list and graph views)
  const transition = useCallback(
    async (
      action: Action,
      status: "in_progress" | "completed" | "failed",
      userReport?: string,
    ): Promise<boolean> => {
      let evidence: { kind: "user_provided"; note: string; recordedAt: string } | undefined;
      if (status === "completed") {
        const needsUserReport = action.executionMode !== "automated" &&
          (action.approvalRequired || ["high", "critical"].includes(action.riskLevel));
        const report = needsUserReport
          ? userReport?.trim() || window.prompt("Describe what you completed yourself. TRESTLE records this as your report; it does not independently verify the external result.")
          : userReport?.trim() || "User reports completing this task after reviewing the result.";
        if (report === null || !report.trim()) return false;
        evidence = {
          kind: "user_provided",
          note: needsUserReport ? `User reports: ${report.trim()}` : report.trim(),
          recordedAt: new Date().toISOString(),
        };
      } else if (status === "in_progress" && userReport?.trim()) {
        evidence = {
          kind: "user_provided",
          note: userReport.trim(),
          recordedAt: new Date().toISOString(),
        };
      }

      const r = await fetch(`/api/cases/${id}/actions/${action.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, evidence }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error);
        return false;
      }
      await refreshData();
      return true;
    },
    [id, refreshData],
  );

  const handleNodeSelect = useCallback(
    (action: Action | null) => setSelectedActionId(action?.id ?? null),
    [],
  );

  const selectedAction = item?.actions.find((a) => a.id === selectedActionId) ??
    null;

  // Open the prepare modal with intelligent defaults
  // Kept for compatibility with the advanced operation editor; the normal
  // approval flow uses requestActionApproval and never opens this editor.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const openPrepareModal = (action: Action) => {
    setPreparingAction(action);
    setPrepDesc(`Execute operation for: ${action.title}`);

    if (action.id === "secure-cards") {
      setPrepOpType("enter_form_details");
      setPrepDest("https://bank.example/cards/secure");
      setPrepPayloadStr(
        JSON.stringify(
          {
            cardIssuer: "Sample Indian Bank",
            cardType: "Debit",
            cardEnding: "4321",
            freezeReason: "Lost wallet",
            actionType: "temporary_lock",
          },
          null,
          2,
        ),
      );
      setPrepProhibitsAuto(false);
    } else if (action.id === "prepare-replacements") {
      setPrepOpType("enter_form_details");
      setPrepDest("https://dvla.example.gov/replacement");
      setPrepPayloadStr(
        JSON.stringify(
          {
            jurisdiction: "India",
            documentType: "Indian driving licence",
            declarationConfirmed: false,
            applicantName: "Sample Holder",
          },
          null,
          2,
        ),
      );
      setPrepProhibitsAuto(false);
    } else {
      setPrepOpType(
        action.riskLevel === "critical"
          ? "submit_declaration"
          : "enter_form_details",
      );
      setPrepDest("https://portal.example.gov");
      setPrepPayloadStr(
        JSON.stringify(
          { actionId: action.id, details: action.description },
          null,
          2,
        ),
      );
      setPrepProhibitsAuto(false);
    }
  };

  // Submit approval request
  const submitApprovalRequest = async () => {
    if (!preparingAction) return;
    setSubmittingReq(true);
    setFeedback("");
    setError("");

    try {
      let parsedPayload: Record<string, unknown> = {};
      try {
        parsedPayload = JSON.parse(prepPayloadStr) as Record<string, unknown>;
      } catch {
        throw new Error("Payload must be valid JSON.");
      }

      const res = await fetch(
        `/api/cases/${id}/actions/${preparingAction.id}/approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: {
              operationType: prepOpType,
              description: prepDesc,
              destination: prepDest || undefined,
              payload: parsedPayload,
              prohibitsAutomation: prepProhibitsAuto,
            },
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback(`Approval requested for "${preparingAction.title}".`);
      setPreparingAction(null);
      await refreshData();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to submit approval request",
      );
    } finally {
      setSubmittingReq(false);
    }
  };

  // Decide on an approval (Approve or Reject)
  const handleDecision = async (decision: "approve" | "reject") => {
    if (!reviewApproval) return;
    setDeciding(true);
    setFeedback("");
    setError("");

    try {
      const res = await fetch(
        `/api/cases/${id}/approvals/${reviewApproval.id}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            notes: decisionNotes.trim() || undefined,
            reason: decisionNotes.trim() || undefined,
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback(
        decision === "approve"
          ? `Operation approved for execution.`
          : `Operation was rejected.`,
      );
      setReviewApproval(null);
      setDecisionNotes("");
      await refreshData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to record decision");
    } finally {
      setDeciding(false);
    }
  };

  // View execution history for an action
  const viewHistory = async (action: Action) => {
    setHistoryAction(action);
    setLoadingHistory(true);
    try {
      const res = await fetch(
        `/api/cases/${id}/actions/${action.id}/executions`,
      );
      if (res.ok) {
        const data = await res.json();
        setActionHistory(data);
      }
    } catch {
      setActionHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  if (error && !item) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-4 text-rose-300">
          {error}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-blue-300 hover:underline"
        >
          ← Back to cases
        </Link>
      </main>
    );
  }

  if (!item) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-slate-400">
        Loading case…
      </main>
    );
  }

  const completed = item.actions.filter((a) => a.status === "completed").length;
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const caseBriefForResearch = createPlanningBrief(item.originalInput);
  const supplementalResearchDefault = caseBriefForResearch.ok && caseBriefForResearch.brief.eventType === "online_identity_misuse"
    ? "India"
    : "";

  const resetDemoCase = async () => {
    if (!window.confirm("Reset this demo case to 0/5 and clear its history?")) {
      return;
    }

    setError("");
    setFeedback("");
    const response = await fetch(`/api/cases/${id}/reset`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Unable to reset demo case.");
      return;
    }

    setFeedback("Demo case reset to 0/5. Execution history and approvals were cleared.");
    await refreshData();
  };

  return (
    <main className="trestle-case-page flex min-h-screen flex-col">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
        <Link href="/" className="text-sm text-blue-300 hover:underline">
          ← All cases
        </Link>
        {/* Global Alerts / Feedback */}
        {feedback && (
          <div className="mt-6 rounded-lg border border-emerald-800/80 bg-emerald-950/50 p-4 text-emerald-200">
            {feedback}
          </div>
        )}
        {error && (
          <div className="mt-6 rounded-lg border border-rose-800/80 bg-rose-950/50 p-4 text-rose-200">
            {error}
          </div>
        )}

        <header className="mt-8 border-b border-slate-800 pb-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
              Your case
            </p>
            <span className="rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs text-slate-300" aria-label="Case status">{item.status.replaceAll("_", " ")}</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
            {item.title}
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">{item.originalInput}</p>
          <div className="mt-6 max-w-3xl" aria-label={`Progress: ${completed} of ${item.actions.length} steps complete`}>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500"><span>Progress</span><span>{completed} of {item.actions.length} steps</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-600 transition-all" style={{ width: `${item.actions.length ? completed / item.actions.length * 100 : 0}%` }} /></div>
          </div>
        </header>

        <WorkflowRunPanel
          caseId={id}
          actions={item.actions}
          approvals={approvals}
          jurisdiction={researchJurisdiction}
          documentType={researchDocumentType}
          supplementalResearchDefault={supplementalResearchDefault}
          onCaseRefresh={refreshData}
          onTransition={transition}
        />

        <details className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-300 marker:hidden">
            <span className="inline-flex items-center gap-2">Details & activity <span className="text-xs font-normal text-slate-500">{pendingApprovals.length ? `· ${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} pending` : "· workflow history and diagnostics"}</span></span>
          </summary>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Persisted workflow actions, approvals, evidence, and dependency diagnostics.</p>
            <div className="inline-flex rounded-lg border border-slate-800 p-1" role="group" aria-label="Technical detail view">
              {(["list", "graph"] as ViewMode[]).map((modeOption) => <button key={modeOption} type="button" aria-pressed={view === modeOption} onClick={() => { setView(modeOption); if (modeOption === "list") setSelectedActionId(null); }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${view === modeOption ? "bg-blue-500 text-white" : "text-slate-500"}`}>{modeOption === "list" ? "Action details" : "Dependency graph"}</button>)}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={resetDemoCase} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-500 hover:text-amber-700">Reset demo case</button>
          </div>
        {/* Approval Queue Panel */}
        <section className="mt-8 rounded-xl border border-orange-900/40 bg-orange-950/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-900/30 pb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-orange-200">
                Human Approval Queue
              </h2>
              <span className="rounded-full bg-orange-900/80 px-2.5 py-0.5 text-xs font-semibold text-orange-200">
                {pendingApprovals.length} pending
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Actions require explicit human review before execution
            </p>
          </div>

          {pendingApprovals.length === 0
            ? (
              <p className="mt-4 text-sm text-slate-400">
                No pending approval requests. Eligible low-risk tasks may
                proceed automatically.
              </p>
            )
            : (
              <div className="mt-4 space-y-3">
                {pendingApprovals.map((app) => {
                  const linkedAction = item.actions.find((a) =>
                    a.id === app.actionId
                  );
                  return (
                    <div
                      key={app.id}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/80 p-4 sm:flex-row sm:items-center"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-200">
                            {linkedAction?.title || app.actionId}
                          </span>
                          <span
                            className={`rounded border px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${
                              riskTone[app.riskCategory] ||
                              riskTone.requires_review
                            }`}
                          >
                            {app.riskCategory.replace("_", " ")}
                          </span>
                          {app.prohibitsAutomation && (
                            <span className="rounded border border-rose-800/80 bg-rose-950/80 px-2 py-0.5 text-xs text-rose-300">
                              Personal Action Only
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-300">
                          {app.operationDescription}
                        </p>
                        {app.destination && (
                          <p className="text-xs text-slate-400">
                            Target:{" "}
                            <code className="text-blue-300">
                              {app.destination}
                            </code>
                          </p>
                        )}
                        <p className="text-xs text-slate-500">
                          Payload Hash:{" "}
                          <code className="text-slate-400">
                            {app.payloadHash.slice(0, 16)}…
                          </code>{" "}
                          · Expires:{" "}
                          {new Date(app.expiresAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setReviewApproval(app);
                          setDecisionNotes("");
                        }}
                        className="shrink-0 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500"
                      >
                        Review Operation
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
        </section>

      {/* ── Content area: List View or Graph View ────────────────────────────── */}
      {view === "list"
        ? (
          <div className="mx-auto w-full max-w-7xl px-6 pb-10 sm:px-10">
            <section className="mt-8 space-y-4">
              <h2 className="text-xl font-semibold text-slate-100">
                Case Actions
              </h2>
              {item.actions.map((action) => {
                const blockedBy = action.dependencies.filter(
                  (d) =>
                    item.actions.find((a) => a.id === d)?.status !==
                      "completed",
                );
                const isBlocked = blockedBy.length > 0;
                const actionApprovals = approvals.filter((a) =>
                  a.actionId === action.id
                );
                const activeApproved = actionApprovals.find((a) =>
                  a.status === "approved"
                );
                const activePending = actionApprovals.find((a) =>
                  a.status === "pending"
                );
                const isLiveResearch = action.id === "identify-reporting";
                return (
                  <article
                    key={action.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition-colors"
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-medium text-slate-100">
                            {action.title}
                          </h3>
                          {isLiveResearch && (
                            <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-cyan-300">
                              LIVE RESEARCH
                            </span>
                          )}
                          <span
                            className={`text-xs font-semibold uppercase tracking-wider ${
                              tone[action.status] || "text-slate-400"
                            }`}
                          >
                            {action.status.replace("_", " ")}
                          </span>
                          {activeApproved && (
                            <span className="rounded-full border border-emerald-800/80 bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-300">
                              Authorised
                            </span>
                          )}
                          {activePending && (
                            <span className="rounded-full border border-orange-800/80 bg-orange-950/60 px-2 py-0.5 text-xs text-orange-300">
                              Approval Pending
                            </span>
                          )}
                        </div>
                        <p className="text-sm leading-6 text-slate-400">
                          {action.description}
                        </p>
                      </div>

                      {/* Action Controls */}
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {action.status === "in_progress" && action.executionMode !== "automated" && (
                          <button
                            onClick={() => void transition(action, "completed")}
                            className="rounded-md border border-emerald-700 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/40"
                          >
                            I completed this myself
                          </button>
                        )}

                        {/* History Button */}
                        <button
                          onClick={() => viewHistory(action)}
                          className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                        >
                          Audit & History
                        </button>
                      </div>
                    </div>

                    {/* Status & Security Explanations */}
                    {isBlocked && (
                      <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/30 p-2.5 text-xs text-amber-200">
                        <strong>Cannot proceed:</strong>{" "}
                        Blocked by incomplete prerequisites:{" "}
                        {blockedBy.join(", ")}.
                      </div>
                    )}
                    {action.approvalRequired && !activeApproved && !isBlocked &&
                      (
                        <div className="mt-3 rounded border border-orange-900/50 bg-orange-950/30 p-2.5 text-xs text-orange-200">
                          <strong>Approval Required:</strong>{" "}
                          This action involves sensitive details or
                          consequential changes. Human approval must be granted
                          before automated execution is permitted.
                        </div>
                      )}

                    {action.id === "identify-reporting" && (
                      <div className="mt-4 rounded border border-cyan-900/60 bg-cyan-950/20 p-3 text-xs text-cyan-100">
                        <strong>Live research inputs:</strong>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <label>
                            Jurisdiction
                            <input
                              value={researchJurisdiction}
                              onChange={(event) =>
                                setResearchJurisdiction(event.target.value)}
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
                            />
                          </label>
                          <label>
                            Document type
                            <input
                              value={researchDocumentType}
                              onChange={(event) =>
                                setResearchDocumentType(event.target.value)}
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
                            />
                          </label>
                        </div>
                        <p className="mt-2 text-cyan-300">
                          Read-only official guidance research. No forms, payments, uploads, or account changes.
                        </p>
                      </div>
                    )}

                    {/* Action Metadata Grid */}
                    <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 text-sm sm:grid-cols-3">
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500">
                          Prerequisites
                        </span>
                        <p className="mt-1 text-slate-300">
                          {action.dependencies.length
                            ? action.dependencies.join(", ")
                            : "None"}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500">
                          Risk & Policy
                        </span>
                        <p className="mt-1 text-slate-300">
                          {action.riskLevel.toUpperCase()} ·{" "}
                          {action.approvalRequired
                            ? "Human approval mandatory"
                            : "Low risk (auto-eligible)"}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500">
                          Success Criteria
                        </span>
                        <p className="mt-1 text-slate-300">
                          {action.successCriteria.join(" ")}
                        </p>
                      </div>
                    </div>

                    {/* Evidence cards if present */}
                    {action.evidence.length > 0 && (
                      <div className="mt-4 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Recorded Evidence ({action.evidence.length})
                        </span>
                        <div className="mt-2 space-y-1.5">
                          {action.evidence.map((ev, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs"
                            >
                              <span
                                className={`rounded px-1.5 py-0.5 uppercase tracking-wide ${
                                  ev.kind === "simulated"
                                    ? "bg-amber-950/70 text-amber-300"
                                    : "bg-emerald-950/70 text-emerald-300"
                                }`}
                              >
                                {ev.kind}
                              </span>
                              <span className="text-slate-300">{ev.note}</span>
                              <span className="text-slate-500 ml-auto">
                                {new Date(ev.recordedAt).toLocaleTimeString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          </div>
        )
        : (
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
                  onTransition={async (action, status) => { await transition(action, status); }}
                />
              </div>
            )}
          </div>
        )}
        </details>
      </div>

      {/* Review & Decide Modal */}
      {reviewApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <span
                  className={`rounded border px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${
                    riskTone[reviewApproval.riskCategory] ||
                    riskTone.requires_review
                  }`}
                >
                  {reviewApproval.riskCategory.replace("_", " ")}
                </span>
                <h3 className="mt-2 text-xl font-semibold text-slate-100">
                  Review Proposed Operation
                </h3>
              </div>
              <button
                onClick={() => setReviewApproval(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500">
                  What would happen?
                </span>
                <p className="mt-1 text-slate-200 font-medium">
                  {friendlyOperationLabel(reviewApproval.operationType)}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {reviewApproval.operationDescription}
                </p>
              </div>

              {reviewApproval.destination && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-500">
                    Where would this happen?
                  </span>
                  <p className="mt-1 text-blue-300 font-mono text-xs">
                    {reviewApproval.destination}
                  </p>
                </div>
              )}

              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500">
                  Canonical SHA-256 Payload Hash
                </span>
                <p className="mt-1 font-mono text-xs text-slate-400">
                  {reviewApproval.payloadHash}
                </p>
              </div>

              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500">
                  Technical details
                </span>
                <details className="mt-1 rounded border border-slate-800 bg-slate-950 p-3">
                  <summary className="cursor-pointer text-xs text-slate-400">
                    Show advanced operation data
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-300 font-mono">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(reviewApproval.payload), null, 2);
                      } catch {
                        return reviewApproval.payload;
                      }
                    })()}
                  </pre>
                </details>
              </div>

              {reviewApproval.prohibitsAutomation && (
                <div className="rounded border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-200">
                  <strong>You need to do this yourself:</strong>{" "}
                  This service requires personal interaction or does not allow
                  automation. Approving this request will not allow TRESTLE to
                  complete it automatically.
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400">
                  Notes for your decision (Optional)
                </label>
                <textarea
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="Why are you approving or rejecting this request?"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                  rows={2}
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                onClick={() => setReviewApproval(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDecision("reject")}
                disabled={deciding}
                className="rounded-md border border-rose-600/70 bg-rose-950/60 px-4 py-2 text-sm font-medium text-rose-200 hover:bg-rose-900/60 disabled:opacity-50"
              >
                {deciding ? "Rejecting…" : "Reject request"}
              </button>
              {!reviewApproval.prohibitsAutomation && (
                <button
                  onClick={() => handleDecision("approve")}
                  disabled={deciding}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {deciding ? "Approving…" : "Approve request"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Prepare & Request Approval Modal */}
      {preparingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-100">
                  Request permission for this step
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Action: {preparingAction.title}
                </p>
                <p className="mt-2 max-w-xl text-sm leading-5 text-slate-400">
                  Review what TRESTLE is asking permission to do. Approval does
                  not claim that the real-world task has already happened.
                </p>
              </div>
              <button
                onClick={() => setPreparingAction(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400">
                  What kind of permission is needed?
                </label>
                <select
                  value={prepOpType}
                  onChange={(e) => setPrepOpType(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="enter_form_details">
                    Prepare information for a service (review required)
                  </option>
                  <option value="select_document_upload">
                    Choose documents for upload (review required)
                  </option>
                  <option value="modify_record">
                    Change an existing record (review required)
                  </option>
                  <option value="submit_declaration">
                    Submit an official declaration (high consequence)
                  </option>
                  <option value="make_payment">
                    Make a payment (high consequence)
                  </option>
                  <option value="cancel_service">
                    Cancel a service (high consequence)
                  </option>
                  <option value="read_public_info">
                    Read public information (low risk)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400">
                  What would TRESTLE do?
                </label>
                <input
                  type="text"
                  value={prepDesc}
                  onChange={(e) => setPrepDesc(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400">
                  Which service or website is involved? (Optional)
                </label>
                <input
                  type="text"
                  value={prepDest}
                  onChange={(e) => setPrepDest(e.target.value)}
                  placeholder="For example: your bank's card-security service"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 focus:outline-none"
                />
              </div>

              <details className="rounded border border-slate-800 bg-slate-950/40 p-3">
                <summary className="cursor-pointer text-xs uppercase tracking-wider text-slate-400">
                  Advanced details (optional)
                </summary>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  These technical values are used to bind your approval to one
                  exact operation. Most users can leave the pre-filled values unchanged.
                </p>
                <textarea
                  value={prepPayloadStr}
                  onChange={(e) => setPrepPayloadStr(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-200 focus:outline-none"
                />
              </details>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="prohibitAuto"
                  checked={prepProhibitsAuto}
                  onChange={(e) => setPrepProhibitsAuto(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950"
                />
                <label
                  htmlFor="prohibitAuto"
                  className="text-xs text-slate-300"
                >
                  This service requires me to complete the step personally
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                onClick={() => setPreparingAction(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={submitApprovalRequest}
                disabled={submittingReq}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
              >
                {submittingReq ? "Sending request…" : "Send for human review"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit & Execution History Modal */}
      {historyAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-100">
                  Execution Audit Log
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Action: {historyAction.title} ({historyAction.id})
                </p>
              </div>
              <button
                onClick={() => setHistoryAction(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 max-h-96 overflow-auto text-sm">
              {loadingHistory
                ? (
                  <p className="text-slate-400 text-xs">
                    Loading execution history…
                  </p>
                )
                : actionHistory.length === 0
                ? (
                  <p className="text-slate-400 text-xs">
                    No execution attempts recorded yet.
                  </p>
                )
                : (
                  <div className="space-y-3">
                    {actionHistory.map((att) => (
                      <div
                        key={att.id}
                        className="rounded border border-slate-800 bg-slate-950/70 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-semibold uppercase tracking-wider ${
                              att.status === "succeeded"
                                ? "text-emerald-300"
                                : att.status === "uncertain"
                                ? "text-amber-300"
                                : "text-rose-300"
                            }`}
                          >
                            {att.status}
                          </span>
                          {att.isSimulated && (
                            <span className="rounded bg-amber-950 px-2 py-0.5 text-amber-300">
                              [SIMULATED]
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-slate-200">
                          {att.resultSummary}
                        </p>
                        {att.uncertaintyReason && (
                          <p className="mt-1 text-amber-300">
                            <strong>Uncertainty:</strong>{" "}
                            {att.uncertaintyReason}
                          </p>
                        )}
                        {att.resultDetails && !att.isSimulated && (
                          <details className="mt-3 rounded border border-cyan-900/60 bg-cyan-950/20 p-2">
                            <summary className="cursor-pointer text-cyan-200">
                              View persisted TinyFish trace and result
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-slate-400">
                              {att.resultDetails}
                            </pre>
                          </details>
                        )}
                        <p className="mt-2 text-slate-500 font-mono">
                          Started: {new Date(att.startedAt).toLocaleString()}
                          {" "}
                          · Provider: {att.provider}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div className="mt-6 flex justify-end border-t border-slate-800 pt-4">
              <button
                onClick={() => setHistoryAction(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
