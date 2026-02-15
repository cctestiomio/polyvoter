import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tokenId = searchParams.get("tokenId");
  const startTs = searchParams.get("startTs");
  const endTs = searchParams.get("endTs");

  if (!tokenId) return NextResponse.json({ history: [] });

  try {
    // 1-minute candles from Polymarket CLOB
    const url = `https://clob.polymarket.com/prices-history?interval=1m&market=${tokenId}&startTs=${startTs}&endTs=${endTs}`;
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0", // Mimic browser to avoid some blocks
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      console.error("Poly history fetch failed:", res.status);
      return NextResponse.json({ history: [] });
    }
    
    const data = await res.json();
    return NextResponse.json({ history: data.history || [] });
  } catch (e) {
    console.error("Poly history proxy error:", e);
    return NextResponse.json({ history: [] });
  }
}
