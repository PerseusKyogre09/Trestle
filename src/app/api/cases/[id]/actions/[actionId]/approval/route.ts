import { NextResponse } from "next/server";
import { requestApprovalSchema } from "../../../../../../../domain/validation";
import { ApprovalError, requestApproval } from "../../../../../../../server/approvalService";
import { getCase } from "../../../../../../../server/repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const { id, actionId } = await params;
  const caseItem = await getCase(id);
  if (!caseItem) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  const action = caseItem.actions.find((a) => a.id === actionId);
  if (!action) {
    return NextResponse.json({ error: "Action not found in this case." }, { status: 404 });
  }

  const rawJson = await request.json().catch(() => null);
  const parsed = requestApprovalSchema.safeParse(rawJson);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid approval request." },
      { status: 400 }
    );
  }

  try {
    const approval = await requestApproval(
      id,
      actionId,
      parsed.data.operation,
      parsed.data.expiresInSeconds
    );
    return NextResponse.json(approval, { status: 201 });
  } catch (error) {
    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create approval request." },
      { status: 500 }
    );
  }
}
