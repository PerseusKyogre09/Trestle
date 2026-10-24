import { describe, expect, it } from "vitest";
import { canonicalizeJson, hashPayload, scrubSensitiveData } from "./crypto";

describe("Crypto and Security Utilities", () => {
  it("deterministically canonicalizes JSON with out-of-order keys", () => {
    const objA = { b: 2, a: 1, c: { z: 9, y: 8 } };
    const objB = { a: 1, c: { y: 8, z: 9 }, b: 2 };

    const canonA = canonicalizeJson(objA);
    const canonB = canonicalizeJson(objB);

    expect(canonA).toBe(canonB);
    expect(hashPayload(objA)).toBe(hashPayload(objB));
  });

  it("produces distinct SHA-256 hashes for different payloads", () => {
    const hash1 = hashPayload({ field: "value1" });
    const hash2 = hashPayload({ field: "value2" });
    expect(hash1).not.toBe(hash2);
  });

  it("scrubs sensitive keys (passwords, tokens, OTPs, CVVs) from data structures", () => {
    const sensitive = {
      username: "user123",
      password: "SuperSecretPassword!",
      auth_token: "xyz987token",
      cardDetails: {
        number: "4111222233334444",
        cvv: "123",
        pin: "9999",
      },
      otpCode: "654321",
    };

    const scrubbed = scrubSensitiveData(sensitive) as {
      username: string;
      password: string;
      auth_token: string;
      cardDetails: { number: string; cvv: string; pin: string };
      otpCode: string;
    };
    expect(scrubbed.username).toBe("user123");
    expect(scrubbed.password).toBe("[REDACTED]");
    expect(scrubbed.auth_token).toBe("[REDACTED]");
    expect(scrubbed.cardDetails.cvv).toBe("[REDACTED]");
    expect(scrubbed.cardDetails.pin).toBe("[REDACTED]");
    expect(scrubbed.otpCode).toBe("[REDACTED]");
  });
});
