import { getCase } from "../../../../../../server/repository";
import { subscribeSharedBrowserFrames } from "../../../../../../server/sharedBrowser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localRequestAllowed(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const host = request.headers.get("host")?.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase();
  return Boolean(host && ["localhost", "127.0.0.1", "::1"].includes(host));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!localRequestAllowed(request)) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!await getCase(id)) return new Response("Case not found", { status: 404 });

  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, value: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
        } catch {
          // The request was closed while a frame was being delivered.
        }
      };
      try {
        unsubscribe = await subscribeSharedBrowserFrames(id, (frame) => {
          send("frame", frame);
        });
        send("status", { state: "connected" });
        heartbeat = setInterval(() => send("heartbeat", { at: Date.now() }), 15_000);
      } catch (error) {
        send("error", { message: error instanceof Error ? error.message : "Could not connect to the browser frame stream." });
        controller.close();
      }
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  request.signal.addEventListener("abort", () => {
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  }, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
