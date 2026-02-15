import { NextResponse } from "next/server";
import { z } from "zod";
import { computeIndicators } from "@/lib/analyze";
import type { Candle, Signal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  marketBase: z.string().min(3),
  anchorStartTsSec: z.coerce.number().int().positive(),
  count: z.coerce.number().int().min(10).max(240).default(70),
  window: z.coerce.number().int().min(5).max(40).default(15),
  fidelity: z.coerce.number().int().min(1).max(5).default(1),

  // Tuning knobs
  minVotes: z.coerce.number().int().min(1).max(10).default(3),
  minConfidence: z.coerce.number().min(0).max(1).default(0.25),
  rsiUp: z.coerce.number().min(50).max(80).default(54),
  rsiDown: z.coerce.number().min(20).max(50).default(46),
  emaFast: z.coerce.number().int().min(3).max(30).default(9),
  emaSlow: z.coerce.number().int().min(5).max(80).default(21)
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

async function gammaMarketBySlug(slug: string) {
  return fetchJson(`https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`, 12000);
}

async function yesPricesHistory(yesTokenId: string, startTsSec: number, endTsSec: number, fidelityMin: number) {
  const url = new URL("https://clob.polymarket.com/prices-history");
  url.searchParams.set("market", yesTokenId);
  url.searchParams.set("startTs", String(startTsSec));
  url.searchParams.set("endTs", String(endTsSec));
  url.searchParams.set("fidelity", String(fidelityMin));
  return fetchJson(url.toString(), 15000);
}

function pointsToCandles(points: Array<{ t: number; p: number }>): Candle[] {
  const sorted = points
    .map((x) => ({ t: Number(x.t), p: Number(x.p) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p))
    .sort((a, b) => a.t - b.t);

  return sorted.map((pt) => {
    const tMs = pt.t * 1000;
    return {
      openTime: tMs,
      open: pt.p,
      high: pt.p,
      low: pt.p,
      close: pt.p,
      volume: 0,
      closeTime: tMs + 60_000
    };
  });
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
      window: searchParams.get("window") ?? undefined,
      fidelity: searchParams.get("fidelity") ?? undefined,
      minVotes: searchParams.get("minVotes") ?? undefined,
      minConfidence: searchParams.get("minConfidence") ?? undefined,
      rsiUp: searchParams.get("rsiUp") ?? undefined,
      rsiDown: searchParams.get("rsiDown") ?? undefined,
      emaFast: searchParams.get("emaFast") ?? undefined,
      emaSlow: searchParams.get("emaSlow") ?? undefined
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const {
      marketBase,
      anchorStartTsSec,
      count,
      window,
      fidelity,
      minVotes,
      minConfidence,
      rsiUp,
      rsiDown,
      emaFast,
      emaSlow
    } = parsed.data;

    const base = marketBase.trim().replace(/-+$/g, "");
    const total = count + window;

    const slugs: Array<{ slug: string; start: number; end: number }> = [];
    for (let i = total - 1; i >= 0; i--) {
      const start = anchorStartTsSec - i * 300;
      slugs.push({ slug: `${base}-${start}`, start, end: start + 300 });
    }

    const perSlug: Array<{
      slug: string;
      startTsSec: number;
      yesTokenId: string | null;
      winner: "YES" | "NO" | null;
      yesPoints: Array<{ t: number; p: number }>;
      error?: string;
    }> = [];

    for (const s of slugs) {
      try {
        const m = await gammaMarketBySlug(s.slug);
        const ids = normalizeStringOrArray(m?.clobTokenIds ?? m?.clobTokenIDs ?? m?.clob_token_ids);
        const yesId = ids?.[0] ? String(ids[0]) : null;

        const outcomePrices = toNumArray(m?.outcomePrices);
        const winner = inferredWinnerFromOutcomePrices(outcomePrices, m?.closed);

        let yesPoints: Array<{ t: number; p: number }> = [];
        if (yesId) {
          const h = await yesPricesHistory(yesId, s.start, s.end, fidelity);
          const hist = Array.isArray(h?.history) ? h.history : [];
          yesPoints = hist
            .map((x: any) => ({ t: Number(x.t), p: Number(x.p) }))
            .filter((x: any) => Number.isFinite(x.t) && Number.isFinite(x.p));
        }

        perSlug.push({ slug: s.slug, startTsSec: s.start, yesTokenId: yesId, winner, yesPoints });
      } catch (e: any) {
        perSlug.push({
          slug: s.slug,
          startTsSec: s.start,
          yesTokenId: null,
          winner: null,
          yesPoints: [],
          error: e?.message ?? "Failed"
        });
      }
    }

    const rows: any[] = [];
    for (let i = window; i < perSlug.length; i++) {
      const remaining = perSlug.length - i;
      if (remaining > count) continue;

      const cur = perSlug[i];

      const historyPoints: Array<{ t: number; p: number }> = [];
      for (let k = i - window; k < i; k++) historyPoints.push(...(perSlug[k]?.yesPoints ?? []));

      const candles = pointsToCandles(historyPoints);

      let predicted: Signal = "NEUTRAL";
      let votes = { up: 0, down: 0, neutral: 0, confidence: 0 };

      if (candles.length >= 30) {
        const out = computeIndicators(candles, { minVotes, minConfidence, rsiUp, rsiDown, emaFast, emaSlow });
        predicted = out.prediction.verdict;
        votes = {
          up: out.prediction.up ?? 0,
          down: out.prediction.down ?? 0,
          neutral: out.prediction.neutral ?? 0,
          confidence: out.prediction.confidence ?? 0
        };
      }

      const predictedSide = predicted === "UP" ? "YES" : predicted === "DOWN" ? "NO" : null;
      const actualSide = cur.winner;
      const correct = predictedSide && actualSide ? predictedSide === actualSide : null;

      rows.push({
        slug: cur.slug,
        startTsSec: cur.startTsSec,
        predicted,
        predictedSide,
        actualSide,
        correct,
        votes,
        dataPointsUsed: candles.length,
        marketError: cur.error ?? null
      });
    }

    const resolvedRows = rows.filter((r) => r.actualSide === "YES" || r.actualSide === "NO");
    const scoredRows = resolvedRows.filter((r) => r.correct === true || r.correct === false);

    const predictedRows = resolvedRows.filter((r) => r.predictedSide === "YES" || r.predictedSide === "NO");
    const predictedScored = predictedRows.filter((r) => r.correct === true || r.correct === false);

    const correctCount = scoredRows.filter((r) => r.correct === true).length;
    const accuracy = scoredRows.length ? correctCount / scoredRows.length : null;

    const correctPredCount = predictedScored.filter((r) => r.correct === true).length;
    const accuracyWhenPredicted = predictedScored.length ? correctPredCount / predictedScored.length : null;

    return NextResponse.json(
      {
        marketBase: base,
        anchorStartTsSec,
        count,
        window,
        fidelity,
        tuning: { minVotes, minConfidence, rsiUp, rsiDown, emaFast, emaSlow },
        totals: {
          returned: rows.length,
          resolved: resolvedRows.length,
          scored: scoredRows.length,
          correct: correctCount,
          accuracy,

          // new: how often we actually make a call
          predicted: predictedRows.length,
          predictedScored: predictedScored.length,
          accuracyWhenPredicted
        },
        rows
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
