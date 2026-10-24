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
vi.mock("./db", () => ({ prisma: { sharedBrowserSession: database } }));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static sentMethods: Array<{ method: string; params: Record<string, unknown> }> = [];
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
      result = { targetInfos: [{ targetId: "page-1", type: "page" }] };
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
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      session_id: "tinyfish-session-1",
      cdp_url: "wss://tf-session.tinyfish.io/cdp/private-token",
      base_url: "https://tf-session.tinyfish.io",
    }, { status: 201 })));
    process.env.TINYFISH_API_KEY = "test-only-browser-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates one remote session and reuses it after refresh without exposing CDP credentials", async () => {
    const browser = await import("./sharedBrowser");
    const first = await browser.startOrReconnectSharedBrowser("case-one");
    const second = await browser.startOrReconnectSharedBrowser("case-one");

    expect(first.providerSessionId).toBe("tinyfish-session-1");
    expect(fetch).toHaveBeenCalledWith("https://api.browser.tinyfish.ai", expect.objectContaining({
      body: expect.stringContaining("https://the-internet.herokuapp.com/"),
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
    const started = await browser.startOrReconnectSharedBrowser("case-two");
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
    await browser.startOrReconnectSharedBrowser("case-stream");
    const received: string[] = [];
    const unsubscribe = await browser.subscribeSharedBrowserFrames("case-stream", (frame) => received.push(Buffer.from(frame.data, "base64").toString()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual(["stream-frame"]);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.startScreencast")).toBe(true);
    expect(FakeWebSocket.sentMethods.some((item) => item.method === "Page.screencastFrameAck")).toBe(true);
    unsubscribe();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("rejects direct navigation away from the harmless public test site", async () => {
    const browser = await import("./sharedBrowser");
    await browser.startOrReconnectSharedBrowser("case-three");
    await browser.takeSharedBrowserControl("case-three", "user");

    await expect(browser.runSharedBrowserUserCommand("case-three", {
      type: "navigate",
      url: "https://example.com/",
    })).rejects.toThrow("restricted to the public harmless test site");
  });
});
