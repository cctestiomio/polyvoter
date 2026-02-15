import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  source: z.enum(["binance", "coinbase"]).default("binance"),
});

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal, ...init });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.safeParse({ source: searchParams.get("source") ?? undefined });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { source } = parsed.data;

    if (source === "binance") {
      const j = await fetchJson("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
      const px = Number(j?.price);
      if (!Number.isFinite(px)) throw new Error("Binance response missing price");
      return NextResponse.json(
        { source: "binance", symbol: "BTCUSDT", price: px, tsMs: Date.now() },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const j = await fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot", {
      headers: { "CB-VERSION": "2015-04-08" },
    });
    const px = Number(j?.data?.amount);
    if (!Number.isFinite(px)) throw new Error("Coinbase response missing data.amount");
    return NextResponse.json(
      { source: "coinbase", symbol: "BTC-USD", price: px, tsMs: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
