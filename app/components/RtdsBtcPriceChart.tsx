"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  LogicalRange,
} from "lightweight-charts";

type Theme = "light" | "dark";

type Props = {
  theme: Theme;
  source?: "binance" | "coinbase" | string;
  targetPrice?: number | null;
  onPrice?: (px: number, tsMs: number) => void;
};

type Pt = { time: UTCTimestamp; value: number };

function isVisible(el: HTMLElement | null) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

async function fetchBtcHistory(source: string, startTsSec: number, endTsSec: number) {
  // You already have an API feeding this chart; adjust the URL/shape if needed.
  // This default matches a common pattern: { points: [{tMs, p}] }
  const res = await fetch(
    `/api/btc-history?source=${encodeURIComponent(source)}&startTsSec=${encodeURIComponent(
      String(startTsSec)
    )}&endTsSec=${encodeURIComponent(String(endTsSec))}&t=${Date.now()}`,
    { cache: "no-store" }
  );
  const json: any = await res.json().catch(() => null);
  const pts = Array.isArray(json?.points) ? json.points : [];
  return pts as Array<{ tMs: number; p: number }>;
}

function toLinePoints(points: Array<{ tMs: number; p: number }>): Pt[] {
  return points
    .map((x) => ({ time: Math.floor(Number(x.tMs) / 1000) as UTCTimestamp, value: Number(x.p) }))
    .filter((x) => Number.isFinite(x.time) && Number.isFinite(x.value))
    .sort((a, b) => a.time - b.time)
    .filter((v, i, a) => i === 0 || v.time !== a[i - 1].time);
}

export default function RtdsBtcPriceChart({ theme, source = "binance", targetPrice = null, onPrice }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const pxSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const targetSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isUnmountedRef = useRef(false);
  const hasFittedRef = useRef(false);

  // “Follow realtime” behavior
  const autoFollowRef = useRef(true);

  const [status, setStatus] = useState("Idle");
  const [lastPx, setLastPx] = useState<number | null>(null);
  const [lastIso, setLastIso] = useState("-");

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      line: dark ? "#60a5fa" : "#2563eb",
      target: dark ? "rgba(245,158,11,0.9)" : "rgba(217,119,6,0.9)",
    };
  }, [theme]);

  const closeStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const followRightEdge = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().scrollToRealTime(); // restores default realtime position [web:171]
  };

  // 1) Create chart (and keep “am I at right edge?” updated)
  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      width: elRef.current.clientWidth || 800,
      height: elRef.current.clientHeight || 380,
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true,
        rightOffset: 20,
      },
      crosshair: { mode: 1 },
    });

    chartRef.current = chart;

    pxSeriesRef.current = chart.addLineSeries({
      color: colors.line,
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    // Target price reference line (as a flat line series)
    targetSeriesRef.current = chart.addLineSeries({
      color: colors.target,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Detect manual scroll-away; if user scrolls left, stop forcing follow.
    const ts = chart.timeScale();
    const onRangeChange = () => {
      const pos = ts.scrollPosition(); // distance from right edge in bars
      autoFollowRef.current = pos <= 2;
    };
    ts.subscribeVisibleLogicalRangeChange(onRangeChange);

    const ro = new ResizeObserver(() => {
      if (elRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: elRef.current.clientWidth,
          height: elRef.current.clientHeight || 380,
        });
      }
    });
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      ts.unsubscribeVisibleLogicalRangeChange(onRangeChange);
      chart.remove();
      chartRef.current = null;
      pxSeriesRef.current = null;
      targetSeriesRef.current = null;
      hasFittedRef.current = false;
    };
  }, [colors]);

  // 1b) When tab becomes visible again, re-follow realtime (fixes “freeze after background”) [web:574]
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        autoFollowRef.current = true;
        followRightEdge();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // 2) Update target line whenever targetPrice changes
  useEffect(() => {
    const targetSeries = targetSeriesRef.current;
    const pxSeries = pxSeriesRef.current;
    if (!targetSeries || !pxSeries) return;

    if (targetPrice == null || !Number.isFinite(targetPrice)) {
      targetSeries.setData([]);
      return;
    }

    // Use current visible range if available; otherwise a simple 6h span.
    const chart = chartRef.current;
    const nowSec = Math.floor(Date.now() / 1000);
    const start = nowSec - 21600;

    const t1 = start as UTCTimestamp;
    const t2 = nowSec as UTCTimestamp;

    targetSeries.setData([
      { time: t1, value: targetPrice },
      { time: t2, value: targetPrice },
    ]);

    if (autoFollowRef.current) followRightEdge();
  }, [targetPrice]);

  // 3) Backfill + stream
  const connect = async () => {
    if (isUnmountedRef.current) return;

    closeStream();
    setStatus("Loading history...");

    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = nowSec - 21600; // 6h history

      const pts = await fetchBtcHistory(source, startSec, nowSec);
      if (isUnmountedRef.current) return;

      const data = toLinePoints(pts);
      pxSeriesRef.current?.setData(data);

      if (data.length) {
        const last = data[data.length - 1];
        setLastPx(last.value);
        setLastIso(new Date(Number(last.time) * 1000).toISOString());
        onPrice?.(last.value, Number(last.time) * 1000);
      }

      if (!hasFittedRef.current && chartRef.current) {
        hasFittedRef.current = true;
        // show “recent-ish” data by default
        chartRef.current.timeScale().setVisibleLogicalRange({ from: -300, to: 10 } as LogicalRange);
      }

      if (autoFollowRef.current) followRightEdge();
    } catch {
      // continue to stream anyway
    }

    if (isUnmountedRef.current) return;

    setStatus("Connecting stream…");

    // You already have an RTDS stream; adjust URL/field names if yours differ.
    // Expected message: { type:"tick", tsMs:number, px:number }
    const url = `/api/btc-rtds?source=${encodeURIComponent(source)}&t=${Date.now()}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("Streaming");
      if (autoFollowRef.current) followRightEdge();
    };

    es.onmessage = (ev) => {
      try {
        const msg: any = JSON.parse(ev.data);

        if (msg?.type === "ping") return;
        if (msg?.type === "status") {
          setStatus(String(msg.status));
          return;
        }
        if (msg?.type !== "tick") return;

        const tsMs = Number(msg.tsMs);
        const px = Number(msg.px ?? msg.price ?? msg.p);
        if (!Number.isFinite(tsMs) || !Number.isFinite(px)) return;

        const t = Math.floor(tsMs / 1000) as UTCTimestamp;

        pxSeriesRef.current?.update({ time: t, value: px });

        setLastPx(px);
        setLastIso(new Date(tsMs).toISOString());
        onPrice?.(px, tsMs);

        // Key behavior: keep pushing the viewport right when following realtime. [web:171]
        if (autoFollowRef.current) followRightEdge();
      } catch {
        // ignore bad ticks
      }
    };

    es.onerror = () => {
      setStatus("Reconnecting...");
      es.close();
      if (!isUnmountedRef.current) {
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };
  };

  useEffect(() => {
    isUnmountedRef.current = false;
    hasFittedRef.current = false;
    autoFollowRef.current = true;

    pxSeriesRef.current?.setData([]);
    connect();

    return () => {
      isUnmountedRef.current = true;
      closeStream();
    };
    // reconnect if source changes
  }, [source]);

  return (
    <div className="h-full w-full rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden bg-white dark:bg-zinc-950">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>
          BTC (Polymarket RTDS) — {lastPx == null ? "-" : `$${lastPx.toLocaleString(undefined, { maximumFractionDigits: 3 })}`}
          <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400 font-normal">
            Last: <span className="font-mono">{lastIso}</span>
          </span>
        </span>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>
          <button
            type="button"
            onClick={() => {
              autoFollowRef.current = true;
              followRightEdge();
            }}
            className="rounded-md px-2 py-1 text-xs ring-1 ring-zinc-200 text-zinc-700 hover:bg-zinc-50
                       dark:ring-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Go realtime
          </button>
        </div>
      </div>

      <div ref={elRef} className="h-[340px] w-full" />

      {!isVisible(elRef.current) ? null : null}
    </div>
  );
}
