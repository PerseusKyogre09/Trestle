import { describe, expect, it } from "vitest";
import { createPlanningBrief, createResearchBrief } from "./privacyBoundary";

describe("provider privacy boundary", () => {
  it("creates a generic planning brief without the original prompt", () => {
    const result = createPlanningBrief(
      "I lost my Indian driving licence in Delhi and need replacement guidance.",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.brief)).not.toContain("Delhi");
      expect(JSON.stringify(result.brief)).not.toContain("I lost");
      expect(result.brief.jurisdiction).toBe("India");
    }
  });

  it("rejects personal identifiers before any provider call", () => {
    expect(createPlanningBrief("My name is Priya, email priya@example.com")).toMatchObject({ ok: false });
    expect(createResearchBrief("India", "Aadhaar number 123456789012")).toBeNull();
  });

  it("allows only generic research context", () => {
    expect(createResearchBrief("India", "Indian driving licence")).toEqual({
      jurisdiction: "India",
      documentType: "Indian driving licence",
    });
  });
});
