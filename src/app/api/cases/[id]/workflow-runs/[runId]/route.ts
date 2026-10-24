import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkflowRun } from "../../../../../../server/repository";
import { pauseWorkflow, resumeWorkflow } from "../../../../../../server/workflowOrchestrator";

const controlSchema = z.object({
  action: z.enum(["pause", "resume"]),
  mode: z.enum(["autonomous", "guided"]).optional(),
}).strict();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const run = await getWorkflowRun(runId);
  if (!run || run.caseId !== id) return NextResponse.json({ error: "Workflow run not found." }, { status: 404 });
  return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const run = await getWorkflowRun(runId);
  if (!run || run.caseId !== id) return NextResponse.json({ error: "Workflow run not found." }, { status: 404 });
  const parsed = controlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose pause or resume." }, { status: 400 });

  const updated = parsed.data.action === "pause"
    ? await pauseWorkflow(runId)
    : await resumeWorkflow(runId, parsed.data.mode ?? run.mode);
  return NextResponse.json(updated);
}
