import type { Action, Workflow } from "./types";
import { validateGraph } from "./engine";

export interface WorkflowCompiler { compile(input: string): { workflow?: Workflow; error?: string }; }

const action = (id: string, title: string, description: string, dependencies: string[], extra: Partial<Pick<Action, "priority" | "riskLevel" | "approvalRequired" | "requiredInputs" | "successCriteria" | "executionMode">> = {}) => ({
  id, title, description, status: "pending" as const, dependencies, priority: extra.priority ?? "medium", riskLevel: extra.riskLevel ?? "low",
  approvalRequired: extra.approvalRequired ?? false, requiredInputs: extra.requiredInputs ?? [], successCriteria: extra.successCriteria ?? ["Record what was done and the outcome."], evidence: [], executionMode: extra.executionMode ?? "manual",
});

export class RuleBasedWorkflowCompiler implements WorkflowCompiler {
  compile(input: string) {
    const text = input.toLowerCase();
    if (!(text.includes("wallet") || (text.includes("debit") && text.includes("licen")))) return { error: "Unsupported event. The rule-based compiler currently supports lost-wallet events involving cards or identity documents." };
    const actions = [
      action("secure-cards", "Secure affected bank cards", "Contact each relevant card issuer using a trusted channel and ask about securing or replacing the affected card.", [], { priority: "urgent", riskLevel: "high", approvalRequired: true, requiredInputs: ["Card issuer contact details"], successCriteria: ["Issuer confirms the card is secured or gives a documented next step."], executionMode: "assisted" }),
      action("check-transactions", "Check for suspicious transactions", "Review recent account activity and record any transactions you do not recognize. Confirm the appropriate dispute process with the issuer.", ["secure-cards"], { priority: "high", requiredInputs: ["Account statement or transaction history"], successCriteria: ["Recent activity has been reviewed and any concerns are recorded."], executionMode: "manual" }),
      action("identify-reporting", "Identify the official lost-document reporting procedure", "Find the relevant official guidance for the jurisdiction and document which reporting route, if any, applies. Requirements must be verified for the user's location.", [], { priority: "medium", riskLevel: "medium", requiredInputs: ["Jurisdiction", "Document types"], successCriteria: ["An official source and applicable procedure are recorded for verification."], executionMode: "manual" }),
      action("replacement-requirements", "Identify replacement requirements", "Determine the current requirements for replacing each affected document with the responsible issuing authority. Requirements may vary by jurisdiction.", ["identify-reporting"], { priority: "medium", requiredInputs: ["Jurisdiction", "Document details"], successCriteria: ["Required forms, identity evidence, fees, and appointment needs are recorded for verification."], executionMode: "manual" }),
      action("prepare-replacements", "Prepare replacement applications", "Gather the verified information and prepare the next steps for each replacement application; do not submit anything without the user's review.", ["replacement-requirements"], { priority: "medium", approvalRequired: true, successCriteria: ["Application materials are prepared and ready for user review."], executionMode: "assisted" }),
    ];
    const workflow = { title: "Lost wallet and documents", description: "A dependency-aware plan for securing affected cards and handling lost documents.", actions };
    const graph = validateGraph(actions);
    return graph.ok ? { workflow } : { error: graph.error };
  }
}
