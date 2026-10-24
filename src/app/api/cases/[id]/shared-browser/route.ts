import { NextResponse } from "next/server";
import { z } from "zod";
import { getCase } from "../../../../../server/repository";
import {
  continueSharedBrowserWithAgent,
  endSharedBrowserSession,
  getSharedBrowserSnapshot,
  runSharedBrowserUserCommand,
  startOrReconnectSharedBrowser,
  takeSharedBrowserControl,
} from "../../../../../server/sharedBrowser";

export const runtime = "nodejs";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("take-control") }).strict(),
  z.object({ action: z.literal("pause-agent") }).strict(),
  z.object({ action: z.literal("return-to-agent") }).strict(),
  z.object({ action: z.literal("end") }).strict(),
  z.object({ action: z.literal("click"), x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ action: z.literal("type"), text: z.string().max(300) }).strict(),
  z.object({ action: z.literal("key"), key: z.enum(["Enter", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) }).strict(),
  z.object({ action: z.literal("scroll"), deltaY: z.number().int().min(-1200).max(1200) }).strict(),
  z.object({ action: z.literal("navigate"), url: z.string().url().max(1500) }).strict(),
]);

function localRequestAllowed(request: Request, requireSameOrigin: boolean): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const host = request.headers.get("host")?.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || !["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  if (!requireSameOrigin) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === request.headers.get("host")?.toLowerCase();
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!localRequestAllowed(request, false)) return NextResponse.json({ error: "Shared browser is available only from local development." }, { status: 404 });
  const { id } = await params;
  if (!await getCase(id)) return NextResponse.json({ error: "Case not found." }, { status: 404 });
  try {
    const snapshot = await getSharedBrowserSnapshot(id);
    return NextResponse.json(snapshot ? { ...snapshot, screenshot: null } : null, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load the shared browser session." }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!localRequestAllowed(request, true)) return NextResponse.json({ error: "Shared browser commands require a same-origin local development request." }, { status: 404 });
  const { id } = await params;
  if (!await getCase(id)) return NextResponse.json({ error: "Case not found." }, { status: 404 });
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid shared browser command." }, { status: 400 });

  try {
    const command = parsed.data;
    if (command.action === "start") {
      const snapshot = await startOrReconnectSharedBrowser(id);
      return NextResponse.json({ ...snapshot, screenshot: null });
    }
    if (command.action === "take-control") return NextResponse.json(await takeSharedBrowserControl(id, "user"));
    if (command.action === "pause-agent") return NextResponse.json(await takeSharedBrowserControl(id, "paused"));
    if (command.action === "return-to-agent") return NextResponse.json(await continueSharedBrowserWithAgent(id));
    if (command.action === "end") return NextResponse.json(await endSharedBrowserSession(id));
    const { action: type, ...args } = command;
    const startedAt = performance.now();
    const snapshot = await runSharedBrowserUserCommand(id, { type, ...args } as Parameters<typeof runSharedBrowserUserCommand>[1]);
    const response = NextResponse.json({ ...snapshot, screenshot: null }, {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": `browser-command;dur=${Math.round(performance.now() - startedAt)}`,
      },
    });
    console.info("shared-browser response", {
      command: type,
      elapsedMs: Math.round(performance.now() - startedAt),
      jsonBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shared browser command failed.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
