import type { Action, ProposedOperation } from "../domain/types";
import { createResearchBrief, isReadOnlyResearchStep } from "./privacyBoundary";

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
  if (action.id === "research-reporting-route") {
    return {
      operationType: "public_reporting_research",
      description: "Research official Indian guidance distinguishing unsolicited commercial calls/SMS from suspected cybercrime reports.",
      destination: "Official Government of India public guidance",
      payload: { jurisdiction: "India", researchTask: "spam-reporting-guidance", personalDataIncluded: false },
    };
  }
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

  // This exact workflow action researches public post-purchase document rules.
  // The word "purchase" in its topic must not route it through the generic
  // consequential-action filter; no property purchase or legal filing occurs.
  if (action.id === "research-property-document-guidance") {
    const jurisdiction = typeof context.jurisdiction === "string" ? context.jurisdiction : "";
    const research = createResearchBrief(jurisdiction, "property purchase document requirements and registration records");
    if (!research) {
      throw new OperationFactoryError("Confirm the property's country and state, province, or city before researching local property-document requirements.");
    }
    return {
      operationType: "public_life_event_research",
      description: `Research official public property-document guidance for ${research.jurisdiction}. This is read-only research; it does not purchase property, file documents, or change ownership records.`,
      payload: {
        jurisdiction: research.jurisdiction,
        researchTask: "life-event-guidance",
        topic: research.documentType,
      },
    };
  }

  if (action.executionMode === "assisted" && isReadOnlyResearchStep(action.title, action.description)) {
    const jurisdiction = typeof context.jurisdiction === "string" ? context.jurisdiction : "";
    const topic = `${action.title}: ${action.description}`.slice(0, 100);
    const research = createResearchBrief(jurisdiction, topic);
    if (!research) {
      throw new OperationFactoryError(
        "Choose a general jurisdiction and keep the research step free of personal identifiers.",
      );
    }
    return {
      operationType: "public_life_event_research",
      description: `Research official public guidance for: ${action.title}`,
      payload: { jurisdiction: research.jurisdiction, researchTask: "life-event-guidance", topic: research.documentType },
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
