import { NextResponse } from "next/server";
import { decideApprovalSchema } from "../../../../../../../domain/validation";
import {
  ApprovalError,
  approveRequest,
  rejectRequest,
} from "../../../../../../../server/approvalService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; approvalId: string }> }
) {
  const { id, approvalId } = await params;
  const rawJson = await request.json().catch(() => null);
  const parsed = decideApprovalSchema.safeParse(rawJson);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid decision payload." },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.decision === "approve") {
      const updated = await approveRequest(id, approvalId, {
        decidedBy: parsed.data.decidedBy ?? "user",
        notes: parsed.data.notes,
      });
      return NextResponse.json(updated);
    } else {
      const updated = await rejectRequest(id, approvalId, {
        decidedBy: parsed.data.decidedBy ?? "user",
        reason: parsed.data.reason ?? parsed.data.notes,
      });
      return NextResponse.json(updated);
    }
  } catch (error) {
    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record approval decision." },
      { status: 500 }
    );
  }
}
