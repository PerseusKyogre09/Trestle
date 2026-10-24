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
  if (action.id === "identify-reporting") {
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
      description: `Research official ${research.documentType} replacement guidance for ${research.jurisdiction}.`,
      payload: research,
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
