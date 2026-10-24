import { NextResponse } from "next/server";
import { assertTransition } from "../../../../../../domain/engine";
import { transitionSchema } from "../../../../../../domain/validation";
import { getCase, updateAction } from "../../../../../../server/repository";
import { resumeAfterUserAction } from "../../../../../../server/workflowOrchestrator";
import { invalidateApproval } from "../../../../../../server/approvalService";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; actionId: string }> },
) {
  const { id, actionId } = await params;
  const item = await getCase(id);
  const action = item?.actions.find((a) => a.id === actionId);

  if (!item || !action) {
    return NextResponse.json({ error: "Action not found in this case." }, {
      status: 404,
    });
  }

  const body = transitionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: body.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  // Enforce server-side security rule:
  // "Do not allow the client to set an action to approved or completed by directly editing arbitrary fields."
  const manualUserReport = action.executionMode !== "automated" &&
    body.data.status === "completed" &&
    body.data.evidence?.kind === "user_provided" &&
    body.data.evidence.note.startsWith("User reports:") &&
    body.data.evidence.note.trim().length >= 3;
  if (
    body.data.status === "completed" &&
    (action.approvalRequired || ["high", "critical"].includes(action.riskLevel)) &&
    !manualUserReport
  ) {
    return NextResponse.json(
      {
        error:
          "Actions requiring human approval cannot be directly marked completed via manual transition. Use the execution controller with verified authorization.",
      },
      { status: 403 },
    );
  }

  const blocked = action.dependencies.some(
    (d) => item.actions.find((a) => a.id === d)?.status !== "completed",
  );
  if (body.data.status !== "failed" && blocked) {
    return NextResponse.json(
      { error: "This action is blocked by incomplete prerequisites." },
      { status: 409 },
    );
  }

  try {
    assertTransition(action.status, body.data.status, body.data.evidence);
    const updated = await updateAction(
      actionId,
      body.data.status,
      body.data.evidence,
    );
    if (body.data.status === "completed") {
      if (manualUserReport) {
        for (const approval of action.approvals ?? []) {
          if (["pending", "approved"].includes(approval.status)) {
            await invalidateApproval(id, approval.id, "The user reported completing this action personally.");
          }
        }
      }
      await resumeAfterUserAction(id);
    }
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid transition." },
      { status: 409 },
    );
  }
}
