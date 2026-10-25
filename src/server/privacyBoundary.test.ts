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

  it("classifies spam-report requests locally without retaining the number in the planning brief", () => {
    const result = createPlanningBrief("I received an unwanted spam caller and need the official Indian reporting route.");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brief.eventType).toBe("spam_reporting");
      expect(JSON.stringify(result.brief)).not.toContain("caller");
      expect(JSON.stringify(result.brief)).not.toMatch(/\d{10}/);
    }
  });

  it("recognizes a plain-language unwanted-calls description without asking for a different category", () => {
    const result = createPlanningBrief("I keep getting unwanted calls.");
    expect(result).toMatchObject({
      ok: true,
      brief: { eventType: "spam_reporting", jurisdiction: "India", documentTypes: ["spam reporting"] },
    });
    if (result.ok) expect(JSON.stringify(result.brief)).not.toContain("unwanted calls");
  });

  it("recognizes an ordinary-language relocation request with its Indian jurisdiction", () => {
    expect(createPlanningBrief("I need to shift from Mumbai to Delhi.")).toMatchObject({
      ok: true,
      brief: { eventType: "moving_city", jurisdiction: "India" },
    });
  });

  it("allows concrete unfamiliar events through with a planning summary, but rejects vague prompts", () => {
    const result = createPlanningBrief("My landlord says I need to leave next week and I want to understand my options.");
    expect(result).toMatchObject({ ok: true, brief: { eventType: "life_event" } });
    if (result.ok) expect(result.brief.eventSummary).toContain("landlord");
    expect(createPlanningBrief("I need help")).toMatchObject({ ok: false });
  });
});
