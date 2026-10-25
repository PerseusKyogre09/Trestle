"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Case, Workflow } from "../domain/types";

const suggestions = [
  "I received repeated unwanted calls or messages and want to understand where to report them.",
  "I lost my wallet and need to secure my cards and replace my driving licence.",
  "I need help understanding the official steps after moving to a new city.",
];

function progress(item: Case) {
  const complete = item.actions.filter((action) => action.status === "completed").length;
  return `${complete} of ${item.actions.length} steps`;
}

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [cases, setCases] = useState<Case[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<Workflow | null>(null);
  const [proposalSource, setProposalSource] = useState("");

  useEffect(() => {
    fetch("/api/cases", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : [])
      .then(setCases)
      .catch(() => setMessage("Saved cases could not be loaded. You can still start a new case."));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originalInput: input.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "TRESTLE could not prepare a plan.");
      setProposal(data.workflow);
      setProposalSource(data.source ?? "");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "TRESTLE could not prepare a plan.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProposal() {
    if (!proposal) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originalInput: input.trim(), workflow: proposal }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save this case.");
      router.push(`/cases/${data.id}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not save this case.");
      setLoading(false);
    }
  }

  return (
    <main className="trestle-home min-h-screen">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
        <nav className="flex items-center justify-between" aria-label="Main navigation">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-[#1e3737]">
            <span className="grid size-9 place-items-center rounded-xl bg-[#176b66] text-sm font-bold text-white">T</span>
            TRESTLE
          </Link>
          <a href="#saved-cases" className="text-sm font-medium text-[#536361] hover:text-[#176b66]">Your cases</a>
        </nav>

        <section className="mt-16 grid items-start gap-12 lg:mt-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.65fr)] lg:gap-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-[#287d76]">A steady hand for life’s paperwork</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-.035em] text-[#1d2c32] sm:text-5xl">
              What do you need help getting done?
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#5d6a6a]">
              Tell TRESTLE what happened. It organizes the next steps, checks official guidance, and brings you in whenever a decision or personal action is needed.
            </p>

            <form onSubmit={submit} className="mt-8">
              <label htmlFor="event" className="mb-2 block text-sm font-semibold text-[#344548]">Describe your situation</label>
              <textarea
                id="event"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="For example: I keep getting unwanted calls from a number and want to know the right way to report them."
                maxLength={4000}
                className="min-h-36 w-full resize-y rounded-2xl border border-[#d8dfd9] bg-white p-4 text-[15px] leading-6 text-[#263638] shadow-[0_8px_30px_-24px_rgba(24,56,51,.35)] outline-none transition focus:border-[#398b82] focus:ring-4 focus:ring-[#398b82]/10 placeholder:text-[#9aa4a0]"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button disabled={loading || !input.trim()} className="rounded-xl bg-[#176b66] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#105a56] disabled:cursor-not-allowed disabled:opacity-50">
                  {loading ? "Preparing your next steps…" : "Get started"}
                </button>
                <span className="text-xs text-[#7a8581]">Your plan is reviewed before it becomes a case.</span>
              </div>
            </form>

            <div className="mt-7">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-[#77827d]">Or start with an example</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => setInput(suggestion)} className="rounded-full border border-[#dce2dc] bg-white/70 px-3.5 py-2 text-left text-xs leading-5 text-[#51615e] transition hover:border-[#87b6ae] hover:text-[#176b66]">
                    {suggestion.startsWith("I received") ? "Report unwanted calls" : suggestion.startsWith("I lost") ? "Replace lost documents" : "Prepare for a move"}
                  </button>
                ))}
              </div>
            </div>

            {message && <p role="alert" className="mt-5 rounded-xl border border-[#e5c9c0] bg-[#fff5f1] p-3 text-sm text-[#8e4032]">{message}</p>}
          </div>

          <aside className="border-t border-[#dfe4de] pt-6 lg:mt-1 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <p className="text-sm font-semibold text-[#334645]">A clearer way through</p>
            <ol className="mt-5 space-y-5">
              {[
                ["01", "Tell us what happened", "Start in your own words. No workflow knowledge needed."],
                ["02", "See the next useful step", "TRESTLE checks dependencies and finds relevant public guidance."],
                ["03", "Stay in control", "Review information and handle sensitive or consequential steps yourself."],
              ].map(([number, title, detail]) => (
                <li key={number} className="flex gap-3">
                  <span className="mt-0.5 text-xs font-semibold tabular-nums text-[#6c8c82]">{number}</span>
                  <div><h2 className="text-sm font-semibold text-[#344548]">{title}</h2><p className="mt-1 text-sm leading-6 text-[#74807d]">{detail}</p></div>
                </li>
              ))}
            </ol>
            <p className="mt-6 border-t border-[#e1e5df] pt-4 text-xs leading-5 text-[#87918c]">Research and preparation are shown separately from external actions. TRESTLE never treats a page visit as proof that something was submitted.</p>
          </aside>
        </section>

        {proposal && (
          <section className="mt-12 rounded-2xl border border-[#cbdcd4] bg-white p-5 shadow-[0_20px_50px_-40px_rgba(24,56,51,.5)] sm:p-7" aria-labelledby="proposal-title">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#287d76]">Your plan is ready to review</p>
                <h2 id="proposal-title" className="mt-2 text-2xl font-semibold tracking-tight text-[#203333]">{proposal.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[#66736f]">{proposal.description}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setProposal(null)} className="rounded-xl border border-[#d9e0da] px-4 py-2.5 text-sm font-medium text-[#53615e] hover:bg-[#f6f7f3]">Edit description</button>
                <button type="button" onClick={saveProposal} disabled={loading} className="rounded-xl bg-[#176b66] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#105a56] disabled:opacity-50">{loading ? "Saving…" : "Create my case"}</button>
              </div>
            </div>
            <div className="mt-6 border-t border-[#edf0eb] pt-4">
              <p className="text-sm font-semibold text-[#40504d]">What TRESTLE will work through</p>
              <ol className="mt-3 divide-y divide-[#edf0eb]">
                {proposal.actions.map((action) => <li key={action.id} className="flex gap-3 py-3 text-sm">
                  <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[#e8f2ed] text-[11px] font-semibold text-[#287d76]">✓</span>
                  <div><p className="font-medium text-[#344548]">{action.title}</p><p className="mt-1 leading-5 text-[#75817d]">{action.description}</p></div>
                </li>)}
              </ol>
              <p className="mt-3 text-xs text-[#89938e]">{proposalSource === "deterministic-fallback" ? "Prepared with TRESTLE’s local workflow rules because Groq planning was unavailable or did not meet the workflow safety checks." : "Groq drafted these steps from a privacy-screened event description. TRESTLE checks the plan before you save; contact, account, and identity numbers are not sent to Groq."}</p>
            </div>
          </section>
        )}

        <section id="saved-cases" className="mt-20 scroll-mt-8 border-t border-[#dfe4de] pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#75817d]">Pick up where you left off</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#233332]">Your cases</h2></div>
            <span className="text-sm text-[#7f8985]">{cases.length} saved</span>
          </div>
          {cases.length === 0 ? <p className="mt-5 text-sm text-[#77827d]">Cases you create will appear here.</p> : (
            <ul className="mt-5 divide-y divide-[#e4e8e2]">
              {cases.map((item) => (
                <li key={item.id}>
                  <Link href={`/cases/${item.id}`} className="group flex flex-col gap-2 py-4 transition sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><h3 className="font-semibold text-[#344548] group-hover:text-[#176b66]">{item.title}</h3><p className="mt-1 line-clamp-1 text-sm text-[#77827d]">{item.originalInput}</p></div>
                    <span className="shrink-0 text-xs font-medium text-[#64736e]">{progress(item)} <span aria-hidden="true">→</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
