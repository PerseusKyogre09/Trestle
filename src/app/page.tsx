"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import type { Case, Workflow } from "../domain/types";

export default function Home() {
  const [input, setInput] = useState("");
  const [cases, setCases] = useState<Case[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<Workflow | null>(null);
  useEffect(() => {
    fetch("/api/cases").then((r) => r.ok ? r.json() : []).then(setCases).catch(
      () => setMessage("Cases could not be loaded. Run database setup first."),
    );
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalInput: input }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "Compilation failed.");
      return;
    }
    setProposal(data.workflow);
    setMessage(data.source === "deterministic-fallback" ? "Deterministic fallback plan ready for review." : "AI proposal ready for review.");
  }
  async function saveProposal() {
    if (!proposal) return;
    setLoading(true);
    const response = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalInput: input, workflow: proposal }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not save the reviewed workflow.");
      return;
    }
    setCases((current) => [data, ...current]);
    setProposal(null);
    setInput("");
    setMessage("Reviewed workflow saved as an active case.");
  }
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10 sm:px-10">
      <header className="mb-16">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-300">
          TRESTLE
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-100 sm:text-6xl">
          The Life-Event Compiler
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
          Describe a complex event. TRESTLE compiles it into a dependency-aware
          plan with explicit evidence and human checkpoints.
        </p>
      </header>
      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <form
          onSubmit={submit}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"
        >
          <label htmlFor="event" className="text-sm font-medium text-slate-200">
            What happened?
          </label>
          <textarea
            id="event"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="I lost my wallet containing my debit card and Indian driving licence."
            className="mt-4 min-h-40 w-full rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-100 outline-none ring-blue-400 placeholder:text-slate-600 focus:ring-2"
          />
          <button
            disabled={loading}
            className="mt-4 rounded-lg bg-blue-500 px-5 py-3 font-medium text-white hover:bg-blue-400 disabled:opacity-50"
          >
            {loading ? "Planning…" : "Plan event"}
          </button>
          {message && (
            <p role="alert" className="mt-4 text-sm text-rose-300">{message}</p>
          )}
          <p className="mt-5 text-xs leading-5 text-slate-500">
            Your description is classified locally. The proposed workflow must be reviewed before it is saved.
          </p>
        </form>
        {proposal && (
          <section className="rounded-2xl border border-blue-400/30 bg-slate-900/80 p-6 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Proposed workflow</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-100">{proposal.title}</h2>
                <p className="mt-2 text-sm text-slate-400">{proposal.description}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setProposal(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">Reject</button>
                <button type="button" onClick={saveProposal} disabled={loading} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">Save reviewed workflow</button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {proposal.actions.map((action, index) => (
                <article key={action.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-slate-100">{index + 1}. {action.title}</h3>
                    <span className="text-xs uppercase text-amber-300">{action.riskLevel}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{action.description}</p>
                  <p className="mt-2 text-xs text-slate-500">{action.dependencies.length ? `After: ${action.dependencies.join(", ")}` : "Independent task"}</p>
                  <p className="mt-1 text-xs text-slate-500">{action.approvalRequired ? "Human approval required" : "No approval flagged"} · {action.executionMode === "manual" ? "User action" : "Assisted"}</p>
                  <p className="mt-1 text-xs text-slate-500">Success: {action.successCriteria.join(" ")}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-100">Cases</h2>
            <span className="text-sm text-slate-500">{cases.length} total</span>
          </div>
          {cases.length === 0
            ? (
              <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-sm text-slate-500">
                No cases yet. Describe an event to create your first workflow.
              </div>
            )
            : (
              <div className="space-y-3">
                {cases.map((item) => (
                  <Link
                    href={`/cases/${item.id}`}
                    key={item.id}
                    className="block rounded-xl border border-slate-800 bg-slate-900/50 p-5 hover:border-blue-400/50"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-medium text-slate-100">
                        {item.title}
                      </h3>
                      <span className="rounded-full bg-blue-400/10 px-2 py-1 text-xs text-blue-300">
                        {item.actions.filter((a) => a.status === "completed")
                          .length}/{item.actions.length}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                      {item.originalInput}
                    </p>
                  </Link>
                ))}
              </div>
            )}
        </section>
      </section>
    </main>
  );
}
