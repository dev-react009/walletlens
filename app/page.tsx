"use client";

import { useState } from "react";
import type { WalletReport } from "@/lib/analyze";

const EXAMPLES = [
  { label: "vitalik.eth", value: "vitalik.eth" },
  { label: "Binance hot wallet", value: "0x28C6c06298d514Db089934071355E5743bf21d60" },
];

const LEVEL_STYLES: Record<WalletReport["activityLevel"], string> = {
  "power user": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  occasional: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  dormant: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const DIRECTION_STYLES = {
  in: "text-emerald-400",
  out: "text-rose-400",
  self: "text-slate-400",
};

const RISK_STYLES: Record<string, string> = {
  conservative: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  balanced: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  aggressive: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  degen: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function usd(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function timeAgo(iso: string) {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days < 1) return "today";
  if (days < 30) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WalletReport | null>(null);

  async function analyze(value: string) {
    const query = value.trim();
    if (!query || loading) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`/api/analyze?address=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong.");
      else setReport(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <header className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-violet-400">WalletLens</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Understand any wallet.
          <span className="block text-slate-400">No blockchain expertise needed.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Paste an Ethereum address or ENS name and get a plain-English report of what that wallet
          actually does — balances, habits, and recent activity.
        </p>
      </header>

      <form
        className="mt-10 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          analyze(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0x… or name.eth"
          spellCheck={false}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-sm placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-xl bg-violet-600 px-6 py-3 font-semibold transition hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "Reading…" : "Explain"}
        </button>
      </form>

      <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
        Try:
        {EXAMPLES.map((ex) => (
          <button
            key={ex.value}
            onClick={() => {
              setInput(ex.value);
              analyze(ex.value);
            }}
            className="rounded-full border border-slate-700 px-3 py-1 text-slate-300 transition hover:border-violet-500"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-8 animate-pulse rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-500">
          Reading on-chain history and translating it into plain English…
        </div>
      )}

      {report && (
        <section className="mt-10 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-slate-500">
                {report.ensName ?? `${report.address.slice(0, 8)}…${report.address.slice(-6)}`}
              </span>
              <span
                className={`rounded-full border px-3 py-0.5 text-xs font-semibold capitalize ${LEVEL_STYLES[report.activityLevel]}`}
              >
                {report.activityLevel}
              </span>
            </div>
            <p className="mt-3 text-xl font-semibold leading-snug">{report.headline}</p>
            <ul className="mt-4 space-y-2">
              {report.insights.map((line) => (
                <li key={line} className="flex gap-2 text-slate-300">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: "ETH balance",
                value: report.ethBalance.toLocaleString(undefined, { maximumFractionDigits: 3 }),
              },
              { label: "Value (USD)", value: report.balanceUsd !== null ? usd(report.balanceUsd) : "—" },
              { label: "Transactions", value: report.txCount.toLocaleString() },
              { label: "Last active", value: report.lastSeen ? timeAgo(report.lastSeen) : "—" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
                <p className="mt-1 text-lg font-bold">{stat.value}</p>
              </div>
            ))}
          </div>

          {report.portfolio && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-200">Portfolio mix</h2>
                <span
                  className={`rounded-full border px-3 py-0.5 text-xs font-semibold capitalize ${RISK_STYLES[report.portfolio.riskProfile]}`}
                >
                  {report.portfolio.riskProfile}
                </span>
              </div>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-800">
                <div className="bg-indigo-500" style={{ width: `${report.portfolio.ethPct}%` }} />
                <div className="bg-emerald-500" style={{ width: `${report.portfolio.stablePct}%` }} />
                <div className="bg-sky-500" style={{ width: `${report.portfolio.bluechipPct}%` }} />
                <div className="bg-rose-500" style={{ width: `${report.portfolio.speculativePct}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-500" />ETH {report.portfolio.ethPct}%</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Stablecoins {report.portfolio.stablePct}%</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />Blue-chip {report.portfolio.bluechipPct}%</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-500" />Speculative {report.portfolio.speculativePct}%</span>
              </div>
            </div>
          )}

          {report.traderTake.length > 0 && (
            <div className="rounded-2xl border border-amber-500/20 bg-slate-900 p-6">
              <h2 className="font-semibold text-amber-300">Trader's take</h2>
              <p className="mt-1 text-xs text-slate-500">
                How an experienced trader would read this wallet's recent behavior.
              </p>
              <ul className="mt-4 space-y-2">
                {report.traderTake.map((line) => (
                  <li key={line} className="flex gap-2 text-slate-300">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.holdings.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="font-semibold text-slate-200">Top tokens held</h2>
              <ul className="mt-3 divide-y divide-slate-800">
                {report.holdings.map((h) => (
                  <li key={h.symbol + h.name} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-semibold">{h.symbol}</span>
                      <span className="ml-2 text-slate-500">{h.name}</span>
                      {h.likelySpam && (
                        <span className="ml-2 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                          likely spam
                        </span>
                      )}
                    </span>
                    <span className="text-slate-300">
                      {h.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {h.usdValue !== null && h.usdValue >= 1 && (
                        <span className="ml-2 text-slate-500">≈ {usd(h.usdValue)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.recentActivity.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="font-semibold text-slate-200">Recent activity, translated</h2>
              <ul className="mt-3 space-y-3">
                {report.recentActivity.map((a) => (
                  <li key={a.hash} className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-semibold ${DIRECTION_STYLES[a.direction]}`}>{a.label}</span>
                      <span className="text-slate-500">{timeAgo(a.timestamp)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-300">{a.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <footer className="mt-16 text-center text-xs text-slate-600">
        Data from public Ethereum indexers. Informational only — not financial advice.
      </footer>
    </main>
  );
}
