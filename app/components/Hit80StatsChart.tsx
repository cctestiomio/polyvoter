"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, UTCTimestamp, LineData } from "lightweight-charts";

type Props = {
  theme: "light" | "dark";
  marketBase: string;
  anchorStartTsSec: number | null;
  count: number;
};

type ApiResp = {
  threshold: number;
  totals: {
    hitCount: number;
    knownOutcomeCount: number;
    matchCount: number;
    oppositeCount: number;
    unknownOutcomeCount: number;
    matchRate: number | null;
  };
  rows: Array<{
    slug: string;
    startTsSec: number;
    firstHit: null | { side: "YES" | "NO"; t: number; p: number };
    resolvedWinner: null | "YES" | "NO";
    outcomeKnown: boolean;
    match: null | boolean;
    error?: string;
  }>;
};

export default function Hit80StatsChart({ theme, marketBase, anchorStartTsSec, count }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Idle");
  const [data, setData] = useState<ApiResp | null>(null);

  const seriesRef = useRef<{ yes: any; no: any; opposite: any; unknown: any } | null>(null);

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      yes: dark ? "#22c55e" : "#16a34a",
      no: dark ? "#fb7185" : "#e11d48",
      opposite: dark ? "rgba(250,204,21,0.95)" : "rgba(161,98,7,0.95)",
      unknown: dark ? "rgba(161,161,170,0.65)" : "rgba(113,113,122,0.65)"
    };
  }, [theme]);

  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      width: elRef.current.clientWidth || 800,
      height: 320,
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false }
    });

    const yes = chart.addLineSeries({ color: colors.yes, lineWidth: 2, priceLineVisible: false });
    const no = chart.addLineSeries({ color: colors.no, lineWidth: 2, priceLineVisible: false });
    const opposite = chart.addLineSeries({ color: colors.opposite, lineWidth: 2, priceLineVisible: false });
    const unknown = chart.addLineSeries({ color: colors.unknown, lineWidth: 2, priceLineVisible: false });

    seriesRef.current = { yes, no, opposite, unknown };

    const ro = new ResizeObserver(() => chart.applyOptions({ width: elRef.current?.clientWidth ?? 800 }));
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      seriesRef.current = null;
    };
  }, [colors]);

  useEffect(() => {
    let ignore = false;

    async function run() {
      if (!anchorStartTsSec || !marketBase) {
        setStatus("Waiting for resolved market...");
        setData(null);
        return;
      }

      try {
        setStatus(`Loading last ${count} slugs...`);
        const res = await fetch(
          `/api/poly-hit80?marketBase=${encodeURIComponent(marketBase)}&anchorStartTsSec=${encodeURIComponent(
            String(anchorStartTsSec)
          )}&count=${encodeURIComponent(String(count))}&threshold=0.8&fidelity=1`,
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
    const s = seriesRef.current;
    if (!s) return;

    s.yes.setData([]);
    s.no.setData([]);
    s.opposite.setData([]);
    s.unknown.setData([]);

    if (!data) return;

    const yesPts: LineData[] = [];
    const noPts: LineData[] = [];
    const oppPts: LineData[] = [];
    const unkPts: LineData[] = [];

    for (const r of data.rows) {
      if (!r.firstHit) continue;
      const t = r.startTsSec as UTCTimestamp;
      const v = Number(r.firstHit.p);
      if (!Number.isFinite(v)) continue;

      if (r.outcomeKnown) {
        if (r.match === true) {
          if (r.firstHit.side === "YES") yesPts.push({ time: t, value: v });
          else noPts.push({ time: t, value: v });
        } else if (r.match === false) {
          oppPts.push({ time: t, value: v });
        }
      } else {
        unkPts.push({ time: t, value: v });
      }
    }

    s.yes.setData(yesPts);
    s.no.setData(noPts);
    s.opposite.setData(oppPts);
    s.unknown.setData(unkPts);
  }, [data]);

  const hits = data?.totals.hitCount ?? 0;
  const known = data?.totals.knownOutcomeCount ?? 0;
  const matches = data?.totals.matchCount ?? 0;
  const opposites = data?.totals.oppositeCount ?? 0;
  const unknown = data?.totals.unknownOutcomeCount ?? 0;

  const rate = known > 0 ? `${((matches / known) * 100).toFixed(1)}%` : "-";

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span>After first hit ≥80%, does it resolve that way?</span>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>
        </div>
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          Match rate = <span className="font-mono">{matches}/{known}</span> = <span className="font-mono">{rate}</span>.
          Hits: <span className="font-mono">{hits}</span>, Opposite: <span className="font-mono">{opposites}</span>, Unknown outcome: <span className="font-mono">{unknown}</span>.
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-950">
        <div ref={elRef} />
      </div>

      <div className="px-4 py-3 text-xs bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 flex flex-wrap gap-4">
        <span><span className="inline-block h-2 w-2 rounded-full align-middle mr-2" style={{ background: colors.yes }} />YES hit ≥80% and winner YES</span>
        <span><span className="inline-block h-2 w-2 rounded-full align-middle mr-2" style={{ background: colors.no }} />NO hit ≥80% and winner NO</span>
        <span><span className="inline-block h-2 w-2 rounded-full align-middle mr-2" style={{ background: colors.opposite }} />Hit ≥80% but winner opposite</span>
        <span><span className="inline-block h-2 w-2 rounded-full align-middle mr-2" style={{ background: colors.unknown }} />Hit ≥80% but winner unknown (not closed / not inferred)</span>
      </div>
    </div>
  );
}
