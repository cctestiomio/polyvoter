import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  marketBase: z.string().min(3),
  anchorStartTsSec: z.coerce.number().int().positive(),
  count: z.coerce.number().int().min(1).max(240).default(70),
  threshold: z.coerce.number().min(0.5).max(0.99).default(0.8),
  fidelity: z.coerce.number().int().min(1).max(5).default(1)
});

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

function toNumArray(v: any): number[] {
  return normalizeStringOrArray(v).map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

async function fetchMarketBySlug(slug: string) {
  return fetchJson(`https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`, 12000);
}

async function fetchPricesHistory(tokenId: string, startTsSec: number, endTsSec: number, fidelityMin: number) {
  const url = new URL("https://clob.polymarket.com/prices-history");
  url.searchParams.set("market", tokenId);
  url.searchParams.set("startTs", String(startTsSec));
  url.searchParams.set("endTs", String(endTsSec));
  url.searchParams.set("fidelity", String(fidelityMin));
  return fetchJson(url.toString(), 15000);
}

function firstHit(history: Array<{ t: number; p: number }>, thr: number) {
  const sorted = history
    .map((x) => ({ t: Number(x.t), p: Number(x.p) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p))
    .sort((a, b) => a.t - b.t);

  for (const pt of sorted) {
    if (pt.p >= thr) return pt;
  }
  return null;
}

function inferredWinnerFromOutcomePrices(outcomePrices: number[], closed: any): "YES" | "NO" | null {
  if (!closed) return null;
  if (outcomePrices.length < 2) return null;

  const a = outcomePrices[0];
  const b = outcomePrices[1];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const max = Math.max(a, b);
  const min = Math.min(a, b);
  if (max >= 0.98 && min <= 0.02) return a > b ? "YES" : "NO";
  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.safeParse({
      marketBase: searchParams.get("marketBase") ?? undefined,
      anchorStartTsSec: searchParams.get("anchorStartTsSec") ?? undefined,
      count: searchParams.get("count") ?? undefined,
      threshold: searchParams.get("threshold") ?? undefined,
      fidelity: searchParams.get("fidelity") ?? undefined
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { marketBase, anchorStartTsSec, count, threshold, fidelity } = parsed.data;
    const base = marketBase.trim().replace(/-+$/g, "");

    const rows: any[] = [];

    for (let i = count - 1; i >= 0; i--) {
      const start = anchorStartTsSec - i * 300;
      const end = start + 300;
      const slug = `${base}-${start}`;

      try {
        const m = await fetchMarketBySlug(slug);
        const ids = normalizeStringOrArray(m?.clobTokenIds ?? m?.clobTokenIDs ?? m?.clob_token_ids);
        const yesId = ids?.[0] ? String(ids[0]) : null;
        const noId = ids?.[1] ? String(ids[1]) : null;

        const outcomePrices = toNumArray(m?.outcomePrices);
        const resolvedWinner = inferredWinnerFromOutcomePrices(outcomePrices, m?.closed);

        let yesHit = null;
        let noHit = null;

        if (yesId) {
          const h = await fetchPricesHistory(yesId, start, end, fidelity);
          const hist = Array.isArray(h?.history) ? h.history : [];
          yesHit = firstHit(hist, threshold);
        }
        if (noId) {
          const h = await fetchPricesHistory(noId, start, end, fidelity);
          const hist = Array.isArray(h?.history) ? h.history : [];
          noHit = firstHit(hist, threshold);
        }

        let first: null | { side: "YES" | "NO"; t: number; p: number } = null;
        if (yesHit && noHit) first = yesHit.t <= noHit.t ? { side: "YES", t: yesHit.t, p: yesHit.p } : { side: "NO", t: noHit.t, p: noHit.p };
        else if (yesHit) first = { side: "YES", t: yesHit.t, p: yesHit.p };
        else if (noHit) first = { side: "NO", t: noHit.t, p: noHit.p };

        const outcomeKnown = resolvedWinner !== null;
        const match =
          first && resolvedWinner ? (first.side === resolvedWinner) : null;

        rows.push({
          slug,
          startTsSec: start,
          endTsSec: end,
          threshold,
          firstHit: first,
          resolvedWinner,
          outcomeKnown,
          match
        });
      } catch (e: any) {
        rows.push({ slug, startTsSec: start, endTsSec: end, error: e?.message ?? "Failed" });
      }
    }

    const hits = rows.filter((r) => r?.firstHit);
    const withKnownOutcome = hits.filter((r) => r?.outcomeKnown);
    const matches = withKnownOutcome.filter((r) => r.match === true);
    const opposites = withKnownOutcome.filter((r) => r.match === false);
    const unknown = hits.filter((r) => !r?.outcomeKnown);

    return NextResponse.json(
      {
        marketBase: base,
        anchorStartTsSec,
        count,
        threshold,
        fidelity,
        totals: {
          hitCount: hits.length,
          knownOutcomeCount: withKnownOutcome.length,
          matchCount: matches.length,
          oppositeCount: opposites.length,
          unknownOutcomeCount: unknown.length,
          matchRate: withKnownOutcome.length ? matches.length / withKnownOutcome.length : null
        },
        rows
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
