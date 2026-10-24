import crypto from "crypto";

/**
 * Deterministically serialize any JavaScript object or value into canonical JSON.
 * Keys in objects are sorted alphabetically at all depths.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalizeJson).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalizeJson((obj as Record<string, unknown>)[key])}`
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Computes a SHA-256 hex digest of the canonicalized payload.
 */
export function hashPayload(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

const SENSITIVE_KEY_PATTERNS = [
  /pass(word)?/i,
  /secret/i,
  /token/i,
  /otp/i,
  /cvv/i,
  /cvc/i,
  /pin/i,
  /ssn/i,
  /credit[-_]?card/i,
  /auth/i,
];

/**
 * Redacts known sensitive fields (passwords, tokens, OTPs, CVVs, etc.)
 * so they are never persisted in plain audit records.
 */
export function scrubSensitiveData(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(scrubSensitiveData);

  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key))) {
      clean[key] = "[REDACTED]";
    } else if (typeof val === "object" && val !== null) {
      clean[key] = scrubSensitiveData(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}
