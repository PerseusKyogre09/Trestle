"use client";

/**
 * Case workspace — redesigned for TRESTLE.
 *
 * Layout:
 *   Desktop: sidebar (step list) + main content (header + WorkflowRunPanel + SharedBrowserPanel + details)
 *   Mobile:  header → compact stepper → content
 *
 * All workflow logic (WorkflowRunPanel, SharedBrowserPanel, ActionGraph,
 * ActionDetailPanel) is preserved from the original implementation.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { Action, Approval, Case, ExecutionAttempt } from "../../../../domain/types";
import ActionDetailPanel from "../../../components/ActionDetailPanel";
import WorkflowRunPanel from "../../../components/WorkflowRunPanel";
import { createPlanningBrief } from "../../../../server/privacyBoundary";

const ActionGraph = dynamic(() => import("../../../components/ActionGraph"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-ink-muted)", fontSize: 14 }}>
      Loading graph…
    </div>
  ),
});

/* ── Icons ──────────────────────────────────── */
function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 16, height: 16 }}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}>
      <polyline points="4 10 8 14 16 6" />
    </svg>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 18, height: 18 }}>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/* ── Status helpers ─────────────────────────── */
type ViewMode = "list" | "graph";

const riskTone: Record<string, string> = {
  low_risk: "t-status t-status-active",
  requires_review: "t-status t-status-blocked",
  high_consequence: "t-status t-status-failed",
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

function friendlyOperationLabel(type: string): string {
  return operationLabels[type] ?? type.replaceAll("_", " ");
}

function progressPct(item: Case): number {
  if (!item.actions.length) return 0;
  return Math.round(
    (item.actions.filter((a) => a.status === "completed").length / item.actions.length) * 100
  );
}

function stepDotClass(action: Action, isCurrent: boolean): string {
  if (isCurrent) return "t-step-dot t-step-dot-current";
  if (action.status === "completed") return "t-step-dot t-step-dot-completed";
  if (action.status === "failed") return "t-step-dot t-step-dot-failed";
  if (action.status === "blocked") return "t-step-dot t-step-dot-blocked";
  if (action.status === "in_progress") return "t-step-dot t-step-dot-in-progress";
  return "t-step-dot t-step-dot-pending";
}

function stepTitleClass(action: Action, isCurrent: boolean): string {
  if (isCurrent) return "t-step-title t-step-title-current";
  if (action.status === "completed") return "t-step-title t-step-title-completed";
  if (["pending", "ready"].includes(action.status)) return "t-step-title t-step-title-muted";
  return "t-step-title";
}

function stepDotContent(action: Action, isCurrent: boolean): React.ReactNode {
  if (isCurrent) return "›";
  if (action.status === "completed") return <CheckIcon />;
  if (action.status === "failed") return "✕";
  return null;
}

function caseStatusClass(status: string): string {
  const map: Record<string, string> = {
    active: "t-status t-status-active",
    completed: "t-status t-status-completed",
    archived: "t-status t-status-pending",
  };
  return map[status] ?? "t-status t-status-pending";
}

/* ── Component ──────────────────────────────── */
export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Case | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
        if (!caseRes.ok) throw new Error(caseData.error || "Failed to load case");
        if (isMounted) { setItem(caseData); syncResearchContext(caseData.originalInput); }
        if (approvalsRes.ok) {
          const approvalsData = await approvalsRes.json();
          if (isMounted) setApprovals(approvalsData);
        }
      } catch (e: unknown) {
        if (isMounted) setError(e instanceof Error ? e.message : "Failed to load case");
      }
    };
    fetchData();
    return () => { isMounted = false; };
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

  const transition = useCallback(
    async (action: Action, status: "in_progress" | "completed" | "failed", userReport?: string): Promise<boolean> => {
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
        evidence = { kind: "user_provided", note: userReport.trim(), recordedAt: new Date().toISOString() };
      }
      const r = await fetch(`/api/cases/${id}/actions/${action.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, evidence }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error); return false; }
      await refreshData();
      return true;
    },
    [id, refreshData]
  );

  const handleNodeSelect = useCallback((action: Action | null) => setSelectedActionId(action?.id ?? null), []);
  const selectedAction = item?.actions.find((a) => a.id === selectedActionId) ?? null;

  const submitApprovalRequest = async () => {
    if (!preparingAction) return;
    setSubmittingReq(true);
    setFeedback(""); setError("");
    try {
      let parsedPayload: Record<string, unknown> = {};
      try { parsedPayload = JSON.parse(prepPayloadStr) as Record<string, unknown>; }
      catch { throw new Error("Payload must be valid JSON."); }
      const res = await fetch(`/api/cases/${id}/actions/${preparingAction.id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: {
            operationType: prepOpType, description: prepDesc, destination: prepDest || undefined,
            payload: parsedPayload, prohibitsAutomation: prepProhibitsAuto,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedback(`Approval requested for "${preparingAction.title}".`);
      setPreparingAction(null);
      await refreshData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit approval request");
    } finally { setSubmittingReq(false); }
  };

  const handleDecision = async (decision: "approve" | "reject") => {
    if (!reviewApproval) return;
    setDeciding(true); setFeedback(""); setError("");
    try {
      const res = await fetch(`/api/cases/${id}/approvals/${reviewApproval.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: decisionNotes.trim() || undefined, reason: decisionNotes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedback(decision === "approve" ? "Operation approved for execution." : "Operation was rejected.");
      setReviewApproval(null);
      setDecisionNotes("");
      await refreshData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to record decision");
    } finally { setDeciding(false); }
  };

  const viewHistory = async (action: Action) => {
    setHistoryAction(action);
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/cases/${id}/actions/${action.id}/executions`);
      if (res.ok) setActionHistory(await res.json());
    } catch { setActionHistory([]); }
    finally { setLoadingHistory(false); }
  };

  const resetDemoCase = async () => {
    if (!window.confirm("Reset this demo case to 0 steps and clear its history?")) return;
    setError(""); setFeedback("");
    const response = await fetch(`/api/cases/${id}/reset`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to reset demo case."); return; }
    setFeedback("Demo case reset. Execution history and approvals were cleared.");
    await refreshData();
  };

  /* ── Loading / Error ─── */
  if (error && !item) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <Link href="/cases" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--color-primary)", textDecoration: "none", marginBottom: 20 }}>
          <BackIcon /> Back to cases
        </Link>
        <div className="t-alert t-alert-error">{error}</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2].map((n) => (
            <div key={n} className="t-skeleton" style={{ height: n === 1 ? 48 : 72, borderRadius: 12 }} />
          ))}
        </div>
        <p style={{ marginTop: 16, fontSize: 14, color: "var(--color-ink-muted)" }}>Loading case…</p>
      </div>
    );
  }

  const completed = item.actions.filter((a) => a.status === "completed").length;
  const pct = progressPct(item);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const isSpamReporting = item.actions.some((a) => a.id === "classify-reporting-route");
  const caseBriefForResearch = createPlanningBrief(item.originalInput);
  const supplementalResearchDefault = caseBriefForResearch.ok && caseBriefForResearch.brief.eventType === "online_identity_misuse" ? "India" : "";

  // Ordered actions for step list
  const orderedActions = [...item.actions].sort((a, b) =>
    (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    a.title.localeCompare(b.title)
  );

  // Determine current action (for step highlighting)
  const currentStepId = orderedActions.find((a) => a.status === "in_progress" || a.status === "ready")?.id;

  return (
    <div className="trestle-case-page" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      {/* ── Case header ────────────────────────── */}
      <header
        style={{
          background: "var(--color-card)",
          borderBottom: "1px solid var(--color-border)",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* Back */}
          <Link
            href="/cases"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: "var(--color-ink-secondary)", textDecoration: "none", flexShrink: 0 }}
            aria-label="Back to cases"
          >
            <BackIcon /> Back to cases
          </Link>

          <div style={{ width: 1, height: 16, background: "var(--color-border)", flexShrink: 0 }} aria-hidden="true" />

          {/* Title */}
          <h1 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.title}
          </h1>

          {/* Status */}
          <span className={caseStatusClass(item.status)} style={{ fontSize: 11, flexShrink: 0 }}>
            {item.status}
          </span>

          {/* Progress compact */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div className="t-progress-track" style={{ width: 80, height: 4 }}>
              <div className="t-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span style={{ fontSize: 12, color: "var(--color-ink-muted)", whiteSpace: "nowrap" }}>
              {completed}/{item.actions.length}
            </span>
          </div>

          {/* Overflow menu */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              aria-label="Case actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="t-btn t-btn-ghost t-btn-icon"
            >
              <EllipsisIcon />
            </button>
            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div
                  style={{
                    position: "absolute", top: "100%", right: 0, zIndex: 30, marginTop: 4,
                    background: "var(--color-card)", border: "1px solid var(--color-border)",
                    borderRadius: 10, boxShadow: "var(--shadow-panel)", minWidth: 180, padding: 4,
                  }}
                  role="menu"
                >
                  <button
                    type="button"
                    onClick={() => { setShowDetails((v) => !v); setMenuOpen(false); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: "var(--color-ink)", background: "none", border: "none", borderRadius: 6, cursor: "pointer" }}
                    role="menuitem"
                  >
                    {showDetails ? "Hide technical details" : "Show technical details"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { resetDemoCase(); setMenuOpen(false); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: "var(--color-error-text)", background: "none", border: "none", borderRadius: 6, cursor: "pointer" }}
                    role="menuitem"
                  >
                    Reset demo case
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Feedback/error banner */}
        {(feedback || error) && (
          <div
            className={feedback ? "t-alert t-alert-success" : "t-alert t-alert-error"}
            style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }}
            role={error ? "alert" : "status"}
          >
            {feedback || error}
          </div>
        )}
      </header>

      {/* ── Workspace body ─────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 220px) 1fr",
          flex: 1,
          maxWidth: 1280,
          margin: "0 auto",
          width: "100%",
          alignItems: "start",
        }}
      >
        {/* ── Step sidebar ─── */}
        <nav
          aria-label="Case steps"
          style={{
            borderRight: "1px solid var(--color-border)",
            padding: "20px 16px",
            position: "sticky",
            top: 56,
            maxHeight: "calc(100dvh - 56px)",
            overflowY: "auto",
          }}
          className="t-workspace-steps"
        >
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-ink-muted)", marginBottom: 12 }}>
            Your steps
          </p>
          <ol className="t-step-list">
            {orderedActions.map((action, idx) => {
              const isCurrent = action.id === currentStepId;
              return (
                <li key={action.id} style={{ position: "relative" }}>
                  {idx > 0 && (
                    <div style={{ position: "absolute", left: 11.5, top: -8, width: 1, height: 8, background: "var(--color-border)" }} aria-hidden="true" />
                  )}
                  <div className="t-step-item" style={{ padding: "8px 0", cursor: "default" }}>
                    <div className={stepDotClass(action, isCurrent)} style={{ width: 24, height: 24, fontSize: 11 }}>
                      {stepDotContent(action, isCurrent)}
                    </div>
                    <div className="t-step-content">
                      <span className={stepTitleClass(action, isCurrent)}>
                        {action.title}
                      </span>
                      <div className="t-step-meta">
                        {action.status.replaceAll("_", " ")}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── Main content ─── */}
        <div style={{ padding: "24px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Case description */}
          <div>
            <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--color-ink-secondary)", maxWidth: 640 }}>
              {item.originalInput}
            </p>
          </div>

          {/* Pending approvals banner */}
          {pendingApprovals.length > 0 && (
            <div className="t-alert t-alert-warning" role="alert">
              <strong>{pendingApprovals.length} approval{pendingApprovals.length > 1 ? "s" : ""} pending</strong> — review them in the technical details section below.
            </div>
          )}

          {/* ── WorkflowRunPanel ─── */}
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

          {/* ── Technical details (collapsible) ─── */}
          {showDetails && (
            <section aria-labelledby="technical-details-heading">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h2 id="technical-details-heading" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-ink)" }}>
                  Technical details & activity
                </h2>
                <div style={{ display: "inline-flex", borderRadius: 8, border: "1px solid var(--color-border)", overflow: "hidden" }} role="group" aria-label="Detail view mode">
                  {(["list", "graph"] as ViewMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={view === mode}
                      onClick={() => { setView(mode); if (mode === "list") setSelectedActionId(null); }}
                      style={{
                        padding: "6px 14px", fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer",
                        background: view === mode ? "var(--color-primary)" : "transparent",
                        color: view === mode ? "white" : "var(--color-ink-secondary)",
                      }}
                    >
                      {mode === "list" ? "Action details" : "Dependency graph"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Approval queue */}
              {pendingApprovals.length > 0 && (
                <div className="t-card" style={{ padding: "20px", marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-warning-text)", marginBottom: 12 }}>
                    Human approval queue — {pendingApprovals.length} pending
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {pendingApprovals.map((app) => {
                      const linkedAction = item.actions.find((a) => a.id === app.actionId);
                      return (
                        <div key={app.id} className="t-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>
                                {linkedAction?.title || app.actionId}
                              </span>
                              <span className={riskTone[app.riskCategory] ?? "t-status t-status-blocked"} style={{ fontSize: 11 }}>
                                {app.riskCategory.replaceAll("_", " ")}
                              </span>
                              {app.prohibitsAutomation && (
                                <span className="t-status t-status-failed" style={{ fontSize: 11 }}>Personal action only</span>
                              )}
                            </div>
                            <p style={{ fontSize: 13, color: "var(--color-ink-secondary)", marginTop: 4 }}>{app.operationDescription}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setReviewApproval(app); setDecisionNotes(""); }}
                            className="t-btn t-btn-secondary t-btn-sm"
                            style={{ flexShrink: 0 }}
                          >
                            Review operation
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* List / Graph view */}
              {view === "list" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {item.actions.map((action) => {
                    const blockedBy = action.dependencies.filter(
                      (d) => item.actions.find((a) => a.id === d)?.status !== "completed"
                    );
                    const isBlocked = blockedBy.length > 0;
                    const actionApprovals = approvals.filter((a) => a.actionId === action.id);
                    const activeApproved = actionApprovals.find((a) => a.status === "approved");
                    const activePending = actionApprovals.find((a) => a.status === "pending");

                    return (
                      <article key={action.id} className="t-card" style={{ padding: "16px 20px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>{action.title}</h3>
                              <span
                                style={{
                                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                  color: action.status === "completed" ? "var(--color-success-text)"
                                    : action.status === "failed" ? "var(--color-error-text)"
                                    : action.status === "in_progress" ? "var(--color-info-text)"
                                    : action.status === "blocked" ? "var(--color-warning-text)"
                                    : "var(--color-ink-muted)",
                                }}
                              >
                                {action.status.replaceAll("_", " ")}
                              </span>
                              {activeApproved && (
                                <span className="t-status t-status-active" style={{ fontSize: 11 }}>Authorised</span>
                              )}
                              {activePending && (
                                <span className="t-status t-status-blocked" style={{ fontSize: 11 }}>Approval pending</span>
                              )}
                            </div>
                            <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--color-ink-secondary)", marginTop: 5 }}>{action.description}</p>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            {action.status === "in_progress" && action.executionMode !== "automated" && (
                              <button
                                onClick={() => void transition(action, "completed")}
                                className="t-btn t-btn-secondary t-btn-sm"
                              >
                                I completed this myself
                              </button>
                            )}
                            <button
                              onClick={() => viewHistory(action)}
                              className="t-btn t-btn-ghost t-btn-sm"
                            >
                              Audit & history
                            </button>
                          </div>
                        </div>

                        {isBlocked && (
                          <div className="t-alert t-alert-warning" style={{ marginTop: 10 }}>
                            <strong>Cannot proceed:</strong> Blocked by: {blockedBy.join(", ")}.
                          </div>
                        )}

                        {action.evidence.length > 0 && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
                            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-ink-muted)", marginBottom: 6 }}>
                              Evidence ({action.evidence.length})
                            </p>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {action.evidence.map((ev, i) => (
                                <div key={i} className="t-evidence-item" style={{ padding: "6px 0" }}>
                                  <span
                                    className="t-evidence-tag"
                                    style={{
                                      background: ev.kind === "simulated" ? "var(--color-warning-bg)" : "var(--color-success-bg)",
                                      color: ev.kind === "simulated" ? "var(--color-warning-text)" : "var(--color-success-text)",
                                    }}
                                  >
                                    {ev.kind.replaceAll("_", " ")}
                                  </span>
                                  <span style={{ fontSize: 13, color: "var(--color-ink-secondary)", flex: 1 }}>{ev.note}</span>
                                  <span style={{ fontSize: 11, color: "var(--color-ink-muted)", flexShrink: 0 }}>
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
                </div>
              ) : (
                <div style={{ display: "flex", gap: 16, minHeight: 400 }}>
                  <div style={{ flex: 1, border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
                    <ActionGraph
                      actions={item.actions}
                      selectedActionId={selectedActionId}
                      onNodeSelect={handleNodeSelect}
                    />
                  </div>
                  {selectedAction && (
                    <div style={{ width: 320, flexShrink: 0 }}>
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
            </section>
          )}
        </div>
      </div>

      {/* ── Review approval modal ─────────────── */}
      {reviewApproval && (
        <div className="t-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="review-modal-title">
          <div className="t-modal">
            <div className="t-modal-header">
              <div>
                <span className={riskTone[reviewApproval.riskCategory] ?? "t-status t-status-blocked"} style={{ fontSize: 11 }}>
                  {reviewApproval.riskCategory.replaceAll("_", " ")}
                </span>
                <h2 id="review-modal-title" style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "var(--color-ink)" }}>
                  Review proposed operation
                </h2>
              </div>
              <button type="button" onClick={() => setReviewApproval(null)} className="t-btn t-btn-ghost t-btn-icon" aria-label="Close">✕</button>
            </div>
            <div className="t-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-ink-muted)" }}>What would happen?</p>
                <p style={{ marginTop: 4, fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>{friendlyOperationLabel(reviewApproval.operationType)}</p>
                <p style={{ marginTop: 3, fontSize: 13, color: "var(--color-ink-secondary)" }}>{reviewApproval.operationDescription}</p>
              </div>
              {reviewApproval.destination && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-ink-muted)" }}>Where?</p>
                  <p style={{ marginTop: 4, fontSize: 13, fontFamily: "monospace", color: "var(--color-primary)", wordBreak: "break-all" }}>{reviewApproval.destination}</p>
                </div>
              )}
              {reviewApproval.prohibitsAutomation && (
                <div className="t-alert t-alert-error">
                  <strong>You need to do this yourself:</strong> This service requires personal interaction. Approving this will not allow TRESTLE to complete it automatically.
                </div>
              )}
              <div>
                <label htmlFor="decision-notes" className="t-label">Notes for your decision (optional)</label>
                <textarea
                  id="decision-notes"
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="Why are you approving or rejecting?"
                  className="t-input t-textarea"
                  style={{ minHeight: 72, marginTop: 6 }}
                  rows={2}
                />
              </div>
            </div>
            <div className="t-modal-footer">
              <button type="button" onClick={() => setReviewApproval(null)} className="t-btn t-btn-ghost t-btn-sm">Cancel</button>
              <button type="button" onClick={() => handleDecision("reject")} disabled={deciding} className="t-btn t-btn-danger t-btn-sm">
                {deciding ? "Rejecting…" : "Reject request"}
              </button>
              {!reviewApproval.prohibitsAutomation && (
                <button type="button" onClick={() => handleDecision("approve")} disabled={deciding} className="t-btn t-btn-primary t-btn-sm">
                  {deciding ? "Approving…" : "Approve request"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Prepare approval modal ────────────── */}
      {preparingAction && (
        <div className="t-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="prepare-modal-title">
          <div className="t-modal">
            <div className="t-modal-header">
              <div>
                <h2 id="prepare-modal-title" style={{ fontSize: 18, fontWeight: 700, color: "var(--color-ink)" }}>
                  Request permission for this step
                </h2>
                <p style={{ marginTop: 3, fontSize: 13, color: "var(--color-ink-secondary)" }}>Action: {preparingAction.title}</p>
              </div>
              <button type="button" onClick={() => setPreparingAction(null)} className="t-btn t-btn-ghost t-btn-icon" aria-label="Close">✕</button>
            </div>
            <div className="t-modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label htmlFor="prep-op-type" className="t-label">What kind of permission is needed?</label>
                <select id="prep-op-type" value={prepOpType} onChange={(e) => setPrepOpType(e.target.value)} className="t-input t-select" style={{ marginTop: 6 }}>
                  <option value="enter_form_details">Prepare information for a service (review required)</option>
                  <option value="select_document_upload">Choose documents for upload (review required)</option>
                  <option value="modify_record">Change an existing record (review required)</option>
                  <option value="submit_declaration">Submit an official declaration (high consequence)</option>
                  <option value="make_payment">Make a payment (high consequence)</option>
                  <option value="cancel_service">Cancel a service (high consequence)</option>
                  <option value="read_public_info">Read public information (low risk)</option>
                </select>
              </div>
              <div>
                <label htmlFor="prep-desc" className="t-label">What would TRESTLE do?</label>
                <input id="prep-desc" type="text" value={prepDesc} onChange={(e) => setPrepDesc(e.target.value)} className="t-input" style={{ marginTop: 6 }} />
              </div>
              <div>
                <label htmlFor="prep-dest" className="t-label">Service or website (optional)</label>
                <input id="prep-dest" type="text" value={prepDest} onChange={(e) => setPrepDest(e.target.value)} placeholder="e.g. your bank's card-security service" className="t-input" style={{ marginTop: 6 }} />
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--color-ink)" }}>
                <input type="checkbox" checked={prepProhibitsAuto} onChange={(e) => setPrepProhibitsAuto(e.target.checked)} style={{ marginTop: 2 }} />
                <span>This service requires me to complete the step personally</span>
              </label>
            </div>
            <div className="t-modal-footer">
              <button type="button" onClick={() => setPreparingAction(null)} className="t-btn t-btn-ghost t-btn-sm">Cancel</button>
              <button type="button" onClick={submitApprovalRequest} disabled={submittingReq} className="t-btn t-btn-primary t-btn-sm">
                {submittingReq ? "Sending…" : "Send for human review"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Audit history modal ───────────────── */}
      {historyAction && (
        <div className="t-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
          <div className="t-modal">
            <div className="t-modal-header">
              <div>
                <h2 id="history-modal-title" style={{ fontSize: 18, fontWeight: 700, color: "var(--color-ink)" }}>
                  Execution audit log
                </h2>
                <p style={{ marginTop: 3, fontSize: 13, color: "var(--color-ink-secondary)" }}>
                  {historyAction.title} ({historyAction.id})
                </p>
              </div>
              <button type="button" onClick={() => setHistoryAction(null)} className="t-btn t-btn-ghost t-btn-icon" aria-label="Close">✕</button>
            </div>
            <div className="t-modal-body">
              {loadingHistory ? (
                <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Loading execution history…</p>
              ) : actionHistory.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>No execution attempts recorded yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
                  {actionHistory.map((att) => (
                    <div key={att.id} className="t-card" style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                        <span
                          style={{
                            fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                            color: att.status === "succeeded" ? "var(--color-success-text)"
                              : att.status === "uncertain" ? "var(--color-warning-text)"
                              : "var(--color-error-text)",
                          }}
                        >
                          {att.status}
                        </span>
                        {att.isSimulated && (
                          <span className="t-status t-status-blocked" style={{ fontSize: 11 }}>SIMULATED</span>
                        )}
                      </div>
                      {att.resultSummary && <p style={{ marginTop: 6, fontSize: 13, color: "var(--color-ink-secondary)" }}>{att.resultSummary}</p>}
                      <p style={{ marginTop: 6, fontSize: 11, color: "var(--color-ink-muted)", fontFamily: "monospace" }}>
                        {new Date(att.startedAt).toLocaleString()} · Provider: {att.provider}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="t-modal-footer">
              <button type="button" onClick={() => setHistoryAction(null)} className="t-btn t-btn-ghost t-btn-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
