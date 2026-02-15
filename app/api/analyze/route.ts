import { NextResponse } from "next/server";
import { z } from "zod";
import type { Candle, AnalyzeResponse } from "@/lib/types";
import { computeIndicators } from "@/lib/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  symbol: z.string().default("BTCUSDT"),
  limit: z.coerce.number().int().min(250).max(1000).default(500),
  polymarketSlug: z.string().optional(),
  polymarketType: z.enum(["market", "event"]).optional().default("market")
});

function toCandles(binanceKlines: any[]): Candle[] {
  return binanceKlines.map(k => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6])
  }));
}

async function fetchBinanceCandles(symbol: string, limit: number) {
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "5m");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance error: ${res.status}`);
  return (await res.json()) as any[];
}

async function fetchPolymarketBySlug(slug: string, type: "market" | "event") {
  const base = "https://gamma-api.polymarket.com";
  const path = type === "event" ? `/events/slug/${slug}` : `/markets/slug/${slug}`;
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Polymarket Gamma error: ${res.status}`);
  return res.json();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    symbol: searchParams.get("symbol") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    polymarketSlug: searchParams.get("polymarketSlug") ?? undefined,
    polymarketType: (searchParams.get("polymarketType") ?? undefined) as any
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { symbol, limit, polymarketSlug, polymarketType } = parsed.data;

  const raw = await fetchBinanceCandles(symbol, limit);
  const candles = toCandles(raw);

  const { indicators, prediction } = computeIndicators(candles);

  const last = candles[candles.length - 1];
  const out: AnalyzeResponse = {
    symbol,
    interval: "5m",
    lastClose: last?.close ?? NaN,
    lastCandleCloseTime: last?.closeTime ?? 0,
    indicators,
    prediction
  };

  if (polymarketSlug) {
    out.polymarket = await fetchPolymarketBySlug(polymarketSlug, polymarketType);
  }

  return NextResponse.json(out);
}
