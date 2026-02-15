"use client";
import { useEffect, useState } from "react";

export default function DebugMidStream({ yes, no }: { yes: string; no: string }) {
  const [last, setLast] = useState<string>("(none)");
  const [status, setStatus] = useState<string>("idle");

  useEffect(() => {
    const es = new EventSource(`/api/stream-midpoints?yes=${encodeURIComponent(yes)}&no=${encodeURIComponent(no)}&t=${Date.now()}`);
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "status") setStatus(msg.status);
      if (msg.type === "tick") setLast(`${new Date(msg.tsMs).toISOString()}  ${msg.assetId} mid=${msg.mid}`);
    };
    es.onerror = () => setStatus("error");
    return () => es.close();
  }, [yes, no]);

  return (
    <div className="text-sm">
      <div>Status: {status}</div>
      <div className="font-mono">{last}</div>
    </div>
  );
}
