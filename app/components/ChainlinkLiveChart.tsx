"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { createChart, ColorType, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";

type Props = {
  theme: "light" | "dark";
  rpcWssUrl: string | null;
  feedAddress: string | null;
};

const ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
  "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)"
];

export default function ChainlinkLiveChart({ theme, rpcWssUrl, feedAddress }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const providerRef = useRef<ethers.providers.WebSocketProvider | null>(null);
  const [status, setStatus] = useState<string>("Disconnected");
  const lastTRef = useRef<number>(0);

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      line: dark ? "#3b82f6" : "#2563eb"
    };
  }, [theme]);

  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      height: 260
    });

    const series = chart.addLineSeries({ color: colors.line, lineWidth: 2 });
    seriesRef.current = series;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: elRef.current?.clientWidth ?? 800 }));
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      seriesRef.current = null;
    };
  }, [colors]);

  useEffect(() => {
    // Clean previous
    if (providerRef.current) {
      try { providerRef.current.destroy(); } catch {}
      providerRef.current = null;
    }
    lastTRef.current = 0;

    if (!rpcWssUrl || !feedAddress) {
      setStatus("Missing NEXT_PUBLIC_RPC_WSS_URL or feed address");
      return;
    }

    setStatus("Connecting...");
    const provider = new ethers.providers.WebSocketProvider(rpcWssUrl);
    providerRef.current = provider;

    const c = new ethers.Contract(feedAddress, ABI, provider);

    let decimals = 8;

    async function seed() {
      try {
        decimals = await c.decimals();
        const r = await c.latestRoundData();
        const price = Number(ethers.utils.formatUnits(r.answer, decimals));
        const tsMs = Number(r.updatedAt) * 1000;

        const t = Math.floor(tsMs / 1000) as UTCTimestamp;
        lastTRef.current = t;
        seriesRef.current?.update({ time: t, value: price } as LineData);
        setStatus("Live (listening AnswerUpdated)");
      } catch (e: any) {
        setStatus(e?.message ?? "Seed failed");
      }
    }

    seed();

    const handler = (current: ethers.BigNumber, _roundId: ethers.BigNumber, updatedAt: ethers.BigNumber) => {
      const price = Number(ethers.utils.formatUnits(current, decimals));
      const tsMs = Number(updatedAt) * 1000;
      const t = Math.floor(tsMs / 1000) as UTCTimestamp;
      if (t <= (lastTRef.current || 0)) return;
      lastTRef.current = t;
      seriesRef.current?.update({ time: t, value: price } as LineData);
    };

    c.on("AnswerUpdated", handler);

    provider._websocket?.addEventListener?.("close", () => setStatus("WS closed (reload to reconnect)"));
    provider._websocket?.addEventListener?.("error", () => setStatus("WS error (reload to reconnect)"));

    return () => {
      try { c.off("AnswerUpdated", handler); } catch {}
      try { provider.destroy(); } catch {}
      providerRef.current = null;
      setStatus("Disconnected");
    };
  }, [rpcWssUrl, feedAddress]);

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>Chainlink BTC/USD (WS RPC)</span>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>
      </div>
      <div className="bg-white dark:bg-zinc-950">
        <div ref={elRef} />
      </div>
    </div>
  );
}