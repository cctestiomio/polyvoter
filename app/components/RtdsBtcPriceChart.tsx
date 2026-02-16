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
  IPriceLine,
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

  const priceLineRef = useRef<IPriceLine | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startedRef = useRef(false);
  const hasFittedRef = useRef(false);
  const priceToBeatRef = useRef<number | null>(null);

  // “Follow realtime” behavior: true only when user is at right edge
  const autoFollowRef = useRef(true);

  // Staleness detection: if we stop receiving ticks, reconnect when visible
  const lastTickAtMsRef = useRef<number>(0);

  // Avoid effect re-subscribe when onPrice changes
  const onPriceRef = useRef<Props["onPrice"]>(onPrice);
  useEffect(() => {
    onPriceRef.current = onPrice;
  }, [onPrice]);

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

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const closeStream = () => {
    clearReconnectTimer();
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  };

  const followRightEdge = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().scrollToRealTime();
  };

  const scheduleReconnect = (delayMs: number) => {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      openStream();
    }, delayMs);
  };

  const openStream = () => {
    // Don’t try to stream if chart isn’t ready
    if (!chartRef.current || !seriesRef.current || !leftSeriesRef.current) return;

    closeStream();
    setStatus("Connecting…");

    const es = new EventSource(`/api/stream-btc?t=${Date.now()}`);
    esRef.current = es;

    es.onopen = () => {
      setStatus("Streaming");
      // When a fresh connection opens, re-pin to realtime if in follow mode.
      if (autoFollowRef.current) followRightEdge();
    };

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

        lastTickAtMsRef.current = Date.now();

        const t = Math.floor(tsMs / 1000) as UTCTimestamp;
        const pt: LineData = { time: t, value: price };

        // Update main series (right)
        seriesRef.current?.update(pt);

        // Update dummy series (left) to keep left scale alive
        leftSeriesRef.current?.update(pt);

        setLastPrice(price);
        setLastIso(new Date(tsMs).toISOString());
        onPriceRef.current?.(price, tsMs);

        // Create “Price To Beat” once (and keep a handle to update styling)
        if (priceToBeatRef.current === null && leftSeriesRef.current) {
          priceToBeatRef.current = price;

          priceLineRef.current = leftSeriesRef.current.createPriceLine({
            price,
            color: colors.text,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "Price To Beat",
          });
        }

        // Initial fit (roughly last ~300 points)
        if (!hasFittedRef.current && chartRef.current) {
          hasFittedRef.current = true;
          chartRef.current.timeScale().setVisibleLogicalRange({ from: -300, to: 10 } as LogicalRange);
        }

        // Only force-scroll when we’re in follow mode
        if (autoFollowRef.current) followRightEdge();
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      setStatus("Reconnecting...");
      try {
        es.close();
      } catch {
        // ignore
      }
      // In practice, reconnecting explicitly avoids “stuck” streams in some failure modes.
      scheduleReconnect(1500);
    };
  };

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

    // Dummy Series (Left)
    leftSeriesRef.current = chart.addLineSeries({
      color: "transparent",
      lineVisible: false,
      lineWidth: 1,
      priceScaleId: "left",
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    // Track whether user is at right edge; if they scroll away, stop forcing follow.
    const ts = chart.timeScale();
    const onVisibleRangeChange = () => {
      const pos = ts.scrollPosition(); // distance from right edge in bars
      autoFollowRef.current = pos <= 2;
    };
    ts.subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

    const ro = new ResizeObserver(() => {
      if (elRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: elRef.current.clientWidth });
      }
    });
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      ts.unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);

      closeStream();

      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      leftSeriesRef.current = null;

      hasFittedRef.current = false;
      priceToBeatRef.current = null;
      priceLineRef.current = null;
    };
  }, [colors]); // theme change recreates chart like your original

  // 2) Start stream (once chart exists)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    lastTickAtMsRef.current = Date.now();
    openStream();

    return () => {
      startedRef.current = false;
      closeStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) On tab refocus/visibility: re-enable follow + re-pin + reconnect if stale
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;

      autoFollowRef.current = true;
      followRightEdge();

      // If we haven't received ticks recently, force a reconnect.
      const ageMs = Date.now() - (lastTickAtMsRef.current || 0);
      if (ageMs > 15_000) {
        setStatus("Reconnecting...");
        openStream();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // 4) If theme changes after the “Price To Beat” line exists, update its color
  useEffect(() => {
    if (!priceLineRef.current) return;
    // Lightweight Charts price lines don’t have a direct “setOptions” on all versions,
    // so simplest is: remove + recreate if you want perfect theme sync.
    // We’ll keep it minimal: only recreate if we still have the left series & stored price.
    const left = leftSeriesRef.current;
    const price = priceToBeatRef.current;
    if (!left || price == null) return;

    try {
      left.removePriceLine(priceLineRef.current);
    } catch {
      // ignore
    }

    priceLineRef.current = left.createPriceLine({
      price,
      color: colors.text,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Price To Beat",
    });
  }, [colors.text]);

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>
          BTC (Polymarket RTDS)
          <span className="text-xs text-zinc-600 dark:text-zinc-400 font-normal transition-all duration-300">
            {lastPrice == null ? "" : ` — $${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
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

      <div className="bg-white dark:bg-zinc-950 relative">
        <div ref={elRef} className="w-full h-[300px]" />
      </div>

      <div className="px-4 py-3 text-xs bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-900">
        Last tick: <span className="font-mono">{lastIso}</span>
      </div>
    </div>
  );
}
