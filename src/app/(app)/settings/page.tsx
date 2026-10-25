"use client";

import { useEffect, useState } from "react";
import { SpeechLanguage } from "../../speech/transcription";

function subscribeLanguage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("trestle-language-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("trestle-language-change", onChange);
  };
}

function getLanguageSnapshot(): SpeechLanguage {
  const saved = window.localStorage.getItem("trestle-language");
  return saved === "hi" || saved === "bn" || saved === "gu" || saved === "pa" ? saved : "en";
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

type MicStatus = "unknown" | "granted" | "denied" | "prompt";

export default function SettingsPage() {
  const [language, setLanguageState] = useState<SpeechLanguage>("en");
  const [micStatus, setMicStatus] = useState<MicStatus>("unknown");
  const [requestingMic, setRequestingMic] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Sync language from localStorage
  useEffect(() => {
    function sync() {
      const saved = window.localStorage.getItem("trestle-language");
      const lang = saved === "hi" || saved === "bn" || saved === "gu" || saved === "pa" ? saved : "en";
      setLanguageState(lang);
    }
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("trestle-language-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("trestle-language-change", sync);
    };
  }, []);

  // Check microphone permissions
  useEffect(() => {
    if (!navigator.permissions) { setMicStatus("unknown"); return; }
    navigator.permissions.query({ name: "microphone" as PermissionName }).then((result) => {
      setMicStatus(result.state as MicStatus);
      result.onchange = () => setMicStatus(result.state as MicStatus);
    }).catch(() => setMicStatus("unknown"));
  }, []);

  // Reduced motion preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  function changeLanguage(lang: SpeechLanguage) {
    window.localStorage.setItem("trestle-language", lang);
    window.dispatchEvent(new Event("trestle-language-change"));
  }

  async function requestMicPermission() {
    setRequestingMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicStatus("granted");
    } catch {
      setMicStatus("denied");
    } finally {
      setRequestingMic(false);
    }
  }

  const micStatusLabel: Record<MicStatus, { label: string; note: string; cls: string }> = {
    granted: { label: "Allowed", note: "TRESTLE can record your voice locally. Recordings are never sent to a server.", cls: "t-status t-status-active" },
    denied: { label: "Blocked", note: "Microphone access was denied. To enable voice input, change the permission in your browser's address bar, then reload this page.", cls: "t-status t-status-failed" },
    prompt: { label: "Not yet decided", note: "TRESTLE will ask for permission the first time you use voice input.", cls: "t-status t-status-pending" },
    unknown: { label: "Status unknown", note: "Your browser does not expose microphone permission status. Try recording to see if it works.", cls: "t-status t-status-pending" },
  };

  return (
    <div style={{ minHeight: "100%", padding: "32px 24px 64px", maxWidth: 680, margin: "0 auto", width: "100%" }}>
      {/* ── Header ─────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <p className="t-eyebrow">Settings</p>
        <h1 style={{ marginTop: 4, fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--color-ink)" }}>
          Preferences & privacy
        </h1>
      </div>

      {/* ── Privacy & data ──────────────────────── */}
      <section aria-labelledby="privacy-heading" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <ShieldIcon />
          <h2 id="privacy-heading" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
            Privacy & data handling
          </h2>
        </div>

        <div className="t-card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>
              Where is my data processed?
            </p>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "Case plans (Groq)", local: false, note: "A privacy-screened event description is sent to Groq to draft workflow steps. Your name, contact, account, and identity numbers are not sent." },
                { label: "Speech recognition (Whisper WASM)", local: true, note: "All audio recording and transcription happens locally in your browser. No audio ever leaves your device." },
                { label: "Workflow execution (TinyFish)", local: false, note: "When TRESTLE navigates official websites, a remote browser session is used. Page content observed during research is returned to TRESTLE." },
                { label: "Case storage (SQLite)", local: true, note: "All case data, actions, approvals, and evidence are stored on this server's local SQLite database." },
              ].map(({ label, local, note }) => (
                <div key={label} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--color-ink)" }}>{label}</span>
                      <span className={local ? "t-status t-status-active" : "t-status t-status-in-progress"} style={{ fontSize: 11 }}>
                        {local ? "Local" : "Remote"}
                      </span>
                    </div>
                    <p style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.55, color: "var(--color-ink-secondary)" }}>{note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Microphone ──────────────────────────── */}
      <section aria-labelledby="mic-heading" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <MicIcon />
          <h2 id="mic-heading" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
            Voice input
          </h2>
        </div>

        <div className="t-card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>Microphone permission</span>
                <span className={micStatusLabel[micStatus].cls} style={{ fontSize: 11 }}>
                  {micStatusLabel[micStatus].label}
                </span>
              </div>
              <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: "var(--color-ink-secondary)" }}>
                {micStatusLabel[micStatus].note}
              </p>
            </div>
            {(micStatus === "prompt" || micStatus === "unknown") && (
              <button
                type="button"
                disabled={requestingMic}
                onClick={requestMicPermission}
                className="t-btn t-btn-secondary t-btn-sm"
                style={{ flexShrink: 0 }}
              >
                {requestingMic ? "Requesting…" : "Allow microphone"}
              </button>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 14 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>Speech model</p>
            <p style={{ marginTop: 4, fontSize: 13, lineHeight: 1.55, color: "var(--color-ink-secondary)" }}>
              TRESTLE uses Whisper Base (WASM) — a small, fast model that runs entirely in your browser.
              No audio is uploaded to any server. The model is downloaded once and cached locally.
            </p>
            <div className="t-alert t-alert-neutral" style={{ marginTop: 10, fontSize: 13 }}>
              <strong>Local model only.</strong> Voice input does not use a cloud transcription service.
              If you prefer not to use the local model, you can always type your situation instead.
            </div>
          </div>
        </div>
      </section>

      {/* ── Language ────────────────────────────── */}
      <section aria-labelledby="language-heading" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <GlobeIcon />
          <h2 id="language-heading" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
            Language
          </h2>
        </div>

        <div className="t-card" style={{ padding: "20px 24px" }}>
          <label htmlFor="settings-language" className="t-label">
            Interface language
          </label>
          <p style={{ fontSize: 13, color: "var(--color-ink-secondary)", marginBottom: 10 }}>
            Changes the language used in TRESTLE's interface and speech input.
          </p>
          <select
            id="settings-language"
            value={language}
            onChange={(e) => changeLanguage(e.target.value as SpeechLanguage)}
            className="t-input t-select"
            style={{ maxWidth: 240 }}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="bn">বাংলা</option>
            <option value="gu">ગુજરાતી</option>
            <option value="pa">ਪੰਜਾਬੀ</option>
          </select>
        </div>
      </section>

      {/* ── Accessibility ───────────────────────── */}
      <section aria-labelledby="a11y-heading" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <InfoIcon />
          <h2 id="a11y-heading" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
            Accessibility
          </h2>
        </div>

        <div className="t-card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>Reduced motion</p>
              <p style={{ marginTop: 4, fontSize: 13, lineHeight: 1.5, color: "var(--color-ink-secondary)" }}>
                {reducedMotion
                  ? "Your system is set to reduce motion. TRESTLE respects this preference — transitions and animations are minimal."
                  : "TRESTLE uses small, purposeful transitions. To reduce all motion, enable \"Reduce motion\" in your operating system's accessibility settings."}
              </p>
            </div>
            <span className={reducedMotion ? "t-status t-status-active" : "t-status t-status-pending"} style={{ fontSize: 11, flexShrink: 0 }}>
              {reducedMotion ? "Active" : "System default"}
            </span>
          </div>
        </div>
      </section>

      {/* ── About ───────────────────────────────── */}
      <section aria-labelledby="about-heading">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <InfoIcon />
          <h2 id="about-heading" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
            About TRESTLE
          </h2>
        </div>

        <div className="t-card" style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-ink-secondary)" }}>
            TRESTLE helps you navigate complicated real-life situations — understanding your problem,
            creating an actionable plan, researching relevant information, guiding you through real
            websites, collecting evidence, and tracking genuine outcomes.
          </p>
          <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.7, color: "var(--color-ink-secondary)" }}>
            All case data is stored locally. TRESTLE never claims an action succeeded without evidence
            that the real-world action occurred. Voice recognition runs entirely in your browser.
          </p>
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
            <p style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>
              TRESTLE · Local development build
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
