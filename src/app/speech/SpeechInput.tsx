"use client";

import { useEffect, useRef, useState } from "react";
import { SpeechLanguage, SpeechModel, SpeechState, transcriptScriptMatchesLanguage, transcribeInWorker } from "./transcription";

const speechLabels: Record<SpeechLanguage, { permission: string; unsupported: string; recordingError: string; empty: string; preparing: string; noSpeech: string; scriptMismatch: string; completed: string; failed: string; recording: string; stop: string; cancel: string; mic: string; cancelled: string }> = {
  en: { permission: "Allow microphone access to start a private recording.", unsupported: "Microphone recording requires a supported browser and a secure connection.", recordingError: "Recording failed. Please try again.", empty: "The recording was empty. Please try again.", preparing: "Preparing audio locally…", noSpeech: "No speech was recognized. Please try again.", scriptMismatch: "Transcript added, but it appears to be in another script. Please check and edit it.", completed: "Transcript added. Please check it and edit any mistakes.", failed: "Local speech recognition failed.", recording: "Recording. Speak, then stop when finished.", stop: "Stop recording", cancel: "Cancel", mic: "Speak your description", cancelled: "Recording or transcription cancelled." },
  hi: { permission: "निजी रिकॉर्डिंग शुरू करने के लिए माइक्रोफ़ोन की अनुमति दें।", unsupported: "माइक्रोफ़ोन रिकॉर्डिंग के लिए समर्थित ब्राउज़र और सुरक्षित कनेक्शन चाहिए।", recordingError: "रिकॉर्डिंग विफल हुई। कृपया फिर कोशिश करें।", empty: "रिकॉर्डिंग खाली थी। कृपया फिर कोशिश करें।", preparing: "ऑडियो स्थानीय रूप से तैयार हो रहा है…", noSpeech: "आवाज़ समझ नहीं आई। कृपया फिर कोशिश करें।", scriptMismatch: "ट्रांसक्रिप्ट जोड़ दिया गया है, लेकिन यह दूसरी लिपि में लग रहा है। कृपया जाँचें और संपादित करें।", completed: "ट्रांसक्रिप्ट जोड़ दिया गया। कृपया जाँचें और गलती हो तो सुधारें।", failed: "स्थानीय ट्रांसक्रिप्शन विफल हुआ।", recording: "रिकॉर्डिंग चालू है। बोलें, फिर रोकें दबाएँ।", stop: "रिकॉर्डिंग रोकें", cancel: "रद्द करें", mic: "बोलकर लिखें", cancelled: "रिकॉर्डिंग या ट्रांसक्रिप्शन रद्द किया गया।" },
  bn: { permission: "ব্যক্তিগত রেকর্ডিং শুরু করতে মাইক্রোফোনের অনুমতি দিন।", unsupported: "মাইক্রোফোন রেকর্ডিংয়ের জন্য সমর্থিত ব্রাউজার ও নিরাপদ সংযোগ প্রয়োজন।", recordingError: "রেকর্ডিং ব্যর্থ হয়েছে। আবার চেষ্টা করুন।", empty: "রেকর্ডিং খালি ছিল। আবার চেষ্টা করুন।", preparing: "অডিও স্থানীয়ভাবে প্রস্তুত হচ্ছে…", noSpeech: "কথা শনাক্ত করা যায়নি। আবার চেষ্টা করুন।", scriptMismatch: "লেখা যোগ হয়েছে, তবে অন্য লিপিতে মনে হচ্ছে। দয়া করে যাচাই করে সম্পাদনা করুন।", completed: "লেখা যোগ হয়েছে। দয়া করে মিলিয়ে দেখুন, ভুল থাকলে সম্পাদনা করুন।", failed: "স্থানীয়ভাবে কথা থেকে লেখা তৈরি করা যায়নি।", recording: "রেকর্ডিং চলছে। কথা বলুন, শেষ হলে থামুন।", stop: "রেকর্ডিং থামান", cancel: "বাতিল", mic: "কথা বলে লিখুন", cancelled: "রেকর্ডিং বা লেখা তৈরি বাতিল হয়েছে।" },
  gu: { permission: "ખાનગી રેકોર્ડિંગ શરૂ કરવા માઇક્રોફોનની પરવાનગી આપો.", unsupported: "માઇક્રોફોન રેકોર્ડિંગ માટે સપોર્ટેડ બ્રાઉઝર અને સુરક્ષિત કનેક્શન જરૂરી છે.", recordingError: "રેકોર્ડિંગ નિષ્ફળ થયું. ફરી પ્રયાસ કરો.", empty: "રેકોર્ડિંગ ખાલી હતું. ફરી પ્રયાસ કરો.", preparing: "ઑડિયો સ્થાનિક રીતે તૈયાર થઈ રહ્યો છે…", noSpeech: "બોલેલું ઓળખાયું નથી. ફરી પ્રયાસ કરો.", scriptMismatch: "લખાણ ઉમેરાયું છે, પરંતુ બીજી લિપિમાં લાગે છે. કૃપા કરીને તપાસો અને સંપાદિત કરો.", completed: "લખાણ ઉમેરાયું. કૃપા કરીને તપાસો અને ભૂલ હોય તો સુધારો.", failed: "સ્થાનિક રીતે બોલીનું લખાણ બની શક્યું નથી.", recording: "રેકોર્ડિંગ ચાલુ છે. બોલો અને પછી રોકો.", stop: "રેકોર્ડિંગ રોકો", cancel: "રદ કરો", mic: "બોલીને લખો", cancelled: "રેકોર્ડિંગ અથવા લખાણ બનાવવાનું રદ થયું." },
  pa: { permission: "ਨਿੱਜੀ ਰਿਕਾਰਡਿੰਗ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਦੀ ਇਜਾਜ਼ਤ ਦਿਓ।", unsupported: "ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਰਿਕਾਰਡਿੰਗ ਲਈ ਸਮਰਥਿਤ ਬ੍ਰਾਊਜ਼ਰ ਅਤੇ ਸੁਰੱਖਿਅਤ ਕਨੈਕਸ਼ਨ ਲੋੜੀਂਦਾ ਹੈ।", recordingError: "ਰਿਕਾਰਡਿੰਗ ਅਸਫਲ ਰਹੀ। ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।", empty: "ਰਿਕਾਰਡਿੰਗ ਖਾਲੀ ਸੀ। ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।", preparing: "ਆਡੀਓ ਸਥਾਨਕ ਤੌਰ 'ਤੇ ਤਿਆਰ ਹੋ ਰਹੀ ਹੈ…", noSpeech: "ਬੋਲੀ ਪਛਾਣੀ ਨਹੀਂ ਗਈ। ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।", scriptMismatch: "ਲਿਖਤ ਜੋੜੀ ਗਈ ਹੈ, ਪਰ ਹੋਰ ਲਿਪੀ ਵਿੱਚ ਲੱਗਦੀ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਜਾਂਚੋ ਅਤੇ ਸੋਧੋ।", completed: "ਲਿਖਤ ਜੋੜ ਦਿੱਤੀ। ਕਿਰਪਾ ਕਰਕੇ ਜਾਂਚੋ ਅਤੇ ਗਲਤੀ ਹੋਵੇ ਤਾਂ ਸੋਧੋ।", failed: "ਸਥਾਨਕ ਤੌਰ 'ਤੇ ਬੋਲੀ ਦੀ ਲਿਖਤ ਨਹੀਂ ਬਣੀ।", recording: "ਰਿਕਾਰਡਿੰਗ ਚੱਲ ਰਹੀ ਹੈ। ਬੋਲੋ, ਫਿਰ ਰੋਕੋ।", stop: "ਰਿਕਾਰਡਿੰਗ ਰੋਕੋ", cancel: "ਰੱਦ ਕਰੋ", mic: "ਬੋਲ ਕੇ ਲਿਖੋ", cancelled: "ਰਿਕਾਰਡਿੰਗ ਜਾਂ ਲਿਖਤ ਬਣਾਉਣਾ ਰੱਦ ਕੀਤਾ।" },
};

export function SpeechInput({ language, model = "base", onTranscript }: { language: SpeechLanguage; model?: SpeechModel; onTranscript: (text: string) => void }) {
  const [state, setState] = useState<SpeechState>("idle");
  const [status, setStatus] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelWorker = useRef<(() => void) | null>(null);
  const operationId = useRef(0);

  useEffect(() => () => { recorder.current?.stop(); stream.current?.getTracks().forEach((track) => track.stop()); cancelWorker.current?.(); }, []);

  async function startRecording() {
    operationId.current += 1;
    const text = speechLabels[language];
    setState("requesting-permission"); setStatus(text.permission);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(text.unsupported);
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = nextStream;
      const nextRecorder = new MediaRecorder(nextStream);
      recorder.current = nextRecorder; chunks.current = [];
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onerror = () => { nextStream.getTracks().forEach((track) => track.stop()); setState("error"); setStatus(text.recordingError); };
      nextRecorder.onstop = () => {
        nextStream.getTracks().forEach((track) => track.stop());
        const audio = new Blob(chunks.current, { type: nextRecorder.mimeType || "audio/webm" });
        if (!audio.size) { setState("error"); setStatus(text.empty); return; }
        setState("transcribing"); setStatus(text.preparing);
        const currentOperation = operationId.current;
        void convertAudioLocally(audio)
          .then((audioData) => {
            if (currentOperation !== operationId.current) return Promise.reject(new Error("Transcription cancelled."));
            const task = transcribeInWorker(audioData, language, model, (message) => setStatus(message)); cancelWorker.current = task.cancel;
            return task.result;
          }).then((transcript) => { if (currentOperation !== operationId.current) return; if (!transcript) throw new Error(text.noSpeech); const matchesScript = transcriptScriptMatchesLanguage(transcript, language); onTranscript(transcript); setState("completed"); setStatus(matchesScript ? text.completed : text.scriptMismatch); })
          .catch((error: unknown) => { if (currentOperation !== operationId.current) return; setState("error"); setStatus(error instanceof Error ? error.message : text.failed); }).finally(() => { if (currentOperation === operationId.current) cancelWorker.current = null; });
      };
      nextRecorder.start(); setState("recording"); setStatus(text.recording);
    } catch (error) { stream.current?.getTracks().forEach((track) => track.stop()); setState("error"); setStatus(recordingError(error, language)); }
  }

  function stopRecording() { if (recorder.current?.state === "recording") recorder.current.stop(); }
  function cancel() {
    operationId.current += 1;
    if (recorder.current?.state === "recording") recorder.current.stop();
    cancelWorker.current?.(); cancelWorker.current = null;
    stream.current?.getTracks().forEach((track) => track.stop()); setState("idle"); setStatus(speechLabels[language].cancelled);
  }

  return <div className="mt-3 flex flex-wrap items-center gap-2">
    {state !== "recording" && state !== "transcribing" && <button type="button" onClick={startRecording} aria-label={speechLabels[language].mic} title={speechLabels[language].mic} className="grid size-11 place-items-center rounded-xl border border-[#b9d2c9] bg-[#f2f8f4] text-[#176b66] hover:bg-[#e6f2ec]"><MicIcon /></button>}
    {state === "recording" && <button type="button" onClick={stopRecording} className="rounded-xl bg-[#a84235] px-4 py-2 text-sm font-semibold text-white">{speechLabels[language].stop}</button>}
    {(state === "recording" || state === "transcribing") && <button type="button" onClick={cancel} className="rounded-xl border border-[#d8dfd9] px-3 py-2 text-sm text-[#536361]">{speechLabels[language].cancel}</button>}
    {status && <span role={state === "error" ? "alert" : "status"} className="text-sm text-[#536361]">{status}</span>}
  </div>;
}

function recordingError(error: unknown, language: SpeechLanguage): string {
  const name = error instanceof DOMException ? error.name : "";
  if (language === "hi") return name === "NotAllowedError" ? "माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र सेटिंग में अनुमति देकर फिर कोशिश करें।" : name === "NotFoundError" ? "इस डिवाइस पर माइक्रोफ़ोन नहीं मिला।" : speechLabels.hi.recordingError;
  if (language === "bn") return name === "NotAllowedError" ? "মাইক্রোফোনের অনুমতি পাওয়া যায়নি। ব্রাউজার সেটিংসে অনুমতি দিয়ে আবার চেষ্টা করুন।" : name === "NotFoundError" ? "এই ডিভাইসে মাইক্রোফোন পাওয়া যায়নি।" : speechLabels.bn.recordingError;
  if (language === "gu") return name === "NotAllowedError" ? "માઇક્રોફોનની પરવાનગી મળી નથી. બ્રાઉઝર સેટિંગમાં પરવાનગી આપીને ફરી પ્રયાસ કરો." : name === "NotFoundError" ? "આ ઉપકરણમાં માઇક્રોફોન મળ્યો નથી." : speechLabels.gu.recordingError;
  if (language === "pa") return name === "NotAllowedError" ? "ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ ਮਿਲੀ। ਬ੍ਰਾਊਜ਼ਰ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਇਜਾਜ਼ਤ ਦੇ ਕੇ ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।" : name === "NotFoundError" ? "ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਨਹੀਂ ਮਿਲਿਆ।" : speechLabels.pa.recordingError;
  if (name === "NotAllowedError") return "Microphone access was denied. Allow it in browser settings and try again.";
  if (name === "NotFoundError") return "No microphone was found on this device.";
  if (error instanceof Error && error.message === speechLabels.en.unsupported) return error.message;
  return speechLabels.en.recordingError;
}

function MicIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" /></svg>;
}

async function convertAudioLocally(blob: Blob): Promise<Float32Array> {
  const AudioContextConstructor = window.AudioContext;
  const context = new AudioContextConstructor({ sampleRate: 16_000 });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const source = decoded.getChannelData(0);
    if (decoded.sampleRate === 16_000) return source.slice();
    const outputLength = Math.floor(source.length * 16_000 / decoded.sampleRate);
    const output = new Float32Array(outputLength);
    const ratio = decoded.sampleRate / 16_000;
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = index * ratio;
      const left = Math.floor(sourceIndex);
      const fraction = sourceIndex - left;
      output[index] = (source[left] ?? 0) * (1 - fraction) + (source[Math.min(left + 1, source.length - 1)] ?? 0) * fraction;
    }
    return output;
  } finally {
    await context.close();
  }
}
