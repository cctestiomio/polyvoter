"use client";
import { useEffect, useState } from "react";

export default function DebugBtcStream() {
  const [last, setLast] = useState<string>("(none)");
  const [status, setStatus] = useState<string>("idle");

  useEffect(() => {
    const es = new EventSource(`/api/stream-btc?t=${Date.now()}`);
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "status") setStatus(msg.status);
      if (msg.type === "tick") setLast(`${new Date(msg.tsMs).toISOString()}  btc/usd=${msg.value}`);
    };
    es.onerror = () => setStatus("error");
    return () => es.close();
  }, []);

  return (
    <div className="text-sm">
      <div>Status: {status}</div>
      <div className="font-mono">{last}</div>
    </div>
  );
}
