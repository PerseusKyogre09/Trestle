import type { Action, ProposedOperation } from "../domain/types";
import { createResearchBrief } from "./privacyBoundary";

export class OperationFactoryError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "OperationFactoryError";
  }
}

export function buildOperationForAction(
  action: Action,
  context: Record<string, unknown> = {},
): ProposedOperation {
  const researchTasks = new Set([
    "identify-reporting",
    "replacement-requirements",
  ]);
  if (researchTasks.has(action.id)) {
    const jurisdiction = typeof context.jurisdiction === "string" ? context.jurisdiction : "";
    const documentType = typeof context.documentType === "string" ? context.documentType : "";
    const research = createResearchBrief(jurisdiction, documentType);
    if (!research) {
      throw new OperationFactoryError(
        "Choose a generic jurisdiction and document type before requesting research approval.",
      );
    }
    return {
      operationType: "lost_document_research",
      description: action.id === "identify-reporting"
        ? `Find official reporting guidance for a lost ${research.documentType} in ${research.jurisdiction}.`
        : `Find official replacement requirements for a ${research.documentType} in ${research.jurisdiction}.`,
      payload: { ...research, researchTask: action.id },
    };
  }

  return {
    operationType: action.approvalRequired ? "review_action" : "read_public_info",
    description: action.description,
    payload: {
      actionId: action.id,
      actionTitle: action.title,
      requiredInputs: action.requiredInputs,
      successCriteria: action.successCriteria,
    },
  };
}
