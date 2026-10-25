import { z } from "zod";
import type { Workflow } from "../domain/types";
import type { PlanningBrief } from "./privacyBoundary";
import { validateGraph } from "../domain/engine";

const planSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  missingInputs: z.array(z.string()),
  actions: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    description: z.string().min(1),
    dependencies: z.array(z.string()),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    approvalRequired: z.boolean(),
    requiredInputs: z.array(z.string()),
    successCriteria: z.array(z.string().min(1)),
    liveResearch: z.boolean(),
    requiresUserAction: z.boolean(),
  })),
});

export type ProposedPlan = z.infer<typeof planSchema>;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    missingInputs: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" }, title: { type: "string" }, description: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
          approvalRequired: { type: "boolean" }, requiredInputs: { type: "array", items: { type: "string" } },
          successCriteria: { type: "array", items: { type: "string" } }, liveResearch: { type: "boolean" }, requiresUserAction: { type: "boolean" },
        },
        required: ["id", "title", "description", "dependencies", "priority", "riskLevel", "approvalRequired", "requiredInputs", "successCriteria", "liveResearch", "requiresUserAction"],
      },
    },
  },
  required: ["title", "description", "missingInputs", "actions"],
};

export async function planWithGroq(brief: PlanningBrief, fetchImpl: typeof fetch = fetch): Promise<ProposedPlan | null> {
  if (!process.env.GROQ_API_KEY) return null;
  const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.GROQ_PLANNER_MODEL || "openai/gpt-oss-120b",
      temperature: 0,
      messages: [
        { role: "system", content: "Plan a safe life-event workflow. Do not invent missing user facts. Ask for missing essential inputs in missingInputs. Research actions may read public information only. Never plan payments, submissions, uploads, account changes, or claims of completion." },
        { role: "user", content: JSON.stringify({ planningBrief: brief }) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "life_event_plan", strict: true, schema } },
    }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(content); } catch { return null; }
  const parsed = planSchema.safeParse(decoded);
  if (!parsed.success || !validateGraph(parsed.data.actions).ok) return null;
  return parsed.data;
}

export function planToWorkflow(plan: ProposedPlan): Workflow {
  return {
    title: plan.title,
    description: plan.description,
    actions: plan.actions.map((action) => ({
      id: action.id,
      title: action.title,
      description: action.description,
      status: "pending",
      priority: action.priority,
      dependencies: action.dependencies,
      requiredInputs: action.requiredInputs,
      riskLevel: action.riskLevel,
      approvalRequired: action.approvalRequired,
      successCriteria: action.successCriteria,
      evidence: [],
      executionMode: action.requiresUserAction ? "manual" : action.liveResearch ? "assisted" : "manual",
    })),
  };
}

export function fallbackWorkflowForBrief(brief: PlanningBrief): Workflow | null {
  const base = {
    status: "pending" as const,
    dependencies: [] as string[],
    priority: "medium" as const,
    riskLevel: "low" as const,
    approvalRequired: false,
    requiredInputs: ["User-specific details required for this task"],
    evidence: [],
    executionMode: "manual" as const,
  };
  if (brief.eventType === "spam_reporting") {
    return {
      title: "Suspicious caller reporting",
      description: "First distinguish ordinary unsolicited commercial communication from suspected cybercrime, then use the appropriate Indian official guidance. TRESTLE will not accuse, submit, or claim a report was accepted.",
      actions: [
        { ...base, id: "classify-reporting-route", title: "Describe what kind of call or message you received", description: "Choose whether this was ordinary unwanted promotion, a suspected impersonation/phishing attempt, or an incident where money was lost. This determines the correct reporting route; a 10-digit number alone does not prove wrongdoing.", requiredInputs: ["Observed communication type"], successCriteria: ["The user-selected route category is recorded as user-reported, not independently verified."], executionMode: "manual" },
        { ...base, id: "research-reporting-route", title: "Check official Indian reporting guidance", description: "Compare official TRAI guidance for unsolicited commercial calls/SMS with the National Cyber Crime Reporting Portal's Report Suspect facility. Research is generic and will not include the reported number or personal details.", dependencies: ["classify-reporting-route"], requiredInputs: [], successCriteria: ["Official guidance and source URLs for the applicable reporting channel are recorded."], executionMode: "assisted" },
        { ...base, id: "record-suspicious-identifier", title: "Enter the number or identifier you want to report", description: "Enter only the exact phone number or identifier you observed. TRESTLE stores this answer in the local case and does not send it to Groq or TinyFish.", dependencies: ["research-reporting-route"], requiredInputs: ["Exact observed phone number or identifier"], successCriteria: ["The user-provided identifier is recorded locally without treating it as proof of misconduct."], executionMode: "manual" },
        { ...base, id: "record-reporting-state", title: "Choose the incident State/UT if the selected route asks for it", description: "The NCRP Report Suspect form asks for State of Incident. Choose the State/UT where the incident occurred. For ordinary UCC complaints to your telecom provider, this is not needed in TRESTLE.", dependencies: ["record-suspicious-identifier"], requiredInputs: ["Incident State/UT for NCRP"], successCriteria: ["The user-provided jurisdiction or route-based not-applicable choice is recorded."], executionMode: "manual" },
        { ...base, id: "record-spam-details", title: "Describe what happened", description: "Give a short factual account, including whether it was a call or SMS and when it happened if known. Do not state that a crime occurred unless you have evidence; do not include your passwords, OTPs, or financial details.", dependencies: ["record-reporting-state"], requiredInputs: ["Factual description; communication mode and approximate date/time if known"], successCriteria: ["A factual user-provided description is recorded locally."], executionMode: "manual" },
        { ...base, id: "prepare-report-evidence", title: "Check what supporting evidence you can provide", description: "The NCRP Report Suspect form marks supporting evidence as required and states a 5 MB maximum. Keep relevant evidence such as a screenshot of the call/SMS ready. TRESTLE does not collect or upload the file; you select it on the official site. For the telecom-provider route, follow the provider's current instructions.", dependencies: ["record-spam-details"], requiredInputs: ["Relevant evidence file for NCRP, if using that route; file selection happens on the official site"], successCriteria: ["The user knows what evidence they intend to provide or records that evidence is unavailable; no file is uploaded by TRESTLE."], executionMode: "manual" },
        { ...base, id: "review-report-manually", title: "Review and continue on the official reporting channel", description: "Review the official destination and details yourself. TRESTLE does not upload evidence, complete CAPTCHA, authenticate, or submit this report in this demo. Record any genuine acknowledgement only after the official service provides one.", dependencies: ["prepare-report-evidence"], requiredInputs: ["User review and manual completion on the official service"], successCriteria: ["The user confirms they reviewed the information; no external submission is inferred."], executionMode: "manual" },
      ],
    };
  }
  if (brief.eventType === "moving_city") {
    return {
      title: "Moving preparation plan",
      description: "A generic checklist for reviewing address, service, and administrative changes.",
      actions: [
        { ...base, id: "inventory-moving-tasks", title: "Inventory local changes", description: "List the services, institutions, and records that may need updating after the move.", successCriteria: ["A user-reviewed list of affected services is recorded."] },
        { ...base, id: "research-moving-requirements", title: "Research official requirements", description: "Research public official guidance for the selected jurisdiction and move-related administrative tasks.", successCriteria: ["Official sources and unverified details are recorded."], executionMode: "assisted" },
        { ...base, id: "prepare-moving-updates", title: "Prepare user updates", description: "Prepare the information and documents the user may need to update records manually.", dependencies: ["inventory-moving-tasks", "research-moving-requirements"], successCriteria: ["User-reviewed next steps are ready."], approvalRequired: true, executionMode: "assisted" },
      ],
    };
  }
  if (brief.eventType === "insurance_claim") {
    return {
      title: "Insurance claim preparation plan",
      description: "A generic plan for organizing evidence and reviewing the insurer's official process.",
      actions: [
        { ...base, id: "collect-claim-evidence", title: "Collect claim evidence", description: "Gather the records and documents the user chooses to provide for review.", successCriteria: ["The user has a complete private evidence checklist."], requiredInputs: ["User-provided claim details and documents"] },
        { ...base, id: "research-claim-process", title: "Research the official claim process", description: "Research public insurer or regulator guidance without sending private claim details.", successCriteria: ["Official process guidance and unknowns are recorded."], executionMode: "assisted" },
        { ...base, id: "prepare-claim-review", title: "Prepare claim for user review", description: "Organize the user's private information locally for their own review; do not submit it.", dependencies: ["collect-claim-evidence", "research-claim-process"], successCriteria: ["A user-reviewed preparation checklist is ready."], approvalRequired: true, executionMode: "manual" },
      ],
    };
  }
  return null;
}
