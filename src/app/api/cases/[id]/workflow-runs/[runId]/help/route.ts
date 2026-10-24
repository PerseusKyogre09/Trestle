import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkflowRun } from "../../../../../../../server/repository";
import { helpWithWorkflow } from "../../../../../../../server/workflowOrchestrator";

const helpSchema = z.object({ question: z.string().trim().min(1).max(500) }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const run = await getWorkflowRun(runId);
  if (!run || run.caseId !== id) return NextResponse.json({ error: "Workflow run not found." }, { status: 404 });
  const parsed = helpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a short question without personal information." }, { status: 400 });

  try {
    return NextResponse.json(await helpWithWorkflow(runId, parsed.data.question));
  } catch {
    return NextResponse.json({ error: "Unable to prepare workflow guidance." }, { status: 500 });
  }
}
