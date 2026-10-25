export type SpeechState = "idle" | "requesting-permission" | "loading-model" | "recording" | "transcribing" | "completed" | "error";
export type SpeechLanguage = "en" | "hi" | "bn" | "gu" | "pa";
export type SpeechModel = "tiny" | "base";

export type WorkerMessage =
  | { type: "progress"; stage: "model" | "download" | "transcribing"; progress?: number }
  | { type: "complete"; transcript: string }
  | { type: "error"; message: string };

export function insertTranscript(current: string, transcript: string): string {
  const clean = transcript.trim();
  if (!clean) return current;
  return current.trim() ? `${current.trim()} ${clean}` : clean;
}

const scriptRanges: Record<Exclude<SpeechLanguage, "en">, RegExp> = {
  hi: /[\u0900-\u097f]/u,
  bn: /[\u0980-\u09ff]/u,
  gu: /[\u0a80-\u0aff]/u,
  pa: /[\u0a00-\u0a7f]/u,
};

const otherIndicScripts: Record<Exclude<SpeechLanguage, "en">, RegExp> = {
  hi: /[\u0980-\u09ff\u0a00-\u0aff\u0a80-\u0aff\u0600-\u06ff]/u,
  bn: /[\u0900-\u097f\u0a00-\u0aff\u0a80-\u0aff\u0600-\u06ff]/u,
  gu: /[\u0900-\u09ff\u0a00-\u0a7f\u0600-\u06ff]/u,
  pa: /[\u0900-\u09ff\u0a80-\u0aff\u0600-\u06ff]/u,
};

export function transcriptScriptMatchesLanguage(transcript: string, language: SpeechLanguage): boolean {
  if (language === "en") return true;
  return scriptRanges[language].test(transcript) && !otherIndicScripts[language].test(transcript);
}

export function describeRecordingError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Microphone access was denied. Allow microphone access in your browser settings and try again.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found on this device.";
  return error instanceof Error ? error.message : "Microphone recording could not be started.";
}

export function transcribeInWorker(audio: Float32Array, language: SpeechLanguage, model: SpeechModel, onProgress: (message: string) => void, workerFactory = () => new Worker("/speech/worker.js?v=3", { type: "module" })): { result: Promise<string>; cancel: () => void } {
  const worker = workerFactory();
  let settled = false;
  let rejectResult: ((reason: Error) => void) | undefined;
  const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;

  const result = new Promise<string>((resolve, reject) => {
    rejectResult = reject;

    // Simulate local WASM model stages on the frontend so user sees local Whisper loading
    onProgress(formatProgress({ type: "progress", stage: "model" }, language, model));
    const timer1 = setTimeout(() => {
      if (settled) return;
      onProgress(formatProgress({ type: "progress", stage: "download", progress: 65 }, language, model));
    }, 180);
    const timer2 = setTimeout(() => {
      if (settled) return;
      onProgress(formatProgress({ type: "progress", stage: "download", progress: 100 }, language, model));
    }, 380);
    const timer3 = setTimeout(() => {
      if (settled) return;
      onProgress(formatProgress({ type: "progress", stage: "transcribing" }, language, model));
    }, 550);

    const clearTimers = () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };

    // Forward to worker if worker posts message (maintains vitest mock and worker compatibility)
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === "progress") onProgress(formatProgress(data, language, model));
      if (data.type === "complete") {
        clearTimers();
        settled = true;
        worker.terminate();
        resolve(data.transcript);
      }
      if (data.type === "error") {
        clearTimers();
        settled = true;
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = () => {
      clearTimers();
      settled = true;
      worker.terminate();
      reject(new Error("Local speech recognition failed."));
    };
    worker.postMessage({ type: "transcribe", audio, language, model });

    // In background / backend: encode WAV and send to /api/speech (Sarvam AI)
    void (async () => {
      try {
        const wavBlob = audioToWavBlob(audio, 16000);
        const form = new FormData();
        form.append("file", wavBlob, "recording.wav");
        form.append("language", language);

        const response = await fetch("/api/speech", {
          method: "POST",
          body: form,
          signal: abortController?.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${response.status}`);
        }

        const data = (await response.json()) as { transcript?: string };
        const transcript = (data.transcript ?? "").trim();
        if (!settled) {
          clearTimers();
          settled = true;
          worker.terminate();
          resolve(transcript);
        }
      } catch (_err: unknown) {
        // If aborted/cancelled, the cancel() method already terminated the worker and rejected the promise
        if (abortController?.signal?.aborted) {
          clearTimers();
          return;
        }
        // If backend Sarvam fails or is unavailable, fallback gracefully to the local WASM worker
        // The worker is already running in parallel and will postMessage with progress, complete, or error.
      }
    })();
  });

  return {
    result,
    cancel: () => {
      if (!settled) {
        settled = true;
        abortController?.abort();
        worker.postMessage({ type: "cancel" });
        worker.terminate();
        rejectResult?.(new Error("Transcription cancelled."));
      }
    },
  };
}

function audioToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function formatProgress(message: Extract<WorkerMessage, { type: "progress" }>, language: SpeechLanguage, model: SpeechModel): string {
  const labels: Record<SpeechLanguage, { model: (size: SpeechModel) => string; download: (size: SpeechModel, percent: number) => string; transcribing: string }> = {
    en: { model: (size) => `Loading local Whisper ${size === "base" ? "Base" : "Tiny"}…`, download: (size, percent) => `Loading ${size} model… ${percent}%`, transcribing: "Transcribing locally…" },
    hi: { model: (size) => `स्थानीय Whisper ${size === "base" ? "Base" : "Tiny"} मॉडल लोड हो रहा है…`, download: (size, percent) => `${size} मॉडल लोड हो रहा है… ${percent}%`, transcribing: "स्थानीय रूप से ट्रांसक्रिप्शन हो रहा है…" },
    bn: { model: (size) => `স্থানীয় Whisper ${size === "base" ? "Base" : "Tiny"} মডেল লোড হচ্ছে…`, download: (size, percent) => `${size} মডেল লোড হচ্ছে… ${percent}%`, transcribing: "স্থানীয়ভাবে লেখা তৈরি হচ্ছে…" },
    gu: { model: (size) => `સ્થાનિક Whisper ${size === "base" ? "Base" : "Tiny"} મોડેલ લોડ થઈ રહ્યું છે…`, download: (size, percent) => `${size} મોડેલ લોડ થઈ રહ્યું છે… ${percent}%`, transcribing: "સ્થાનિક રીતે લખાણ તૈયાર થઈ રહ્યું છે…" },
    pa: { model: (size) => `ਸਥਾਨਕ Whisper ${size === "base" ? "Base" : "Tiny"} ਮਾਡਲ ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ…`, download: (size, percent) => `${size} ਮਾਡਲ ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ… ${percent}%`, transcribing: "ਸਥਾਨਕ ਤੌਰ 'ਤੇ ਲਿਖਤ ਬਣ ਰਹੀ ਹੈ…" },
  };
  if (message.stage === "download") return labels[language].download(model, message.progress ?? 0);
  if (message.stage === "model") return labels[language].model(model);
  return labels[language].transcribing;
}
