"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Case } from "../../../domain/types";

type Filter = "active" | "completed" | "all";

function progressPct(item: Case): number {
  if (!item.actions.length) return 0;
  return Math.round(
    (item.actions.filter((a) => a.status === "completed").length /
      item.actions.length) *
      100
  );
}

function nextStep(item: Case): string {
  const pending = item.actions.find(
    (a) => a.status !== "completed" && a.status !== "failed"
  );
  return pending?.title ?? "Review outcome";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - Date.parse(dateStr);
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    active: "t-status t-status-active",
    completed: "t-status t-status-completed",
    archived: "t-status t-status-pending",
  };
  return map[status] ?? "t-status t-status-pending";
}

function StepsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 36, height: 36, color: "var(--color-ink-muted)" }}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }} stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export default function CasesPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch("/api/cases", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load cases.");
        return r.json();
      })
      .then((data) => {
        setCases(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load cases.");
        setLoading(false);
      });
  }, []);

  const filtered = cases.filter((c) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && c.status === "active") ||
      (filter === "completed" && c.status === "completed");
    const matchesQuery =
      !query.trim() ||
      c.title.toLowerCase().includes(query.toLowerCase()) ||
      c.originalInput.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  });

  const activeCnt = cases.filter((c) => c.status === "active").length;
  const completedCnt = cases.filter((c) => c.status === "completed").length;

  return (
    <div style={{ minHeight: "100%", padding: "32px 24px 64px", maxWidth: 800, margin: "0 auto", width: "100%" }}>
      {/* ── Page header ──────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="t-eyebrow">My cases</p>
          <h1 style={{ marginTop: 4, fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--color-ink)" }}>
            Your situations
          </h1>
        </div>
        <Link href="/" className="t-btn t-btn-primary t-btn-sm" style={{ display: "inline-flex", textDecoration: "none" }}>
          <PlusIcon /> New case
        </Link>
      </div>

      {/* ── Filter tabs ───────────────────────── */}
      <div style={{ marginTop: 24, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {([
          { key: "active", label: `Active (${activeCnt})` },
          { key: "completed", label: `Completed (${completedCnt})` },
          { key: "all", label: `All (${cases.length})` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={filter === key ? "t-btn t-btn-primary t-btn-sm" : "t-btn t-btn-ghost t-btn-sm"}
            aria-pressed={filter === key}
          >
            {label}
          </button>
        ))}

        {/* Search */}
        {cases.length > 5 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cases…"
            className="t-input"
            style={{ marginLeft: "auto", width: 200, padding: "6px 12px", fontSize: 13 }}
            aria-label="Search cases"
          />
        )}
      </div>

      {/* ── Content ───────────────────────────── */}
      <div style={{ marginTop: 20 }}>
        {error && (
          <div className="t-alert t-alert-error" style={{ marginBottom: 16 }} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((n) => (
              <div key={n} className="t-skeleton" style={{ height: 100, borderRadius: 14 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="t-card" style={{ marginTop: 8 }}>
            <div className="t-empty">
              <StepsIcon />
              <p className="t-empty-title">
                {query ? "No matching cases" : filter === "completed" ? "No completed cases yet" : "No active cases"}
              </p>
              <p className="t-empty-text">
                {query
                  ? "Try a different search term."
                  : filter === "completed"
                  ? "Cases you finish will appear here."
                  : "Start by describing your situation on the home page."}
              </p>
              {!query && (
                <Link href="/" className="t-btn t-btn-primary" style={{ textDecoration: "none", marginTop: 8 }}>
                  <PlusIcon /> Start a new case
                </Link>
              )}
            </div>
          </div>
        ) : (
          <ul style={{ display: "flex", flexDirection: "column", gap: 10, listStyle: "none" }}>
            {filtered.map((item) => {
              const pct = progressPct(item);
              const isCompleted = item.status === "completed";
              return (
                <li key={item.id}>
                  <Link
                    href={`/cases/${item.id}`}
                    className="t-card t-card-interactive"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "16px 20px",
                      textDecoration: "none",
                      color: "inherit",
                      opacity: isCompleted ? 0.85 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Header row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                          {item.title}
                        </h2>
                        <span className={statusClass(item.status)} style={{ fontSize: 11, flexShrink: 0 }}>
                          {item.status}
                        </span>
                      </div>

                      {/* Description */}
                      {item.originalInput && (
                        <p style={{ marginTop: 4, fontSize: 13, color: "var(--color-ink-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.originalInput}
                        </p>
                      )}

                      {/* Progress bar */}
                      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="t-progress-track" style={{ flex: 1, height: 4 }}>
                          <div
                            className="t-progress-fill"
                            style={{
                              width: `${pct}%`,
                              background: isCompleted ? "var(--color-success-text)" : "var(--color-primary)",
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 11.5, color: "var(--color-ink-muted)", flexShrink: 0 }}>
                          {item.actions.filter((a) => a.status === "completed").length}/{item.actions.length} steps
                        </span>
                      </div>

                      {/* Footer row */}
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {!isCompleted && (
                          <p style={{ fontSize: 12.5, color: "var(--color-primary)", fontWeight: 500 }}>
                            Next: {nextStep(item)}
                          </p>
                        )}
                        <span style={{ fontSize: 11.5, color: "var(--color-ink-muted)", marginLeft: "auto" }}>
                          {relativeTime(item.updatedAt)}
                        </span>
                      </div>
                    </div>

                    <span style={{ color: "var(--color-primary)", flexShrink: 0 }} aria-hidden="true">
                      <ArrowRightIcon />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
