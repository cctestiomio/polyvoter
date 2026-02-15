"use client";

import { useEffect, useRef, useState } from "react";

type TickMsg =
  | { type: "status"; status: string }
  | { type: "tick"; tsMs: number; value?: number; price?: number; symbol?: string };

function getSingletonES(url: string) {
  const g = globalThis as any;
  if (!g.__BTC_SSE__) {
    g.__BTC_SSE__ = new EventSource(url);
  }
  return g.__BTC_SSE__ as EventSource;
}

export default function BtcPriceLive() {
  const [status, setStatus] = useState("Connecting…");
  const [lastIso, setLastIso] = useState("-");
  const [last, setLast] = useState<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const es = getSingletonES(`/api/stream-btc?t=${Date.now()}`);

    const onOpen = () => {
      if (!mountedRef.current) return;
      setStatus("open");
    };

    const onMsg = (ev: MessageEvent) => {
      if (!mountedRef.current) return;

      try {
        const msg = JSON.parse(ev.data) as TickMsg;

        if (msg.type === "status") {
          setStatus(msg.status);
          return;
        }

        if (msg.type === "tick") {
          const tsMs = Number(msg.tsMs);
          const v = Number((msg as any).value ?? (msg as any).price); // accept both
          if (!Number.isFinite(tsMs) || !Number.isFinite(v)) return;

          setLastIso(new Date(tsMs).toISOString());
          setLast(v);
          setStatus("streaming");
        }
      } catch {
        // ignore bad frames
      }
    };

    const onErr = () => {
      if (!mountedRef.current) return;
      setStatus("error (SSE)");
    };

    es.addEventListener("open", onOpen as any);
    es.addEventListener("message", onMsg as any);
    es.addEventListener("error", onErr as any);

    return () => {
      mountedRef.current = false;
      // IMPORTANT: don't close the singleton; just detach listeners.
      es.removeEventListener("open", onOpen as any);
      es.removeEventListener("message", onMsg as any);
      es.removeEventListener("error", onErr as any);
    };
  }, []);

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">BTC (Polymarket WS)</div>
        <div className="text-xs text-zinc-600 dark:text-zinc-400">{status}</div>
      </div>

      <div className="mt-2 text-2xl font-mono">
        {last == null ? "—" : last.toFixed(2)}
      </div>

      <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        Last tick: <span className="font-mono">{lastIso}</span>
      </div>
    </div>
  );
}
