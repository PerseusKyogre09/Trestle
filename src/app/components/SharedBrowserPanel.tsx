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
};

type Props = { caseId: string; actions: Action[] };

export default function SharedBrowserPanel({ caseId, actions }: Props) {
  const [session, setSession] = useState<Session | null>(null);
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
  const queuedCommandCount = useRef(0);
  const lastWheelAt = useRef(0);
  const lastFrameMetricAt = useRef(0);
  const pendingText = useRef("");
  const textTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const responseStartedAt = performance.now();
        const response = await fetch(`/api/cases/${caseId}/shared-browser`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not reconnect to the shared browser.");
        if (disposed) return;
        setSession(data as Session | null);
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
    if (session?.status !== "active") return;
    const source = new EventSource(`/api/cases/${caseId}/shared-browser/stream`);
    const onFrame = (event: Event) => {
      const frame = JSON.parse((event as MessageEvent<string>).data) as { data: string; width: number; height: number; sentAt: number };
      setStreamedFrame(frame.data);
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
  }, [caseId, session?.status, session?.sessionId]);

  function command(body: Record<string, unknown>) {
    if (body.action !== "type" && pendingText.current) flushText();
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
        queuedCommandCount.current -= 1;
        if (queuedCommandCount.current === 0) setBusy(false);
      }
    });
    return commandQueue.current;
  }

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
    <section className="mt-5 rounded-xl border border-cyan-800/70 bg-slate-950/70 p-4" aria-label="Case-aware shared TinyFish browser">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Case-aware shared browser</p>
          <h3 className="mt-1 text-base font-semibold text-slate-100">Open the verified site for this workflow step</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">TRESTLE opens a persisted official research source or a verified public institution support page. You control the shared page. Account access and consequential actions stay with you; loading a page never means the task was completed.</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${session?.controlOwner === "user" ? "border-amber-700 bg-amber-950/40 text-amber-200" : session?.controlOwner === "agent" ? "border-cyan-700 bg-cyan-950/40 text-cyan-200" : "border-slate-700 bg-slate-900 text-slate-300"}`}>
          {session?.status === "active" ? `${session.controlOwner} has control` : session?.status ?? "not started"}
        </span>
      </div>

      {!session || ["failed", "expired", "closed"].includes(session.status)
        ? <div className="mt-4 space-y-3">
          <label className="block max-w-lg text-xs text-slate-300" htmlFor={`browser-institution-${caseId}`}>Institution or bank, if relevant <span className="text-slate-500">(name only; no account/card details)</span>
            <input id={`browser-institution-${caseId}`} value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder="For example, ICICI Bank" className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void command({ action: "start", institution })} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Opening verified case website…" : session?.status === "expired" ? "Open case website in a new session" : "Open case website"}</button>
            <button type="button" disabled={busy} onClick={() => void command({ action: "start", testMode: true })} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 disabled:opacity-50">Development test site</button>
          </div>
          <p className="text-xs text-slate-500">The development test site works only when the server has TRESTLE_BROWSER_TEST_MODE=true. It is never selected for a case.</p>
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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <p className="mr-auto min-w-0 text-xs text-slate-400">{session.pageTitle || "Page title unavailable"} · <span className="break-all">{session.currentUrl || "URL unavailable"}</span></p>
              {session.controlOwner === "agent"
                ? <>
                  <button type="button" disabled={busy} onClick={() => void command({ action: "take-control" })} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Take control</button>
                  <button type="button" disabled={busy} onClick={() => void command({ action: "pause-agent" })} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">Pause agent</button>
                </>
                : session.controlOwner === "user"
                ? <button type="button" disabled={busy} onClick={() => void command({ action: "return-to-agent" })} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Handing back…" : "Finish user step · hand back"}</button>
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
                : "The page is not currently under your control. The browser view is real; no automated action is claimed for this case step."}
            </p>
            <p className="mt-1 text-[11px] text-cyan-300">Live CDP frame stream: {session.status === "active" ? streamState : "disconnected"}</p>
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
      <p className="mt-3 text-[11px] leading-5 text-slate-600">This uses a billable TinyFish Browser API session. The CDP URL and API key remain server-side. Local-development-only: TRESTLE has no user authentication. Research and page navigation do not block cards, submit forms, or verify account changes.</p>
    </section>
  );
}
