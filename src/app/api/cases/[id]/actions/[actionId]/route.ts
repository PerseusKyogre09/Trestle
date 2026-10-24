import { NextResponse } from "next/server";
import { getCase } from "../../../../../../server/repository";
import { assertTransition } from "../../../../../../domain/engine";
import { transitionSchema } from "../../../../../../domain/validation";
import { updateAction } from "../../../../../../server/repository";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; actionId: string }> }) {
  const { id, actionId } = await params; const item = await getCase(id); const action = item?.actions.find((a) => a.id === actionId);
  if (!item || !action) return NextResponse.json({ error: "Action not found in this case." }, { status: 404 });
  const body = transitionSchema.safeParse(await request.json().catch(() => null)); if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const blocked = action.dependencies.some((d) => item.actions.find((a) => a.id === d)?.status !== "completed"); if (body.data.status !== "failed" && blocked) return NextResponse.json({ error: "This action is blocked by incomplete prerequisites." }, { status: 409 });
  try { assertTransition(action.status, body.data.status, body.data.evidence); return NextResponse.json(await updateAction(actionId, body.data.status, body.data.evidence)); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid transition." }, { status: 409 }); }
}
