"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  ISeriesApi,
  IChartApi,
  LineData,
  UTCTimestamp,
  LogicalRange,
} from "lightweight-charts";

type Props = {
  theme: "light" | "dark";
  yesTokenId: string | null;
  noTokenId: string | null;
  windowStartTsSec?: number | null;
  onYesMid?: (mid: number) => void;
  onNoMid?: (mid: number) => void;
};

export default function PolyLiveChart({
  theme,
  yesTokenId,
  noTokenId,
  windowStartTsSec,
  onYesMid,
  onNoMid,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const yesSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const noSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Connection guard
  const startedRef = useRef(false);
  
  // Track if we have set the initial 5m range
  const hasFittedRef = useRef(false);

  const [status, setStatus] = useState("Idle");
  const [lastIso, setLastIso] = useState("-");
  const [yesMid, setYesMid] = useState<number | null>(null);
  const [noMid, setNoMid] = useState<number | null>(null);

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      yes: dark ? "#22c55e" : "#16a34a",
      no: dark ? "#fb7185" : "#e11d48",
    };
  }, [theme]);

  // 1. Initialize Chart
  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      width: elRef.current.clientWidth || 800,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: colors.bg },
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true, // Smooth scrolling enabled
        rightOffset: 20, // Small buffer
      },
    });

    chartRef.current = chart;

    yesSeriesRef.current = chart.addLineSeries({
      color: colors.yes,
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    noSeriesRef.current = chart.addLineSeries({
      color: colors.no,
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    const ro = new ResizeObserver(() => {
      if (elRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: elRef.current.clientWidth });
      }
    });
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      yesSeriesRef.current = null;
      noSeriesRef.current = null;
      hasFittedRef.current = false;
    };
  }, [colors]);

  // Reset guard when tokens change
  useEffect(() => {
    startedRef.current = false;
    hasFittedRef.current = false;
  }, [yesTokenId, noTokenId]);

  // 2. Stream Logic
  useEffect(() => {
    if (startedRef.current) return;
    if (!yesTokenId || !noTokenId) {
      setStatus("Missing token ids");
      return;
    }

    startedRef.current = true;
    setStatus("Connecting…");
    setYesMid(null);
    setNoMid(null);
    setLastIso("-");

    // Clear old data
    if (yesSeriesRef.current) yesSeriesRef.current.setData([]);
    if (noSeriesRef.current) noSeriesRef.current.setData([]);

    const url = `/api/stream-midpoints?yes=${encodeURIComponent(
      yesTokenId
    )}&no=${encodeURIComponent(noTokenId)}&t=${Date.now()}`;

    const es = new EventSource(url);

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);

        if (msg.type === "status") {
          setStatus(String(msg.status));
          return;
        }
        if (msg.type !== "tick") return;

        const tsMs = Number(msg.tsMs);
        if (!Number.isFinite(tsMs)) return;

        const t = Math.floor(tsMs / 1000) as UTCTimestamp;
        let updated = false;

        if (typeof msg.yesMid === "number") {
          const v = Number(msg.yesMid);
          if (Number.isFinite(v)) {
            yesSeriesRef.current?.update({ time: t, value: v } as LineData);
            setYesMid(v);
            onYesMid?.(v);
            updated = true;
          }
        }

        if (typeof msg.noMid === "number") {
          const v = Number(msg.noMid);
          if (Number.isFinite(v)) {
            noSeriesRef.current?.update({ time: t, value: v } as LineData);
            setNoMid(v);
            onNoMid?.(v);
            updated = true;
          }
        }

        if (updated) {
          setLastIso(new Date(tsMs).toISOString());
          setStatus("streaming");

          // FORCE 5-MINUTE VIEW on first data point
          if (!hasFittedRef.current && chartRef.current) {
            hasFittedRef.current = true;
            
            // Set range from -300 (5 mins ago) to +10 (future buffer)
            // This forces the chart to display empty space to the left
            chartRef.current.timeScale().setVisibleLogicalRange({
              from: -300, 
              to: 10,
            } as LogicalRange);
          }
        }
      } catch {
        // ignore
      }
    };

    es.onerror = () => setStatus("SSE error");

    return () => {
      es.close();
      startedRef.current = false;
    };
  }, [yesTokenId, noTokenId, onYesMid, onNoMid]);

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>
          YES/NO midpoint
          <span className="text-xs text-zinc-600 dark:text-zinc-400 font-normal transition-all duration-300">
            {yesMid == null ? "" : ` — YES ${yesMid.toFixed(4)}`}
            {noMid == null ? "" : ` | NO ${noMid.toFixed(4)}`}
            {windowStartTsSec ? ` | Window ${new Date(windowStartTsSec * 1000).toISOString()}` : ""}
          </span>
        </span>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>
      </div>

      <div className="bg-white dark:bg-zinc-950">
        <div ref={elRef} />
      </div>

      <div className="px-4 py-3 text-xs bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
        Last tick: <span className="font-mono">{lastIso}</span>
      </div>
    </div>
  );
}
