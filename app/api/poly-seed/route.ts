import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  marketBase: z.string().min(3),
  startTsSec: z.coerce.number().int().positive(),
  count: z.coerce.number().int().min(1).max(30).default(10),
  fidelity: z.coerce.number().int().min(1).max(5).default(1),
  interval: z.enum(["1h", "6h", "1d"]).default("1h")
});

async function fetchJson(url: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await res.text();
    if (!text) throw new Error(`Empty body (HTTP ${res.status})`);
    const json = JSON.parse(text);
    if (!res.ok) throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
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

async function fetchMarketBySlug(slug: string) {
  const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
  const res = await fetchJson(url);
  const market = Array.isArray(res) ? res[0] : res;
  if (!market) throw new Error(`Market not found for slug: ${slug}`);
  return market;
}

async function fetchYesHistory(tokenId: string, interval: string, fidelity: number) {
  const url = new URL("https://clob.polymarket.com/prices-history");
  url.searchParams.set("market", tokenId);
  url.searchParams.set("interval", interval);
  url.searchParams.set("fidelity", String(fidelity));
  return fetchJson(url.toString());
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.safeParse({
      marketBase: searchParams.get("marketBase") ?? undefined,
      startTsSec: searchParams.get("startTsSec") ?? undefined,
      count: searchParams.get("count") ?? undefined,
      fidelity: searchParams.get("fidelity") ?? undefined,
      interval: searchParams.get("interval") ?? undefined
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { marketBase, startTsSec, count, fidelity, interval } = parsed.data;

    // Build last N slugs (start timestamps, 5m steps)
    const slugs: Array<{ slug: string; start: number; end: number }> = [];
    for (let i = count - 1; i >= 0; i--) {
      const start = startTsSec - i * 300;
      slugs.push({ slug: `${marketBase}-${start}`, start, end: start + 300 });
    }

    const points: Array<{ tMs: number; p: number }> = [];
    const debug: any[] = [];

    for (const s of slugs) {
      const market = await fetchMarketBySlug(s.slug);
      const idsRaw = market?.clobTokenIds ?? market?.clobTokenIDs ?? market?.clob_token_ids;
      const ids = normalizeStringOrArray(idsRaw);

      const yesId = ids?.[0];
      if (!yesId) {
        debug.push({ slug: s.slug, error: "Missing YES token id" });
        continue;
      }

      const hist = await fetchYesHistory(yesId, interval, fidelity);
      const history = Array.isArray(hist?.history) ? hist.history : [];

      // keep only points that fall within that market’s 5-min window
      const filtered = history
        .map((x: any) => ({ t: Number(x.t), p: Number(x.p) }))
        .filter((x: any) => Number.isFinite(x.t) && Number.isFinite(x.p))
        .filter((x: any) => x.t >= s.start && x.t <= s.end);

      for (const pt of filtered) points.push({ tMs: pt.t * 1000, p: pt.p });

      debug.push({ slug: s.slug, yesTokenId: yesId, points: filtered.length });
    }

    // sort + de-dupe by timestamp
    points.sort((a, b) => a.tMs - b.tMs);
    const dedup: Array<{ tMs: number; p: number }> = [];
    let last = -1;
    for (const pt of points) {
      if (pt.tMs === last) continue;
      last = pt.tMs;
      dedup.push(pt);
    }

    return NextResponse.json(
      { marketBase, startTsSec, count, fidelity, points: dedup, debug },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
