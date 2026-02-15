"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useTheme } from "next-themes";

import RtdsBtcPriceChart from "./components/RtdsBtcPriceChart";
import PolyLiveChart from "./components/PolyLiveChart";
import Hit80StatsChart from "./components/Hit80StatsChart";
import TaAccuracyChart from "./components/TaAccuracyChart";

import type { Candle, IndicatorRow, Prediction, Signal } from "@/lib/types";
import { computeIndicators } from "@/lib/analyze";

function pillClasses(sig: Signal) {
  if (sig === "UP") return "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300";
  if (sig === "DOWN") return "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300";
  return "bg-zinc-500/15 text-zinc-700 ring-1 ring-zinc-500/30 dark:text-zinc-300";
}

type TAState = {
  indicators: IndicatorRow[];
  prediction: Prediction;
  lastClose: number;
};

type BucketMode = "next" | "current";

type ResolveResp = {
  desiredSlug: string;
  resolvedSlug: string;
  startTsSec: number;
  question: string;
  clobTokenIds: string[];
};

function latest5mStartEpochSec(mode: BucketMode) {
  const nowSec = Math.floor(Date.now() / 1000);
  const step = 300;
  const currentStart = Math.floor(nowSec / step) * step;
  return mode === "current" ? currentStart : currentStart + step;
}

function errToText(x: any) {
  if (!x) return "Unknown error";
  if (typeof x === "string") return x;
  if (typeof x?.message === "string") return x.message;
  try { return JSON.stringify(x); } catch { return String(x); }
}

function pointsToCandles(points: Array<{ tMs: number; p: number }>, stepMs: number): Candle[] {
  return points
    .filter((x) => Number.isFinite(x.tMs) && Number.isFinite(x.p))
    .sort((a, b) => a.tMs - b.tMs)
    .map((pt) => ({
      openTime: pt.tMs,
      open: pt.p,
      high: pt.p,
      low: pt.p,
      close: pt.p,
      volume: 0,
      closeTime: pt.tMs + stepMs
    }));
}

function majorityVerdict(pred: Prediction | null | undefined): Signal {
  const up = pred?.up ?? 0;
  const down = pred?.down ?? 0;
  if (up > down) return "UP";
  if (down > up) return "DOWN";
  return "NEUTRAL";
}

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const effectiveTheme = (mounted ? (theme === "dark" ? "dark" : "light") : "light") as "light" | "dark";

  const [marketBase, setMarketBase] = useState("btc-updown-5m");
  const [bucketMode, setBucketMode] = useState<BucketMode>("current");
  const [autoTimestamp, setAutoTimestamp] = useState(true);
  const [tsSec, setTsSec] = useState<number>(() => latest5mStartEpochSec("current"));

  const [btcSource, setBtcSource] = useState<"binance" | "chainlink">("binance");
  const [historySlugs, setHistorySlugs] = useState<number>(70);

  const [resolved, setResolved] = useState<ResolveResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [yesMid, setYesMid] = useState<number | null>(null);
  const [noMid, setNoMid] = useState<number | null>(null);
  const [wsTicks, setWsTicks] = useState(0);

  const [targetPrice, setTargetPrice] = useState<number | null>(null);
  const lastBeforeStartRef = useRef<{ tsMs: number; px: number } | null>(null);

  const [ta, setTa] = useState<TAState | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!autoTimestamp) return;
    const tick = () => setTsSec(latest5mStartEpochSec(bucketMode));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [autoTimestamp, bucketMode]);

  // Logic: refresh chart group every 2 slugs (every 10 minutes)
  const chartRefreshKey = useMemo(() => {
    const slugIndex = Math.floor(tsSec / 300); // 5m slug index
    return Math.floor(slugIndex / 2); // integer changes every 2 slugs
  }, [tsSec]);

  const desiredSlug = useMemo(() => {
    const base = marketBase.trim().replace(/-+$/g, "");
    if (!base) return "";
    return `${base}-${tsSec}`;
  }, [marketBase, tsSec]);

  // Resolve slug
  useEffect(() => {
    let ignore = false;

    async function run() {
      const base = marketBase.trim();
      if (!base) {
        setResolved(null);
        setErr(null);
        return;
      }

      setErr(null);
      setResolved(null);

      try {
        const res = await fetch(
          `/api/poly-resolve?marketBase=${encodeURIComponent(base)}&desiredStartTsSec=${encodeURIComponent(
            String(tsSec)
          )}&lookbackIntervals=120`,
          { cache: "no-store" }
        );
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(errToText(json?.error ?? json));
        if (!ignore) setResolved(json);
      } catch (e: any) {
        if (!ignore) setErr(errToText(e));
      }
    }

    run();
    return () => {
      ignore = true;
    };
  }, [marketBase, tsSec]);

  const yesTokenId = useMemo(
    () => (resolved?.clobTokenIds?.[0] ? String(resolved.clobTokenIds[0]) : null),
    [resolved]
  );
  const noTokenId = useMemo(
    () => (resolved?.clobTokenIds?.[1] ? String(resolved.clobTokenIds[1]) : null),
    [resolved]
  );

  const windowStartTsSec = useMemo(() => (resolved?.startTsSec ? resolved.startTsSec : null), [resolved]);
  const marketStartMs = useMemo(() => (resolved?.startTsSec ? resolved.startTsSec * 1000 : null), [resolved]);

  // Seed indicators from last 15 slugs
  useEffect(() => {
    let ignore = false;

    async function run() {
      if (!resolved?.startTsSec) {
        setTa(null);
        return;
      }

      try {
        const res = await fetch(
          `/api/poly-seed?marketBase=${encodeURIComponent(marketBase.trim())}&startTsSec=${encodeURIComponent(
            String(resolved.startTsSec)
          )}&count=15&fidelity=1&interval=1h`,
          { cache: "no-store" }
        );
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(errToText(json?.error ?? json));

        const pts = Array.isArray(json?.points) ? json.points : [];
        const candles = pointsToCandles(pts, 60_000);

        if (ignore) return;

        if (candles.length >= 20) {
          const { indicators, prediction } = computeIndicators(candles);
          const last = candles[candles.length - 1];
          setTa({ indicators, prediction, lastClose: last?.close ?? NaN });
        } else {
          setTa(null);
        }
      } catch (e: any) {
        if (!ignore) setErr(errToText(e));
      }
    }

    run();
    return () => {
      ignore = true;
    };
  }, [resolved?.startTsSec, marketBase]);

  const verdict = majorityVerdict(ta?.prediction);
  const upVotes = ta?.prediction.up ?? 0;
  const downVotes = ta?.prediction.down ?? 0;
  const neutralVotes = ta?.prediction.neutral ?? 0;

  const wsTicksRef = useRef(0);
  const wsTickFlushTimerRef = useRef<number | null>(null);

  const bumpWsTicks = useCallback(() => {
    wsTicksRef.current += 1;

    if (wsTickFlushTimerRef.current != null) return;

    wsTickFlushTimerRef.current = window.setTimeout(() => {
      wsTickFlushTimerRef.current = null;
      setWsTicks(wsTicksRef.current);
    }, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (wsTickFlushTimerRef.current != null) {
        window.clearTimeout(wsTickFlushTimerRef.current);
        wsTickFlushTimerRef.current = null;
      }
    };
  }, []);

  const handleYesMid = useCallback((mid: number) => {
    setYesMid(mid);
    bumpWsTicks();
  }, [bumpWsTicks]);

  const handleNoMid = useCallback((mid: number) => {
    setNoMid(mid);
    bumpWsTicks();
  }, [bumpWsTicks]);

  const handleBtcOnPrice = useCallback((px: number, tsMs: number) => {
    if (!marketStartMs) return;

    if (tsMs <= marketStartMs) lastBeforeStartRef.current = { px, tsMs };

    if (targetPrice === null && tsMs >= marketStartMs) {
      const before = lastBeforeStartRef.current;
      setTargetPrice(before?.px ?? px);
    }
  }, [marketStartMs, targetPrice]);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Polymarket-aligned live TA</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Desired slug: <span className="font-mono">{desiredSlug || "-"}</span>{" "}
            | Resolved: <span className="font-mono">{resolved?.resolvedSlug ?? "-"}</span>
          </p>
        </div>

        <button
          onClick={() => mounted && setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 ring-1 ring-zinc-200 hover:bg-zinc-50
                     dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-800"
          disabled={!mounted}
        >
          {mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
        </button>
      </header>

      <section className="mt-6 grid gap-3 rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800">
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="grid gap-1 lg:col-span-2">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Market base</span>
            <input
              value={marketBase}
              onChange={(e) => setMarketBase(e.target.value)}
              className="rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:ring-zinc-400
                         dark:bg-zinc-950 dark:ring-zinc-800 dark:focus:ring-zinc-600"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Timestamp mode</span>
            <select
              value={bucketMode}
              onChange={(e) => setBucketMode(e.target.value as BucketMode)}
              className="rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:ring-zinc-400
                         dark:bg-zinc-950 dark:ring-zinc-800 dark:focus:ring-zinc-600"
            >
              <option value="current">Current bucket</option>
              <option value="next">Next market</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={autoTimestamp} onChange={(e) => setAutoTimestamp(e.target.checked)} />
            Auto timestamp
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            History slugs:
            <input
              type="number"
              min={10}
              max={240}
              value={historySlugs}
              onChange={(e) => setHistorySlugs(Math.max(10, Math.min(240, Number(e.target.value) || 60)))}
              className="w-[90px] rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none
                         dark:bg-zinc-950 dark:ring-zinc-800"
            />
          </label>

          <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm ${pillClasses(verdict)}`}>
            Verdict: {verdict}
          </span>

          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            Votes (U/D/N): <span className="font-mono">{upVotes}/{downVotes}/{neutralVotes}</span>
          </span>

          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            YES: <span className="font-mono">{yesMid === null ? "-" : yesMid.toFixed(4)}</span>
          </span>

          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            NO: <span className="font-mono">{noMid === null ? "-" : noMid.toFixed(4)}</span>
          </span>

          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            WS ticks: <span className="font-mono">{wsTicks}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">BTC source displayed:</span>
          <select
            value={btcSource}
            onChange={(e) => setBtcSource(e.target.value as any)}
            className="rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none
                       dark:bg-zinc-950 dark:ring-zinc-800"
          >
            <option value="binance">Binance (btcusdt)</option>
            <option value="chainlink">Chainlink (btc/usd)</option>
          </select>
        </div>

        {resolved?.question ? (
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{resolved.question}</span>
            {windowStartTsSec ? (
              <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400">
                Window: <span className="font-mono">{new Date(windowStartTsSec * 1000).toISOString()}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {err ? (
          <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-700 ring-1 ring-rose-500/20 dark:text-rose-200">
            {err}
          </div>
        ) : null}
      </section>

      {/* 
        Pass chartRefreshKey to key prop to force re-mount every 2 slugs.
        This resets internal chart state (zoom, data) cleanly.
      */}
      <div key={`charts-${chartRefreshKey}`} className="mt-6 grid gap-6 lg:grid-cols-2">
        <RtdsBtcPriceChart
          theme={effectiveTheme}
          source={btcSource}
          targetPrice={targetPrice}
          onPrice={handleBtcOnPrice}
        />

        <PolyLiveChart
          theme={effectiveTheme}
          yesTokenId={yesTokenId}
          noTokenId={noTokenId}
          windowStartTsSec={windowStartTsSec}
          onYesMid={handleYesMid}
          onNoMid={handleNoMid}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Hit80StatsChart
          theme={effectiveTheme}
          marketBase={marketBase.trim()}
          anchorStartTsSec={resolved?.startTsSec ?? null}
          count={historySlugs}
        />
        <TaAccuracyChart
          theme={effectiveTheme}
          marketBase={marketBase.trim()}
          anchorStartTsSec={resolved?.startTsSec ?? null}
          count={historySlugs}
        />
      </div>

      <section className="mt-6 overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
        <div className="bg-white px-4 py-3 text-sm font-medium text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
          Indicators (seeded from last 15 slugs)
        </div>

        <div className="overflow-x-auto bg-white dark:bg-zinc-950">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              <tr className="border-b border-zinc-200 dark:border-zinc-900">
                <th className="px-4 py-3">Indicator</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Signal</th>
                <th className="px-4 py-3">Rule</th>
              </tr>
            </thead>

            <tbody>
              {ta?.indicators?.map((r) => (
                <tr key={r.key} className="border-b border-zinc-200/70 dark:border-zinc-900/70">
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-200">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-200">{r.value}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs ${pillClasses(r.signal)}`}>
                      {r.signal}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{r.note ?? "-"}</td>
                </tr>
              ))}

              {!ta ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-500" colSpan={4}>
                    Seeding indicator data...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
