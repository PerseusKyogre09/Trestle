"use client";

/**
 * ActionDetailPanel – slide-in panel shown when a graph node is selected.
 *
 * Displays the full action details (description, dependencies, success
 * criteria, risk, approval, evidence, current status) and exposes the same
 * Start / Complete / Record failure transitions that the list view uses.
 * Uses the existing /api/cases/[id]/actions/[actionId] PATCH endpoint.
 */

import { useEffect, useState } from "react";
import type {
  Action,
  Approval,
  Case,
  ExecutionAttempt,
  ProposedOperation,
} from "../../domain/types";

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

const statusStyle: Record<string, string> = {
  pending: "border-slate-700 bg-slate-800/60 text-slate-300",
  ready: "border-blue-400/30 bg-blue-400/10 text-blue-300",
  awaiting_approval: "border-orange-400/30 bg-orange-400/10 text-orange-300",
  in_progress: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  blocked: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  failed: "border-rose-400/30 bg-rose-400/10 text-rose-300",
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

function sourceUrls(resultDetails: string): string[] {
  try {
    const parsed: unknown = JSON.parse(resultDetails);
    if (!parsed || typeof parsed !== "object") return [];
    const urls = (parsed as { sourceUrls?: unknown }).sourceUrls;
    return Array.isArray(urls)
      ? urls.filter(
        (url): url is string =>
          typeof url === "string" &&
          (url.startsWith("https://") || url.startsWith("http://")),
      )
      : [];
  } catch {
    return [];
  }
}

function researchResult(resultDetails: string): {
  summary?: string;
  sourceUrls: string[];
  requirements: string[];
  requiredDocuments: string[];
  fees: string[];
  nextSteps: string[];
  unknowns: string[];
} | null {
  try {
    const parsed: unknown = JSON.parse(resultDetails);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    const list = (key: string) =>
      Array.isArray(value[key])
        ? value[key].filter((item): item is string => typeof item === "string")
        : [];
    return {
      summary: typeof value.summary === "string" ? value.summary : undefined,
      sourceUrls: sourceUrls(resultDetails),
      requirements: list("requirements"),
      requiredDocuments: list("requiredDocuments"),
      fees: list("fees"),
      nextSteps: list("nextSteps"),
      unknowns: list("unknowns"),
    };
  } catch {
    return null;
  }
}

function ResearchList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-300">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

export default function ActionDetailPanel(
  { action, caseItem, onClose, onTransition }: Props,
) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [executions, setExecutions] = useState<ExecutionAttempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [jurisdiction, setJurisdiction] = useState("India");
  const [documentType, setDocumentType] = useState("Indian driving licence");
  const operation: ProposedOperation = {
    operationType: "complete_action",
    description: action.description,
    payload: { actionId: action.id },
  };
  const liveOperation: ProposedOperation = {
    operationType: "lost_document_research",
    description: "Research the official lost-document replacement process.",
    payload: { jurisdiction, documentType },
  };

  useEffect(() => {
    Promise.all([
      fetch(
        `/api/cases/${caseItem.id}/approvals?actionId=${action.id}`,
      ).then((response) =>
        response.json()
      ),
      fetch(`/api/cases/${caseItem.id}/actions/${action.id}/executions`).then((
        response,
      ) => response.json()),
    ])
      .then(([approvalData, executionData]) => {
        setApprovals(approvalData);
        setExecutions(executionData);
      })
      .catch(() => setMessage("Approval history could not be loaded."));
  }, [action.id, caseItem.id]);

  async function requestApproval() {
    setBusy(true);
    const response = await fetch(
      `/api/cases/${caseItem.id}/actions/${action.id}/approval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: {} }),
      },
    );
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error);
    setApprovals((current) => [data, ...current]);
  }

  async function decide(approvalId: string, decision: "approve" | "reject") {
    setBusy(true);
    const response = await fetch(
      `/api/cases/${caseItem.id}/approvals/${approvalId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error);
    setApprovals((current) =>
      current.map((item) => item.id === approvalId ? data : item)
    );
  }

  async function execute() {
    const approved = approvals.find((item) => item.status === "approved");
    if (!approved) return;
    setBusy(true);
    const response = await fetch(
      `/api/cases/${caseItem.id}/actions/${action.id}/execute`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error);
    const historyResponse = await fetch(
      `/api/cases/${caseItem.id}/actions/${action.id}/executions`,
    );
    if (!historyResponse.ok) {
      setMessage("Execution succeeded, but its history could not be loaded.");
      return;
    }
    setExecutions(await historyResponse.json());
    window.location.reload();
  }

  async function requestLiveApproval() {
    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/cases/${caseItem.id}/actions/${action.id}/approval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: { jurisdiction, documentType } }),
      },
    );
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error);
    setApprovals((current) => [data, ...current]);
  }

  async function executeLive() {
    const approved = approvals.find(
      (item) =>
        item.status === "approved" &&
        item.operationType === liveOperation.operationType,
    );
    if (!approved) return setMessage("Approve the live research operation first.");
    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/cases/${caseItem.id}/actions/${action.id}/execute`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: liveOperation,
          provider: "tinyfish",
        }),
      },
    );
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error);
    const historyResponse = await fetch(
      `/api/cases/${caseItem.id}/actions/${action.id}/executions`,
    );
    if (historyResponse.ok) setExecutions(await historyResponse.json());
    else setMessage("Research finished, but execution history could not be loaded.");
    if (data.outcome === "uncertain") {
      setMessage(data.uncertaintyReason ?? "TinyFish returned an inconclusive result.");
    }
  }
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
          <span
            className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
              statusStyle[action.status] ?? "border-slate-700 text-slate-300"
            }`}
          >
            {action.status.replace(/_/g, " ")}
          </span>
        </div>

        <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-3">
          <Label>Proposed operation</Label>
          <Value>{operation.operationType.replace(/_/g, " ")}</Value>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {operation.description}
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-950/70 p-2 text-[11px] text-slate-500">{JSON.stringify(operation.payload, null, 2)}</pre>
          <p className="mt-2 text-[11px] text-slate-500">
            This operation is local and simulated. No external service will be
            contacted.
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
            <p className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/5 p-2 text-xs leading-5 text-amber-300">
              Blocked by {blockedBy.length}{" "}
              incomplete prerequisite{blockedBy.length > 1 ? "s" : ""}. Complete
              {" "}
              {blockedBy.map((id) =>
                caseItem.actions.find((item) => item.id === id)?.title ?? id
              ).join(", ")} first.
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
              {action.approvalRequired
                ? (
                  <p className="rounded-md border border-orange-400/20 bg-orange-400/5 p-2 text-xs leading-5 text-orange-200">
                    This action requires approval. Use the approved execution
                    control to complete it with recorded evidence.
                  </p>
                )
                : (
                  <button
                    onClick={() => onTransition(action, "completed")}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    Complete with evidence
                  </button>
                )}
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

      <div className="border-t border-slate-800 px-5 py-4">
        <Label>Approval and execution</Label>
        <Value>
          {approvals[0]
            ? `Approval: ${approvals[0].status}`
            : "No approval requested."}
        </Value>
        {approvals.length > 0 && (
          <div className="mt-2 space-y-2">
            {approvals.slice(0, 3).map((approval) => (
              <div
                key={approval.id}
                className="rounded-md border border-slate-800 bg-slate-900/60 p-2 text-xs"
              >
                <span
                  className={approval.status === "approved"
                    ? "text-emerald-300"
                    : approval.status === "rejected" ||
                        approval.status === "invalidated"
                    ? "text-rose-300"
                    : approval.status === "expired"
                    ? "text-amber-300"
                    : "text-orange-300"}
                >
                  {approval.status}
                </span>
                {approval.decisionReason && (
                  <p className="mt-1 text-slate-500">
                    {approval.decisionReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {!blockedBy.length && !approvals.some((item) =>
            ["pending", "approved"].includes(item.status)
          ) && (
            <button
              disabled={busy}
              onClick={requestApproval}
              className="rounded-md bg-orange-500 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Request approval
            </button>
          )}
          {approvals.find((item) => item.status === "pending") && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  decide(
                    approvals.find((item) => item.status === "pending")!.id,
                    "approve",
                  )}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  decide(
                    approvals.find((item) =>
                      item.status === "pending"
                    )!.id,
                    "reject",
                  )}
                className="rounded-md border border-rose-400/40 px-3 py-2 text-sm text-rose-300"
              >
                Reject
              </button>
            </>
          )}
          {approvals.some((item) => item.status === "approved") && (
            <button
              disabled={busy}
              onClick={execute}
              className="rounded-md bg-blue-500 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Execute simulated action
            </button>
          )}
        </div>
        {executions[0] && (
          <p className="mt-2 text-xs text-slate-400">
            Latest result: {executions[0].resultSummary ?? executions[0].status}
          </p>
        )}
        {executions.length > 0 && (
          <div className="mt-3 space-y-2">
            <Label>Execution history</Label>
            {executions.map((execution) => (
              <div
                key={execution.id}
                className="rounded-md border border-slate-800 bg-slate-900/60 p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={execution.status === "succeeded"
                      ? "text-emerald-300"
                      : execution.status === "running"
                      ? "text-blue-300"
                      : execution.status === "uncertain"
                      ? "text-amber-300"
                      : "text-rose-300"}
                  >
                    {execution.status}
                  </span>
                  <span className="text-slate-600">
                    {execution.isSimulated ? "SIMULATED" : "provider result"}
                  </span>
                </div>
                {execution.resultSummary && (
                  <p className="mt-1 text-slate-400">
                    {execution.resultSummary}
                  </p>
                )}
                {execution.evidence && (
                  <p className="mt-1 text-slate-500">
                    Evidence: simulated only — no external completion claimed.
                  </p>
                )}
                {execution.resultDetails && !execution.isSimulated && (
                  <div className="mt-2 rounded bg-slate-950/60 p-2 text-slate-400">
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-blue-300">
                      LIVE TINYFISH research result
                    </p>
                    {researchResult(execution.resultDetails) ? (
                      <div className="space-y-3">
                        {researchResult(execution.resultDetails)!.summary && (
                          <p className="text-sm leading-5 text-slate-200">
                            {researchResult(execution.resultDetails)!.summary}
                          </p>
                        )}
                        <ResearchList
                          title="What the official guidance requires"
                          items={researchResult(execution.resultDetails)!.requirements}
                        />
                        <ResearchList
                          title="Documents to prepare"
                          items={researchResult(execution.resultDetails)!.requiredDocuments}
                        />
                        <ResearchList
                          title="Published fees"
                          items={researchResult(execution.resultDetails)!.fees}
                        />
                        <ResearchList
                          title="Next steps"
                          items={researchResult(execution.resultDetails)!.nextSteps}
                        />
                        <ResearchList
                          title="Needs verification"
                          items={researchResult(execution.resultDetails)!.unknowns}
                        />
                        {researchResult(execution.resultDetails)!.sourceUrls.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[11px] uppercase tracking-wide text-slate-500">
                              Official sources
                            </p>
                            {researchResult(execution.resultDetails)!.sourceUrls.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block break-all text-cyan-300 underline hover:text-cyan-200"
                          >
                            {url}
                          </a>
                            ))}
                          </div>
                        )}
                        <p className="border-t border-slate-800 pt-2 text-[11px] text-amber-300">
                          Research only: no application was submitted and no replacement was completed.
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        The provider returned a result that could not be displayed safely.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {action.id === "identify-reporting" && (
          <div className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
            <Label>Live TinyFish research</Label>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              This researches official guidance only. It does not submit an application,
              upload documents, pay fees, or claim replacement completion.
            </p>
            <div className="mt-3 grid gap-2">
              <label className="text-xs text-slate-400">
                Jurisdiction
                <input
                  value={jurisdiction}
                  onChange={(event) => setJurisdiction(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                />
              </label>
              <label className="text-xs text-slate-400">
                Document type
                <input
                  value={documentType}
                  onChange={(event) => setDocumentType(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-cyan-300">
              LIVE TINYFISH · requires a separate approval for this exact research operation
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!approvals.some((item) =>
                ["pending", "approved"].includes(item.status) &&
                item.operationType === "lost_document_research"
              ) && (
                <button
                  disabled={busy || !jurisdiction.trim() || !documentType.trim()}
                  onClick={requestLiveApproval}
                  className="rounded-md border border-cyan-400/40 px-3 py-2 text-sm text-cyan-200 disabled:opacity-50"
                >
                  Request live research approval
                </button>
              )}
              {approvals.find(
                (item) =>
                  item.status === "pending" &&
                  item.operationType === "lost_document_research",
              ) && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      decide(
                        approvals.find(
                          (item) =>
                            item.status === "pending" &&
                            item.operationType === "lost_document_research",
                        )!.id,
                        "approve",
                      )}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    Approve live research
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      decide(
                        approvals.find(
                          (item) =>
                            item.status === "pending" &&
                            item.operationType === "lost_document_research",
                        )!.id,
                        "reject",
                      )}
                    className="rounded-md border border-rose-400/40 px-3 py-2 text-sm text-rose-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              )}
              {approvals.some(
                (item) =>
                  item.status === "approved" &&
                  item.operationType === "lost_document_research",
              ) && (
                <button
                  disabled={busy}
                  onClick={executeLive}
                  className="rounded-md bg-cyan-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  Run LIVE TINYFISH research
                </button>
              )}
            </div>
          </div>
        )}
        {message && (
          <p role="alert" className="mt-2 text-xs text-rose-300">{message}</p>
        )}
      </div>
    </aside>
  );
}
