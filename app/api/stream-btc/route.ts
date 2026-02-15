import { NextResponse } from "next/server";

// Edge runtime is required to support standard WebSocket without 'bufferutil' issues
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const ws = new WebSocket("wss://ws-live-data.polymarket.com");
      let keepAliveTimer: any = null;
      let closed = false;

      const sendSse = (data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      ws.onopen = () => {
        // Subscribe to Chainlink BTC/USD
        const msg = {
          action: "subscribe",
          subscriptions: [
            {
              topic: "crypto_prices_chainlink",
              type: "*",
              filters: JSON.stringify({ symbol: "btc/usd" }),
            },
          ],
        };
        ws.send(JSON.stringify(msg));

        // Ping every 15s to keep connection alive
        keepAliveTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("PING");
            sendSse({ type: "ping" });
          }
        }, 15000);

        sendSse({ type: "status", status: "subscribed" });
      };

      ws.onmessage = (event) => {
        if (closed) return;
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.topic === "crypto_prices_chainlink" && msg.type === "update") {
            const { symbol, value, timestamp } = msg.payload || {};
            // Filter strictly for BTC/USD
            if (symbol === "btc/usd" && value) {
              sendSse({
                type: "tick",
                symbol: "btc/usd",
                value: Number(value), // Ensure it's a number
                tsMs: Number(timestamp),
              });
            }
          }
        } catch (e) {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!closed) {
          sendSse({ type: "status", status: "closed" });
          closed = true;
          try { controller.close(); } catch {}
        }
      };

      ws.onerror = (e) => {
        if (!closed) {
          sendSse({ type: "status", status: "error" });
        }
      };

      return () => {
        closed = true;
        clearInterval(keepAliveTimer);
        ws.close();
      };
    },
    cancel() {
      // Stream canceled
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
    },
  });
}
