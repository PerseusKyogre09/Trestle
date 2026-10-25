import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TRESTLE — One problem. One clear next step.",
  description:
    "TRESTLE helps you navigate complicated real-life situations. Describe what's happening and TRESTLE creates an action plan, finds official information, guides you through real websites, and tracks what actually happened.",
};

/* ──────────────────────────────────────────────────────────────
   TRESTLE Marketing Landing Page
   Server component — no interactivity, pure HTML + CSS.
   ────────────────────────────────────────────────────────────── */

function TrestleMark({ size = 36 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: "#245B45",
        borderRadius: Math.round(size * 0.28),
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" fill="none" style={{ width: size * 0.55, height: size * 0.55 }}>
        <path
          d="M4 6h12M4 6l2-2h8l2 2M6 6v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6M9 6v10M11 6v10"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

const features = [
  {
    icon: "🧭",
    title: "Understands your situation",
    body: "Describe what's happening in plain language — or speak it aloud. TRESTLE reads between the lines and identifies the real problem.",
  },
  {
    icon: "📋",
    title: "Creates an actionable plan",
    body: "Every case gets a step-by-step workflow tailored to your situation. Steps are in the right order, with dependencies tracked.",
  },
  {
    icon: "🔍",
    title: "Finds official information",
    body: "TRESTLE uses a live browser to research government websites, report pages, and service portals — and shows you exactly where it looked.",
  },
  {
    icon: "🌐",
    title: "Guides you through real websites",
    body: "When TRESTLE finds an official page, it opens it in a shared live browser. You take control when the site needs your input.",
  },
  {
    icon: "✅",
    title: "Tracks real outcomes",
    body: "TRESTLE never marks a step complete unless it can actually confirm what happened. No false progress. No claims it can't verify.",
  },
  {
    icon: "🔒",
    title: "Private by design",
    body: "Voice recognition runs entirely in your browser. Case data stays on your device. Sensitive numbers are never sent to cloud services.",
  },
];

const situations = [
  { emoji: "📱", label: "Lost or stolen phone" },
  { emoji: "📞", label: "Report spam or suspicious calls" },
  { emoji: "📄", label: "Replace a lost document" },
  { emoji: "✈️", label: "Prepare for international travel" },
  { emoji: "📦", label: "Resolve an online order dispute" },
  { emoji: "🏛️", label: "Navigate a government service" },
  { emoji: "💳", label: "Block a lost card" },
  { emoji: "🗃️", label: "File an official complaint" },
];

const steps = [
  {
    n: "01",
    title: "Describe what's going on",
    body: "Type or speak your situation in plain words. TRESTLE understands messy real-life problems, not just keywords.",
  },
  {
    n: "02",
    title: "Review the plan",
    body: "TRESTLE drafts an ordered action plan. You review it before anything is created — nothing happens without you.",
  },
  {
    n: "03",
    title: "Work through the steps",
    body: "TRESTLE researches official sources, opens verified pages, and tells you exactly what to do at each step.",
  },
  {
    n: "04",
    title: "See what actually happened",
    body: "Every completed step is backed by evidence — a verified page visit, your own report, or a recorded outcome.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Skip nav */}
      <a href="#main" style={{ position: "absolute", left: -9999, top: 8, zIndex: 100, background: "var(--color-primary)", color: "white", padding: "8px 16px", borderRadius: 8 }} className="focus:left-4">
        Skip to content
      </a>

      {/* ── Navbar ──────────────────────────── */}
      <nav
        aria-label="Site navigation"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(248,247,242,0.90)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
          {/* Logo */}
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <TrestleMark size={30} />
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--color-ink)" }}>trestle</span>
          </Link>

          {/* Desktop nav links */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }} role="list">
            {[
              { href: "#how-it-works", label: "How it works" },
              { href: "#features", label: "Features" },
              { href: "#situations", label: "Use cases" },
            ].map(({ href, label }) => (
              <a
                key={href}
                href={href}
                style={{
                  fontSize: 14, fontWeight: 500, color: "var(--color-ink-secondary)", textDecoration: "none",
                  padding: "6px 12px", borderRadius: 8, transition: "background 120ms ease, color 120ms ease",
                }}
                role="listitem"
              >
                {label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <Link
            href="/app"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px",
              background: "var(--color-primary)", color: "white", borderRadius: 9, fontSize: 14,
              fontWeight: 600, textDecoration: "none", letterSpacing: "-0.01em",
              transition: "background 120ms ease",
            }}
          >
            Open the app →
          </Link>
        </div>
      </nav>

      {/* ── Main ────────────────────────────── */}
      <main id="main">

        {/* ── Hero ─────────────────────────── */}
        <section
          aria-label="Introduction"
          style={{
            padding: "80px 24px 72px",
            maxWidth: 1120,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 64,
            alignItems: "center",
          }}
        >
          {/* Left: copy */}
          <div>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px",
                background: "var(--color-sage)", borderRadius: 999, marginBottom: 24,
                border: "1px solid var(--color-sage-dark)",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-primary)" }}>
                One problem. One clear next step.
              </span>
            </div>

            <h1
              style={{
                fontSize: "clamp(40px, 5.5vw, 64px)",
                fontWeight: 800,
                lineHeight: 1.04,
                letterSpacing: "-0.04em",
                color: "var(--color-ink)",
                margin: 0,
              }}
            >
              Life gets
              <br />
              complicated.
              <br />
              <span style={{ color: "var(--color-primary)" }}>We'll sort it out.</span>
            </h1>

            <p
              style={{
                marginTop: 24, fontSize: 18, lineHeight: 1.7,
                color: "var(--color-ink-secondary)", maxWidth: 480,
              }}
            >
              TRESTLE is a personal guide for real-life situations.
              Describe your problem — TRESTLE builds a plan, researches official sources,
              and helps you actually get things done.
            </p>

            <div style={{ marginTop: 36, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link
                href="/app"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "14px 28px", background: "var(--color-primary)", color: "white",
                  borderRadius: 12, fontSize: 16, fontWeight: 700, textDecoration: "none",
                  letterSpacing: "-0.02em", boxShadow: "0 4px 24px rgba(36,91,69,0.22)",
                  transition: "background 150ms ease, box-shadow 150ms ease",
                }}
              >
                Start for free
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 16, height: 16 }}>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <a
                href="#how-it-works"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "14px 24px", background: "transparent", color: "var(--color-ink)",
                  borderRadius: 12, fontSize: 15, fontWeight: 600, textDecoration: "none",
                  border: "1.5px solid var(--color-border-strong)",
                }}
              >
                See how it works
              </a>
            </div>

            <p style={{ marginTop: 18, fontSize: 13, color: "var(--color-ink-muted)" }}>
              No account needed. Data stays on your device.
            </p>
          </div>

          {/* Right: visual */}
          <div aria-hidden="true" style={{ position: "relative" }}>
            {/* Mock case card */}
            <div
              style={{
                background: "var(--color-card)", borderRadius: 20, padding: 28,
                boxShadow: "0 8px 48px rgba(36,42,39,0.10), 0 2px 12px rgba(36,42,39,0.06)",
                border: "1px solid var(--color-border)",
                maxWidth: 460,
              }}
            >
              {/* Case header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-primary)" }}>Active case</span>
                  <h3 style={{ marginTop: 6, fontSize: 17, fontWeight: 700, color: "var(--color-ink)", letterSpacing: "-0.025em" }}>
                    Report an unwanted number
                  </h3>
                </div>
                <span style={{ padding: "3px 10px", background: "var(--color-success-bg)", color: "var(--color-success-text)", borderRadius: 999, fontSize: 11, fontWeight: 700, border: "1px solid var(--color-success-border)", flexShrink: 0 }}>
                  active
                </span>
              </div>

              {/* Progress */}
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-ink-secondary)" }}>Progress</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary)" }}>3 of 6 steps</span>
                </div>
                <div style={{ height: 5, background: "var(--color-border)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: "50%", height: "100%", background: "var(--color-primary)", borderRadius: 999 }} />
                </div>
              </div>

              {/* Step list */}
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 0 }}>
                {[
                  { done: true,    label: "Identify the type of call" },
                  { done: true,    label: "Record the suspicious number" },
                  { done: true,    label: "Choose a reporting route" },
                  { done: false, current: true, label: "Open official TRAI portal" },
                  { done: false,   label: "Complete the report form" },
                  { done: false,   label: "Save confirmation evidence" },
                ].map(({ done, current, label }, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 0",
                      borderBottom: i < 5 ? "1px solid var(--color-border)" : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                        display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700,
                        background: done ? "var(--color-success-bg)" : current ? "var(--color-primary)" : "var(--color-sage)",
                        color: done ? "var(--color-success-text)" : current ? "white" : "var(--color-ink-muted)",
                        border: `1.5px solid ${done ? "var(--color-success-border)" : current ? "var(--color-primary)" : "var(--color-border)"}`,
                      }}
                    >
                      {done ? "✓" : current ? "›" : ""}
                    </div>
                    <span
                      style={{
                        fontSize: 13, fontWeight: current ? 600 : 400,
                        color: done ? "var(--color-ink-muted)" : current ? "var(--color-primary)" : "var(--color-ink-secondary)",
                        textDecoration: done ? "line-through" : "none",
                      }}
                    >
                      {label}
                    </span>
                    {current && (
                      <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--color-primary)", flexShrink: 0 }}>
                        Now →
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Floating badge */}
            <div
              style={{
                position: "absolute", bottom: -16, right: -16, background: "white",
                borderRadius: 14, padding: "12px 16px", boxShadow: "0 4px 20px rgba(36,42,39,0.12)",
                border: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#EAF5EF", display: "grid", placeItems: "center", fontSize: 16 }}>
                🔒
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink)", lineHeight: 1.3 }}>Privacy by design</p>
                <p style={{ fontSize: 11, color: "var(--color-ink-muted)", marginTop: 1 }}>Voice stays in your browser</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────── */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          style={{
            padding: "80px 24px",
            background: "var(--color-sage)",
            borderTop: "1px solid var(--color-sage-dark)",
            borderBottom: "1px solid var(--color-sage-dark)",
          }}
        >
          <div style={{ maxWidth: 1120, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--color-primary)" }}>
                How it works
              </span>
              <h2
                id="how-heading"
                style={{
                  marginTop: 10, fontSize: "clamp(30px, 4vw, 44px)", fontWeight: 800,
                  letterSpacing: "-0.035em", color: "var(--color-ink)", lineHeight: 1.1,
                }}
              >
                From problem to outcome
                <br />
                in four steps
              </h2>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 2,
              }}
            >
              {steps.map(({ n, title, body }) => (
                <div
                  key={n}
                  style={{
                    background: "var(--color-card)", padding: "28px 26px",
                    borderRadius: 0, border: "1px solid var(--color-border)",
                    position: "relative",
                  }}
                >
                  <span
                    style={{
                      fontSize: 40, fontWeight: 900, letterSpacing: "-0.06em",
                      color: "var(--color-sage-dark)", lineHeight: 1, display: "block",
                      marginBottom: 16,
                    }}
                    aria-hidden="true"
                  >
                    {n}
                  </span>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--color-ink)", letterSpacing: "-0.02em", lineHeight: 1.25 }}>
                    {title}
                  </h3>
                  <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.65, color: "var(--color-ink-secondary)" }}>
                    {body}
                  </p>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 48, textAlign: "center" }}>
              <Link
                href="/app"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "13px 28px", background: "var(--color-primary)", color: "white",
                  borderRadius: 12, fontSize: 15, fontWeight: 700, textDecoration: "none",
                  letterSpacing: "-0.01em",
                }}
              >
                Try it now — free
              </Link>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────── */}
        <section
          id="features"
          aria-labelledby="features-heading"
          style={{ padding: "80px 24px", maxWidth: 1120, margin: "0 auto" }}
        >
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--color-primary)" }}>
              Features
            </span>
            <h2
              id="features-heading"
              style={{
                marginTop: 10, fontSize: "clamp(30px, 4vw, 44px)", fontWeight: 800,
                letterSpacing: "-0.035em", color: "var(--color-ink)", lineHeight: 1.1,
              }}
            >
              Everything you need
              <br />
              to actually finish it
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            {features.map(({ icon, title, body }) => (
              <div
                key={title}
                style={{
                  background: "var(--color-card)", borderRadius: 16, padding: "24px 22px",
                  border: "1px solid var(--color-border)",
                  boxShadow: "0 1px 3px rgba(36,42,39,0.04)",
                  transition: "box-shadow 200ms ease, transform 200ms ease",
                }}
              >
                <span style={{ fontSize: 28, display: "block", marginBottom: 14 }} aria-hidden="true">{icon}</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)", letterSpacing: "-0.02em" }}>
                  {title}
                </h3>
                <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.65, color: "var(--color-ink-secondary)" }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Situations ───────────────────── */}
        <section
          id="situations"
          aria-labelledby="situations-heading"
          style={{
            padding: "72px 24px",
            background: "#F2F5F1",
            borderTop: "1px solid var(--color-sage-dark)",
            borderBottom: "1px solid var(--color-sage-dark)",
          }}
        >
          <div style={{ maxWidth: 1120, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 44 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--color-primary)" }}>
                Use cases
              </span>
              <h2
                id="situations-heading"
                style={{
                  marginTop: 10, fontSize: "clamp(28px, 3.5vw, 40px)", fontWeight: 800,
                  letterSpacing: "-0.03em", color: "var(--color-ink)", lineHeight: 1.15,
                }}
              >
                TRESTLE handles
                <br />
                real-life situations
              </h2>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 10,
              }}
            >
              {situations.map(({ emoji, label }) => (
                <div
                  key={label}
                  style={{
                    background: "var(--color-card)", borderRadius: 12, padding: "16px 18px",
                    border: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 12,
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">{emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-ink)" }}>{label}</span>
                </div>
              ))}
            </div>

            <p style={{ marginTop: 20, textAlign: "center", fontSize: 14, color: "var(--color-ink-muted)" }}>
              …and anything else you describe in plain words.
            </p>
          </div>
        </section>

        {/* ── Privacy block ────────────────── */}
        <section
          aria-labelledby="privacy-heading"
          style={{ padding: "72px 24px", maxWidth: 1120, margin: "0 auto" }}
        >
          <div
            style={{
              background: "var(--color-primary)", borderRadius: 24, padding: "56px 48px",
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center",
            }}
          >
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.6)" }}>
                Privacy
              </span>
              <h2
                id="privacy-heading"
                style={{
                  marginTop: 10, fontSize: "clamp(26px, 3vw, 38px)", fontWeight: 800,
                  letterSpacing: "-0.03em", color: "white", lineHeight: 1.15,
                }}
              >
                Your situation.
                <br />
                Your device.
                <br />
                Your data.
              </h2>
              <Link
                href="/settings"
                style={{
                  marginTop: 28, display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "12px 22px", background: "rgba(255,255,255,0.15)", color: "white",
                  borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: "none",
                  border: "1.5px solid rgba(255,255,255,0.25)",
                  backdropFilter: "blur(4px)",
                }}
              >
                Privacy details →
              </Link>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { icon: "🎙️", title: "Voice stays local", body: "Whisper speech recognition runs entirely in your browser. No audio is sent anywhere." },
                { icon: "💾", title: "Cases stay on this device", body: "Your situation, action plan, and evidence are stored in a local database. Nothing is uploaded." },
                { icon: "🔍", title: "Screened before cloud", body: "When a plan needs AI, a privacy-stripped brief is sent. Your name, numbers, and credentials never are." },
              ].map(({ icon, title, body }) => (
                <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.12)", display: "grid", placeItems: "center", fontSize: 16, flexShrink: 0 }}>
                    {icon}
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "white" }}>{title}</p>
                    <p style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.70)", marginTop: 3 }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ────────────────────── */}
        <section
          aria-label="Get started"
          style={{
            padding: "80px 24px 96px",
            textAlign: "center",
            background: "var(--color-sage)",
            borderTop: "1px solid var(--color-sage-dark)",
          }}
        >
          <TrestleMark size={48} />
          <h2
            style={{
              marginTop: 20, fontSize: "clamp(32px, 5vw, 52px)", fontWeight: 800,
              letterSpacing: "-0.04em", color: "var(--color-ink)", lineHeight: 1.05,
            }}
          >
            Ready to sort it out?
          </h2>
          <p style={{ marginTop: 16, fontSize: 18, color: "var(--color-ink-secondary)", maxWidth: 440, margin: "16px auto 0" }}>
            Describe your situation and TRESTLE will figure out the rest.
            No sign-up. No cost.
          </p>
          <div style={{ marginTop: 36, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/app"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "15px 32px", background: "var(--color-primary)", color: "white",
                borderRadius: 14, fontSize: 17, fontWeight: 700, textDecoration: "none",
                letterSpacing: "-0.02em", boxShadow: "0 4px 28px rgba(36,91,69,0.24)",
              }}
            >
              Start for free
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 18, height: 18 }}>
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </section>

        {/* ── Footer ───────────────────────── */}
        <footer
          style={{
            borderTop: "1px solid var(--color-border)",
            padding: "24px",
            background: "var(--color-card)",
          }}
        >
          <div
            style={{
              maxWidth: 1120, margin: "0 auto", display: "flex",
              alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TrestleMark size={22} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>trestle</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>
              Privacy by design · Local development build
            </p>
            <div style={{ display: "flex", gap: 20 }}>
              {[
                { href: "/app", label: "Open app" },
                { href: "/cases", label: "My cases" },
                { href: "/settings", label: "Privacy" },
              ].map(({ href, label }) => (
                <Link key={href} href={href} style={{ fontSize: 13, color: "var(--color-ink-secondary)", textDecoration: "none" }}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </footer>
      </main>

      {/* ── Responsive styles ────────────── */}
      <style>{`
        @media (max-width: 768px) {
          /* Stack hero on mobile */
          section[aria-label="Introduction"] > div {
            grid-template-columns: 1fr !important;
            gap: 40px !important;
            padding: 48px 24px 56px !important;
          }
          /* Hide the mock card's floating badge on very small screens */
          section[aria-label="Introduction"] div[style*="position: absolute"] {
            display: none;
          }
          /* Privacy section */
          section[aria-labelledby="privacy-heading"] div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
            padding: 36px 24px !important;
          }
          /* How-it-works numbers grid */
          section[id="how-it-works"] div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
