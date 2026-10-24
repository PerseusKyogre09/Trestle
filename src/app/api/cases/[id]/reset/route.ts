import { NextResponse } from "next/server";
import { resetCaseForDemo } from "../../../../../server/repository";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reset = await resetCaseForDemo(id);

  if (!reset) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
