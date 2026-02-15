"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalyzeResponse, Signal } from "@/lib/types";

function pillClasses(sig: Signal) {
  if (sig === "UP") return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30";
  if (sig === "DOWN") return "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30";
  return "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30";
}

export default function Page() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [polymarketSlug, setPolymarketSlug] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const url = useMemo(() => {
    const u = new URL("/api/analyze", window.location.origin);
    u.searchParams.set("symbol", symbol);
    u.searchParams.set("limit", "500");
    if (polymarketSlug.trim()) {
      u.searchParams.set("polymarketSlug", polymarketSlug.trim());
      u.searchParams.set("polymarketType", "market");
    }
    return u.toString();
  }, [symbol, polymarketSlug]);

  async function refresh() {
    try {
      setLoading(true);
      setErr(null);
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ? JSON.stringify(json.error) : `HTTP ${res.status}`);
      setData(json);
    } catch (e: any) {
      setErr(e?.message ?? "Request failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const verdict = data?.prediction.verdict ?? "NEUTRAL";

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">BTC 5m technical vote</h1>
          <p className="text-zinc-400">
            Majority vote across indicators → predicted next 5-minute direction.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <a
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 ring-1 ring-zinc-800 hover:bg-zinc-800"
            href="https://github.com/new"
            target="_blank"
            rel="noreferrer"
          >
            Create GitHub repo
          </a>
        </div>
      </header>

      <section className="mt-6 grid gap-3 rounded-xl bg-zinc-900/40 p-4 ring-1 ring-zinc-800">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs text-zinc-400">Symbol</span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="rounded-lg bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800 outline-none focus:ring-zinc-600"
              placeholder="BTCUSDT"
            />
          </label>

          <label className="grid gap-1 sm:col-span-2">
            <span className="text-xs text-zinc-400">Polymarket market slug (optional)</span>
            <input
              value={polymarketSlug}
              onChange={(e) => setPolymarketSlug(e.target.value)}
              className="rounded-lg bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800 outline-none focus:ring-zinc-600"
              placeholder="e.g. some-polymarket-market-slug"
            />
          </label>
        </div>

        {err ? (
          <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-500/20">
            {err}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm ${pillClasses(verdict)}`}>
              Verdict: {verdict}
            </span>
            {data ? (
              <span className="text-sm text-zinc-300">
                Last close: <span className="font-mono">{data.lastClose.toFixed(2)}</span>
              </span>
            ) : (
              <span className="text-sm text-zinc-500">No data yet.</span>
            )}
          </div>

          {data ? (
            <div className="text-sm text-zinc-400">
              Up {data.prediction.up} | Down {data.prediction.down} | Neutral {data.prediction.neutral} | Confidence{" "}
              {(data.prediction.confidence * 100).toFixed(0)}%
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl ring-1 ring-zinc-800">
        <div className="bg-zinc-900/60 px-4 py-3 text-sm font-medium text-zinc-200">Indicators (last computed)</div>
        <div className="overflow-x-auto bg-zinc-950">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-zinc-950 text-zinc-400">
              <tr className="border-b border-zinc-900">
                <th className="px-4 py-3">Indicator</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Signal</th>
                <th className="px-4 py-3">Rule</th>
              </tr>
            </thead>
            <tbody>
              {data?.indicators?.map((r) => (
                <tr key={r.key} className="border-b border-zinc-900/70">
                  <td className="px-4 py-3 text-zinc-200">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-zinc-200">{r.value}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs ${pillClasses(r.signal)}`}>
                      {r.signal}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{r.note ?? "—"}</td>
                </tr>
              ))}
              {!data ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-500" colSpan={4}>
                    Loading…
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {data?.polymarket ? (
        <section className="mt-6 rounded-xl bg-zinc-900/40 p-4 ring-1 ring-zinc-800">
          <div className="text-sm font-medium text-zinc-200">Polymarket (Gamma) payload</div>
          <p className="mt-1 text-sm text-zinc-400">
            This is a raw JSON view so you can map the fields you care about (question, outcomes, prices, etc.).
          </p>
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-200 ring-1 ring-zinc-800">
            {JSON.stringify(data.polymarket, null, 2)}
          </pre>
        </section>
      ) : null}

      <footer className="mt-8 text-xs text-zinc-500">
        Not financial advice. This is a heuristic snapshot; 5-minute direction is noisy and indicator voting can fail.
      </footer>
    </main>
  );
}
