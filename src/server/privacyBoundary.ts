export type PlanningBrief = {
  eventType: string;
  jurisdiction: string | null;
  documentTypes: string[];
  /** A privacy-screened description used to plan concrete, unclassified events. */
  eventSummary: string;
  planningGoal: "public_research_and_user_action_plan";
};

const prohibitedResearchActions = /\b(submit|submission|upload|pay|payment|purchase|send|message|email|call|apply|application|file a complaint|change account|modify account|delete account|transfer|book appointment)\b/i;
const researchIntent = /\b(research|find|identify|check|understand|compare|review|verify|look up|locate|determine|official guidance|requirements)\b/i;

export function isReadOnlyResearchStep(title: string, description: string): boolean {
  const text = `${title} ${description}`;
  return researchIntent.test(text) && !prohibitedResearchActions.test(text);
}

export function normalizeJurisdictionAnswer(value: string): string | null {
  const jurisdiction = value.replace(/^User reports:\s*/i, "").trim();
  if (jurisdiction.length < 2 || jurisdiction.length > 80 || /\d/.test(jurisdiction)) return null;
  if (!/^[\p{L}\s.,'’()-]+$/u.test(jurisdiction)) return null;
  if (/\b(?:street|road|avenue|lane|apartment|flat|unit|plot|house number|address|postcode|postal code|zip code)\b/i.test(jurisdiction)) return null;
  return jurisdiction.replace(/\s+/g, " ");
}

const sensitivePatterns = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /\b(?:\+?\d[\s-]?){8,}\b/,
  /\b(?:aadhaar|pan|passport|dl|driving licence|license)\s*(?:number|no\.?|#)?\s*[:=-]?\s*[a-z0-9-]{5,}\b/i,
  /\b(?:account|card)(?:\s*(?:number|no\.?|#))?\s*[:=-]?\s*(?=[a-z0-9-]*\d)[a-z0-9-]{6,}\b/i,
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
  if (/^(?:i need help|help me|something happened|i need assistance|can you help me)[.!?\s]*$/i.test(text)) {
    return { ok: false, reason: "Please describe the specific event or outcome you need help with." };
  }
  const unwantedCommunication = /\b(unwanted|unsolicited|spam|junk|promotional|marketing)\b.{0,48}\b(calls?|messages?|texts?|sms|communications?)\b/i.test(text) ||
    /\b(calls?|messages?|texts?|sms|communications?)\b.{0,48}\b(unwanted|unsolicited|spam|junk|promotional|marketing)\b/i.test(text) ||
    /\b(robocalls?|telemarketing calls?)\b/i.test(text);
  const onlineIdentityMisuse = /\b(identity|impersonat(?:ion|ed)|profile|account)\b.{0,45}\b(misus(?:e|ed|ing)|theft|stolen|fake|hijack(?:ed)?|taken over|impersonat(?:ion|ed))\b/i.test(text) ||
    /\b(misus(?:e|ed|ing)|theft|stolen|fake|hijack(?:ed)?|taken over)\b.{0,45}\b(identity|profile|account)\b/i.test(text);
  const travelDestination = text.match(/\b(?:travel(?:ing|ling)?|trip|visit(?:ing)?|vacation|holiday)\s+(?:to|in)\s+(?:the\s+)?([A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*){0,2})/u)?.[1] ?? null;
  const propertyPurchase = /\b(?:bought|purchased|buying|purchase|purchasing)\b.{0,45}\b(?:house|home|property|flat|apartment|land)\b/i.test(text) ||
    /\b(?:house|home|property|flat|apartment|land)\b.{0,35}\b(?:bought|purchased|buying|purchase|purchasing)\b/i.test(text);
  const hindiDrivingLicenseApplication = /(?:ड्राइविंग\s*लाइसेंस|ड्राइविंग\s*लाइसेन्स|ड्राइविंग\s*लाइसेंस|ड्राइविंग\s*लाइसेंस\s*(?:बनवाना|बनाना|चाहिए)|लाइसेंस\s*(?:बनवाना|बनाना|चाहिए))/u.test(text);
  const eventType = hindiDrivingLicenseApplication
    ? "driving_license_application"
    : lower.includes("wallet")
    ? "lost_wallet"
    : unwantedCommunication || /(spam|unsolicited|scam call|spam caller|suspicious number|report.*number)/i.test(text)
    ? "spam_reporting"
    : onlineIdentityMisuse
    ? "online_identity_misuse"
    : /\b(travel|traveling|travelling|trip|visit|vacation|holiday)\b/i.test(text)
    ? "travel_planning"
    : propertyPurchase
    ? "property_purchase"
    : lower.includes("lost") && (lower.includes("licen") || lower.includes("document"))
    ? "lost_document"
    : lower.includes("mov") || lower.includes("relocat") || /\bshift(?:ing)?\s+from\b/.test(lower)
    ? "moving_city"
    : lower.includes("education") || lower.includes("university") || lower.includes("college")
    ? "education_application"
    : lower.includes("insurance") || lower.includes("claim")
    ? "insurance_claim"
      : "life_event";
  const documentTypes = eventType === "driving_license_application"
    ? ["driving licence application"]
    : eventType === "online_identity_misuse"
    ? ["online identity misuse reporting and account protection"]
    : eventType === "spam_reporting" ? ["spam reporting"] : eventType === "travel_planning"
    ? [travelDestination ? `travel to ${travelDestination}` : "travel planning"] : eventType === "property_purchase"
    ? ["property purchase documents and registration"] : [
    "driving licence",
    "passport",
    "identity document",
    "debit card",
  ].filter((document) => lower.includes(document.replace("driving licence", "licen")));
  const jurisdiction = eventType === "travel_planning"
    ? travelDestination
    : eventType === "property_purchase"
    ? null
    : eventType === "spam_reporting" || lower.includes("india") || lower.includes("indian") || /\b(mumbai|delhi)\b/.test(lower)
    ? "India"
    : null;

  return {
    ok: true,
    brief: {
      eventType,
      jurisdiction,
      documentTypes: documentTypes.length > 0 ? documentTypes : [eventType.replaceAll("_", " ")],
      eventSummary: eventType === "life_event"
        ? text.slice(0, 500)
        : eventType === "online_identity_misuse"
        ? "online identity misuse response and account protection"
        : eventType === "travel_planning"
        ? `Travel planning${travelDestination ? ` for ${travelDestination}` : ""}${/\bfirst\s+time\b/i.test(text) ? "; first visit" : ""}`
        : eventType === "driving_license_application"
        ? "The user wants to apply for a driving licence; identify the correct local process and required steps."
        : eventType === "property_purchase"
        ? "property purchase document guidance"
        : eventType.replaceAll("_", " "),
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
