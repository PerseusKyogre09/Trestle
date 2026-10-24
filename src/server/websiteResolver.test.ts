import { describe, expect, it, vi } from "vitest";
import { resolveCaseWebsite, isAllowedCaseNavigation, isAllowedNavigation, isSafeDevelopmentUrl } from "./websiteResolver";
import { lookup } from "node:dns/promises";
import type { Action } from "../domain/types";

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => [{
    address: hostname === "internal.example" ? "10.1.2.3" : "93.184.216.34",
    family: 4,
  }]),
}));

function action(input: Partial<Action> & Pick<Action, "id" | "sequence" | "title" | "description">): Action {
  return {
    caseId: "case-1",
    status: "ready",
    priority: "medium",
    dependencies: [],
    requiredInputs: [],
    riskLevel: "low",
    approvalRequired: false,
    successCriteria: [],
    evidence: [],
    executionMode: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...input,
  };
}

const baseCase = (originalInput: string, actions: Action[]) => ({
  title: "Life event",
  description: "Coordinate next steps",
  originalInput,
  actions,
});

describe("case-aware official website selection", () => {
  it("selects a different official page for a clearly identified bank", () => {
    const task = action({ id: "secure-card", sequence: 0, title: "Secure lost credit card", description: "Contact the bank about card security." });
    const icici = resolveCaseWebsite({ caseItem: baseCase("My ICICI Bank credit card was lost", [task]) });
    const hdfc = resolveCaseWebsite({ caseItem: baseCase("My HDFC credit card was lost", [task]) });

    expect(icici.kind).toBe("selected");
    expect(hdfc.kind).toBe("selected");
    if (icici.kind === "selected" && hdfc.kind === "selected") {
      expect(new URL(icici.selection.url).hostname).toBe("www.icici.bank.in");
      expect(icici.selection.url).toBe("https://www.icici.bank.in/personal-banking/cards/credit-card/block-credit-card");
      expect(new URL(hdfc.selection.url).hostname).toBe("www.hdfc.bank.in");
      expect(icici.selection.actionId).toBe("secure-card");
      expect(icici.selection.reason).toContain("Public browsing only");
    }
  });

  it("asks for the issuer instead of guessing from a generic lost-card case", () => {
    const task = action({ id: "secure-card", sequence: 0, title: "Secure affected bank cards", description: "Contact the card issuer." });
    const result = resolveCaseWebsite({ caseItem: baseCase("I lost a credit card", [task]) });
    expect(result.kind).toBe("clarification");
    if (result.kind === "clarification") expect(result.message).toContain("Which bank issued");
  });

  it("distinguishes SBI Card from State Bank debit-card support", () => {
    const creditAction = action({ id: "credit", sequence: 0, title: "Replace credit card", description: "Find the card issuer's lost-card process." });
    const debitAction = action({ id: "debit", sequence: 0, title: "Replace debit card", description: "Find the bank's lost-card process." });
    const credit = resolveCaseWebsite({ caseItem: baseCase("I lost my SBI credit card", [creditAction]) });
    const debit = resolveCaseWebsite({ caseItem: baseCase("I lost my SBI debit card", [debitAction]) });
    expect(credit.kind).toBe("selected");
    expect(debit.kind).toBe("selected");
    if (credit.kind === "selected" && debit.kind === "selected") {
      expect(credit.selection.allowedDomain).toBe("sbicard.com");
      expect(debit.selection.allowedDomain).toBe("sbi.bank.in");
    }
  });

  it("uses only persisted non-simulated research evidence supporting the current action", () => {
    const research = action({
      id: "research-license",
      sequence: 0,
      title: "Research driving licence replacement",
      description: "Find official replacement instructions.",
      status: "completed",
      successCriteria: [],
      executionAttempts: [{
        id: "attempt-1", caseId: "case-1", actionId: "research-license", provider: "tinyfish",
        status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z", isSimulated: false,
        resultDetails: JSON.stringify({ officialSourceUrls: ["https://parivahan.gov.in/" ] }),
      }],
    });
    const next = action({ id: "prepare-license", sequence: 1, title: "Prepare replacement steps", description: "Prepare required next steps.", dependencies: ["research-license"] });
    const result = resolveCaseWebsite({ caseItem: baseCase("I lost an Indian driving licence", [research, next]) });
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.selection.url).toBe("https://parivahan.gov.in/");
      expect(result.selection.source).toBe("persisted_tinyfish_research");
      expect(result.selection.actionId).toBe("prepare-license");
    }
  });

  it("selects the earliest eligible persisted task and rejects unsafe or off-domain navigation", () => {
    const first = action({ id: "first", sequence: 0, title: "Research official process", description: "Find the official page." });
    const later = action({ id: "later", sequence: 1, title: "Replace document", description: "Find next steps.", dependencies: ["first"] });
    const done = { ...first, status: "completed" as const, executionAttempts: [{
      id: "attempt", caseId: "case-1", actionId: "first", provider: "tinyfish", status: "succeeded" as const,
      startedAt: "2026-01-01T00:00:00.000Z", isSimulated: false,
      resultDetails: JSON.stringify({ officialSourceUrls: ["https://parivahan.gov.in/" ] }),
    }] };
    const result = resolveCaseWebsite({ caseItem: baseCase("Lost Indian driving licence", [done, later]) });
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") expect(result.selection.actionId).toBe("later");
    expect(isAllowedCaseNavigation("https://parivahan.gov.in/help", "parivahan.gov.in")).toBe(true);
    expect(isAllowedCaseNavigation("https://evil.example/", "parivahan.gov.in")).toBe(false);
    expect(isAllowedCaseNavigation("http://parivahan.gov.in/", "parivahan.gov.in")).toBe(false);
    expect(isAllowedCaseNavigation("https://127.0.0.1/", "parivahan.gov.in")).toBe(false);
    expect(isAllowedCaseNavigation("https://parivahan.gov.in@evil.example/", "parivahan.gov.in")).toBe(false);
    expect(isAllowedCaseNavigation("https://www.icici.bank.in/personal-banking/", "icici.bank.in")).toBe(true);
    expect(isAllowedCaseNavigation("https://sbi.bank.in/web/faq-s/faq-atm-services", "sbi.co.in")).toBe(true);
    expect(isAllowedCaseNavigation("https://hdfc.bank.in/credit-cards/block-loststolen-card", "hdfcbank.com")).toBe(true);
    expect(isAllowedCaseNavigation("https://axis.bank.in/cards/credit-card", "axisbank.com")).toBe(true);
    expect(isAllowedCaseNavigation("https://evil.bank.in/", "sbi.co.in")).toBe(false);
  });

  it("allows an explicitly entered public website in development mode, but blocks internal destinations", async () => {
    expect((await isSafeDevelopmentUrl("https://example.com/path?q=private"))?.hostname).toBe("example.com");
    expect((await isSafeDevelopmentUrl("http://example.com:8080/"))?.port).toBe("8080");
    expect(await isSafeDevelopmentUrl("http://localhost:3000/" )).toBeNull();
    expect(await isSafeDevelopmentUrl("http://127.0.0.1/" )).toBeNull();
    expect(await isSafeDevelopmentUrl("https://internal.example/" )).toBeNull();
    expect(await isSafeDevelopmentUrl("javascript:alert(1)" )).toBeNull();
    expect(await isSafeDevelopmentUrl("https://user:pass@example.com/" )).toBeNull();
  });

  it("reuses a positive public DNS check during navigation interception", async () => {
    vi.mocked(lookup).mockClear();
    const host = "stable-public-resolution.example.org";
    expect(await isSafeDevelopmentUrl(`https://${host}/`)).not.toBeNull();
    expect(await isAllowedNavigation(`https://${host}/next`, "*")).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
