import { NextResponse } from "next/server";
import { z } from "zod";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(3),
  tokenId: z.string().min(10),
  tsSec: z.number().int().positive(), // epoch seconds
  mid: z.number().min(0).max(1),
});

function keyFor(slug: string, tokenId: string) {
  return `pm:mid:${slug}:${tokenId}`; // hash: field=tsSec, value=mid
}

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { slug, tokenId, tsSec, mid } = parsed.data;

    const key = keyFor(slug, tokenId);

    // Store as a hash field per second (<= ~300 fields per 5m slug).
    await kv.hset(key, { [String(tsSec)]: String(mid) });

    // Keep data for 14 days (tweak as you want).
    await kv.expire(key, 60 * 60 * 24 * 14);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

// Optional: debug read
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = String(searchParams.get("slug") ?? "");
  const tokenId = String(searchParams.get("tokenId") ?? "");
  if (!slug || !tokenId) return NextResponse.json({ error: "Missing slug/tokenId" }, { status: 400 });

  const key = keyFor(slug, tokenId);
  const all = await kv.hgetall<Record<string, string>>(key);
  return NextResponse.json({ slug, tokenId, points: all ?? {} });
}
