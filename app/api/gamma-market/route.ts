import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseJsonStringArray(x: any): string[] | null {
  if (Array.isArray(x)) return x.map(String);
  if (typeof x === "string") {
    try {
      const j = JSON.parse(x);
      return Array.isArray(j) ? j.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function computeWinnerFromMarket(m: any): "Yes" | "No" | null {
  // 1) Prefer explicit resolution-ish fields if present (Gamma schemas can vary by market type)
  const direct = [
    m?.resolution,
    m?.resolvedOutcome,
    m?.winningOutcome,
    m?.winner,
    m?.result,
    m?.finalOutcome,
  ]
    .map((v) => (v == null ? "" : String(v)))
    .find((s) => s.trim().length > 0);

  if (direct) {
    const v = direct.trim().toLowerCase();
    if (v === "yes") return "Yes";
    if (v === "no") return "No";
  }

  // 2) Fallback: derive from outcomes[] + outcomePrices[] (paired by index)
  const outcomes = parseJsonStringArray(m?.outcomes);
  const pricesRaw = parseJsonStringArray(m?.outcomePrices);
  if (!outcomes || !pricesRaw || outcomes.length !== pricesRaw.length) return null;

  const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
  const noIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "no");
  if (yesIdx < 0 || noIdx < 0) return null;

  const yesPx = Number(pricesRaw[yesIdx]);
  const noPx = Number(pricesRaw[noIdx]);
  if (!Number.isFinite(yesPx) || !Number.isFinite(noPx)) return null;

  // If Gamma has a clear winner (often 1/0 when resolved), pick it.
  if (yesPx === noPx) return null;
  return yesPx > noPx ? "Yes" : "No";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = String(searchParams.get("slug") ?? "").trim();
    if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

    const url = `https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`; // Gamma get-by-slug [page:2]
    const r = await fetch(url, {
      cache: "no-store",
      headers: {
        "accept": "application/json",
        "user-agent": "poly-dashboard/1.0",
      },
    });

    const market = await r.json().catch(() => null);
    if (!r.ok) {
      return NextResponse.json(
        { error: "Gamma error", status: r.status, market },
        { status: 502 }
      );
    }

    const winner = computeWinnerFromMarket(market);

    return NextResponse.json({
      ok: true,
      slug,
      closed: Boolean(market?.closed), // Gamma includes `closed` [page:2]
      winner,
      market,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
