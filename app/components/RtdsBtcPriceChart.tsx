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
  LineStyle,
} from "lightweight-charts";

type Props = {
  theme: "light" | "dark";
  source?: "binance" | "chainlink";
  targetPrice?: number | null;
  onPrice?: (px: number, tsMs: number) => void;
};

export default function RtdsBtcPriceChart({ theme, onPrice }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Main series (Right scale)
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Dummy series for Left-side "Price To Beat" label
  const leftSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const startedRef = useRef(false);
  const hasFittedRef = useRef(false);
  const priceToBeatRef = useRef<number | null>(null);

  const [status, setStatus] = useState("Idle");
  const [lastIso, setLastIso] = useState("-");
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      line: dark ? "#f59e0b" : "#d97706",
    };
  }, [theme]);

  // 1) Initialize chart
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
      rightPriceScale: {
        borderVisible: false,
        visible: true,
      },
      leftPriceScale: {
        visible: true,
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true,
        rightOffset: 20,
      },
    });

    chartRef.current = chart;

    // Main Series (Right)
    seriesRef.current = chart.addLineSeries({
      color: colors.line,
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      priceScaleId: "right",
      crosshairMarkerVisible: true,
    });

    // Dummy Series (Left) — DO NOT use lineWidth: 0 (invalid type in LWC typings).
    // Hide it via lineVisible: false.
    leftSeriesRef.current = chart.addLineSeries({
      color: "transparent",
      lineVisible: false,
      lineWidth: 1,
      priceScaleId: "left",
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
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
      seriesRef.current = null;
      leftSeriesRef.current = null;

      hasFittedRef.current = false;
      priceToBeatRef.current = null;
    };
  }, [colors]);

  // 2) Stream logic
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    setStatus("Connecting…");

    const es = new EventSource(`/api/stream-btc?t=${Date.now()}`);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const msg: any = JSON.parse(ev.data);

        if (msg?.type === "status") {
          setStatus(String(msg.status));
          return;
        }
        if (msg?.type === "ping") return;
        if (msg?.type !== "tick") return;

        const price = Number(msg.value ?? msg.price);
        const tsMs = Number(msg.tsMs);

        if (!Number.isFinite(tsMs) || !Number.isFinite(price)) return;

        const t = Math.floor(tsMs / 1000) as UTCTimestamp;
        const pt: LineData = { time: t, value: price };

        // Update main series (right)
        seriesRef.current?.update(pt);

        // Update dummy series (left) to keep left scale “alive”
        leftSeriesRef.current?.update(pt);

        setLastPrice(price);
        setLastIso(new Date(tsMs).toISOString());
        onPrice?.(price, tsMs);

        // Add “Price To Beat” line once on LEFT axis
        if (priceToBeatRef.current === null && leftSeriesRef.current) {
          priceToBeatRef.current = price;

          leftSeriesRef.current.createPriceLine({
            price,
            color: colors.text,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "Price To Beat",
          });
        }

        // Initial fit (roughly last ~300 points), then keep pinned to latest
        if (!hasFittedRef.current && chartRef.current) {
          hasFittedRef.current = true;
          chartRef.current.timeScale().setVisibleLogicalRange({ from: -300, to: 10 } as LogicalRange);
        }

        // Keep latest data visible (prevents “stuck on the left” after refresh)
        chartRef.current?.timeScale().scrollToRealTime();
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      setStatus("Stream dropped/error");
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
      startedRef.current = false;
    };
  }, [onPrice, colors.text]);

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>
          BTC (Polymarket RTDS)
          <span className="text-xs text-zinc-600 dark:text-zinc-400 font-normal transition-all duration-300">
            {lastPrice == null ? "" : ` — $${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          </span>
        </span>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>
      </div>

      <div className="bg-white dark:bg-zinc-950 relative">
        <div ref={elRef} className="w-full h-[300px]" />
      </div>

      <div className="px-4 py-3 text-xs bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-900">
        Last tick: <span className="font-mono">{lastIso}</span>
      </div>
    </div>
  );
}
