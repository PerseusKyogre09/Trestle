import { NextResponse } from "next/server";
import { executeActionSchema } from "../../../../../../../domain/validation";
import {
  executionController,
  ExecutionControllerError,
} from "../../../../../../../server/execution/controller";
import { resumeAfterUserAction } from "../../../../../../../server/workflowOrchestrator";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; actionId: string }> },
) {
  const { id, actionId } = await params;
  const rawJson = await request.json().catch(() => ({}));
  const parsed = executeActionSchema.safeParse(rawJson);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ??
          "Invalid execution parameters.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await executionController.execute(id, actionId, {
      // Operation details are derived from the persisted action and approval
      // inside the controller. Client-supplied operation fields are ignored.
      providerName: parsed.data.provider,
    });
    if (result.outcome === "verified") await resumeAfterUserAction(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ExecutionControllerError) {
      return NextResponse.json({ error: error.message }, {
        status: error.statusCode,
      });
    }
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Execution failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
