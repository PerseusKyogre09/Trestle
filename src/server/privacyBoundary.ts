export type PlanningBrief = {
  eventType: string;
  jurisdiction: string | null;
  documentTypes: string[];
  planningGoal: "public_research_and_user_action_plan";
};

const sensitivePatterns = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /\b(?:\+?\d[\s-]?){8,}\b/,
  /\b(?:aadhaar|pan|passport|dl|driving licence|license)\s*(?:number|no\.?|#)?\s*[:=-]?\s*[a-z0-9-]{5,}\b/i,
  /\b(?:account|card)\s*(?:number|no\.?|#)?\s*[:=-]?\s*[a-z0-9-]{6,}\b/i,
];

export function createPlanningBrief(input: string):
  | { ok: true; brief: PlanningBrief }
  | { ok: false; reason: string } {
  const text = input.trim();
  if (!text) return { ok: false, reason: "Describe the event without personal details." };
  if (sensitivePatterns.some((pattern) => pattern.test(text))) {
    return {
      ok: false,
      reason: "Please remove names, contact details, document numbers, account numbers, and other private values. The planner only needs a generic event description.",
    };
  }

  const lower = text.toLowerCase();
  const eventType = lower.includes("wallet")
    ? "lost_wallet"
    : lower.includes("lost") && (lower.includes("licen") || lower.includes("document"))
    ? "lost_document"
    : lower.includes("mov") || lower.includes("relocat")
    ? "moving_city"
    : lower.includes("education") || lower.includes("university") || lower.includes("college")
    ? "education_application"
    : lower.includes("insurance") || lower.includes("claim")
    ? "insurance_claim"
    : "other";
  const documentTypes = [
    "driving licence",
    "passport",
    "identity document",
    "debit card",
  ].filter((document) => lower.includes(document.replace("driving licence", "licen")));
  const jurisdiction = lower.includes("india") || lower.includes("indian")
    ? "India"
    : null;

  return {
    ok: true,
    brief: {
      eventType,
      jurisdiction,
      documentTypes: documentTypes.length > 0 ? documentTypes : [eventType.replaceAll("_", " ")],
      planningGoal: "public_research_and_user_action_plan",
    },
  };
}

export function createResearchBrief(
  jurisdiction: string,
  documentType: string,
): { jurisdiction: string; documentType: string } | null {
  const values = `${jurisdiction} ${documentType}`;
  if (!jurisdiction.trim() || !documentType.trim()) return null;
  if (sensitivePatterns.some((pattern) => pattern.test(values))) return null;
  return {
    jurisdiction: jurisdiction.trim().slice(0, 80),
    documentType: documentType.trim().slice(0, 100),
  };
}
