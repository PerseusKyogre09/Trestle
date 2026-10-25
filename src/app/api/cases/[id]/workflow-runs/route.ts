import { NextResponse } from "next/server";
import { z } from "zod";
import { createPlanningBrief, createResearchBrief, isReadOnlyResearchStep } from "../../../../../server/privacyBoundary";
import { getCase } from "../../../../../server/repository";
import { listWorkflowRunsWithRecovery, startWorkflow } from "../../../../../server/workflowOrchestrator";

const startSchema = z.object({
  mode: z.enum(["autonomous", "guided"]).default("autonomous"),
  jurisdiction: z.string().trim().max(80),
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
  const caseBrief = createPlanningBrief(caseItem.originalInput);
  const propertyLocationPending = caseBrief.ok && caseBrief.brief.eventType === "property_purchase" && !caseBrief.brief.jurisdiction;
  const inferredContext = caseBrief.ok && ["travel_planning", "property_purchase"].includes(caseBrief.brief.eventType) && caseBrief.brief.jurisdiction
    ? { jurisdiction: caseBrief.brief.jurisdiction, documentType: caseBrief.brief.documentTypes[0] }
    : null;
  const currentResearchAction = caseItem.actions.find((action) =>
    action.executionMode === "assisted" && isReadOnlyResearchStep(action.title, action.description)
  );
  const requestedTopic = parsed.data.documentType.trim();
  const genericTopic = !requestedTopic || ["life event", "life-event", "general guidance"].includes(requestedTopic.toLowerCase());
  const researchTopic = inferredContext?.documentType ?? (genericTopic && currentResearchAction
    ? currentResearchAction.title
    : requestedTopic);
  const safeContext = propertyLocationPending
    ? { jurisdiction: "", documentType: caseBrief.brief.documentTypes[0] ?? researchTopic }
    : createResearchBrief(
      inferredContext?.jurisdiction ?? (parsed.data.jurisdiction.trim() || "general"),
      researchTopic,
    );
  if (!safeContext) {
    return NextResponse.json({ error: "TRESTLE could not prepare safe public-research context for this step. Remove personal identifiers from the research topic and try again." }, { status: 400 });
  }

  try {
    const result = await startWorkflow(id, { ...parsed.data, ...safeContext });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: "Unable to start the workflow." }, { status: 500 });
  }
}
