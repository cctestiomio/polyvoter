"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";

import RtdsBtcPriceChart from "./components/RtdsBtcPriceChart";
import PolyLiveChart from "./components/PolyLiveChart";
import Hit80StatsChart from "./components/Hit80StatsChart";
import TaAccuracyChart from "./components/TaAccuracyChart";
import TaAnalysisTable, { MarketEvent } from "./components/TaAnalysisTable";
import TaPredictionTable, { TaPredRow } from "./components/TaPredictionTable";

import type { Candle, IndicatorRow, Prediction, Signal } from "@/lib/types";
import { computeIndicators } from "@/lib/analyze";

function pillClasses(sig: Signal) {
  if (sig === "UP") return "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300";
  if (sig === "DOWN") return "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300";
  return "bg-zinc-500/15 text-zinc-700 ring-1 ring-zinc-500/30 dark:text-zinc-300";
}

type TAState = { indicators: IndicatorRow[]; prediction: Prediction; lastClose: number };
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
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
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
      closeTime: pt.tMs + stepMs,
    }));
}

function majorityVerdict(pred: Prediction | null | undefined): Signal {
  const up = pred?.up ?? 0;
  const down = pred?.down ?? 0;
  if (up > down) return "UP";
  if (down > up) return "DOWN";
  return "NEUTRAL";
}

function TradingViewWidget() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    container.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: "BINANCE:BTCUSDT",
      interval: "5",
      timezone: "America/Los_Angeles",
      theme: "light",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      save_image: false,
      calendar: false,
      hide_volume: true,
      studies: ["RSI@tv-basicstudies", "MASimple@tv-basicstudies"],
      support_host: "https://www.tradingview.com",
    });

    container.current.appendChild(script);
  }, []);

  return (
    <div
      className="h-[500px] w-full rounded-xl overflow-hidden ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white"
      ref={container}
    />
  );
}

function coerceYesNo(x: any): "Yes" | "No" | null {
  const v = String(x ?? "").trim().toLowerCase();
  if (v === "yes" || v === "up" || v === "true") return "Yes";
  if (v === "no" || v === "down" || v === "false") return "No";
  return null;
}

function coercePredictionToYesNoNeutral(x: any): "Yes" | "No" | "Neutral" | null {
  const v = String(x ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "yes" || v === "up" || v === "bull" || v === "long") return "Yes";
  if (v === "no" || v === "down" || v === "bear" || v === "short") return "No";
  if (v === "neutral" || v === "flat") return "Neutral";
  return null;
}

function parseEventsFromHit80(hit80Json: any): MarketEvent[] {
  const rows = Array.isArray(hit80Json?.rows) ? hit80Json.rows : [];
  const out: MarketEvent[] = [];

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;

    const slug = String(r.slug ?? "").trim();
    const startTsSec = Number(r.startTsSec);
    const endTsSec = Number.isFinite(Number(r.endTsSec)) ? Number(r.endTsSec) : startTsSec + 300;
    if (!slug || !Number.isFinite(startTsSec) || !Number.isFinite(endTsSec)) continue;

    const hitSide = coerceYesNo(r?.firstHit?.side);
    const hitPrice = r?.firstHit?.p == null ? null : Number(r.firstHit.p);

    const outcomeKnown = Boolean(r?.outcomeKnown);
    const resolvedWinner = coerceYesNo(r?.resolvedWinner);

    out.push({
      slug,
      startTsSec,
      endTsSec,
      hitSide,
      hitPrice: Number.isFinite(hitPrice as any) ? (hitPrice as number) : null,
      outcome: outcomeKnown && resolvedWinner ? resolvedWinner : "Open",
    });
  }

  out.sort((a, b) => Number(b.startTsSec ?? 0) - Number(a.startTsSec ?? 0));
  return out;
}

/**
 * Compute TA correctness directly from the same per-slug rows shown in TA Predictions.
 * - Only score rows with resolved outcome (Yes/No) and scorable prediction (Yes/No).
 * - Apply window=30 on the most recent scored rows.
 */
function computeTaCorrectnessFromRows(
  rows: TaPredRow[],
  window: number
): { accuracyPct: number; totalSignals: number; correct: number } {
  const scorable = rows.filter(
    (r) => (r.outcome === "Yes" || r.outcome === "No") && (r.prediction === "Yes" || r.prediction === "No")
  );

  const windowRows = scorable.slice(0, Math.max(0, window | 0));
  const correct = windowRows.filter((r) => r.prediction === r.outcome).length;

  const totalSignals = windowRows.length;
  const accuracyPct = totalSignals > 0 ? (correct / totalSignals) * 100 : 0;

  return { accuracyPct, totalSignals, correct };
}

/**
 * Parse TA rows from taJson and fill `outcome` using outcomesBySlug from the Event Log.
 * More robust extraction of prediction shapes.
 */
function parseTaRowsToTable(taJson: any, outcomesBySlug: Map<string, "Yes" | "No">): TaPredRow[] {
  const rows = Array.isArray(taJson?.rows) ? taJson.rows : Array.isArray(taJson?.perSlug) ? taJson.perSlug : [];
  const out: TaPredRow[] = [];

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;

    const slug = String(r.slug ?? r.marketSlug ?? r.resolvedSlug ?? "").trim();
    if (!slug) continue;

    const startTsSec =
      (Number.isFinite(Number(r.startTsSec)) && Number(r.startTsSec)) ||
      (Number.isFinite(Number(r.tsSec)) && Number(r.tsSec)) ||
      Number(slug.split("-").pop());

    if (!Number.isFinite(startTsSec)) continue;
    const endTsSec = (Number.isFinite(Number(r.endTsSec)) && Number(r.endTsSec)) || startTsSec + 300;

    const rawPred =
      r.prediction ??
      r.predictedSide ??
      r.signal ??
      r.verdict ??
      r.side ??
      r?.pred?.side ??
      r?.pred?.verdict ??
      r?.prediction?.side ??
      r?.prediction?.verdict ??
      null;

    let prediction =
      coercePredictionToYesNoNeutral(rawPred) ??
      coercePredictionToYesNoNeutral(r?.prediction?.value) ??
      null;

    // If prediction is a probability (e.g. probYes), map it.
    if (prediction == null) {
      const pYes =
        (Number.isFinite(Number((r as any).probYes)) && Number((r as any).probYes)) ||
        (Number.isFinite(Number((r as any).pYes)) && Number((r as any).pYes)) ||
        (Number.isFinite(Number((r as any).yesProb)) && Number((r as any).yesProb)) ||
        (Number.isFinite(Number((r as any).probabilityYes)) && Number((r as any).probabilityYes)) ||
        null;

      if (pYes != null) {
        if (pYes > 0.5) prediction = "Yes";
        else if (pYes < 0.5) prediction = "No";
        else prediction = "Neutral";
      }
    }

    const outcomeFromEventLog = outcomesBySlug.get(slug) ?? null;

    out.push({
      slug,
      startTsSec,
      endTsSec,
      prediction,
      outcome: outcomeFromEventLog ? outcomeFromEventLog : "Open",
    });
  }

  out.sort((a, b) => b.startTsSec - a.startTsSec);
  return out;
}

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const effectiveTheme = (mounted ? (theme === "dark" ? "dark" : "light") : "light") as "light" | "dark";

  const [marketBase, setMarketBase] = useState("btc-updown-5m");
  const [bucketMode, setBucketMode] = useState<BucketMode>("current");
  const [autoTimestamp, setAutoTimestamp] = useState(true);
  const [tsSec, setTsSec] = useState<number>(() => latest5mStartEpochSec("current"));
  const [historySlugs, setHistorySlugs] = useState<number>(100);

  const [splitTables, setSplitTables] = useState(false);

  const [resolved, setResolved] = useState<ResolveResp | null>(null);
  const [resolveStatus, setResolveStatus] = useState<string>("Idle");
  const [err, setErr] = useState<string | null>(null);

  const [yesMid, setYesMid] = useState<number | null>(null);
  const [noMid, setNoMid] = useState<number | null>(null);

  const [targetPrice, setTargetPrice] = useState<number | null>(null);
  const lastBeforeStartRef = useRef<{ tsMs: number; px: number } | null>(null);

  const [ta, setTa] = useState<TAState | null>(null);

  const [marketEvents, setMarketEvents] = useState<MarketEvent[]>([]);
  const [taAccuracyPct, setTaAccuracyPct] = useState<number>(0);
  const [taTotalSignals, setTaTotalSignals] = useState<number>(0);
  const [taPredRows, setTaPredRows] = useState<TaPredRow[]>([]);

  const [eventLogStatus, setEventLogStatus] = useState<string>("Idle");
  const [eventLogErr, setEventLogErr] = useState<string | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<MarketEvent | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!autoTimestamp) return;
    const tick = () => {
      const next = latest5mStartEpochSec(bucketMode);
      setTsSec((prev) => (prev === next ? prev : next));
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [autoTimestamp, bucketMode]);

  const desiredSlug = useMemo(() => {
    const base = marketBase.trim().replace(/-+$/g, "");
    return base ? `${base}-${tsSec}` : "";
  }, [marketBase, tsSec]);

  // Resolve market
  useEffect(() => {
    let ignore = false;
    const base = marketBase.trim();
    if (!base) return;

    async function run() {
      setErr(null);
      setResolveStatus("Resolving...");
      try {
        const res = await fetch(
          `/api/poly-resolve?marketBase=${encodeURIComponent(base)}&desiredStartTsSec=${encodeURIComponent(
            String(tsSec)
          )}&lookbackIntervals=120`,
          { cache: "no-store" }
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(errToText(json?.error ?? json));
        if (!ignore) {
          setResolved(json);
          setResolveStatus("Idle");
        }
      } catch (e: any) {
        if (!ignore) {
          setErr(errToText(e));
          setResolveStatus("Error");
        }
      }
    }

    run();
    return () => {
      ignore = true;
    };
  }, [marketBase, tsSec]);

  const yesTokenId = useMemo(() => (resolved?.clobTokenIds?.[0] ? String(resolved.clobTokenIds[0]) : null), [resolved]);
  const noTokenId = useMemo(() => (resolved?.clobTokenIds?.[1] ? String(resolved.clobTokenIds[1]) : null), [resolved]);
  const windowStartTsSec = useMemo(() => (resolved?.startTsSec ? resolved.startTsSec : null), [resolved]);
  const marketStartMs = useMemo(() => (resolved?.startTsSec ? resolved.startTsSec * 1000 : null), [resolved]);

  const handleBtcOnPrice = useCallback(
    (px: number, tsMs: number) => {
      if (!marketStartMs) return;
      if (tsMs <= marketStartMs) lastBeforeStartRef.current = { px, tsMs };
      if (targetPrice === null && tsMs >= marketStartMs) {
        const before = lastBeforeStartRef.current;
        setTargetPrice(before?.px ?? px);
      }
    },
    [marketStartMs, targetPrice]
  );

  const handleYesMid = useCallback((mid: number) => setYesMid(mid), []);
  const handleNoMid = useCallback((mid: number) => setNoMid(mid), []);

  // Fetch hit80 + ta rows, then compute TA correctness from the parsed rows
  const eventFetchIdRef = useRef(0);

  useEffect(() => {
    let alive = true;

    async function run() {
      setEventLogErr(null);

      const base = marketBase.trim();
      const anchor = resolved?.startTsSec ?? null;

      if (!base || !anchor) {
        setEventLogStatus("Waiting for anchor...");
        return;
      }

      const fetchId = ++eventFetchIdRef.current;
      setEventLogStatus("Loading signals...");

      try {
        const [hit80Res, taRes] = await Promise.all([
          fetch(
            `/api/poly-hit80?marketBase=${encodeURIComponent(base)}&anchorStartTsSec=${encodeURIComponent(
              String(anchor)
            )}&count=${encodeURIComponent(String(historySlugs))}&threshold=0.8&fidelity=1`,
            { cache: "no-store" }
          ),
          fetch(
            `/api/poly-ta-accuracy?marketBase=${encodeURIComponent(base)}&anchorStartTsSec=${encodeURIComponent(
              String(anchor)
            )}&count=${encodeURIComponent(String(historySlugs))}&window=30&fidelity=1`,
            { cache: "no-store" }
          ),
        ]);

        const hit80Json = await hit80Res.json().catch(() => null);
        const taJson = await taRes.json().catch(() => null);

        if (!hit80Res.ok) throw new Error(`poly-hit80: ${errToText(hit80Json?.error ?? hit80Json)}`);
        if (!taRes.ok) throw new Error(`poly-ta-accuracy: ${errToText(taJson?.error ?? taJson)}`);

        const events = parseEventsFromHit80(hit80Json);

        // Build outcome lookup from Event Log (this is what makes TA outcomes load)
        const outcomesBySlug = new Map<string, "Yes" | "No">();
        for (const e of events) {
          if (e.outcome === "Yes" || e.outcome === "No") outcomesBySlug.set(e.slug, e.outcome);
        }

        const taRows = parseTaRowsToTable(taJson, outcomesBySlug);

        // Compute correctness from TA rows (not from taJson summary fields)
        const TA_WINDOW = 30;
        const taComputed = computeTaCorrectnessFromRows(taRows, TA_WINDOW);

        if (!alive) return;
        if (fetchId !== eventFetchIdRef.current) return;

        setMarketEvents(events);
        setTaPredRows(taRows);

        setTaAccuracyPct(taComputed.accuracyPct);
        setTaTotalSignals(taComputed.totalSignals);

        setEventLogStatus(
          events.length ? "Idle" : `No events found (response keys: ${Object.keys(hit80Json ?? {}).join(", ")})`
        );
      } catch (e: any) {
        if (!alive) return;
        setEventLogErr(errToText(e));
        setEventLogStatus("Error");
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [marketBase, historySlugs, resolved?.startTsSec]);

  // Seed TA indicators panel
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

        const json = await res.json().catch(() => null);
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

  const firstHit80Stats = useMemo(() => {
    const resolvedRows = marketEvents.filter((e) => e.outcome === "Yes" || e.outcome === "No");
    const total = resolvedRows.length;
    const matches = resolvedRows.filter((e) => e.hitSide && e.hitSide === e.outcome).length;
    const rate = total > 0 ? (matches / total) * 100 : 0;
    return { total, matches, rate };
  }, [marketEvents]);

  const hitMissStats = useMemo(() => {
    // only rows where outcome is resolved AND we have a hitSide (Yes/No)
    const scored = marketEvents.filter(
      (e) => (e.outcome === "Yes" || e.outcome === "No") && (e.hitSide === "Yes" || e.hitSide === "No")
    );

    const hits = scored.filter((e) => e.hitSide === e.outcome).length;
    const misses = scored.filter((e) => e.hitSide !== e.outcome).length;

    return { hits, misses, total: scored.length };
  }, [marketEvents]);

  const hitRatePct = hitMissStats.total > 0 ? (hitMissStats.hits / hitMissStats.total) * 100 : 0;

  const btcChartKey = `btc-${tsSec}`; // refresh every slug

  const polyChartKey = useMemo(() => {
    if (selectedEvent) return `poly-drill-${selectedEvent.slug}`;
    const anchorForKey = resolved?.startTsSec ?? tsSec;
    const slugIndex = Math.floor(anchorForKey / 300);
    const twoSlugBlock = Math.floor(slugIndex / 2);
    return `poly-live-${twoSlugBlock}`;
  }, [resolved?.startTsSec, tsSec, selectedEvent]);

  return (
    <main className="mx-auto max-w-7xl p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Polymarket-aligned live TA</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Desired slug: <span className="font-mono">{desiredSlug || "-"}</span> | Resolved:{" "}
            <span className="font-mono">{resolved?.resolvedSlug ?? "-"}</span>{" "}
            <span className="ml-2 text-xs text-zinc-500">Resolve: {resolveStatus}</span>
          </p>
          {err ? <p className="mt-2 text-sm text-rose-600">Error: {err}</p> : null}
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

      <section className="grid gap-3 rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800">
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

        <div className="flex flex-wrap items-center gap-4">
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

          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={splitTables} onChange={(e) => setSplitTables(e.target.checked)} />
            Split tables side-by-side
          </label>

          <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm ${pillClasses(verdict)}`}>
            Verdict: {verdict}
          </span>

          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            Votes: <span className="font-mono">{upVotes}U / {downVotes}D</span>
          </span>

          <div className="flex gap-4 ml-auto">
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              YES: <span className="font-mono">{yesMid === null ? "-" : yesMid.toFixed(4)}</span>
            </span>
            <span className="text-sm font-medium text-red-600 dark:text-red-400">
              NO: <span className="font-mono">{noMid === null ? "-" : noMid.toFixed(4)}</span>
            </span>
          </div>
        </div>
      </section>

      <TradingViewWidget />

      <div className="grid gap-6 lg:grid-cols-2 h-[400px]">
        <div key={btcChartKey} className="h-full w-full">
          <RtdsBtcPriceChart
            theme={effectiveTheme}
            source={"binance"}
            targetPrice={targetPrice}
            onPrice={handleBtcOnPrice}
          />
        </div>

        <div key={polyChartKey} className="h-full w-full relative">
          <PolyLiveChart
            theme={effectiveTheme}
            yesTokenId={yesTokenId}
            noTokenId={noTokenId}
            windowStartTsSec={windowStartTsSec}
            onYesMid={handleYesMid}
            onNoMid={handleNoMid}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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

      <section className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800">
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">First Hit ≥80% Success Rate</div>
            <div className="mt-1 text-2xl font-semibold">
              {firstHit80Stats.total === 0 ? "—" : `${firstHit80Stats.rate.toFixed(1)}%`}{" "}
              <span className="text-sm font-normal text-zinc-500">
                ({firstHit80Stats.matches}/{firstHit80Stats.total} resolved)
              </span>
            </div>

            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Hits: <span className="font-mono">{hitMissStats.hits}</span> | Misses:{" "}
              <span className="font-mono">{hitMissStats.misses}</span> | Total scored:{" "}
              <span className="font-mono">{hitMissStats.total}</span>{" "}
              <span className="text-zinc-500">
                ({hitMissStats.total === 0
                  ? "—"
                  : `${hitMissStats.hits}/${hitMissStats.total} = ${hitRatePct.toFixed(1)}%`})
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800">
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">TA Correctness (Window=30)</div>
            <div className="mt-1 text-2xl font-semibold">
              {taAccuracyPct.toFixed(1)}%{" "}
              <span className="text-sm font-normal text-zinc-500">({taTotalSignals} signals)</span>
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800">
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Event Log status</div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {eventLogStatus}
              {eventLogErr ? <div className="mt-1 text-rose-600">Error: {eventLogErr}</div> : null}
            </div>
          </div>
        </div>

        <div className={splitTables ? "grid gap-6 lg:grid-cols-2 items-start" : "grid gap-6"}>
          <TaAnalysisTable
            events={marketEvents}
            taAccuracy={taAccuracyPct}
            totalSignals={taTotalSignals}
            onEventClick={setSelectedEvent}
          />
          <TaPredictionTable rows={taPredRows} />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
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
