import "server-only";

const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";

export const languageCodeMap: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  pa: "pa-IN",
};

export async function transcribeWithSarvam(
  audioBlob: Blob,
  language: string,
  model = "saaras:v4",
): Promise<string> {
  const apiKey = process.env.SARVAM_API || process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error("Sarvam API key is not configured.");
  }

  const languageCode = languageCodeMap[language] || "unknown";

  const formData = new FormData();
  formData.append("file", audioBlob, "speech.wav");
  formData.append("model", model);
  formData.append("language_code", languageCode);
  formData.append("mode", "transcribe");

  const response = await fetch(SARVAM_STT_URL, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Sarvam STT failed with status ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { transcript?: string };
  return (data.transcript ?? "").trim();
}
