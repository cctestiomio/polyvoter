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

// Helper: Fetch history safely
async function fetchTokenHistory(tokenId: string, startTs: number, endTs: number) {
  try {
    // Try our internal proxy first to avoid CORS
    const res = await fetch(
      `/api/poly-history?tokenId=${tokenId}&startTs=${startTs}&endTs=${endTs}`
    );
    if (!res.ok) return [];
    const json = await res.json();
    return json.history || [];
  } catch {
    return [];
  }
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

  // Connection guard & Reconnect refs
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountedRef = useRef(false);
  
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

  // 1. Initialize Chart (EXACTLY as you provided)
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

  // 2. Robust Connection Logic (Backfill + Reconnect + Stream)
  const connect = async () => {
    if (isUnmountedRef.current || !yesTokenId || !noTokenId) return;

    // Cleanup any existing connection before starting new one
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus("Loading history...");

    // --- A. BACKFILL HISTORY (New Robust Logic) ---
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = nowSec - 21600; // Fetch last 6 hours to be safe

      const [yesHist, noHist] = await Promise.all([
        fetchTokenHistory(yesTokenId, startSec, nowSec),
        fetchTokenHistory(noTokenId, startSec, nowSec),
      ]);

      if (isUnmountedRef.current) return;

      // Populate YES Series
      if (yesSeriesRef.current && yesHist.length > 0) {
        const data = yesHist
          .map((p: any) => ({ time: Number(p.t) as UTCTimestamp, value: Number(p.p) }))
          .sort((a, b) => a.time - b.time)
          .filter((v, i, a) => i === 0 || v.time !== a[i - 1].time); // Dedupe
        yesSeriesRef.current.setData(data);
        
        if (data.length > 0) {
            const val = data[data.length - 1].value;
            setYesMid(val);
            onYesMid?.(val);
        }
      }

      // Populate NO Series
      if (noSeriesRef.current && noHist.length > 0) {
        const data = noHist
          .map((p: any) => ({ time: Number(p.t) as UTCTimestamp, value: Number(p.p) }))
          .sort((a, b) => a.time - b.time)
          .filter((v, i, a) => i === 0 || v.time !== a[i - 1].time); // Dedupe
        noSeriesRef.current.setData(data);

        if (data.length > 0) {
            const val = data[data.length - 1].value;
            setNoMid(val);
            onNoMid?.(val);
        }
      }

      // --- B. APPLY YOUR EXACT 5-MINUTE VIEW LOGIC ---
      // We apply this immediately after history load so the user sees data right away.
      if (!hasFittedRef.current && chartRef.current) {
        hasFittedRef.current = true;
        
        // Exact logic you liked:
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: -300, 
          to: 10,
        } as LogicalRange);
      }

    } catch (e) {
      console.error("History fetch error:", e);
      // Continue to streaming even if history fails
    }

    // --- C. START STREAMING ---
    if (isUnmountedRef.current) return;
    setStatus("Connecting stream…");

    const url = `/api/stream-midpoints?yes=${encodeURIComponent(
      yesTokenId
    )}&no=${encodeURIComponent(noTokenId)}&t=${Date.now()}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setStatus("Streaming");

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);

        // Keep-alive / Ping handling
        if (msg.type === "ping") return; 

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
          
          // Re-apply view logic ONLY if not yet applied (fallback)
          if (!hasFittedRef.current && chartRef.current) {
            hasFittedRef.current = true;
            chartRef.current.timeScale().setVisibleLogicalRange({
              from: -300, 
              to: 10,
            } as LogicalRange);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setStatus("Reconnecting...");
      es.close();
      if (!isUnmountedRef.current) {
        // Retry connection in 3s
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };
  };

  // 3. Trigger Connection on Token Change
  useEffect(() => {
    isUnmountedRef.current = false;
    hasFittedRef.current = false;
    
    if (yesTokenId && noTokenId) {
       // Clear old data first
       if (yesSeriesRef.current) yesSeriesRef.current.setData([]);
       if (noSeriesRef.current) noSeriesRef.current.setData([]);
       
       connect();
    } else {
       setStatus("Missing token ids");
    }

    return () => {
      isUnmountedRef.current = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [yesTokenId, noTokenId]); 
  // removed onYesMid/onNoMid from dep array to avoid re-connecting on callback change

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
