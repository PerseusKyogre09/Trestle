import { NextResponse } from "next/server";
import { z } from "zod";
import { createPlanningBrief, createResearchBrief, normalizeJurisdictionAnswer } from "../../../../../server/privacyBoundary";
import { prisma } from "../../../../../server/db";
import { getCase } from "../../../../../server/repository";
import { startWorkflow } from "../../../../../server/workflowOrchestrator";

const schema = z.object({
  jurisdiction: z.string().trim().min(2).max(80),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const caseItem = await getCase(id);
  if (!caseItem) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a country or jurisdiction to research." }, { status: 400 });
  const jurisdiction = normalizeJurisdictionAnswer(parsed.data.jurisdiction);
  if (!jurisdiction) return NextResponse.json({ error: "Enter a country, state, or region only." }, { status: 400 });

  const brief = createPlanningBrief(caseItem.originalInput);
  if (!brief.ok) return NextResponse.json({ error: "This case needs a safe general topic before public research can start." }, { status: 422 });
  const topic = brief.brief.documentTypes[0] ?? `${brief.brief.eventType.replaceAll("_", " ")} public guidance`;
  const researchContext = createResearchBrief(jurisdiction, topic);
  if (!researchContext) return NextResponse.json({ error: "The research topic did not pass privacy checks." }, { status: 422 });

  const slug = jurisdiction.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const actionId = `supplemental-research-${slug}`;
  const existingAction = caseItem.actions.find((action) => action.id === actionId);
  if (existingAction?.status === "completed") {
    return NextResponse.json({ error: `Official ${jurisdiction} research is already recorded for this case. Open that step to review it.` }, { status: 409 });
  }
  const activeRun = await prisma.workflowRun.findFirst({ where: { caseId: id, activeLock: id } });
  if (activeRun) return NextResponse.json({ error: "This case already has an active workflow run. Wait for it to finish before adding jurisdiction research." }, { status: 409 });

  if (!existingAction) {
    const sequence = caseItem.actions.reduce((maximum, action) => Math.max(maximum, action.sequence ?? -1), -1) + 1;
    await prisma.action.create({
      data: {
        id: actionId,
        caseId: id,
        sequence,
        title: `Research official ${jurisdiction} guidance`,
        description: `Find current official ${jurisdiction} public guidance for ${researchContext.documentType}. This is read-only research; it does not file a report or change an account.`,
        status: "pending",
        priority: "medium",
        riskLevel: "low",
        approvalRequired: false,
        requiredInputs: "[]",
        successCriteria: JSON.stringify([`Official ${jurisdiction} sources and relevant guidance are recorded.`]),
        evidence: "[]",
        executionMode: "assisted",
        dependencies: "[]",
      },
    });
    await prisma.case.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  try {
    const result = await startWorkflow(id, {
      mode: "autonomous",
      jurisdiction: researchContext.jurisdiction,
      documentType: researchContext.documentType,
    });
    return NextResponse.json({ actionId, run: result.run, created: result.created }, { status: result.created ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: "The research step was saved, but its workflow run could not be started. Try starting the case again." }, { status: 500 });
  }
}
