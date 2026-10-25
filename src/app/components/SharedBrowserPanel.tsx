"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import type { Action } from "../../domain/types";

// Live remote screenshots must be rendered as received, without Next image optimization.
/* eslint-disable @next/next/no-img-element */

type Session = {
  sessionId: string;
  providerSessionId: string;
  status: "connecting" | "active" | "disconnected" | "expired" | "failed" | "closed" | string;
  controlOwner: "user" | "agent" | "paused";
  currentUrl: string | null;
  pageTitle: string | null;
  lastActivity: string | null;
  screenshot: string | null;
  viewport: { width: number; height: number } | null;
  notice?: string;
  actionId?: string | null;
  institution?: string | null;
  selectedUrl?: string | null;
  selectionSource?: string | null;
  selectionReason?: string | null;
  isTestMode?: boolean;
  accessIssue?: "blocked" | "challenge" | null;
};

export type LiveBrowserFrame = { data: string; currentUrl: string | null; pageTitle: string | null; actionId: string | null };
type Props = { caseId: string; actions: Action[]; isSpamReporting?: boolean; workflowStarted?: boolean; workflowActionId?: string | null; autoStartForWorkflow?: boolean; onLiveFrame?: (frame: LiveBrowserFrame | null) => void };

function isTraiUccLandingPage(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.hostname.toLowerCase() === "trai.gov.in" && url.pathname.replace(/\/$/, "") === "/ucc";
  } catch {
    return false;
  }
}

export default function SharedBrowserPanel({ caseId, actions, isSpamReporting = false, workflowStarted = false, workflowActionId = null, autoStartForWorkflow = false, onLiveFrame }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agentMessage, setAgentMessage] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [institution, setInstitution] = useState("");
  const [lastUiTiming, setLastUiTiming] = useState<string | null>(null);
  const [frameVersion, setFrameVersion] = useState(0);
  const [streamedFrame, setStreamedFrame] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const commandQueue = useRef<Promise<void>>(Promise.resolve());
  const commandRef = useRef<(body: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
  const queuedCommandCount = useRef(0);
  const lastWheelAt = useRef(0);
  const lastFrameMetricAt = useRef(0);
  const lastGuideFrameAt = useRef(0);
  const pendingText = useRef("");
  const textTimer = useRef<number | undefined>(undefined);
  const automaticStartKey = useRef<string | null>(null);
  const automaticWorkflowStartKey = useRef<string | null>(null);
  const automaticStepNavigationKey = useRef<string | null>(null);
  const automaticUccAdvanceKey = useRef<string | null>(null);
  const sessionRevision = useRef(0);
  const pendingMutations = useRef(0);
  const routeEvidence = actions.find((action) => action.id === "classify-reporting-route")?.evidence
    .find((item) => item.kind === "user_provided")?.note ?? "";
  const chosenRoute = routeEvidence.toLowerCase().includes("ordinary unsolicited")
    ? "ordinary-ucc"
    : routeEvidence.toLowerCase().includes("suspected cybercrime")
    ? "suspected-cybercrime"
    : "";
  const isTravelCase = actions.some((action) => action.id === "research-travel-entry-guidance");
  const isBankCase = actions.some((action) => /\b(?:bank|credit card|debit card|card issuer)\b/i.test(`${action.title} ${action.description}`));

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const revisionAtRequest = sessionRevision.current;
        const responseStartedAt = performance.now();
        const response = await fetch(`/api/cases/${caseId}/shared-browser`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not reconnect to the shared browser.");
        if (disposed) return;
        // Do not let a GET that raced an automatic start or a control handoff
        // overwrite the newer session snapshot returned by that command.
        if (revisionAtRequest !== sessionRevision.current || pendingMutations.current > 0) {
          setSessionLoaded(true);
          timer = window.setTimeout(() => void poll(), 500);
          return;
        }
        setSession(data as Session | null);
        setSessionLoaded(true);
        setLastUiTiming(`Frame response ${Math.round(performance.now() - responseStartedAt)} ms · ~${Math.round(JSON.stringify(data).length / 1024)} KB`);
        if (data?.currentUrl) setUrlDraft(data.currentUrl);
        if (data?.status === "active") timer = window.setTimeout(() => void poll(), queuedCommandCount.current > 0 ? 2200 : 1200);
        else if (data?.status === "connecting") timer = window.setTimeout(() => void poll(), 1800);
      } catch {
        if (!disposed) timer = window.setTimeout(() => void poll(), 4000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [caseId]);

  useEffect(() => {
    if (!isSpamReporting || !workflowStarted || !chosenRoute || !sessionLoaded || session) return;
    const startKey = `${caseId}:${chosenRoute}`;
    if (automaticStartKey.current === startKey) return;
    automaticStartKey.current = startKey;
    sessionRevision.current += 1;
    pendingMutations.current += 1;
    let disposed = false;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/cases/${caseId}/shared-browser`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not open the selected official reporting page.");
        sessionRevision.current += 1;
        if (disposed) return;
        setSession(data as Session);
        if (typeof data.message === "string") setAgentMessage(data.message);
        if (data.currentUrl) setUrlDraft(data.currentUrl);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Could not open the selected official reporting page.");
      } finally {
        pendingMutations.current -= 1;
        if (!disposed) setBusy(false);
      }
    })();
    return () => { disposed = true; };
  }, [caseId, chosenRoute, isSpamReporting, session, sessionLoaded, workflowStarted]);

  useEffect(() => {
    if (isSpamReporting || !autoStartForWorkflow || !workflowStarted || !sessionLoaded ||
      (session && !["failed", "expired", "closed"].includes(session.status))) return;
    const startKey = `${caseId}:verified-workflow-source`;
    if (automaticWorkflowStartKey.current === startKey) return;
    automaticWorkflowStartKey.current = startKey;
    sessionRevision.current += 1;
    pendingMutations.current += 1;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/cases/${caseId}/shared-browser`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not open the researched official page.");
        sessionRevision.current += 1;
        setSession(data as Session);
        if (data.currentUrl) setUrlDraft(data.currentUrl);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open the researched official page.");
      } finally {
        pendingMutations.current -= 1;
        setBusy(false);
      }
    })();
  }, [autoStartForWorkflow, caseId, isSpamReporting, session, sessionLoaded, workflowStarted]);

  useEffect(() => {
    if (
      isSpamReporting || !autoStartForWorkflow || !workflowStarted || !sessionLoaded ||
      !workflowActionId || session?.status !== "active" || session.controlOwner !== "agent" ||
      session.actionId === workflowActionId
    ) return;
    const navigationKey = `${caseId}:${session.sessionId}:${workflowActionId}`;
    if (automaticStepNavigationKey.current === navigationKey) return;
    automaticStepNavigationKey.current = navigationKey;
    pendingMutations.current += 1;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/cases/${caseId}/shared-browser`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "advance-to-workflow-step" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No verified official page is available for this step yet.");
        sessionRevision.current += 1;
        setSession(data as Session);
        if (data.currentUrl) setUrlDraft(data.currentUrl);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open a verified page for this step.");
      } finally {
        pendingMutations.current -= 1;
        setBusy(false);
      }
    })();
  }, [autoStartForWorkflow, caseId, isSpamReporting, session, sessionLoaded, workflowActionId, workflowStarted]);

  useEffect(() => {
    if (
      !isSpamReporting || chosenRoute !== "ordinary-ucc" || session?.status !== "active" ||
      session.controlOwner !== "agent" || session.selectionSource !== "official_reporting_directory" ||
      !isTraiUccLandingPage(session.currentUrl)
    ) return;
    const advanceKey = `${caseId}:${session.sessionId}:trai-ucc-guide`;
    if (automaticUccAdvanceKey.current === advanceKey) return;
    automaticUccAdvanceKey.current = advanceKey;
    void commandRef.current({ action: "advance-ucc-guide" });
  }, [caseId, chosenRoute, isSpamReporting, session]);

  useEffect(() => {
    if (session?.status !== "active") return;
    const source = new EventSource(`/api/cases/${caseId}/shared-browser/stream`);
    const onFrame = (event: Event) => {
      const frame = JSON.parse((event as MessageEvent<string>).data) as { data: string; width: number; height: number; sentAt: number };
      setStreamedFrame(frame.data);
      if (onLiveFrame && Date.now() - lastGuideFrameAt.current >= 2500) {
        lastGuideFrameAt.current = Date.now();
        onLiveFrame({
          data: frame.data,
          currentUrl: session.currentUrl,
          pageTitle: session.pageTitle,
          actionId: session.actionId ?? null,
        });
      }
      setStreamState("connected");
      if (Date.now() - lastFrameMetricAt.current >= 1000) {
        lastFrameMetricAt.current = Date.now();
        setLastUiTiming(`Live frame ${Math.max(0, Date.now() - frame.sentAt)} ms after server capture · ${Math.round(frame.data.length * 0.75 / 1024)} KB · ${frame.width}×${frame.height}`);
      }
    };
    source.addEventListener("frame", onFrame);
    source.addEventListener("status", () => setStreamState("connected"));
    source.onerror = () => setStreamState("disconnected");
    return () => {
      source.removeEventListener("frame", onFrame);
      source.close();
    };
  }, [caseId, onLiveFrame, session?.actionId, session?.currentUrl, session?.pageTitle, session?.status, session?.sessionId]);

  useEffect(() => {
    if (session?.status !== "active") onLiveFrame?.(null);
  }, [onLiveFrame, session?.status]);

  function command(body: Record<string, unknown>) {
    if (body.action !== "type" && pendingText.current) flushText();
    sessionRevision.current += 1;
    pendingMutations.current += 1;
    queuedCommandCount.current += 1;
    setBusy(true);
    commandQueue.current = commandQueue.current.then(async () => {
      setError("");
      try {
        const startedAt = performance.now();
        const response = await fetch(`/api/cases/${caseId}/shared-browser`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Shared browser command failed.");
        sessionRevision.current += 1;
        const latest = data.snapshot ?? data;
        setSession((current) => ({
          ...current,
          ...latest,
          screenshot: latest.screenshot ?? current?.screenshot ?? null,
          viewport: latest.viewport ?? current?.viewport ?? null,
        } as Session));
        if (typeof data.message === "string") setAgentMessage(data.message);
        if (latest.currentUrl) setUrlDraft(latest.currentUrl);
        setLastUiTiming(`Input ${Math.round(performance.now() - startedAt)} ms · ${response.headers.get("server-timing") ?? "server timing unavailable"} · ~${Math.round(JSON.stringify(data).length / 1024)} KB`);
        setFrameVersion((version) => version + 1);
        setStreamedFrame(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Shared browser command failed.");
      } finally {
        pendingMutations.current -= 1;
        queuedCommandCount.current -= 1;
        if (queuedCommandCount.current === 0) setBusy(false);
      }
    });
    return commandQueue.current;
  }
  commandRef.current = command;

  function flushText() {
    if (textTimer.current !== undefined) window.clearTimeout(textTimer.current);
    textTimer.current = undefined;
    const text = pendingText.current;
    pendingText.current = "";
    if (text) void command({ action: "type", text });
  }

  function clickViewport(event: React.PointerEvent<HTMLDivElement>) {
    if (session?.controlOwner !== "user" || !session.viewport || !viewportRef.current) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const rect = imageRef.current?.getBoundingClientRect() ?? viewportRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * session.viewport.width;
    const y = (event.clientY - rect.top) / rect.height * session.viewport.height;
    void command({ action: "click", x: Math.round(x), y: Math.round(y) });
  }

  function keyViewport(event: KeyboardEvent<HTMLDivElement>) {
    if (session?.controlOwner !== "user") return;
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      pendingText.current = `${pendingText.current}${event.key}`.slice(-300);
      if (textTimer.current !== undefined) window.clearTimeout(textTimer.current);
      textTimer.current = window.setTimeout(flushText, 45);
    } else if (["Enter", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      flushText();
      void command({ action: "key", key: event.key });
    }
  }

  function wheelViewport(event: WheelEvent<HTMLDivElement>) {
    if (session?.controlOwner !== "user") return;
    event.preventDefault();
    if (Date.now() - lastWheelAt.current < 100) return;
    lastWheelAt.current = Date.now();
    void command({ action: "scroll", deltaY: Math.round(event.deltaY) });
  }

  return (
    <section className="trestle-browser-panel mt-5 rounded-xl border border-cyan-800/70 bg-slate-950/70 p-4 sm:p-5" aria-label="Case-aware shared TinyFish browser">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">{isSpamReporting ? "Live browser · TinyFish" : "Shared live browser"}</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-100">{isSpamReporting ? "The official site for your selected route" : "The website for this step"}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{isSpamReporting ? "Once you choose ordinary spam or suspected cybercrime, TRESTLE opens the matching official route in this shared browser. Take control when the site needs your input; return control for permitted page checks. Ordinary UCC complaints go through your telecom provider. TRESTLE does not read form values or submit reports." : "When TinyFish finds a verified official source for the current step, TRESTLE opens it in the shared browser. The dashboard shows genuine live page frames; opening a page does not complete the task."}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${session?.controlOwner === "user" ? "border-amber-700 bg-amber-950/40 text-amber-200" : session?.controlOwner === "agent" ? "border-cyan-700 bg-cyan-950/40 text-cyan-200" : "border-slate-700 bg-slate-900 text-slate-300"}`}>
          {session?.status === "active" ? `${session.controlOwner === "agent" && session.selectionSource === "official_reporting_directory" ? "TRESTLE" : session.controlOwner} has control` : session?.status ?? "not started"}
        </span>
      </div>

      {!session || ["failed", "expired", "closed"].includes(session.status)
        ? <div className="mt-4 space-y-3">
          {!isSpamReporting && !isTravelCase && <label className="block max-w-lg text-xs text-slate-300" htmlFor={`browser-institution-${caseId}`}>{isBankCase ? "Card-issuing bank, if it is not clear from your case" : "Organization or agency, if relevant"} <span className="text-slate-500">(name only)</span>
            <input id={`browser-institution-${caseId}`} value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder={isBankCase ? "For example, ICICI Bank" : "For example, the relevant agency"} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
          </label>}
          <div className="flex flex-wrap gap-2">
            {!isSpamReporting && !workflowStarted && <button type="button" disabled={busy} onClick={() => void command({ action: "start", institution })} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Opening verified case website…" : session?.status === "expired" ? "Open case website in a new session" : "Open case website"}</button>}
            {isSpamReporting && !workflowStarted && <p className="text-sm text-slate-400">Start the workflow and select the reporting category; the matching official page will open automatically.</p>}
            {isSpamReporting && workflowStarted && !chosenRoute && <p className="text-sm text-slate-400">Waiting for your reporting-route choice before opening a site.</p>}
            {isSpamReporting && workflowStarted && chosenRoute && <p role="status" className="text-sm text-cyan-200">{busy ? "Opening your selected route in the live TinyFish browser…" : error ? "Automatic browser start needs attention; use the error above." : session && ["failed", "expired", "closed"].includes(session.status) ? `The previous browser session is ${session.status}. Open a new session to continue.` : "Opening the selected official page automatically when no session is already active."}</p>}
            {!isSpamReporting && workflowStarted && !autoStartForWorkflow && <div role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm leading-6 text-teal-900"><p>The browser is waiting for a verified official URL tied to the current step. It will open automatically once that source is recorded; TRESTLE will not guess a destination.</p><button type="button" disabled={busy} onClick={() => void command({ action: "start", institution })} className="mt-2 rounded-lg border border-teal-800 px-3 py-1.5 text-sm font-semibold text-teal-900 disabled:opacity-50">{busy ? "Checking verified sources…" : "Try opening a verified source"}</button></div>}
            {isSpamReporting && chosenRoute && error && <button type="button" disabled={busy} onClick={() => void command({ action: "start" })} className="rounded-lg border border-amber-700 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">Retry opening selected official page</button>}
            {isSpamReporting && workflowStarted && chosenRoute && session && ["failed", "expired", "closed"].includes(session.status) && <button type="button" disabled={busy} onClick={() => void command({ action: "start" })} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Opening…" : "Open official page in a new browser session"}</button>}
            {!isSpamReporting && !workflowStarted && <button type="button" disabled={busy} onClick={() => void command({ action: "start", testMode: true })} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 disabled:opacity-50">Development test site</button>}
          </div>
          {!isSpamReporting && !workflowStarted && <p className="text-xs text-slate-500">The development test site works only when the server has TRESTLE_BROWSER_TEST_MODE=true. It is never selected for a case.</p>}
        </div>
        : session.status === "disconnected"
        ? <button type="button" disabled={busy} onClick={() => void command({ action: "start" })} className="mt-4 rounded-lg border border-amber-700 px-4 py-2 text-sm text-amber-100 disabled:opacity-50">{busy ? "Reconnecting…" : "Reconnect to this session"}</button>
        : session.status === "connecting"
        ? <p className="mt-4 rounded-lg border border-slate-800 p-3 text-sm text-slate-300">Connecting to the existing TinyFish session…</p>
        : (
          <>
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm">
              <p className="font-medium text-slate-100">Current workflow step: {actions.find((action) => action.id === session.actionId)?.title ?? session.actionId ?? "Unavailable"}</p>
              {session.institution && <p className="mt-1 text-slate-300">Institution: {session.institution}</p>}
              <p className="mt-1 break-all text-xs text-cyan-200">Selected URL: {session.selectedUrl ?? "Unavailable"}</p>
              <p className="mt-1 text-xs text-slate-400">Selection: {session.selectionSource ?? "unknown"}. {session.selectionReason ?? "No selection explanation is available."}</p>
              {session.selectedUrl && <a href={session.selectedUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-cyan-300 underline underline-offset-2">Open selected page in my browser</a>}
            </div>
            {session.accessIssue && (
              <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <h4 className="font-semibold">{session.accessIssue === "blocked" ? "The official site blocked the remote browser" : "The official site requires a browser check"}</h4>
                <p className="mt-1 leading-6">TinyFish detected an access block or security challenge on this page. TRESTLE will not bypass it. Open the verified official page in your own browser and follow the site’s instructions there. This remote page has not been treated as a successful visit or completed workflow step.</p>
                {(session.selectedUrl ?? session.currentUrl) && <a href={session.selectedUrl ?? session.currentUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-lg bg-amber-900 px-3 py-2 font-semibold text-white">Open official site in my browser</a>}
                <p className="mt-2 text-xs">When you finish, return to TRESTLE and record what you were able to do. Any completion will be saved as user-reported unless TRESTLE can independently verify it.</p>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <p className="mr-auto min-w-0 text-xs text-slate-400">{session.pageTitle || "Page title unavailable"} · <span className="break-all">{session.currentUrl || "URL unavailable"}</span></p>
              {session.controlOwner === "agent"
                ? <>
                  <button type="button" disabled={busy} onClick={() => void command({ action: "take-control" })} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Take control</button>
                  <button type="button" disabled={busy} onClick={() => void command({ action: "pause-agent" })} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">{session.selectionSource === "official_reporting_directory" ? "Pause TRESTLE" : "Pause agent"}</button>
                  {isSpamReporting && chosenRoute === "ordinary-ucc" && isTraiUccLandingPage(session.currentUrl) && <button type="button" disabled={busy} onClick={() => void command({ action: "advance-ucc-guide" })} className="rounded-lg border border-amber-700 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">{busy ? "Opening TRAI instructions…" : "Open TRAI complaint instructions"}</button>}
                </>
                : session.controlOwner === "user"
                ? <button type="button" disabled={busy} onClick={() => void command({ action: session.isTestMode || session.selectionSource === "official_reporting_directory" ? "return-to-agent" : "pause-agent" })} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking page…" : session.isTestMode ? "Finish user step · hand back" : session.selectionSource === "official_reporting_directory" ? "Return control to TRESTLE" : "Finish browsing · pause controls"}</button>
                : <>
                  <button type="button" disabled={busy} onClick={() => void command({ action: "take-control" })} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Take control</button>
                  {session.isTestMode
                    ? <button type="button" disabled={busy} onClick={() => void command({ action: "return-to-agent" })} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Resume test agent</button>
                    : <span className="text-xs text-slate-400">Paused. TRESTLE will not automate actions on this site.</span>}
                </>}
              <button
                type="button"
                disabled={busy}
                onClick={() => void command({ action: "end" })}
                className="rounded-lg border border-rose-800 px-3 py-2 text-sm text-rose-200 disabled:opacity-50"
              >
                End remote session
              </button>
            </div>
            {session.status === "active" && !session.currentUrl && session.selectionSource !== "explicit_test_mode" && (
              <p role="status" className="mt-3 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
                The remote browser has not confirmed a web page URL. If the viewport shows a Chromium network error, navigation did not succeed and this does not complete the workflow step. Use the verified page link above to continue in your browser, or refresh the official destination.
              </p>
            )}
            {session.controlOwner === "user" && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
              {!session.isTestMode && session.selectionSource !== "development_custom_url" && (
                <button type="button" disabled={busy} onClick={() => void command({ action: "refresh-official-site" })} className="rounded-lg border border-cyan-800 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50">Refresh verified official destination</button>
              )}
              <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void command({ action: "navigate", url: urlDraft }); }}>
                <label htmlFor={`shared-browser-url-${caseId}`} className="sr-only">Navigate the shared browser</label>
                <input id={`shared-browser-url-${caseId}`} value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200" />
                <button type="submit" disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">Go</button>
              </form>
              </div>
            )}
            <div
              ref={viewportRef}
              tabIndex={0}
              role="application"
              aria-label={session.controlOwner === "user"
                ? "Interactive remote browser; click then type or use arrow and enter keys"
                : "Read-only remote browser preview while agent has control"}
              onPointerDown={clickViewport}
              onKeyDown={keyViewport}
              onWheel={wheelViewport}
              className={`mt-3 overflow-hidden rounded-lg border bg-black outline-none ${
                session.controlOwner === "user"
                  ? "border-amber-700 focus:ring-2 focus:ring-amber-500"
                  : "border-slate-700"
              }`}
            >
              {session.status === "active" ? (
                <img
                  ref={imageRef}
                  src={streamedFrame ? `data:image/jpeg;base64,${streamedFrame}` : `/api/cases/${caseId}/shared-browser/frame?v=${frameVersion}`}
                  alt={`Live remote browser page: ${session.pageTitle ?? "page title unavailable"}`}
                  draggable={false}
                  className={`pointer-events-none block h-auto w-full select-none ${session.controlOwner === "user" ? "cursor-crosshair" : "cursor-default"}`}
                  onLoad={() => {
                    const frameUrl = `/api/cases/${caseId}/shared-browser/frame?v=${frameVersion}`;
                    const resource = performance.getEntriesByName(new URL(frameUrl, location.href).toString()).at(-1) as PerformanceResourceTiming | undefined;
                    if (resource) setLastUiTiming(`Frame ${Math.round(resource.duration)} ms · ${Math.round(resource.transferSize / 1024)} KB transferred · ${imageRef.current?.naturalWidth}×${imageRef.current?.naturalHeight}`);
                  }}
                  onError={() => setError("Live browser frame could not be delivered. Check the local server output for capture timing/error details.")}
                />
              ) : (
                <p className="p-8 text-center text-sm text-slate-400">
                  The live page is unavailable. TRESTLE will not replace it with a simulated preview.
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {session.controlOwner === "user"
                ? `Click the real page, then type or scroll. Navigation is restricted to ${session.isTestMode || session.selectionSource === "development_custom_url" ? "public HTTP/HTTPS websites; localhost, private IPs, and internal destinations are blocked" : session.selectedUrl ? new URL(session.selectedUrl).hostname : "the verified official domain"}. Do not enter passwords, card details, or OTPs into TRESTLE.`
                : session.selectionSource === "official_reporting_directory"
                ? "TRESTLE has control of the same live browser while it checks the official page. It never reads entered values, fills fields, or submits the report. Take control whenever you want to edit the page."
                : "The page is not currently under your control. The browser view is real; no automated action is claimed for this case step."}
            </p>
            <p className="mt-1 text-[11px] text-cyan-300">Live CDP frame stream: {session.status === "active" ? streamState : "disconnected"}</p>
            <p className="mt-1 text-[11px] text-slate-500">The image above is captured from this real TinyFish browser session and updates as the page changes; it is not a sample screenshot.</p>
            {session.lastActivity && (
              <p className="mt-1 text-[11px] text-slate-600">
                Last browser activity: {new Date(session.lastActivity).toLocaleTimeString()}
              </p>
            )}
            {lastUiTiming && <p className="mt-1 text-[11px] text-slate-500" aria-live="polite">Measured locally: {lastUiTiming}</p>}
            {agentMessage && (
              <p role="status" className="mt-3 rounded-lg border border-cyan-900 bg-cyan-950/30 p-3 text-sm text-cyan-100">
                {agentMessage}
              </p>
            )}
            {session.notice && <p className="mt-3 text-sm text-amber-200">{session.notice}</p>}
          </>
        )}
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
      <p className="mt-3 text-[11px] leading-5 text-slate-600">Never enter passwords, card security codes, or OTPs in TRESTLE. In this local development app, browser access is not tied to a user account; keep the session on a trusted machine.</p>
    </section>
  );
}
