import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  marketBase: z.string().min(3),
  desiredStartTsSec: z.coerce.number().int().positive(),
  lookbackIntervals: z.coerce.number().int().min(1).max(300).default(36) // 36*5m = 3 hours
});

async function fetchJson(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const msg = json?.error || json?.message || `HTTP ${res.status}`;
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      (err as any).status = res.status;
      throw err;
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
    const parsed = Q.safeParse({
      marketBase: searchParams.get("marketBase") ?? undefined,
      desiredStartTsSec: searchParams.get("desiredStartTsSec") ?? undefined,
      lookbackIntervals: searchParams.get("lookbackIntervals") ?? undefined
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { marketBase, desiredStartTsSec, lookbackIntervals } = parsed.data;
    const base = marketBase.trim().replace(/-+$/g, "");

    let lastErr: any = null;

    for (let i = 0; i <= lookbackIntervals; i++) {
      const start = desiredStartTsSec - i * 300;
      const slug = `${base}-${start}`;

      try {
        // Official endpoint [web:289]
        const market = await fetchJson(
          `https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`
        );

        const clobTokenIdsRaw = market?.clobTokenIds ?? market?.clobTokenIDs ?? market?.clob_token_ids;
        const clobTokenIds = normalizeStringOrArray(clobTokenIdsRaw);

        return NextResponse.json(
          {
            desiredSlug: `${base}-${desiredStartTsSec}`,
            resolvedSlug: slug,
            startTsSec: start,
            question: market?.question ?? market?.title ?? slug,
            clobTokenIds
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (e: any) {
        lastErr = e;
        // keep going on 404; stop early on other errors
        if (Number(e?.status) && Number(e.status) !== 404) break;
      }
    }

    return NextResponse.json(
      {
        error:
          "No market found in lookback window. Try switching to Current bucket, or increase lookbackIntervals.",
        details: lastErr?.message ?? null
      },
      { status: 404 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
