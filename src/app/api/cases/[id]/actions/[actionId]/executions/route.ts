import { NextResponse } from "next/server";
import { getCase, getExecutionAttemptsByActionId } from "../../../../../../../server/repository";

export async function GET(
  _request: Request,
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

  try {
    const attempts = await getExecutionAttemptsByActionId(actionId);
    return NextResponse.json(attempts);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to retrieve execution records." },
      { status: 500 }
    );
  }
}
