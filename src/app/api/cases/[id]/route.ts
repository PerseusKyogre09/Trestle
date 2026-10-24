import { NextResponse } from "next/server";
import { getCase } from "../../../../server/repository";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const item = await getCase((await params).id);
  return item
    ? NextResponse.json(item)
    : NextResponse.json({ error: "Case not found." }, { status: 404 });
}
