"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  // Use the exact resolved slug + token IDs you already compute in page.tsx
  slug: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;

  // 5m window start/end (seconds)
  startTsSec: number | null;

  // threshold you care about (e.g. 0.8)
  threshold?: number;
};

function coerceNum(x: any): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickMidFromAnyShape(json: any, tokenId: string): number | null {
  if (!json) return null;

  // Common shapes:
  // 1) { "<tokenId>": "0.83", "<tokenId2>": "0.17" }
  if (typeof json === "object" && json[tokenId] != null) {
    return coerceNum(json[tokenId]);
  }

  // 2) { midprices: { "<tokenId>": "0.83" } } or { midPrices: {...} }
  const mp = json.midprices ?? json.midPrices ?? json.mid_prices ?? null;
  if (mp && typeof mp === "object" && mp[tokenId] != null) {
    return coerceNum(mp[tokenId]);
  }

  // 3) { data: { "<tokenId>": "0.83" } }
  const data = json.data ?? null;
  if (data && typeof data === "object" && data[tokenId] != null) {
    return coerceNum(data[tokenId]);
  }

  return null;
}

export default function PolyMidpointRecorder({
  slug,
  yesTokenId,
  noTokenId,
  startTsSec,
  threshold = 0.8,
}: Props) {
  const [status, setStatus] = useState("Idle");
  const [last, setLast] = useState<{ tsSec: number; yes: number | null; no: number | null } | null>(null);

  const activeRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const endTsSec = useMemo(() => (startTsSec ? startTsSec + 300 : null), [startTsSec]);

  useEffect(() => {
    activeRef.current = true;

    const run = async () => {
      if (!slug || !yesTokenId || !noTokenId || !startTsSec || !endTsSec) {
        setStatus("Waiting for market...");
        return;
      }

      // Only record while we are in/near the window (small grace so you still catch late moves)
      const nowSec = Math.floor(Date.now() / 1000);
      const within = nowSec >= startTsSec - 5 && nowSec <= endTsSec + 120;
      if (!within) {
        setStatus("Outside window (not recording)");
        return;
      }

      setStatus("Recording…");

      try {
        // Prefer batch endpoint (/midprices) to minimize requests. [page:0]
        const url = `https://clob.polymarket.com/midprices?markets=${encodeURIComponent(
          `${yesTokenId},${noTokenId}`
        )}`;

        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json().catch(() => null);

        const yes = pickMidFromAnyShape(json, yesTokenId);
        const no = pickMidFromAnyShape(json, noTokenId);

        const tsSec = Math.floor(Date.now() / 1000);
        setLast({ tsSec, yes, no });

        // Ingest any finite midpoints
        const ingest = async (tokenId: string, mid: number) => {
          await fetch("/api/poly-mid-ingest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug, tokenId, tsSec, mid }),
            keepalive: true,
          });
        };

        if (typeof yes === "number" && Number.isFinite(yes)) await ingest(yesTokenId, yes);
        if (typeof no === "number" && Number.isFinite(no)) await ingest(noTokenId, no);
      } catch {
        setStatus("Recorder error (will retry)");
      }
    };

    const tick = async () => {
      if (!activeRef.current) return;
      await run();
      if (!activeRef.current) return;
      timerRef.current = window.setTimeout(tick, 1000);
    };

    tick();

    return () => {
      activeRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [slug, yesTokenId, noTokenId, startTsSec, endTsSec]);

  return (
    <div className="text-xs text-zinc-600 dark:text-zinc-400">
      Recorder: {status}
      {last ? (
        <span className="ml-2 font-mono">
          t={last.tsSec} yes={last.yes?.toFixed?.(4) ?? "-"} no={last.no?.toFixed?.(4) ?? "-"} thr={threshold}
        </span>
      ) : null}
    </div>
  );
}
