import { NextResponse } from "next/server";
import { z } from "zod";
import { createResearchBrief } from "../../../../../server/privacyBoundary";
import { getCase } from "../../../../../server/repository";
import { listWorkflowRunsWithRecovery, startWorkflow } from "../../../../../server/workflowOrchestrator";

const startSchema = z.object({
  mode: z.enum(["autonomous", "guided"]).default("autonomous"),
  jurisdiction: z.string().trim().min(1).max(80),
  documentType: z.string().trim().min(1).max(100),
}).strict();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const caseItem = await getCase(id);
  if (!caseItem) return NextResponse.json({ error: "Case not found." }, { status: 404 });
  return NextResponse.json(await listWorkflowRunsWithRecovery(id), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const caseItem = await getCase(id);
  if (!caseItem) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid workflow start request." }, { status: 400 });
  }
  const safeContext = createResearchBrief(parsed.data.jurisdiction, parsed.data.documentType);
  if (!safeContext) {
    return NextResponse.json({ error: "Use only a general jurisdiction and document type. Do not enter names, document numbers, or private values." }, { status: 400 });
  }

  try {
    const result = await startWorkflow(id, { ...parsed.data, ...safeContext });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: "Unable to start the workflow." }, { status: 500 });
  }
}
