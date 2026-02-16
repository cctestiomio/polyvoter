"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  ISeriesApi,
  IChartApi,
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

type HistPoint = { t: number; p: number };
type Pt = { time: UTCTimestamp; value: number };

async function fetchTokenHistory(tokenId: string, startTs: number, endTs: number): Promise<HistPoint[]> {
  try {
    const res = await fetch(
      `/api/poly-history?tokenId=${encodeURIComponent(tokenId)}&startTs=${encodeURIComponent(
        String(startTs)
      )}&endTs=${encodeURIComponent(String(endTs))}&t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const json: any = await res.json().catch(() => null);
    return Array.isArray(json?.history) ? (json.history as HistPoint[]) : [];
  } catch {
    return [];
  }
}

function toPts(hist: HistPoint[]): Pt[] {
  return hist
    .map((p) => ({ time: Number(p.t) as UTCTimestamp, value: Number(p.p) }))
    .filter((x) => Number.isFinite(x.time) && Number.isFinite(x.value))
    .sort((a, b) => a.time - b.time)
    .filter((v, i, a) => i === 0 || v.time !== a[i - 1].time);
}

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

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);

  // Tracks whether we should “follow” realtime (stay pinned to the right).
  // If user scrolls left, this turns false until they return near the right edge.
  const autoFollowRef = useRef(true);

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
    // Always animated; returns chart to “realtime” position.
    chart.timeScale().scrollToRealTime();
  };

  // 1) Initialize chart + subscribe to user scrolling
  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      width: elRef.current.clientWidth || 800,
      height: 300,
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

    // Detect whether user has scrolled away from realtime.
    const ts = chart.timeScale();
    const onRangeChange = () => {
      // scrollPosition() is distance from right edge to latest bar (in bars).
      const pos = ts.scrollPosition();
      autoFollowRef.current = pos <= 2; // “near the right edge”
    };
    ts.subscribeVisibleLogicalRangeChange(onRangeChange);

    const ro = new ResizeObserver(() => {
      if (elRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: elRef.current.clientWidth });
      }
    });
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      ts.unsubscribeVisibleLogicalRangeChange(onRangeChange);
      chart.remove();
      chartRef.current = null;
      yesSeriesRef.current = null;
      noSeriesRef.current = null;
      hasFittedRef.current = false;
    };
  }, [colors]);

  // 1b) When tab becomes visible again, re-follow realtime
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

  // 2) Backfill + stream
  const connect = async () => {
    if (isUnmountedRef.current || !yesTokenId || !noTokenId) return;

    closeStream();
    setStatus("Loading history...");

    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = nowSec - 21600;

      const [yesHist, noHist] = await Promise.all([
        fetchTokenHistory(yesTokenId, startSec, nowSec),
        fetchTokenHistory(noTokenId, startSec, nowSec),
      ]);

      if (isUnmountedRef.current) return;

      if (yesSeriesRef.current) {
        const data = toPts(yesHist);
        yesSeriesRef.current.setData(data);
        if (data.length) {
          const val = data[data.length - 1].value;
          setYesMid(val);
          onYesMid?.(val);
        }
      }

      if (noSeriesRef.current) {
        const data = toPts(noHist);
        noSeriesRef.current.setData(data);
        if (data.length) {
          const val = data[data.length - 1].value;
          setNoMid(val);
          onNoMid?.(val);
        }
      }

      // Your initial 5m-ish view logic (only once)
      if (!hasFittedRef.current && chartRef.current) {
        hasFittedRef.current = true;
        chartRef.current.timeScale().setVisibleLogicalRange({ from: -300, to: 10 } as LogicalRange);
      }

      // After backfill, follow realtime (unless user purposely scrolled away earlier)
      if (autoFollowRef.current) followRightEdge();
    } catch {
      // still attempt stream
    }

    if (isUnmountedRef.current) return;

    setStatus("Connecting stream…");

    const url = `/api/stream-midpoints?yes=${encodeURIComponent(yesTokenId)}&no=${encodeURIComponent(
      noTokenId
    )}&t=${Date.now()}`;

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
        if (!Number.isFinite(tsMs)) return;

        const t = Math.floor(tsMs / 1000) as UTCTimestamp;
        let updated = false;

        if (typeof msg.yesMid === "number" && Number.isFinite(msg.yesMid)) {
          const v = Number(msg.yesMid);
          yesSeriesRef.current?.update({ time: t, value: v });
          setYesMid(v);
          onYesMid?.(v);
          updated = true;
        }

        if (typeof msg.noMid === "number" && Number.isFinite(msg.noMid)) {
          const v = Number(msg.noMid);
          noSeriesRef.current?.update({ time: t, value: v });
          setNoMid(v);
          onNoMid?.(v);
          updated = true;
        }

        if (updated) {
          setLastIso(new Date(tsMs).toISOString());

          // This is the key: if we’re in “follow” mode, always push view to the right.
          if (autoFollowRef.current) followRightEdge();
        }
      } catch {
        // ignore
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

  // 3) Trigger on token change (and window change)
  useEffect(() => {
    isUnmountedRef.current = false;
    hasFittedRef.current = false;
    autoFollowRef.current = true;

    if (yesTokenId && noTokenId) {
      yesSeriesRef.current?.setData([]);
      noSeriesRef.current?.setData([]);
      connect();
    } else {
      setStatus("Missing token ids");
    }

    return () => {
      isUnmountedRef.current = true;
      closeStream();
    };
  }, [yesTokenId, noTokenId, windowStartTsSec]);

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

      <div className="px-4 py-3 text-xs bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 flex items-center justify-between">
        <span>
          Last tick: <span className="font-mono">{lastIso}</span>
        </span>

        <button
          type="button"
          onClick={() => {
            autoFollowRef.current = true;
            followRightEdge();
          }}
          className="rounded-md px-2 py-1 ring-1 ring-zinc-200 text-zinc-700 hover:bg-zinc-50
                     dark:ring-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Go realtime
        </button>
      </div>
    </div>
  );
}
