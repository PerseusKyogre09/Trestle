import { afterEach, describe, expect, it } from "vitest";
import { TinyFishExecutionProvider, parseSseBlock } from "./tinyfishProvider";
import type { ExecutionContext } from "./types";

const context: ExecutionContext = {
  caseId: "case-1",
  actionId: "identify-reporting",
  operation: {
    operationType: "lost_document_research",
    description: "Research official replacement guidance.",
    payload: {
      jurisdiction: "United Kingdom",
      documentType: "driving licence",
    },
  },
};

function responseFor(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(event));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("TinyFishExecutionProvider", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
  });

  it("parses multiple events and accepts only a completed final event", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider(async () =>
      responseFor([
        'data: {"type":"STARTED","run_id":"run-1"}\n\n',
        'data: {"type":"PROGRESS","purpose":"Searching"}\n\n',
        'data: {"type":"COMPLETE","status":"COMPLETED","result":{"summary":"Found guidance","sourceUrls":["https://gov.example"]}}\n\n',
      ])
    );

    const result = await provider.execute(context);

    expect(result.status).toBe("succeeded");
    expect(result.isSimulated).toBe(false);
    expect(result.canVerifyOutcome).toBe(false);
    expect(result.details?.sourceUrls).toEqual(["https://gov.example"]);
  });

  it("handles incomplete chunks and failed terminal events", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider(async () =>
      responseFor([
        'data: {"type":"STARTED"}\n',
        '\ndata: {"type":"COMPLETE","status":"FAILED","error":{"help_message":"Run failed"}}\n\n',
      ])
    );

    const result = await provider.execute(context);

    expect(result.status).toBe("failed");
    expect(result.resultSummary).toContain("Run failed");
  });

  it("reports malformed stream data as inconclusive", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider(async () =>
      responseFor(['data: {not-json}\n\n'])
    );

    const result = await provider.execute(context);

    expect(result.status).toBe("uncertain");
    expect(result.uncertaintyReason).toContain("malformed");
  });

  it("does not allow the live provider without a key", async () => {
    const provider = new TinyFishExecutionProvider();
    const eligibility = await provider.checkEligibility(context);

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toContain("TINYFISH_API_KEY");
  });

  it("rejects unsupported operations", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider();
    const eligibility = await provider.checkEligibility({
      ...context,
      operation: { ...context.operation, operationType: "pay_fee" },
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.supportsOperation).toBe(false);
  });

  it("rejects malformed SSE JSON directly", () => {
    expect(() => parseSseBlock("data: nope")).toThrow();
  });
});
