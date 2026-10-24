import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const values = [...rows.values()];
      return values.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: Record<string, unknown> = {
        commandClaimed: false,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(String(row.id), row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.get(where.id);
      if (!row) throw new Error("missing row");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of rows.values()) {
        const matches = Object.entries(where).every(([key, value]) => {
          if (key === "controlOwner" && value && typeof value === "object" && "in" in value) {
            return (value as { in: unknown[] }).in.includes(row[key]);
          }
          return row[key] === value;
        });
        if (matches) {
          Object.assign(row, data, { updatedAt: new Date() });
          count += 1;
        }
      }
      return { count };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
vi.mock("./db", () => ({ prisma: { sharedBrowserSession: database } }));
vi.mock("./repository", () => ({
  getCase: vi.fn(async () => ({
    id: "case-real",
    title: "Lost credit card",
    description: "Find safe next steps.",
    originalInput: "I lost my ICICI Bank credit card.",
    actions: [{
      id: "secure-card", caseId: "case-real", sequence: 0,
      title: "Secure lost credit card", description: "Contact the card issuer.",
      status: "ready", priority: "high", dependencies: [], requiredInputs: [],
      riskLevel: "high", approvalRequired: true, successCriteria: [], evidence: [],
      executionMode: "manual", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }],
  })),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static sentMethods: Array<{ method: string; params: Record<string, unknown> }> = [];
  static omitInitialPageTarget = false;
  private listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(raw: string) {
    const request = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    FakeWebSocket.sentMethods.push({ method: request.method, params: request.params });
    let result: Record<string, unknown> = {};
    if (request.method === "Target.getTargets") {
      result = { targetInfos: FakeWebSocket.omitInitialPageTarget ? [] : [{ targetId: "page-1", type: "page" }] };
    } else if (request.method === "Target.createTarget") {
      result = { targetId: "created-page-1" };
    } else if (request.method === "Target.attachToTarget") {
      result = { sessionId: "target-session-1" };
    } else if (request.method === "Page.getLayoutMetrics") {
      result = { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } };
    } else if (request.method === "Page.captureScreenshot") {
      result = { data: Buffer.from("actual-frame-bytes").toString("base64") };
    } else if (request.method === "Runtime.evaluate") {
      const expression = String(request.params.expression ?? "");
      const value = expression.includes("location.href")
        ? JSON.stringify({ url: "https://the-internet.herokuapp.com/inputs", title: "Inputs" })
        : expression.includes("input[type=number]")
        ? "41"
        : "";
      result = { result: { value } };
    } else if (request.method === "DOM.getDocument") {
      result = { root: { nodeId: 1 } };
    } else if (request.method === "DOM.querySelector") {
      result = { nodeId: 2 };
    }
    queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id: request.id, result }) }));
    if (request.method === "Page.startScreencast") {
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({
        method: "Page.screencastFrame",
        sessionId: "target-session-1",
        params: { data: Buffer.from("stream-frame").toString("base64"), sessionId: 7, metadata: { deviceWidth: 1280, deviceHeight: 720 } },
      }) }));
    }
  }

  close() {
    this.emit("close", {});
  }

  emitCdp(method: string, params: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify({ method, params, sessionId: "target-session-1" }) });
  }

  private emit(type: string, event: { data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("TinyFish shared browser proof of concept", () => {
  beforeEach(() => {
    database.rows.clear();
    vi.clearAllMocks();
    FakeWebSocket.instances = [];
    FakeWebSocket.sentMethods = [];
    FakeWebSocket.omitInitialPageTarget = false;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      session_id: "tinyfish-session-1",
      cdp_url: "wss://tf-session.tinyfish.io/cdp/private-token",
      base_url: "https://tf-session.tinyfish.io",
    }, { status: 201 })));
    process.env.TINYFISH_API_KEY = "test-only-browser-key";
    process.env.TRESTLE_BROWSER_TEST_MODE = "true";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates one remote session and reuses it after refresh without exposing CDP credentials", async () => {
    const browser = await import("./sharedBrowser");
    const first = await browser.startOrReconnectSharedBrowser("case-one", { testMode: true });
    const second = await browser.startOrReconnectSharedBrowser("case-one", { testMode: true });

    expect(first.providerSessionId).toBe("tinyfish-session-1");
    expect(fetch).toHaveBeenCalledWith("https://api.browser.tinyfish.ai", expect.objectContaining({
      body: expect.not.stringContaining("https://the-internet.herokuapp.com/"),
    }));
    expect(second.sessionId).toBe(first.sessionId);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain("private-token");
    expect(JSON.stringify(database.rows.get(first.sessionId))).not.toContain("private-token");
    expect(first.screenshot).toBeNull();
    expect((await browser.getSharedBrowserFrame("case-one"))?.bytes.toString()).toBe("actual-frame-bytes");
  });

  it("serializes user takeover and agent continuation on the same page session", async () => {
    const browser = await import("./sharedBrowser");
    const started = await browser.startOrReconnectSharedBrowser("case-two", { testMode: true });
    await expect(browser.runSharedBrowserUserCommand("case-two", { type: "type", text: "41" }))
      .rejects.toThrow("busy or control changed");

    await browser.takeSharedBrowserControl("case-two", "user");
    const methodStart = FakeWebSocket.sentMethods.length;
    await browser.runSharedBrowserUserCommand("case-two", { type: "click", x: 100, y: 120 });
    await browser.runSharedBrowserUserCommand("case-two", { type: "click", x: 104, y: 122 });
    await browser.runSharedBrowserUserCommand("case-two", { type: "type", text: "41" });
    await browser.runSharedBrowserUserCommand("case-two", { type: "scroll", deltaY: 250 });
    await browser.runSharedBrowserUserCommand("case-two", { type: "navigate", url: "https://the-internet.herokuapp.com/inputs" });
    const clickEvents = FakeWebSocket.sentMethods.slice(methodStart).filter((item) => item.method === "Input.dispatchMouseEvent");
    expect(clickEvents.map((item) => item.params.type).slice(0, 3)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(clickEvents[1]?.params).toMatchObject({ x: 100, y: 120, button: "left" });
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Input.insertText" && item.params.text === "41")).toBe(true);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === "https://the-internet.herokuapp.com/inputs")).toBe(true);
    const continued = await browser.continueSharedBrowserWithAgent("case-two");

    expect(continued.snapshot.providerSessionId).toBe(started.providerSessionId);
    expect(continued.snapshot.controlOwner).toBe("agent");
    expect(continued.message).toContain("same browser session");
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("streams actual CDP screencast frames from the existing session", async () => {
    const browser = await import("./sharedBrowser");
    await browser.startOrReconnectSharedBrowser("case-stream", { testMode: true });
    const received: string[] = [];
    const unsubscribe = await browser.subscribeSharedBrowserFrames("case-stream", (frame) => received.push(Buffer.from(frame.data, "base64").toString()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual(["stream-frame"]);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.startScreencast")).toBe(true);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.screencastFrameAck")).toBe(true);
    unsubscribe();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("allows other public sites in explicit development mode but blocks private destinations", async () => {
    const browser = await import("./sharedBrowser");
    await browser.startOrReconnectSharedBrowser("case-three", { testMode: true });
    await browser.takeSharedBrowserControl("case-three", "user");

    await browser.runSharedBrowserUserCommand("case-three", {
      type: "navigate",
      url: "https://delhipolice.gov.in/",
    });
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === "https://delhipolice.gov.in/")).toBe(true);

    await expect(browser.runSharedBrowserUserCommand("case-three", {
      type: "navigate",
      url: "http://127.0.0.1:3000/",
    })).rejects.toThrow("public HTTP or HTTPS website");
  });

  it("reconnects the same remote session when its persisted navigation policy changes", async () => {
    const browser = await import("./sharedBrowser");
    const started = await browser.startOrReconnectSharedBrowser("case-stale-guard", { testMode: true });
    const row = database.rows.get(started.sessionId);
    expect(row).toBeDefined();
    if (!row) return;
    row.isTestMode = false;
    row.allowedDomain = "the-internet.herokuapp.com";

    await browser.getSharedBrowserSnapshot("case-stale-guard");
    expect(row.providerSessionId).toBe("tinyfish-session-1");
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("creates the browser at blank before navigating within the selected domain", async () => {
    const browser = await import("./sharedBrowser");
    await browser.startOrReconnectSharedBrowser("case-guard", { testMode: true });
    const createCall = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(createCall?.[1]?.body))).not.toHaveProperty("url");
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Fetch.enable")).toBe(true);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === "https://the-internet.herokuapp.com/")).toBe(true);
  });

  it("opens the case-resolved official page in the same new browser session", async () => {
    const browser = await import("./sharedBrowser");
    const snapshot = await browser.startOrReconnectSharedBrowser("case-real");
    expect(snapshot.actionId).toBe("secure-card");
    expect(snapshot.institution).toBe("ICICI Bank");
    expect(snapshot.selectedUrl).toBe("https://www.icici.bank.in/personal-banking/cards/credit-card/block-credit-card");
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === snapshot.selectedUrl)).toBe(true);
    expect(snapshot.controlOwner).toBe("user");
  });

  it("refreshes a persisted official bank destination without creating a second remote session", async () => {
    const browser = await import("./sharedBrowser");
    const started = await browser.startOrReconnectSharedBrowser("case-real");
    const row = database.rows.get(started.sessionId);
    expect(row).toBeDefined();
    if (!row) return;
    row.institution = "SBI debit card";

    const refreshed = await browser.refreshSharedBrowserOfficialSite("case-real");

    expect(refreshed.providerSessionId).toBe(started.providerSessionId);
    expect(refreshed.institution).toBe("State Bank of India");
    expect(refreshed.selectedUrl).toBe("https://sbi.bank.in/web/faq-s/faq-atm-services");
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === refreshed.selectedUrl)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("creates a missing blank page target within the existing TinyFish session", async () => {
    FakeWebSocket.omitInitialPageTarget = true;
    const browser = await import("./sharedBrowser");
    const snapshot = await browser.startOrReconnectSharedBrowser("case-real");
    expect(snapshot.providerSessionId).toBe("tinyfish-session-1");
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Target.createTarget" && item.params.url === "about:blank")).toBe(true);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === snapshot.selectedUrl)).toBe(true);
  });

  it("opens and navigates an explicitly supplied public URL in development mode", async () => {
    const browser = await import("./sharedBrowser");
    const snapshot = await browser.startOrReconnectSharedBrowser("case-real", { developmentUrl: "https://example.com/demo?token=private" });
    expect(snapshot.selectionSource).toBe("development_custom_url");
    expect(snapshot.selectedUrl).toBe("https://example.com/demo");
    expect(JSON.stringify(snapshot)).not.toContain("token=private");
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === "https://example.com/demo?token=private")).toBe(true);

    await browser.runSharedBrowserUserCommand("case-real", { type: "navigate", url: "https://other.com/path" });
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.navigate" && item.params.url === "https://other.com/path")).toBe(true);
    await expect(browser.runSharedBrowserUserCommand("case-real", { type: "navigate", url: "http://127.0.0.1:3000/" }))
      .rejects.toThrow("public HTTP or HTTPS website");
  });

  it("blocks redirected document requests outside the selected domain", async () => {
    const browser = await import("./sharedBrowser");
    await browser.startOrReconnectSharedBrowser("case-real");
    FakeWebSocket.instances[0].emitCdp("Fetch.requestPaused", {
      requestId: "redirected-document",
      request: { url: "https://attacker.example/collect", resourceType: "Document" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Fetch.failRequest" && item.params.requestId === "redirected-document")).toBe(true);
  });
});
