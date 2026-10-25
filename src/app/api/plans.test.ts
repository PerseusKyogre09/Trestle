import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackWorkflowForBrief } from "../../server/planner";
import { POST } from "./plans/route";

describe("POST /api/plans", () => {
  const previousApiKey = process.env.GROQ_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousApiKey;
  });

  it("recognizes unwanted calls and asks Groq for a constrained plan using only the generic brief", async () => {
    process.env.GROQ_API_KEY = "test-key";
    const trusted = fallbackWorkflowForBrief({
      eventType: "spam_reporting",
      jurisdiction: "India",
      documentTypes: ["spam reporting"],
      eventSummary: "The user wants help identifying the appropriate official reporting steps.",
      planningGoal: "public_research_and_user_action_plan",
    })!;
    let groqRequest = "";
    const groqPlan = {
      title: "A plan for unwanted calls",
      description: "Find the appropriate official reporting route and prepare the user's next steps.",
      missingInputs: [],
      actions: trusted.actions.map((action) => ({
        id: action.id,
        title: action.title,
        description: action.description,
        dependencies: action.dependencies,
        priority: action.priority,
        riskLevel: action.riskLevel,
        approvalRequired: action.approvalRequired,
        requiredInputs: action.requiredInputs,
        successCriteria: action.successCriteria,
        liveResearch: action.executionMode === "assisted",
        requiresUserAction: action.executionMode !== "assisted",
      })),
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      groqRequest = String(init?.body ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(groqPlan) } }] }), { status: 200 });
    }));

    const response = await POST(new Request("http://localhost/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalInput: "I keep getting unwanted calls." }),
    }));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.source).toBe("groq-planner");
    expect(result.workflow.actions.map((action: { id: string }) => action.id)).toEqual(trusted.actions.map((action) => action.id));
    const messages = JSON.parse(groqRequest).messages as Array<{ content: string }>;
    expect(messages[1].content).toContain('"eventType":"spam_reporting"');
    expect(groqRequest).not.toContain("I keep getting unwanted calls");
    expect(groqRequest).not.toContain("phone number");
  });

  it("uses Groq to draft specific steps for a concrete event outside the built-in categories", async () => {
    process.env.GROQ_API_KEY = "test-key";
    let groqRequest = "";
    const groqPlan = {
      title: "Understand your housing options",
      description: "Organize the situation and identify reliable next steps.",
      missingInputs: ["City or state", "Any written notice received"],
      actions: [{
        id: "review-notice", title: "Review the notice", description: "Identify the stated date and requested next step.",
        dependencies: [], priority: "medium", riskLevel: "low", approvalRequired: false,
        requiredInputs: ["Notice details"], successCriteria: ["The notice and its deadline are understood."],
        liveResearch: false, requiresUserAction: true,
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      groqRequest = String(init?.body ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(groqPlan) } }] }), { status: 200 });
    }));

    const response = await POST(new Request("http://localhost/api/plans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalInput: "My landlord says I need to leave next week and I want to understand my options." }),
    }));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.source).toBe("groq-planner");
    expect(result.workflow.title).toBe("Understand your housing options");
    expect(result.workflow.actions[0].id).toBe("trestle-official-guidance-research");
    expect(result.workflow.actions[0].executionMode).toBe("assisted");
    expect(result.workflow.actions[1].title).toBe("Review the notice");
    expect(result.workflow.actions[1].dependencies).toContain("trestle-official-guidance-research");
    expect(groqRequest).toContain("landlord says I need to leave next week");
  });

  it("asks for specifics instead of creating a workflow for a vague request", async () => {
    const response = await POST(new Request("http://localhost/api/plans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalInput: "I need help" }),
    }));
    expect(response.status).toBe(422);
  });
});
