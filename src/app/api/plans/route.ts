import { NextResponse } from "next/server";
import { RuleBasedWorkflowCompiler } from "../../../domain/compiler";
import { ensureOfficialResearchStep, fallbackWorkflowForBrief, planSpamToWorkflow, planToWorkflow, planWithGroq } from "../../../server/planner";
import { createPlanningBrief } from "../../../server/privacyBoundary";
import { createCaseSchema } from "../../../domain/validation";

export async function POST(request: Request) {
  const parsed = createCaseSchema.pick({ originalInput: true }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return NextResponse.json({ error: "Describe the life event in more detail." }, { status: 400 });

  const brief = createPlanningBrief(parsed.data.originalInput);
  if (!brief.ok) return NextResponse.json({ error: brief.reason }, { status: 422 });
  if (brief.brief.eventType === "property_purchase") {
    const workflow = fallbackWorkflowForBrief(brief.brief);
    return workflow
      ? NextResponse.json({ workflow, source: "deterministic-fallback" })
      : NextResponse.json({ error: "No safe property-document workflow is available." }, { status: 422 });
  }
  const aiPlan = await planWithGroq(brief.brief).catch(() => null);
  if (brief.brief.eventType === "life_event" && !aiPlan) {
    return NextResponse.json({ error: "TRESTLE couldn't prepare a tailored plan right now. Please try again shortly or add more detail about the outcome you need." }, { status: 503 });
  }
  if (brief.brief.eventType === "spam_reporting") {
    const modelWorkflow = aiPlan ? planSpamToWorkflow(aiPlan, brief.brief) : null;
    const workflow = modelWorkflow ?? fallbackWorkflowForBrief(brief.brief);
    return workflow
      ? NextResponse.json({ workflow, source: modelWorkflow ? "groq-planner" : "deterministic-fallback" })
      : NextResponse.json({ error: "No safe spam-report workflow is available." }, { status: 422 });
  }
  const proposedWorkflow = aiPlan
    ? planToWorkflow(aiPlan)
    : fallbackWorkflowForBrief(brief.brief) ?? new RuleBasedWorkflowCompiler().compile(parsed.data.originalInput).workflow;
  const needsDestination = brief.brief.eventType === "travel_planning" && !brief.brief.jurisdiction;
  const workflow = proposedWorkflow
    ? needsDestination ? proposedWorkflow : ensureOfficialResearchStep(proposedWorkflow, brief.brief)
    : null;
  if (!workflow) return NextResponse.json({ error: "No safe workflow template is available for this category yet." }, { status: 422 });
  if (aiPlan?.missingInputs.length) {
    return NextResponse.json({ workflow, missingInputs: aiPlan.missingInputs, source: "groq-planner" }, { status: 200 });
  }
  return NextResponse.json({ workflow, source: aiPlan ? "groq-planner" : "deterministic-fallback" });
}
