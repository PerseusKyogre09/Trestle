import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { isAllowedNavigation, isSafeDevelopmentUrl, resolveCaseWebsite, type WebsiteSelection } from "./websiteResolver";

const browserApiEndpoint = "https://api.browser.tinyfish.ai";
const demoUrl = "https://the-internet.herokuapp.com/";
const demoTimeoutSeconds = 900;
const connectionCache = new Map<string, TinyFishCdp>();

type BrowserSessionRecord = {
  id: string;
  caseId: string;
  providerSessionId: string;
  encryptedConnection: string;
  status: string;
  controlOwner: string;
  currentUrl: string | null;
  pageTitle: string | null;
  lastActivity: string | null;
  activeLock: string | null;
  selectedUrl: string | null;
  selectionSource: string | null;
  selectionReason: string | null;
  actionId: string | null;
  institution: string | null;
  allowedDomain: string | null;
  isTestMode: boolean;
};

export type SharedBrowserSnapshot = {
  sessionId: string;
  providerSessionId: string;
  status: string;
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

function apiKey(): string {
  return process.env.TINYFISH_API_KEY?.trim() ?? "";
}

function encryptionKey(): Buffer {
  const secret = apiKey();
  if (!secret) throw new Error("TinyFish is not configured on the server.");
  return createHash("sha256").update(`trestle-shared-browser\0${secret}`).digest();
}

function encryptConnection(value: { cdpUrl: string; baseUrl: string }): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

function decryptConnection(value: string): { cdpUrl: string; baseUrl: string } {
  const envelope = JSON.parse(value) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as { cdpUrl: string; baseUrl: string };
}

function safeDisplayUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

function safeTitle(raw: string): string {
  return raw
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .slice(0, 160);
}

type CdpReply = Record<string, unknown>;
type PendingCommand = { resolve: (value: CdpReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

class TinyFishCdp {
  private socket: WebSocket;
  private nextId = 0;
  private targetSessionId = "";
  private pending = new Map<number, PendingCommand>();
  private readonly ready: Promise<void>;
  private viewport = { width: 1280, height: 720 };
  private screencastStarted = false;
  private readonly frameListeners = new Set<(frame: { data: string; width: number; height: number; sentAt: number }) => void>();
  private lastFrameLogAt = 0;

  constructor(cdpUrl: string, readonly allowedDomain: string) {
    if (typeof WebSocket === "undefined") {
      throw new Error("This Node.js runtime does not provide WebSocket support for TinyFish Browser API sessions.");
    }
    this.socket = new WebSocket(cdpUrl);
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Could not connect to the remote browser session.")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("The remote browser session disconnected."));
      }
      this.pending.clear();
    });

    let pageTarget: Record<string, unknown> | undefined;
    let targetKinds: string[] = [];
    for (let attempt = 0; attempt < 4 && !pageTarget; attempt += 1) {
      const targets = await this.sendRaw("Target.getTargets", {});
      const infos = Array.isArray(targets.targetInfos) ? targets.targetInfos as Record<string, unknown>[] : [];
      targetKinds = infos
        .map((target) => typeof target.type === "string" ? target.type : "unknown")
        .slice(0, 10);
      pageTarget = infos.find((target) => target.type === "page");
      if (!pageTarget) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!pageTarget) {
      // TinyFish may return a valid blank browser session before exposing its
      // initial page target. Create a tab inside this same CDP browser session.
      const created = await this.sendRaw("Target.createTarget", { url: "about:blank" });
      if (typeof created.targetId === "string") {
        pageTarget = { targetId: created.targetId, type: "page" };
      }
    }
    if (!pageTarget || typeof pageTarget.targetId !== "string") {
      console.warn("TinyFish browser session did not expose or create a page target", { targetKinds });
      throw new Error("TinyFish created the browser session, but TRESTLE could not open a page in it. The session was closed; retry once, or end the stale session before retrying.");
    }
    const attached = await this.sendRaw("Target.attachToTarget", {
      targetId: pageTarget.targetId,
      flatten: true,
    });
    if (typeof attached.sessionId !== "string") throw new Error("Could not attach to the TinyFish browser page.");
    this.targetSessionId = attached.sessionId;
    await this.sendRaw("Page.enable", {}, this.targetSessionId);
    await this.sendRaw("Runtime.enable", {}, this.targetSessionId);
    await this.sendRaw("DOM.enable", {}, this.targetSessionId);
    await this.sendRaw("Fetch.enable", {
      patterns: [{ resourceType: "Document", requestStage: "Request" }],
    }, this.targetSessionId);
    const layout = await this.sendRaw("Page.getLayoutMetrics", {}, this.targetSessionId);
    const visual = layout.cssVisualViewport as { clientWidth?: number; clientHeight?: number } | undefined;
    this.viewport = {
      width: visual?.clientWidth || 1280,
      height: visual?.clientHeight || 720,
    };
  }

  private async handleMessage(data: unknown): Promise<void> {
    const raw = typeof data === "string"
      ? data
      : data instanceof Blob
      ? await data.text()
      : String(data);
    let message: { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: CdpReply; error?: { message?: string } };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }
    if (message.method === "Page.screencastFrame") {
      const params = message.params ?? {};
      const metadata = params.metadata as { deviceWidth?: number; deviceHeight?: number } | undefined;
      const frameData = params.data;
      if (typeof frameData === "string") {
        const frame = {
          data: frameData,
          width: metadata?.deviceWidth ?? this.viewport.width,
          height: metadata?.deviceHeight ?? this.viewport.height,
          sentAt: Date.now(),
        };
        for (const listener of this.frameListeners) listener(frame);
        if (frame.sentAt - this.lastFrameLogAt >= 1_000) {
          this.lastFrameLogAt = frame.sentAt;
          console.info("shared-browser streamed frame", {
            listeners: this.frameListeners.size,
            encodedBytes: Math.round(frameData.length * 0.75),
          });
        }
      }
      if (typeof params.sessionId === "number") {
        void this.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => undefined);
      }
    }
    if (message.method === "Fetch.requestPaused") {
      const params = message.params ?? {};
      const requestId = params.requestId;
      const request = params.request as { url?: unknown } | undefined;
      if (typeof requestId === "string" && typeof request?.url === "string") {
        void isAllowedNavigation(request.url, this.allowedDomain)
          .then((allowed) => this.sendRaw(
            allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
            allowed ? { requestId } : { requestId, errorReason: "BlockedByClient" },
            this.targetSessionId,
          ))
          .catch(() => this.sendRaw("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, this.targetSessionId).catch(() => undefined));
      }
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? "Remote browser command failed."));
    else pending.resolve(message.result ?? {});
  }

  private async sendRaw(method: string, params: Record<string, unknown>, sessionId?: string): Promise<CdpReply> {
    const id = ++this.nextId;
    return new Promise<CdpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The remote browser did not respond to a command."));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private async send(method: string, params: Record<string, unknown> = {}): Promise<CdpReply> {
    await this.ready;
    return this.sendRaw(method, params, this.targetSessionId);
  }

  async navigate(url: string): Promise<void> {
    if (!await isAllowedNavigation(url, this.allowedDomain)) {
      throw new Error(this.allowedDomain === "*"
        ? "Use a public HTTP or HTTPS website. Localhost, private IPs, and internal addresses are blocked."
        : `Navigation is restricted to the verified official domain ${this.allowedDomain}.`);
    }
    await this.send("Page.navigate", { url });
  }

  async screenshot(): Promise<{ data: string; width: number; height: number }> {
    const startedAt = performance.now();
    const shot = await this.send("Page.captureScreenshot", { format: "jpeg", quality: 45, fromSurface: true });
    if (typeof shot.data !== "string") throw new Error("The browser did not return a screenshot.");
    console.info("shared-browser capture", {
      elapsedMs: Math.round(performance.now() - startedAt),
      encodedBytes: Math.round(shot.data.length * 0.75),
    });
    return {
      data: shot.data,
      width: this.viewport.width,
      height: this.viewport.height,
    };
  }

  viewportSize(): { width: number; height: number } {
    return this.viewport;
  }

  async subscribeFrames(listener: (frame: { data: string; width: number; height: number; sentAt: number }) => void): Promise<() => void> {
    this.frameListeners.add(listener);
    if (!this.screencastStarted) {
      await this.send("Page.startScreencast", {
        format: "jpeg",
        quality: 45,
        maxWidth: 1440,
        maxHeight: 900,
        everyNthFrame: 3,
      });
      this.screencastStarted = true;
    }
    return () => this.frameListeners.delete(listener);
  }

  async metadata(): Promise<{ currentUrl: string | null; pageTitle: string; accessIssue: "blocked" | "challenge" | null }> {
    const response = await this.send("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const title = document.title || "";
        const text = (document.body?.innerText || "").slice(0, 5000);
        const blocked = /you have been blocked|access denied|request blocked|err_blocked_by_client/i.test(title + " " + text);
        const challenge = /attention required|checking your browser|verify you are human|cloudflare ray id|captcha/i.test(title + " " + text);
        return { url: location.href, title, accessIssue: blocked ? "blocked" : challenge ? "challenge" : null };
      })())`,
      returnByValue: true,
    });
    const result = response.result as { value?: unknown } | undefined;
    try {
      const value = JSON.parse(String(result?.value ?? "{}")) as { url?: string; title?: string; accessIssue?: "blocked" | "challenge" | null };
      return {
        currentUrl: value.url ? safeDisplayUrl(value.url) : null,
        pageTitle: safeTitle(value.title ?? ""),
        accessIssue: value.accessIssue === "blocked" || value.accessIssue === "challenge" ? value.accessIssue : null,
      };
    } catch {
      return { currentUrl: null, pageTitle: "", accessIssue: null };
    }
  }

  async inspectReportingForm(): Promise<{ formCount: number; requiredControlCount: number; captchaPresent: boolean }> {
    const response = await this.send("Runtime.evaluate", {
      expression: `JSON.stringify((() => ({
        formCount: document.forms.length,
        requiredControlCount: document.querySelectorAll('input[required], select[required], textarea[required], [aria-required="true"]').length,
        captchaPresent: Boolean(document.querySelector('[id*="captcha" i], [class*="captcha" i], iframe[title*="captcha" i], iframe[src*="captcha" i]'))
      }))())`,
      returnByValue: true,
    });
    const value = (response.result as { value?: unknown } | undefined)?.value;
    try {
      const parsed = JSON.parse(String(value ?? "{}")) as Record<string, unknown>;
      return {
        formCount: typeof parsed.formCount === "number" ? parsed.formCount : 0,
        requiredControlCount: typeof parsed.requiredControlCount === "number" ? parsed.requiredControlCount : 0,
        captchaPresent: parsed.captchaPresent === true,
      };
    } catch {
      throw new Error("The reporting page structure could not be checked safely.");
    }
  }

  async click(x: number, y: number): Promise<void> {
    // CDP preserves WebSocket message order. Sending these together avoids a
    // full remote round trip for every mouse phase while retaining press/release order.
    await Promise.all([
      this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
      this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }),
      this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }),
    ]);
  }

  async typeText(text: string): Promise<void> {
    await this.send("Input.insertText", { text });
  }

  async focusAt(x: number, y: number): Promise<void> {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async key(key: string): Promise<void> {
    const keyInfo: Record<string, { code: string; keyCode: number }> = {
      Enter: { code: "Enter", keyCode: 13 },
      Tab: { code: "Tab", keyCode: 9 },
      Backspace: { code: "Backspace", keyCode: 8 },
      Delete: { code: "Delete", keyCode: 46 },
      ArrowUp: { code: "ArrowUp", keyCode: 38 },
      ArrowDown: { code: "ArrowDown", keyCode: 40 },
      ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
      ArrowRight: { code: "ArrowRight", keyCode: 39 },
    };
    const info = keyInfo[key];
    if (!info) throw new Error("That key is not supported by the shared browser demo.");
    const base = { key, code: info.code, windowsVirtualKeyCode: info.keyCode, nativeVirtualKeyCode: info.keyCode };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async scroll(deltaY: number): Promise<void> {
    const metrics = await this.send("Page.getLayoutMetrics");
    const viewport = metrics.cssVisualViewport as { clientWidth?: number; clientHeight?: number } | undefined;
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round((viewport?.clientWidth ?? 1280) / 2),
      y: Math.round((viewport?.clientHeight ?? 720) / 2),
      deltaX: 0,
      deltaY,
    });
  }

  async continueDemo(): Promise<string> {
    const meta = await this.metadata();
    if (meta.currentUrl !== `${demoUrl}inputs`) {
      return "Agent inspected the shared page. For this proof of concept, the demo continuation is available on the harmless number-input test page.";
    }
    const doc = await this.send("DOM.getDocument", { depth: 0 });
    const root = doc.root as { nodeId?: number } | undefined;
    if (!root?.nodeId) throw new Error("The agent could not inspect the test page.");
    const queried = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=number]" });
    const nodeId = queried.nodeId;
    if (typeof nodeId !== "number" || nodeId === 0) throw new Error("The test input is not available on the current page.");
    const valueReply = await this.send("Runtime.evaluate", {
      expression: "document.querySelector('input[type=number]')?.value ?? ''",
      returnByValue: true,
    });
    const currentValue = String((valueReply.result as { value?: unknown } | undefined)?.value ?? "");
    if (!/^\d{1,6}$/.test(currentValue)) {
      throw new Error("Enter a harmless number in the test field before returning control to the agent.");
    }
    const nextValue = String(Number(currentValue) + 1);
    await this.send("DOM.focus", { nodeId });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    });
    await this.typeText(nextValue);
    return "Agent read the test field from this same browser session and updated it. No form was submitted.";
  }

  close(): void {
    try { this.socket.close(); } catch { /* already disconnected */ }
  }
}

function connectionFor(record: BrowserSessionRecord): TinyFishCdp {
  const navigationDomain = record.isTestMode ? "*" : record.allowedDomain ?? "";
  const current = connectionCache.get(record.id);
  if (current?.allowedDomain === navigationDomain) return current;
  if (current) {
    // Development sessions created before the open-public-site setting was
    // enabled can remain in the process cache after a hot reload. Reconnect
    // to the same persisted TinyFish session with the updated navigation
    // policy instead of keeping the old demo-domain-only guard.
    current.close();
    connectionCache.delete(record.id);
  }
  const secret = decryptConnection(record.encryptedConnection);
  const connection = new TinyFishCdp(secret.cdpUrl, navigationDomain);
  connectionCache.set(record.id, connection);
  return connection;
}

function publicState(record: BrowserSessionRecord): Omit<SharedBrowserSnapshot, "screenshot" | "viewport"> {
  return {
    sessionId: record.id,
    providerSessionId: record.providerSessionId,
    status: record.status,
    controlOwner: record.controlOwner as SharedBrowserSnapshot["controlOwner"],
    currentUrl: record.currentUrl,
    pageTitle: record.pageTitle,
    lastActivity: record.lastActivity,
    actionId: record.actionId,
    institution: record.institution,
    selectedUrl: record.selectedUrl ? safeDisplayUrl(record.selectedUrl) : null,
    selectionSource: record.selectionSource,
    selectionReason: record.selectionReason,
    isTestMode: record.isTestMode,
  };
}

async function waitForCreatedSession(caseId: string): Promise<BrowserSessionRecord | null> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId } });
    if (!row || row.status !== "connecting") return row as BrowserSessionRecord | null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId } }) as Promise<BrowserSessionRecord | null>;
}

export async function startOrReconnectSharedBrowser(caseId: string, options: { institution?: string; testMode?: boolean; developmentUrl?: string } = {}): Promise<SharedBrowserSnapshot> {
  const testMode = options.testMode === true;
  if (testMode && (process.env.NODE_ENV === "production" || process.env.TRESTLE_BROWSER_TEST_MODE !== "true")) {
    throw new Error("The harmless browser test site is disabled. Set TRESTLE_BROWSER_TEST_MODE=true in local development to enable it.");
  }
  const developmentMode = options.developmentUrl !== undefined;
  if (developmentMode && process.env.NODE_ENV === "production") {
    throw new Error("Custom website browsing is available only in local development.");
  }
  const existing = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId } }) as BrowserSessionRecord | null;
  if (existing) {
    if (existing.isTestMode !== testMode) {
      throw new Error("An existing browser session belongs to a different mode. End that session before opening the case website or the explicit development test site.");
    }
    if ((existing.selectionSource === "development_custom_url") !== developmentMode) {
      throw new Error("An existing browser session belongs to a different navigation mode. End that session before changing modes.");
    }
    if (!existing.allowedDomain || !existing.selectedUrl) {
      throw new Error("This older browser session has no verified case website selection. End it, then start a new case-aware session.");
    }
    if (existing.status === "connecting") {
      const created = await waitForCreatedSession(caseId);
      if (!created || created.status !== "active") throw new Error("The shared browser is still connecting. Wait a moment and retry.");
      return getSharedBrowserSnapshot(caseId) as Promise<SharedBrowserSnapshot>;
    }
    if (existing.status === "active") return getSharedBrowserSnapshot(caseId) as Promise<SharedBrowserSnapshot>;
    if (existing.status === "disconnected" && existing.activeLock === caseId) {
      try {
        const cdp = connectionFor(existing);
        const metadata = await cdp.metadata();
        const updated = await prisma.sharedBrowserSession.update({
          where: { id: existing.id },
          data: { status: "active", currentUrl: metadata.currentUrl, pageTitle: metadata.pageTitle, lastActivity: new Date().toISOString() },
        }) as BrowserSessionRecord;
        return { ...publicState(updated), screenshot: null, viewport: cdp.viewportSize() };
      } catch {
        connectionCache.get(existing.id)?.close();
        connectionCache.delete(existing.id);
        await prisma.sharedBrowserSession.update({ where: { id: existing.id }, data: { status: "expired", activeLock: null } });
        throw new Error("The previous TinyFish browser session has expired. Start a new demo session to create a replacement.");
      }
    }
    throw new Error("The existing remote session is disconnected. It was not replaced automatically; explicitly start a new demo session after reviewing the old run.");
  }
  let selection: WebsiteSelection;
  if (testMode) {
    selection = {
      actionId: "browser-development-test",
      actionTitle: "Browser interaction test",
      url: demoUrl,
      allowedDomain: "*",
      institution: null,
      source: "explicit_test_mode",
      reason: "Explicit development test mode. This site is unrelated to the case and is never selected for normal case work.",
    };
  } else if (developmentMode) {
    const url = await isSafeDevelopmentUrl(options.developmentUrl ?? "");
    if (!url) throw new Error("Enter a public HTTP or HTTPS website. Localhost, private IPs, and internal addresses are blocked.");
    selection = {
      actionId: "development-custom-website",
      actionTitle: "Development website check",
      url: url.toString(),
      allowedDomain: "*",
      institution: null,
      source: "development_custom_url",
      reason: "This URL was entered manually in local development. It is user-selected and is not evidence of an official source or completion.",
    };
  } else {
    const { getCase } = await import("./repository");
    const caseItem = await getCase(caseId);
    if (!caseItem) throw new Error("Case not found.");
    const resolution = resolveCaseWebsite({ caseItem, institution: options.institution });
    if (resolution.kind !== "selected") throw new Error(resolution.message);
    selection = resolution.selection;
  }

  const key = apiKey();
  if (!key) throw new Error("Set TINYFISH_API_KEY in the server environment to start the shared browser.");

  const localId = crypto.randomUUID();
  let row: BrowserSessionRecord;
  try {
    row = await prisma.sharedBrowserSession.create({
      data: {
        id: localId,
        caseId,
        providerSessionId: `pending-${localId}`,
        encryptedConnection: "pending",
        status: "connecting",
        controlOwner: testMode || selection.source === "official_reporting_directory" ? "agent" : "user",
        selectedUrl: selection.url,
        selectionSource: selection.source,
        selectionReason: selection.reason,
        actionId: selection.actionId,
        institution: selection.institution,
        allowedDomain: selection.allowedDomain,
        isTestMode: testMode,
        activeLock: caseId,
      },
    }) as BrowserSessionRecord;
  } catch {
    const raced = await waitForCreatedSession(caseId);
    if (raced?.status === "active") return getSharedBrowserSnapshot(caseId) as Promise<SharedBrowserSnapshot>;
    throw new Error("A shared browser session is already being created for this case.");
  }

  let providerSessionId: string | null = null;
  try {
    const response = await fetch(browserApiEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": key },
      body: JSON.stringify({ timeout_seconds: demoTimeoutSeconds }),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(`TinyFish Browser API rejected session creation (HTTP ${response.status}).`);
    if (typeof body?.session_id !== "string" || typeof body.cdp_url !== "string" || typeof body.base_url !== "string") {
      throw new Error("TinyFish returned an incomplete Browser API session response.");
    }
    providerSessionId = body.session_id;
    const cdpUrl = new URL(body.cdp_url);
    const baseUrl = new URL(body.base_url);
    if (cdpUrl.protocol !== "wss:" || baseUrl.protocol !== "https:") throw new Error("TinyFish returned an invalid remote browser connection URL.");
    const encryptedConnection = encryptConnection({ cdpUrl: cdpUrl.toString(), baseUrl: baseUrl.toString() });
    row = await prisma.sharedBrowserSession.update({
      where: { id: localId },
      data: {
        providerSessionId: body.session_id,
        encryptedConnection,
        status: "active",
        lastActivity: new Date().toISOString(),
      },
    }) as BrowserSessionRecord;
    const cdp = connectionFor(row);
    await cdp.navigate(selection.url);
    const metadata = await cdp.metadata();
    row = await prisma.sharedBrowserSession.update({
      where: { id: localId },
      data: { currentUrl: metadata.currentUrl, pageTitle: metadata.pageTitle, lastActivity: new Date().toISOString() },
    }) as BrowserSessionRecord;
    return { ...publicState(row), screenshot: null, viewport: cdp.viewportSize() };
  } catch (error) {
    connectionCache.get(localId)?.close();
    connectionCache.delete(localId);
    if (providerSessionId) {
      await fetch(`${browserApiEndpoint}/${encodeURIComponent(providerSessionId)}`, {
        method: "DELETE",
        headers: { "X-API-Key": key },
      }).catch(() => undefined);
    }
    await prisma.sharedBrowserSession.update({
      where: { id: localId },
      data: { status: "failed", activeLock: null },
    }).catch(() => undefined);
    throw error instanceof Error ? error : new Error("Could not start the TinyFish shared browser.");
  }
}

export async function getSharedBrowserSnapshot(caseId: string): Promise<SharedBrowserSnapshot | null> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId }, orderBy: { updatedAt: "desc" } }) as BrowserSessionRecord | null;
  if (!row) return null;
  if (row.status !== "active") return { ...publicState(row), screenshot: null, viewport: null };
  try {
    const cdp = connectionFor(row);
    const metadata = await cdp.metadata();
    const updated = await prisma.sharedBrowserSession.update({
      where: { id: row.id },
      data: {
        currentUrl: metadata.currentUrl,
        pageTitle: metadata.pageTitle,
      },
    }) as BrowserSessionRecord;
    return { ...publicState(updated), screenshot: null, viewport: cdp.viewportSize(), accessIssue: metadata.accessIssue };
  } catch {
    connectionCache.get(row.id)?.close();
    connectionCache.delete(row.id);
    const updated = await prisma.sharedBrowserSession.update({ where: { id: row.id }, data: { status: "disconnected" } }) as BrowserSessionRecord;
    return { ...publicState(updated), screenshot: null, viewport: null, notice: "Connection to the existing TinyFish browser was lost. Reconnect will use this session ID and will not create another session." };
  }
}

async function claimCommand(sessionId: string, expectedOwner?: string): Promise<BrowserSessionRecord> {
  const claimed = await prisma.sharedBrowserSession.updateMany({
    where: { id: sessionId, status: "active", commandClaimed: false, ...(expectedOwner ? { controlOwner: expectedOwner } : {}) },
    data: { commandClaimed: true },
  });
  if (claimed.count !== 1) throw new Error("The browser is busy or control changed. Wait briefly and try again.");
  return prisma.sharedBrowserSession.findUnique({ where: { id: sessionId } }) as Promise<BrowserSessionRecord>;
}

async function releaseCommand(sessionId: string): Promise<void> {
  await prisma.sharedBrowserSession.updateMany({ where: { id: sessionId }, data: { commandClaimed: false } });
}

async function withCommand<T>(sessionId: string, owner: "user" | "agent" | undefined, operation: (row: BrowserSessionRecord, cdp: TinyFishCdp) => Promise<T>, refreshMetadata = true): Promise<T> {
  const row = await claimCommand(sessionId, owner);
  try {
    const cdp = connectionFor(row);
    const result = await operation(row, cdp);
    const metadata = refreshMetadata ? await cdp.metadata() : null;
    await prisma.sharedBrowserSession.update({
      where: { id: row.id },
      data: {
        ...(metadata ? { currentUrl: metadata.currentUrl, pageTitle: metadata.pageTitle } : {}),
        lastActivity: new Date().toISOString(),
      },
    });
    return result;
  } finally {
    await releaseCommand(sessionId);
  }
}

export async function takeSharedBrowserControl(caseId: string, controlOwner: "user" | "agent" | "paused"): Promise<SharedBrowserSnapshot> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId, status: "active" } }) as BrowserSessionRecord | null;
  if (!row) throw new Error("There is no active shared browser session for this case.");
  const claimed = await prisma.sharedBrowserSession.updateMany({ where: { id: row.id, status: "active", commandClaimed: false }, data: { commandClaimed: true } });
  if (claimed.count !== 1) throw new Error("The browser is busy. Try switching control again in a moment.");
  try {
    await prisma.sharedBrowserSession.update({ where: { id: row.id }, data: { controlOwner, lastActivity: new Date().toISOString() } });
  } finally {
    await releaseCommand(row.id);
  }
  return getSharedBrowserSnapshot(caseId) as Promise<SharedBrowserSnapshot>;
}

export async function runSharedBrowserUserCommand(
  caseId: string,
  command: { type: "click"; x: number; y: number } | { type: "type"; text: string } | { type: "key"; key: string } | { type: "scroll"; deltaY: number } | { type: "navigate"; url: string },
): Promise<Omit<SharedBrowserSnapshot, "screenshot">> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId, status: "active" } }) as BrowserSessionRecord | null;
  if (!row) throw new Error("There is no active shared browser session.");
  const commandStartedAt = performance.now();
  await withCommand(row.id, "user", async (_session, cdp) => {
    if (command.type === "click") {
      if (command.x < 0 || command.y < 0 || command.x > 4096 || command.y > 4096) throw new Error("Click position is outside the browser viewport.");
      await cdp.click(command.x, command.y);
    } else if (command.type === "type") {
      if (command.text.length > 300) throw new Error("Text input is limited to 300 characters in this demo.");
      await cdp.typeText(command.text);
    } else if (command.type === "key") {
      await cdp.key(command.key);
    } else if (command.type === "scroll") {
      await cdp.scroll(Math.max(-1200, Math.min(1200, command.deltaY)));
    } else {
      await cdp.navigate(command.url);
    }
  }, command.type === "navigate");
  const updated = await prisma.sharedBrowserSession.findUnique({ where: { id: row.id } }) as BrowserSessionRecord;
  console.info("shared-browser input", {
    command: command.type,
    elapsedMs: Math.round(performance.now() - commandStartedAt),
    status: updated.status,
  });
  return { ...publicState(updated), viewport: connectionFor(updated).viewportSize() };
}

/** Refresh a bank/site selection after official domains or support URLs change,
 * keeping the same remote browser session and its user-control state. */
export async function refreshSharedBrowserOfficialSite(
  caseId: string,
  expectedOwner: "user" | "agent" = "user",
): Promise<SharedBrowserSnapshot> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId, status: "active" } }) as BrowserSessionRecord | null;
  if (!row) throw new Error("There is no active shared browser session.");
  if (row.isTestMode || row.selectionSource === "development_custom_url") {
    throw new Error("Refresh the official case destination only from a case browser session.");
  }
  if (row.controlOwner !== expectedOwner) throw new Error("Browser control changed; the official destination was not refreshed.");
  const claimed = await prisma.sharedBrowserSession.updateMany({
    where: { id: row.id, status: "active", controlOwner: expectedOwner, commandClaimed: false },
    data: { commandClaimed: true },
  });
  if (claimed.count !== 1) throw new Error("The browser is busy or control changed. Wait briefly and try again.");
  try {
    const { getCase } = await import("./repository");
    const caseItem = await getCase(caseId);
    if (!caseItem) throw new Error("Case not found.");
    const resolution = resolveCaseWebsite({ caseItem, institution: row.institution ?? undefined });
    if (resolution.kind !== "selected") throw new Error(resolution.message);

    connectionCache.get(row.id)?.close();
    connectionCache.delete(row.id);
    const updated = await prisma.sharedBrowserSession.update({
      where: { id: row.id },
      data: {
        selectedUrl: resolution.selection.url,
        selectionSource: resolution.selection.source,
        selectionReason: resolution.selection.reason,
        actionId: resolution.selection.actionId,
        institution: resolution.selection.institution,
        allowedDomain: resolution.selection.allowedDomain,
        lastActivity: new Date().toISOString(),
      },
    }) as BrowserSessionRecord;
    const cdp = connectionFor(updated);
    await cdp.navigate(resolution.selection.url);
    const metadata = await cdp.metadata();
    const finalRecord = await prisma.sharedBrowserSession.update({
      where: { id: row.id },
      data: { currentUrl: metadata.currentUrl, pageTitle: metadata.pageTitle, lastActivity: new Date().toISOString() },
    }) as BrowserSessionRecord;
    return { ...publicState(finalRecord), screenshot: null, viewport: cdp.viewportSize() };
  } finally {
    await releaseCommand(row.id);
  }
}

export async function getSharedBrowserFrame(caseId: string): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId }, orderBy: { updatedAt: "desc" } }) as BrowserSessionRecord | null;
  if (!row || row.status !== "active") return null;
  const frame = await connectionFor(row).screenshot();
  return { bytes: Buffer.from(frame.data, "base64"), width: frame.width, height: frame.height };
}

export async function subscribeSharedBrowserFrames(caseId: string, listener: (frame: { data: string; width: number; height: number; sentAt: number }) => void): Promise<() => void> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId, status: "active" } }) as BrowserSessionRecord | null;
  if (!row) throw new Error("There is no active shared browser session to stream.");
  const cdp = connectionFor(row);
  const unsubscribeCdp = await cdp.subscribeFrames(listener);
  return () => {
    unsubscribeCdp();
  };
}

export async function continueSharedBrowserWithAgent(caseId: string): Promise<{ snapshot: SharedBrowserSnapshot; message: string }> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId, status: "active" } }) as BrowserSessionRecord | null;
  if (!row) throw new Error("There is no active shared browser session.");
  const claimed = await prisma.sharedBrowserSession.updateMany({
    where: { id: row.id, status: "active", controlOwner: { in: ["user", "paused"] }, commandClaimed: false },
    data: { commandClaimed: true, controlOwner: "agent" },
  });
  if (claimed.count !== 1) throw new Error("Take control in the browser before returning it to the agent.");
  let message: string;
  try {
    if (row.selectionSource === "official_reporting_directory" && !row.isTestMode) {
      const cdp = connectionFor(row);
      const metadata = await cdp.metadata();
      const actualHost = metadata.currentUrl ? new URL(metadata.currentUrl).hostname.toLowerCase() : "";
      if (!actualHost || !(actualHost === row.allowedDomain || actualHost.endsWith(`.${row.allowedDomain}`))) {
        throw new Error("The current page is outside the selected official reporting domain. TRESTLE did not inspect it.");
      }
      const readiness = await cdp.inspectReportingForm();
      const currentPath = metadata.currentUrl ? new URL(metadata.currentUrl).pathname.replace(/\/$/, "") : "";
      message = actualHost === "trai.gov.in"
        ? currentPath === "/complain-or-report-against-ucc"
          ? "TRESTLE checked TRAI's official complaint/report instructions. This is not a form hosted by TRAI; it directs UCC complaints and reports through your telecom provider, including 1909 or an approved app. To open a provider-specific route, TRESTLE needs to know your mobile provider. No private data was read and nothing was submitted."
          : "TRESTLE checked the official TRAI UCC page. It is guidance, not a complaint form; UCC complaints go through your telecom provider, 1909, or the DND app. No private data was read and nothing was submitted."
        : readiness.formCount > 0
        ? `TRESTLE checked the live reporting page on ${actualHost}. It found ${readiness.formCount} form(s), ${readiness.requiredControlCount} required control(s), and ${readiness.captchaPresent ? "a CAPTCHA element" : "no CAPTCHA element detected"}. It did not read any field values, change the page, or submit. TRESTLE has control now; take control again whenever you need to edit the page.`
        : `TRESTLE checked the live official page on ${actualHost}. No web form was present on this page; it appears to be guidance only. It did not read private data or click anything. TRESTLE has control now; take control again whenever you need to edit the page.`;
      await prisma.sharedBrowserSession.update({ where: { id: row.id }, data: { lastActivity: new Date().toISOString() } });
    } else if (!row.isTestMode) {
      await prisma.sharedBrowserSession.update({ where: { id: row.id }, data: { controlOwner: "paused", lastActivity: new Date().toISOString() } });
      message = "Control handoff recorded. This TRESTLE version does not automate actions in this case browser; continue with the workflow manually. Authentication and consequential steps remain yours.";
    } else {
      const current = await connectionFor(row).metadata();
      if (current.currentUrl !== `${demoUrl}inputs`) {
        await prisma.sharedBrowserSession.update({ where: { id: row.id }, data: { controlOwner: "paused", lastActivity: new Date().toISOString() } });
        message = "Control handoff recorded. The fixed test interaction only runs on the harmless number-input test page; no agent automation ran on this website.";
      } else {
        message = await connectionFor(row).continueDemo();
      }
    }
    const metadata = await connectionFor(row).metadata();
    await prisma.sharedBrowserSession.update({
      where: { id: row.id },
      data: { currentUrl: metadata.currentUrl, pageTitle: metadata.pageTitle, lastActivity: new Date().toISOString() },
    });
  } finally {
    await releaseCommand(row.id);
  }
  const snapshot = await getSharedBrowserSnapshot(caseId);
  if (!snapshot) throw new Error("Shared browser session could not be reloaded.");
  return { snapshot, message };
}

/** Advance a TRESTLE-owned UCC session from the general TRAI landing page to
 * the official complaint/report instructions, without reading or submitting
 * any user data. */
export async function advanceSharedBrowserUccGuide(caseId: string): Promise<{ snapshot: SharedBrowserSnapshot; message: string }> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId, status: "active" } }) as BrowserSessionRecord | null;
  if (!row) throw new Error("There is no active shared browser session.");
  if (row.controlOwner !== "agent" || row.selectionSource !== "official_reporting_directory" || row.allowedDomain !== "trai.gov.in") {
    throw new Error("TRESTLE can only advance its own verified TRAI UCC session.");
  }
  const targetUrl = "https://trai.gov.in/complain-or-report-against-ucc";
  const cdp = connectionFor(row);
  const before = await cdp.metadata();
  const beforeUrl = before.currentUrl ? new URL(before.currentUrl) : null;
  if (beforeUrl?.hostname.toLowerCase() === "trai.gov.in" && beforeUrl.pathname.replace(/\/$/, "") === "/complain-or-report-against-ucc") {
    const snapshot = await getSharedBrowserSnapshot(caseId);
    if (!snapshot) throw new Error("The shared browser session could not be reloaded.");
    return { snapshot, message: "The shared browser is already on TRAI's official UCC complaint/report instructions." };
  }
  if (!beforeUrl || beforeUrl.hostname.toLowerCase() !== "trai.gov.in" || beforeUrl.pathname.replace(/\/$/, "") !== "/ucc") {
    throw new Error("TRESTLE did not navigate because the current page is not the expected TRAI UCC landing page.");
  }
  const claimed = await prisma.sharedBrowserSession.updateMany({
    where: { id: row.id, status: "active", controlOwner: "agent", commandClaimed: false },
    data: { commandClaimed: true },
  });
  if (claimed.count !== 1) throw new Error("The browser is busy or control changed. Wait briefly and try again.");
  try {
    await cdp.navigate(targetUrl);
    let metadata = await cdp.metadata();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const landed = metadata.currentUrl ? new URL(metadata.currentUrl) : null;
      if (landed?.hostname.toLowerCase() === "trai.gov.in" && landed.pathname.replace(/\/$/, "") === "/complain-or-report-against-ucc") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
      metadata = await cdp.metadata();
    }
    const landed = metadata.currentUrl ? new URL(metadata.currentUrl) : null;
    if (landed?.hostname.toLowerCase() !== "trai.gov.in" || landed.pathname.replace(/\/$/, "") !== "/complain-or-report-against-ucc") {
      throw new Error("TRAI's complaint/report instructions page did not finish loading. TRESTLE did not claim that it opened.");
    }
    const updated = await prisma.sharedBrowserSession.update({
      where: { id: row.id },
      data: {
        currentUrl: metadata.currentUrl,
        pageTitle: metadata.pageTitle,
        selectedUrl: targetUrl,
        selectionReason: "Official TRAI instructions explaining UCC complaints and reports and directing users to their telecom provider.",
        lastActivity: new Date().toISOString(),
      },
    }) as BrowserSessionRecord;
    return {
      snapshot: { ...publicState(updated), screenshot: null, viewport: cdp.viewportSize() },
      message: "TRESTLE opened TRAI's official complaint/report instructions in the same browser session. The page directs users to their telecom provider; TRESTLE needs that provider name before choosing a provider-specific site. No private values were read and nothing was submitted.",
    };
  } finally {
    await releaseCommand(row.id);
  }
}

export async function endSharedBrowserSession(caseId: string): Promise<SharedBrowserSnapshot> {
  const row = await prisma.sharedBrowserSession.findFirst({ where: { caseId, activeLock: caseId } }) as BrowserSessionRecord | null;
  if (!row) throw new Error("There is no active shared browser session for this case.");
  const key = apiKey();
  const response = await fetch(`${browserApiEndpoint}/${encodeURIComponent(row.providerSessionId)}`, {
    method: "DELETE",
    headers: { "X-API-Key": key },
  });
  if (response.status !== 204 && !response.ok) {
    throw new Error(`TinyFish did not confirm browser termination (HTTP ${response.status}). The session may still be active.`);
  }
  connectionCache.get(row.id)?.close();
  connectionCache.delete(row.id);
  const ended = await prisma.sharedBrowserSession.update({
    where: { id: row.id },
    data: { status: "closed", controlOwner: "paused", activeLock: null, commandClaimed: false },
  }) as BrowserSessionRecord;
  return { ...publicState(ended), screenshot: null, viewport: null };
}
