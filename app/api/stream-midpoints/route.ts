import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function midFromBestBidAsk(m: any): number | null {
  const bid = Number(m?.best_bid);
  const ask = Number(m?.best_ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return (bid + ask) / 2;
}

function best(side: "bid" | "ask", levels: any[]): number | null {
  const nums = (Array.isArray(levels) ? levels : [])
    .map((x) => Number(x?.price ?? x?.[0]))
    .filter((p) => Number.isFinite(p));
  if (!nums.length) return null;
  return side === "bid" ? Math.max(...nums) : Math.min(...nums);
}

function midFromBook(m: any): number | null {
  const bids = m?.bids ?? m?.buys ?? [];
  const asks = m?.asks ?? m?.sells ?? [];
  const bid = best("bid", bids);
  const ask = best("ask", asks);
  if (bid === null || ask === null) return null;
  return (bid + ask) / 2;
}

export async function GET(req: Request) {
  process.env.WS_NO_BUFFER_UTIL = process.env.WS_NO_BUFFER_UTIL || "1";
  process.env.WS_NO_UTF_8_VALIDATE = process.env.WS_NO_UTF_8_VALIDATE || "1";

  const { default: WebSocket } = await import("ws");

  const { searchParams } = new URL(req.url);
  const yes = String(searchParams.get("yes") ?? "").trim();
  const no = String(searchParams.get("no") ?? "").trim();
  if (!yes || !no) return NextResponse.json({ error: "Missing yes/no token ids" }, { status: 400 });

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;

      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };

      const sendEvent = (obj: any) => write(`data: ${JSON.stringify(obj)}\n\n`);
      const sendComment = (txt: string) => write(`: ${txt}\n\n`);

      // Keep last known values and emit combined ticks
      let lastYes: number | null = null;
      let lastNo: number | null = null;
      let lastEmitMs = 0;

      const maybeEmit = (tsMs: number) => {
        // Throttle combined emits to reduce UI flicker (10 per sec max)
        const now = Date.now();
        if (now - lastEmitMs < 100) return;
        lastEmitMs = now;

        sendEvent({
          type: "tick",
          tsMs,
          yesAssetId: yes,
          noAssetId: no,
          yesMid: lastYes,
          noMid: lastNo,
        });
      };

      const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market", {
        perMessageDeflate: false,
      }); // WSS quickstart market path [page:5]

      let pingTimer: NodeJS.Timeout | null = null;
      let sseKeepAlive: NodeJS.Timeout | null = null;

      cleanup = () => {
        if (closed) return;
        closed = true;
        try { ws.close(); } catch {}
        if (pingTimer) clearInterval(pingTimer);
        if (sseKeepAlive) clearInterval(sseKeepAlive);
        try { controller.close(); } catch {}
      };

      ws.on("open", () => {
        // Subscribe shape from quickstart [page:5]
        ws.send(JSON.stringify({ assets_ids: [yes, no], type: "market" }));

        // Keepalive PING pattern [page:5]
        pingTimer = setInterval(() => {
          try { ws.send("PING"); } catch {}
        }, 10000);

        sseKeepAlive = setInterval(() => sendComment("keepalive"), 20000);

        sendEvent({ type: "status", status: "subscribed" });
      });

      ws.on("message", (raw) => {
        if (closed) return;
        try {
          const msg = JSON.parse(raw.toString());
          const assetId = String(msg?.asset_id ?? "");
          if (assetId !== yes && assetId !== no) return;

          const eventType = String(msg?.event_type ?? "");
          let mid: number | null = null;

          // Market channel supports these events [page:4]
          if (eventType === "best_bid_ask") mid = midFromBestBidAsk(msg);
          else if (eventType === "book") mid = midFromBook(msg);
          else mid = midFromBestBidAsk(msg) ?? midFromBook(msg);

          if (mid === null || !Number.isFinite(mid)) return;

          const tsMs = Number(msg?.timestamp);
          const useTsMs = Number.isFinite(tsMs) ? tsMs : Date.now();

          if (assetId === yes) lastYes = mid;
          if (assetId === no) lastNo = mid;

          maybeEmit(useTsMs);
        } catch {}
      });

      ws.on("close", (code, reason) => {
        sendEvent({ type: "status", status: "closed", code, reason: reason?.toString?.() ?? "" });
        cleanup?.();
      });

      ws.on("error", (err) => {
        sendEvent({ type: "status", status: "error", message: String((err as any)?.message ?? err) });
        cleanup?.();
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
