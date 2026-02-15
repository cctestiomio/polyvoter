import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({ slug: z.string().min(3) });

async function fetchJson(url: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const msg = json?.error || json?.message || `HTTP ${res.status}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function normalizeStringOrArray(v: any): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {}
    }
    if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
    return s ? [s] : [];
  }
  return [];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.safeParse({ slug: searchParams.get("slug") ?? "" });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const slug = parsed.data.slug.trim();

    // Official endpoint: /markets/slug/{slug} [web:289]
    const market = await fetchJson(`https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`);

    const clobTokenIdsRaw = market?.clobTokenIds ?? market?.clobTokenIDs ?? market?.clob_token_ids;
    const clobTokenIds = normalizeStringOrArray(clobTokenIdsRaw);

    return NextResponse.json(
      {
        slug,
        question: market?.question ?? market?.title ?? slug,
        clobTokenIds,
        outcomes: normalizeStringOrArray(market?.outcomes),
        outcomePrices: normalizeStringOrArray(market?.outcomePrices)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
