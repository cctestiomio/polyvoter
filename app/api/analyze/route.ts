import { NextResponse } from "next/server";
import { computeIndicators } from "@/lib/analyze";

// Force dynamic to prevent static caching issues on Vercel
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body || !Array.isArray(body.candles)) {
      return NextResponse.json(
        { error: "Invalid request body. Expected 'candles' array." },
        { status: 400 }
      );
    }

    const result = computeIndicators(body.candles);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
