import { Dashboard } from "./dashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 md:text-3xl">
            bayes-iot
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Real-time IoT pipeline · Bayesian time-series forecasting
          </p>
        </div>
        <a
          href="https://github.com/jaycoed365/bayes-iot-pipeline"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-zinc-500 hover:text-zinc-300 transition"
        >
          github.com/jaycoed365/bayes-iot-pipeline →
        </a>
      </header>

      {/* Live dashboard */}
      <Dashboard />

      {/* Footer */}
      <footer className="mt-10 border-t border-ink-800 pt-6 text-xs text-zinc-500">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>auto-refresh every 10s</span>
          <span>·</span>
          <span>data from Neon Postgres</span>
          <span>·</span>
          <span>built with Next.js + Prisma + Recharts</span>
        </div>
      </footer>
    </main>
  );
}
