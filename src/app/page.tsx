export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-20">
      <section className="w-full max-w-3xl border-l border-blue-400/40 pl-6 sm:pl-10">
        <p className="mb-6 text-sm font-medium uppercase tracking-[0.3em] text-blue-300">
          TRESTLE
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-100 sm:text-6xl">
          The Life-Event Compiler
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
          TRESTLE will turn complex life events into clear, dependency-aware workflows—so the
          right next step is always easier to see.
        </p>
        <p className="mt-10 text-sm text-slate-500">Initial scaffold · More to come</p>
      </section>
    </main>
  );
}
