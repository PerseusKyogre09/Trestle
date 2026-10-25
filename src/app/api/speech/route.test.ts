import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "./route";
import * as sarvam from "@/server/sarvam";

describe("speech transcription route", () => {
  it("returns 400 when no audio file is provided", async () => {
    const formData = new FormData();
    formData.append("language", "hi");
    const req = new Request("http://localhost/api/speech", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/No audio file/i);
  });

  it("transcribes audio file with Sarvam and returns transcript", async () => {
    const spy = vi.spyOn(sarvam, "transcribeWithSarvam").mockResolvedValueOnce("मेरा पर्स खो गया है");
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(100)], { type: "audio/wav" }), "test.wav");
    formData.append("language", "hi");

    const req = new Request("http://localhost/api/speech", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transcript).toBe("मेरा पर्स खो गया है");
    expect(spy).toHaveBeenCalledWith(expect.any(Blob), "hi");
    spy.mockRestore();
  });
});
