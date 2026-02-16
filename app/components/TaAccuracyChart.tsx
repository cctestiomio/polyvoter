"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, UTCTimestamp, HistogramData } from "lightweight-charts";

type Props = {
  theme: "light" | "dark";
  marketBase: string;
  anchorStartTsSec: number | null;
  count: number;
};

type ApiResp = {
  window: number;
  totals: { scored: number; correct: number; accuracy: number | null };
  rows: Array<{
    slug: string;
    startTsSec: number;
    correct: boolean | null;
  }>;
};

export default function TaAccuracyChart({ theme, marketBase, anchorStartTsSec, count }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const histRef = useRef<any>(null);

  const [status, setStatus] = useState("Idle");
  const [data, setData] = useState<ApiResp | null>(null);

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      good: dark ? "rgba(34,197,94,0.9)" : "rgba(22,163,74,0.85)",
      bad: dark ? "rgba(244,63,94,0.9)" : "rgba(225,29,72,0.85)",
      unk: dark ? "rgba(161,161,170,0.55)" : "rgba(113,113,122,0.55)"
    };
  }, [theme]);

  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      width: elRef.current.clientWidth || 800,
      height: 260,
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false }
    });

    const hist = chart.addHistogramSeries({
      base: 0,
      priceFormat: { type: "price", precision: 0, minMove: 1 }
    });

    histRef.current = hist;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: elRef.current?.clientWidth ?? 800 }));
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      histRef.current = null;
    };
  }, [colors]);

  useEffect(() => {
    let ignore = false;

    async function run() {
      if (!anchorStartTsSec || !marketBase) {
        setData(null);
        setStatus("Waiting for resolved market...");
        return;
      }

      try {
        setStatus(`Loading TA accuracy (last ${count} slugs)...`);
        const res = await fetch(
          `/api/poly-ta-accuracy?marketBase=${encodeURIComponent(marketBase)}` +
            `&anchorStartTsSec=${encodeURIComponent(String(anchorStartTsSec))}` +
            `&count=${encodeURIComponent(String(count))}&window=45&fidelity=1`,
          { cache: "no-store" }
        );
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

        if (!ignore) {
          setData(json);
          setStatus("Loaded");
        }
      } catch (e: any) {
        if (!ignore) {
          setData(null);
          setStatus(e?.message ?? "Failed");
        }
      }
    }

    run();
    return () => {
      ignore = true;
    };
  }, [marketBase, anchorStartTsSec, count]);

  useEffect(() => {
    const hist = histRef.current;
    if (!hist) return;

    const pts: HistogramData[] = [];
    if (data) {
      for (const r of data.rows) {
        const t = r.startTsSec as UTCTimestamp;
        if (r.correct === true) pts.push({ time: t, value: 1, color: colors.good });
        else if (r.correct === false) pts.push({ time: t, value: -1, color: colors.bad });
        else pts.push({ time: t, value: 0, color: colors.unk });
      }
    }
    hist.setData(pts);
  }, [data, colors]);

  const scored = data?.totals.scored ?? 0;
  const correct = data?.totals.correct ?? 0;
  const acc = data?.totals.accuracy;
  const accText = typeof acc !== "number" || !Number.isFinite(acc) ? "-" : `${(acc * 100).toFixed(1)}%`;

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>TA correctness by slug (window=45)</span>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          {status} | Accuracy: <span className="font-mono">{correct}/{scored}</span> = <span className="font-mono">{accText}</span>
        </span>
      </div>

      <div className="bg-white dark:bg-zinc-950">
        <div ref={elRef} />
      </div>

      <div className="px-4 py-3 text-xs bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 flex flex-wrap gap-4">
        <span><span className="inline-block h-2 w-2 rounded-full align-middle mr-2" style={{ background: colors.good }} />+1 correct</span>
        <span><span className="inline-block h-2 w-2 rounded-full align-middle mr-2" style={{ background: colors.bad }} />-1 wrong</span>
        <span><span className="inline-block h-2 w-2 rounded-full align-middle mr-2" style={{ background: colors.unk }} />0 unknown/unresolved</span>
      </div>
    </div>
  );
}

