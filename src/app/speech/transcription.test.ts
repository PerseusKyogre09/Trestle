import { describe, expect, it, vi } from "vitest";
import { describeRecordingError, insertTranscript, transcriptScriptMatchesLanguage, transcribeInWorker } from "./transcription";

describe("local speech transcription helpers", () => {
  it("inserts a transcript into the editable case input", () => {
    expect(insertTranscript("My situation", " मेरी स्थिति is urgent ")).toBe("My situation मेरी स्थिति is urgent");
    expect(insertTranscript("  ", "  नमस्ते  ")).toBe("नमस्ते");
    expect(insertTranscript("existing", " ")).toBe("existing");
  });

  it("accepts selected-script speech with Latin code-switching and rejects another Indic script", () => {
    expect(transcriptScriptMatchesLanguage("मेरा credit card खो गया है", "hi")).toBe(true);
    expect(transcriptScriptMatchesLanguage("મારું કાર્ડ ખોવાઈ ગયું", "hi")).toBe(false);
    expect(transcriptScriptMatchesLanguage("میرا کارڈ کھو گیا ہے", "hi")).toBe(false);
    expect(transcriptScriptMatchesLanguage("আমার credit card হারিয়ে গেছে", "bn")).toBe(true);
    expect(transcriptScriptMatchesLanguage("ਮेरा ਕਾਰਡ ਗੁੰਮ ਗਿਆ", "pa")).toBe(false);
  });

  it("explains microphone permission errors", () => {
    expect(describeRecordingError(new DOMException("denied", "NotAllowedError"))).toMatch(/denied/i);
    expect(describeRecordingError(new DOMException("missing", "NotFoundError"))).toMatch(/No microphone/i);
  });

  it("rejects inference failures and terminates the worker", async () => {
    const worker = { onmessage: null as ((event: MessageEvent) => void) | null, onerror: null as (() => void) | null, postMessage: vi.fn(), terminate: vi.fn() };
    const task = transcribeInWorker(new Float32Array([0.1]), "hi", "base", vi.fn(), () => worker as unknown as Worker);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ language: "hi", model: "base" }));
    worker.onmessage?.({ data: { type: "error", message: "WASM unavailable" } } as MessageEvent);
    await expect(task.result).rejects.toThrow("WASM unavailable");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cancels pending inference and terminates its worker", async () => {
    const worker = { onmessage: null as ((event: MessageEvent) => void) | null, onerror: null as (() => void) | null, postMessage: vi.fn(), terminate: vi.fn() };
    const task = transcribeInWorker(new Float32Array([0.1]), "en", "base", vi.fn(), () => worker as unknown as Worker);
    task.cancel();
    await expect(task.result).rejects.toThrow("Transcription cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
