import type { Action, ProposedOperation, RiskCategory } from "../domain/types";

export interface PolicyEvaluation {
  category: RiskCategory;
  requiresApproval: boolean;
  canExecuteAutomatically: boolean;
  prohibitsAutomation: boolean;
  reasons: string[];
}

const LOW_RISK_OPERATIONS = new Set([
  "read_public_info",
  "read_information",
  "inspect_website",
  "browse_site",
  "prepare_draft",
  "draft",
  "lookup_guidance",
  "lost_document_research",
  "public_life_event_research",
]);

const REQUIRES_REVIEW_OPERATIONS = new Set([
  "enter_form_details",
  "populate_form",
  "fill_form",
  "select_document_upload",
  "upload_document",
  "modify_record",
  "update_record",
  "draft_change",
]);

const HIGH_CONSEQUENCE_OPERATIONS = new Set([
  "submit_declaration",
  "legal_declaration",
  "make_payment",
  "pay_fee",
  "cancel_service",
  "terminate_service",
  "submit_application",
  "final_submission",
  "submit",
]);

/**
 * Classifies an action and proposed operation into conceptual risk categories:
 * - low_risk
 * - requires_review
 * - high_consequence
 */
export function classifyOperation(
  action: Action,
  operation?: ProposedOperation,
): { category: RiskCategory; prohibitsAutomation: boolean; reason: string } {
  // 1. Explicit check: does the destination service prohibit automation or require personal action?
  if (operation?.prohibitsAutomation) {
    return {
      category: "high_consequence",
      prohibitsAutomation: true,
      reason:
        "The destination service prohibits automated interactions or requires personal completion by the user.",
    };
  }

  const opType = operation?.operationType?.toLowerCase().trim() ?? "";

  // 2. High consequence operations or critical risk actions
  if (
    HIGH_CONSEQUENCE_OPERATIONS.has(opType) ||
    action.riskLevel === "critical" ||
    opType.includes("payment") ||
    opType.includes("declaration") ||
    opType.includes("cancel") ||
    opType.includes("submit")
  ) {
    return {
      category: "high_consequence",
      prohibitsAutomation: false,
      reason:
        "Operation involves legal commitments, financial payments, service cancellations, or final official submissions.",
    };
  }

  // 3. Requires review operations or high risk actions or action.approvalRequired
  if (
    REQUIRES_REVIEW_OPERATIONS.has(opType) ||
    action.approvalRequired ||
    action.riskLevel === "high" ||
    opType.includes("form") ||
    opType.includes("upload") ||
    opType.includes("modify")
  ) {
    return {
      category: "requires_review",
      prohibitsAutomation: false,
      reason:
        "Operation involves entering personal details, selecting documents for upload, or consequential changes to records.",
    };
  }

  // 4. Low risk operations
  if (
    LOW_RISK_OPERATIONS.has(opType) ||
    (action.riskLevel === "low" && !action.approvalRequired)
  ) {
    return {
      category: "low_risk",
      prohibitsAutomation: false,
      reason:
        "Operation reads publicly available information, inspects websites, or prepares drafts without submitting them.",
    };
  }

  // Default to requires_review for medium risk or unspecified operations
  return {
    category: "requires_review",
    prohibitsAutomation: false,
    reason:
      "Operation requires user review and approval prior to execution under system safety policy.",
  };
}

/**
 * Centrally evaluates whether an action and operation can execute,
 * whether human approval is required, and whether automation is prohibited.
 */
export function evaluatePolicy(
  action: Action,
  operation?: ProposedOperation,
): PolicyEvaluation {
  const classification = classifyOperation(action, operation);
  const reasons: string[] = [classification.reason];

  if (classification.prohibitsAutomation) {
    return {
      category: classification.category,
      requiresApproval: true,
      canExecuteAutomatically: false,
      prohibitsAutomation: true,
      reasons: [
        ...reasons,
        "Automation is prohibited for this service. User must complete this step personally.",
      ],
    };
  }

  switch (classification.category) {
    case "low_risk":
      return {
        category: "low_risk",
        requiresApproval: false,
        canExecuteAutomatically: true,
        prohibitsAutomation: false,
        reasons,
      };

    case "requires_review":
      return {
        category: "requires_review",
        requiresApproval: true,
        canExecuteAutomatically: false,
        prohibitsAutomation: false,
        reasons: [
          ...reasons,
          "User approval is required before this operation can execute.",
        ],
      };

    case "high_consequence":
      return {
        category: "high_consequence",
        requiresApproval: true,
        canExecuteAutomatically: false,
        prohibitsAutomation: false,
        reasons: [
          ...reasons,
          "Explicit, action-specific human approval is strictly required immediately before this consequential operation executes.",
        ],
      };
  }
}
