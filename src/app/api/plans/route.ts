import { NextResponse } from "next/server";
import { RuleBasedWorkflowCompiler } from "../../../domain/compiler";
import { fallbackWorkflowForBrief, planToWorkflow, planWithGroq } from "../../../server/planner";
import { createPlanningBrief } from "../../../server/privacyBoundary";
import { createCaseSchema } from "../../../domain/validation";

export async function POST(request: Request) {
  const parsed = createCaseSchema.pick({ originalInput: true }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return NextResponse.json({ error: "Describe the life event in more detail." }, { status: 400 });

  const brief = createPlanningBrief(parsed.data.originalInput);
  if (!brief.ok) return NextResponse.json({ error: brief.reason }, { status: 422 });
  if (brief.brief.eventType === "other") {
    return NextResponse.json({ error: "This situation needs a generic category first. Try describing whether it involves moving, education, insurance, a lost document, or unwanted calls/messages." }, { status: 422 });
  }

  if (brief.brief.eventType === "spam_reporting") {
    const workflow = fallbackWorkflowForBrief(brief.brief);
    return workflow
      ? NextResponse.json({ workflow, source: "deterministic-fallback" })
      : NextResponse.json({ error: "No safe spam-report workflow is available." }, { status: 422 });
  }

  const aiPlan = await planWithGroq(brief.brief).catch(() => null);
  const workflow = aiPlan
    ? planToWorkflow(aiPlan)
    : fallbackWorkflowForBrief(brief.brief) ?? new RuleBasedWorkflowCompiler().compile(parsed.data.originalInput).workflow;
  if (!workflow) return NextResponse.json({ error: "No safe workflow template is available for this category yet." }, { status: 422 });
  if (aiPlan?.missingInputs.length) {
    return NextResponse.json({ workflow, missingInputs: aiPlan.missingInputs }, { status: 200 });
  }
  return NextResponse.json({ workflow, source: aiPlan ? "groq-planner" : "deterministic-fallback" });
}
