import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  token_ids: z.string().min(1), // comma-separated
});

async function fetchJson(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
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
    const parsed = Q.safeParse({ token_ids: searchParams.get("token_ids") ?? undefined });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const tokenIds = parsed.data.token_ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);

    if (!tokenIds.length) return NextResponse.json({ error: "No token_ids provided" }, { status: 400 });

    const midsArr = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const url = new URL("https://clob.polymarket.com/midpoint");
        url.searchParams.set("token_id", tokenId);
        const j = await fetchJson(url.toString());
        const mid = Number(j?.mid);
        return { tokenId, mid: Number.isFinite(mid) ? mid : null };
      })
    );

    const mids: Record<string, number | null> = {};
    for (const x of midsArr) mids[x.tokenId] = x.mid;

    return NextResponse.json(
      { tsMs: Date.now(), mids },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
