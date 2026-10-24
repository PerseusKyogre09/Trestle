import { NextResponse } from "next/server";
import { getCase } from "../../../../../../server/repository";
import { getSharedBrowserFrame } from "../../../../../../server/sharedBrowser";

export const runtime = "nodejs";

function localRequestAllowed(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const host = request.headers.get("host")?.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase();
  return Boolean(host && ["localhost", "127.0.0.1", "::1"].includes(host));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: "Shared browser is available only from local development." }, { status: 404 });
  const { id } = await params;
  if (!await getCase(id)) return NextResponse.json({ error: "Case not found." }, { status: 404 });
  const startedAt = performance.now();
  try {
    const frame = await getSharedBrowserFrame(id);
    if (!frame) return NextResponse.json({ error: "No active browser frame is available." }, { status: 409 });
    const response = new NextResponse(new Uint8Array(frame.bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Browser-Width": String(frame.width),
        "X-Browser-Height": String(frame.height),
        "Server-Timing": `capture;dur=${Math.round(performance.now() - startedAt)}`,
      },
    });
    console.info("shared-browser frame delivery", {
      elapsedMs: Math.round(performance.now() - startedAt),
      bytes: frame.bytes.byteLength,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Could not capture the live browser frame." }, { status: 503 });
  }
}
