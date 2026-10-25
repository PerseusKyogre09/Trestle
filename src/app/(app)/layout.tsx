import type { ReactNode } from "react";
import { AppShell } from "../components/AppShell";

/**
 * Layout for all tool pages (/app, /cases, /settings).
 * Wraps content in the AppShell sidebar navigation.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
