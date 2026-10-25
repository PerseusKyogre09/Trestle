"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function CasesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <line x1="12" y1="12" x2="12" y2="16" />
      <line x1="10" y1="14" x2="14" y2="14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ width: 20, height: 20 }}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

const navItems = [
  { href: "/app", label: "Home", Icon: HomeIcon, matchExact: false },
  { href: "/cases", label: "My cases", Icon: CasesIcon, matchExact: false },
  { href: "/settings", label: "Settings", Icon: SettingsIcon, matchExact: true },
] as const;

function TrestleLogo({ size = 28 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: "#245B45",
        borderRadius: Math.round(size * 0.3),
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
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="t-shell">
      {/* ── Desktop sidebar ───────────────────── */}
      <nav className="t-sidebar" aria-label="Primary navigation">
        <Link href="/app" className="t-sidebar-logo" aria-label="TRESTLE home">
          <TrestleLogo />
          <span className="t-sidebar-wordmark">trestle</span>
        </Link>
        <p className="t-sidebar-tagline">Your personal guide for real-life situations</p>

        <div className="t-sidebar-nav">
          {navItems.map(({ href, label, Icon, matchExact }) => (
            <Link
              key={href}
              href={href}
              className={`t-sidebar-link${isActive(href, matchExact) ? " active" : ""}`}
              aria-current={isActive(href, matchExact) ? "page" : undefined}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </div>

        <div className="t-sidebar-footer">
          <p style={{ fontSize: 11, color: "var(--color-ink-muted)", lineHeight: 1.5 }}>
            Privacy by design.{" "}
            <span style={{ display: "block" }}>All processing is local where possible.</span>
          </p>
        </div>
      </nav>

      {/* ── Mobile top bar ───────────────────── */}
      <header className="t-topbar" aria-label="TRESTLE mobile header">
        <Link href="/app" className="t-topbar-logo" aria-label="TRESTLE home">
          <TrestleLogo size={30} />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)" }}>
            trestle
          </span>
        </Link>
        <span style={{ fontSize: 11, color: "var(--color-ink-muted)" }}>
          Privacy by design
        </span>
      </header>

      {/* ── Main content ─────────────────────── */}
      <main className="t-main" id="main-content">
        {children}
      </main>

      {/* ── Mobile bottom nav ────────────────── */}
      <div className="t-bottom-nav" aria-label="Mobile navigation">
        <div className="t-bottom-nav-items">
          {navItems.map(({ href, label, Icon, matchExact }) => (
            <Link
              key={href}
              href={href}
              className={`t-bottom-nav-item${isActive(href, matchExact) ? " active" : ""}`}
              aria-current={isActive(href, matchExact) ? "page" : undefined}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
