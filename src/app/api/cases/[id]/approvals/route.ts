import { NextResponse } from "next/server";
import { getApprovalsForCase } from "../../../../../server/approvalService";
import { getCase } from "../../../../../server/repository";
import type { ApprovalStatus } from "../../../../../domain/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const caseItem = await getCase(id);
  if (!caseItem) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const actionId = searchParams.get("actionId") || undefined;
  const status = (searchParams.get("status") as ApprovalStatus) || undefined;

  try {
    const approvals = await getApprovalsForCase(id, { actionId, status });
    return NextResponse.json(approvals);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to retrieve approvals." },
      { status: 500 }
    );
  }
}
