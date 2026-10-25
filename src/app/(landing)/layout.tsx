import type { ReactNode } from "react";

/**
 * Layout for the landing page route group.
 * Full-width, no sidebar — the landing page manages its own navigation.
 */
export default function LandingLayout({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: "100dvh", background: "var(--color-canvas)" }}>{children}</div>;
}
