import { ModelManager, WhisperWasmService } from "./whisper-library.js";

self.onmessage = async ({ data }) => {
  if (data.type === "cancel") return;
  try {
    if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
      throw new Error("Local speech recognition needs cross-origin isolation. Reload the page or contact the site administrator.");
    }
    if (!data.audio) throw new Error("No recording was received.");
    self.postMessage({ type: "progress", stage: "model" });
    const modelSize = data.model === "tiny" ? "tiny" : "base";
    const manager = new ModelManager({ logLevel: 3 });
    const model = await manager.loadModelByUrl(`/speech/ggml-${modelSize}.bin`, (progress) => {
      self.postMessage({ type: "progress", stage: "download", progress });
    });
    const whisper = new WhisperWasmService({ logLevel: 3 });
    await whisper.initModel(model);
    self.postMessage({ type: "progress", stage: "transcribing" });
    const result = await whisper.transcribe(data.audio, undefined, {
      language: data.language,
      threads: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)),
      translate: false,
    });
    self.postMessage({ type: "complete", transcript: result.segments.map((segment) => segment.text).join(" ").trim() });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Local speech recognition failed." });
  }
};
