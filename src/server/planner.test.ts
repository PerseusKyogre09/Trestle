import { afterEach, describe, expect, it } from "vitest";
import { planWithGroq } from "./planner";
import type { PlanningBrief } from "./privacyBoundary";

const brief: PlanningBrief = {
  eventType: "lost_document",
  jurisdiction: "India",
  documentTypes: ["Indian driving licence"],
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
});
