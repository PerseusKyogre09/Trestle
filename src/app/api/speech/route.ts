import { NextResponse } from "next/server";
import { transcribeWithSarvam } from "@/server/sarvam";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const language = (formData.get("language") as string) || "en";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
    }

    const transcript = await transcribeWithSarvam(file, language);
    return NextResponse.json({ transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speech recognition failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
