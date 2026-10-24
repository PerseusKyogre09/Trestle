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
      researchTask: "identify-reporting",
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
        'data: {"type":"COMPLETE","status":"COMPLETED","result":{"summary":"Found guidance","sourceUrls":["https://parivahan.gov.in/"],"requirements":["Use the issuing authority process"],"nextSteps":["Review the official guidance"]}}\n\n',
      ])
    );

    const result = await provider.execute(context);

    expect(result.status).toBe("succeeded");
    expect(result.isSimulated).toBe(false);
    expect(result.canVerifyOutcome).toBe(true);
    expect(result.evidence?.kind).toBe("verified");
    expect(result.details?.sourceUrls).toEqual(["https://parivahan.gov.in/"]);
    expect(result.details?.officialSourceUrls).toEqual(["https://parivahan.gov.in/"]);
    expect((result.details?.trace as Array<Record<string, unknown>>).map((event) => event.type)).toEqual([
      "STARTED",
      "PROGRESS",
      "COMPLETE",
    ]);
  });

  it("returns after COMPLETE even when TinyFish keeps the SSE connection open", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"type":"COMPLETE","status":"COMPLETED","result":{"summary":"Finished"}}\n\n',
          ));
        },
      });
      return new Response(stream, { status: 200 });
    });

    const result = await provider.execute(context);

    expect(result.status).toBe("succeeded");
    expect(result.resultSummary).toBe("Finished");
  });

  it("uses the three-minute TinyFish agent duration and allows a slow stream to finish", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    let requestBody: { agent_config?: { max_duration_seconds?: number } } = {};
    const provider = new TinyFishExecutionProvider(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      await new Promise((resolve) => setTimeout(resolve, 25));
      return responseFor([
        'data: {"type":"COMPLETE","status":"COMPLETED","result":{"summary":"Slow result"}}\n\n',
      ]);
    });

    const result = await provider.execute(context);

    expect(requestBody.agent_config?.max_duration_seconds).toBe(180);
    expect(result.status).toBe("succeeded");
    expect(result.resultSummary).toBe("Slow result");
  });

  it("recognizes the SSE event name when the payload omits its type", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider(async () =>
      responseFor([
        'event: COMPLETE\ndata: {"status":"COMPLETED","result":{"summary":"Finished"}}\n\n',
      ])
    );

    const result = await provider.execute(context);

    expect(result.status).toBe("succeeded");
    expect(result.resultSummary).toBe("Finished");
  });

  it("does not verify a completed run that lacks sources or procedure details", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider(async () =>
      responseFor([
        'data: {"type":"COMPLETE","status":"COMPLETED","result":{"summary":"Some text","sourceUrls":[],"requirements":[],"nextSteps":[]}}\n\n',
      ])
    );

    const result = await provider.execute(context);

    expect(result.status).toBe("succeeded");
    expect(result.canVerifyOutcome).toBe(false);
    expect(result.evidence).toBeUndefined();
  });

  it("does not treat a non-government HTTPS page as official evidence", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const provider = new TinyFishExecutionProvider(async () =>
      responseFor([
        'data: {"type":"COMPLETE","status":"COMPLETED","result":{"summary":"Found guidance","sourceUrls":["https://example.com"],"requirements":["A requirement"],"nextSteps":["A next step"]}}\n\n',
      ])
    );

    const result = await provider.execute(context);

    expect(result.status).toBe("succeeded");
    expect(result.canVerifyOutcome).toBe(false);
    expect(result.evidence).toBeUndefined();
    expect(result.details?.officialSourceUrls).toEqual([]);
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

  it("rejects private research values before making an outbound request", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    let called = false;
    const provider = new TinyFishExecutionProvider(async () => {
      called = true;
      return responseFor([]);
    });

    await expect(provider.execute({
      ...context,
      operation: {
        ...context.operation,
        payload: {
          jurisdiction: "India",
          documentType: "Aadhaar number 123456789012",
          researchTask: "identify-reporting",
        },
      },
    })).rejects.toThrow(/generic, non-personal/);
    expect(called).toBe(false);
  });

  it("rejects malformed SSE JSON directly", () => {
    expect(() => parseSseBlock("data: nope")).toThrow();
  });
});
