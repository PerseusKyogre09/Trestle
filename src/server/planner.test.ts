import { afterEach, describe, expect, it } from "vitest";
import { fallbackWorkflowForBrief, planSpamToWorkflow, planWithGroq } from "./planner";
import { createPlanningBrief } from "./privacyBoundary";
import type { PlanningBrief } from "./privacyBoundary";

const brief: PlanningBrief = {
  eventType: "lost_document",
  jurisdiction: "India",
  documentTypes: ["Indian driving licence"],
  eventSummary: "lost document",
  planningGoal: "public_research_and_user_action_plan",
};

describe("Groq planning boundary", () => {
  afterEach(() => delete process.env.GROQ_API_KEY);

  it("sends only the planning brief, never the raw request or case object", async () => {
    process.env.GROQ_API_KEY = "test-key";
    let requestBody = "";
    const response = {
      title: "Lost document plan",
      description: "A plan for public research and user action.",
      missingInputs: [],
      actions: [{
        id: "research-official-guidance",
        title: "Research official guidance",
        description: "Find public issuing-authority information.",
        dependencies: [],
        priority: "medium",
        riskLevel: "low",
        approvalRequired: false,
        requiredInputs: ["Jurisdiction"],
        successCriteria: ["Official guidance is recorded."],
        liveResearch: true,
        requiresUserAction: false,
      }],
    };
    const plan = await planWithGroq(brief, async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status: 200 });
    });

    expect(plan?.actions[0].id).toBe("research-official-guidance");
    expect(requestBody).toContain("planningBrief");
    expect(requestBody).toContain("Indian driving licence");
    expect(requestBody).not.toContain("case object");
    expect(requestBody).not.toContain("personal");
  });

  it("rejects cyclic plans", async () => {
    process.env.GROQ_API_KEY = "test-key";
    const cyclic = {
      title: "Invalid", description: "Invalid", missingInputs: [], actions: [
        { id: "a", title: "A", description: "A", dependencies: ["b"], priority: "low", riskLevel: "low", approvalRequired: false, requiredInputs: [], successCriteria: ["A"], liveResearch: false, requiresUserAction: true },
        { id: "b", title: "B", description: "B", dependencies: ["a"], priority: "low", riskLevel: "low", approvalRequired: false, requiredInputs: [], successCriteria: ["B"], liveResearch: false, requiresUserAction: true },
      ],
    };
    const plan = await planWithGroq(brief, async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(cyclic) } }] }), { status: 200 }));
    expect(plan).toBeNull();
  });

  it("creates a dedicated spam-report flow with a route-classification gate before research", () => {
    const workflow = fallbackWorkflowForBrief({ ...brief, eventType: "spam_reporting", documentTypes: ["spam caller"] });
    expect(workflow?.actions.map((action) => action.id)).toEqual([
      "classify-reporting-route", "research-reporting-route", "record-suspicious-identifier", "record-reporting-state", "record-spam-details", "prepare-report-evidence", "review-report-manually",
    ]);
    expect(workflow?.actions[1].dependencies).toEqual(["classify-reporting-route"]);
    expect(workflow?.actions[1].executionMode).toBe("assisted");
    expect(workflow?.actions[2].dependencies).toEqual(["research-reporting-route"]);
    expect(workflow?.actions[3].dependencies).toEqual(["record-suspicious-identifier"]);
    expect(workflow?.actions[5].description).toContain("does not collect or upload the file");
  });

  it("recognizes a Hindi driving-licence request and builds a usable local workflow", () => {
    const parsed = createPlanningBrief("मुझे ड्राइविंग लाइसेंस बनवाना है।");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.brief.eventType).toBe("driving_license_application");
    const workflow = fallbackWorkflowForBrief(parsed.brief);
    expect(workflow?.title).toBe("Driving licence application checklist");
    expect(workflow?.actions.map((action) => action.id)).toEqual([
      "confirm-license-jurisdiction", "research-license-application", "prepare-license-application", "complete-license-application-yourself",
    ]);
  });

  it("builds a local response plan for online identity misuse", () => {
    const parsed = createPlanningBrief("My identity is being misused online");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.brief.eventType).toBe("online_identity_misuse");
    const workflow = fallbackWorkflowForBrief(parsed.brief);
    expect(workflow?.title).toBe("Respond to online identity misuse");
    expect(workflow?.actions.map((action) => action.id)).toContain("research-identity-misuse-reporting");
    expect(workflow?.actions.some((action) => /password|one-time code/i.test(action.description))).toBe(true);
  });

  it("returns a general workflow for an otherwise unclassified described event", () => {
    const workflow = fallbackWorkflowForBrief({ ...brief, eventType: "life_event", eventSummary: "a damaged household item" });
    expect(workflow?.actions.map((action) => action.id)).toEqual([
      "clarify-situation", "research-situation-guidance", "prepare-situation-next-steps",
    ]);
  });

  it("uses Groq wording only when it preserves the approved spam workflow graph and trusted policy", () => {
    const spamBrief = { ...brief, eventType: "spam_reporting", documentTypes: ["spam caller identifier"] };
    const trusted = fallbackWorkflowForBrief(spamBrief)!;
    const proposed = {
      title: "A clear plan for unwanted calls",
      description: "Separate ordinary unwanted calls from suspected cybercrime and find the right official route.",
      missingInputs: [],
      actions: trusted.actions.map((action) => ({
        id: action.id,
        title: `Step: ${action.title}`,
        description: action.description,
        dependencies: action.dependencies,
        priority: action.priority,
        riskLevel: "low" as const,
        approvalRequired: false,
        requiredInputs: [],
        successCriteria: ["Groq suggested this."],
        liveResearch: action.executionMode === "assisted",
        requiresUserAction: action.executionMode !== "assisted",
      })),
    };
    const workflow = planSpamToWorkflow(proposed, spamBrief);

    expect(workflow?.title).toBe(proposed.title);
    expect(workflow?.actions[0].title).toBe("Step: Describe what kind of call or message you received");
    expect(workflow?.actions.find((action) => action.id === "research-reporting-route")?.executionMode).toBe("assisted");
    expect(workflow?.actions.find((action) => action.id === "review-report-manually")?.requiredInputs).toEqual(trusted.actions.at(-1)?.requiredInputs);
    expect(workflow?.actions.find((action) => action.id === "review-report-manually")?.executionMode).toBe("manual");
  });

  it("rejects Groq spam plans that add steps, change dependencies, or claim a report was submitted", () => {
    const spamBrief = { ...brief, eventType: "spam_reporting", documentTypes: ["spam caller identifier"] };
    const trusted = fallbackWorkflowForBrief(spamBrief)!;
    const makePlan = () => ({
      title: "Safe plan", description: "A safe plan", missingInputs: [],
      actions: trusted.actions.map((action) => ({
        id: action.id, title: action.title, description: action.description,
        dependencies: action.dependencies, priority: action.priority, riskLevel: action.riskLevel,
        approvalRequired: action.approvalRequired, requiredInputs: action.requiredInputs,
        successCriteria: action.successCriteria, liveResearch: action.executionMode === "assisted",
        requiresUserAction: action.executionMode !== "assisted",
      })),
    });
    const changedDependency = makePlan();
    changedDependency.actions[2].dependencies = [];
    expect(planSpamToWorkflow(changedDependency, spamBrief)).toBeNull();

    const falseClaim = makePlan();
    falseClaim.actions[6].description = "Your report has been submitted successfully.";
    expect(planSpamToWorkflow(falseClaim, spamBrief)).toBeNull();
  });
});
