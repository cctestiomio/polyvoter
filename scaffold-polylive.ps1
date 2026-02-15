$ErrorActionPreference = "Stop"

# UTF-8 without BOM to avoid JSON parse issues
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-FileNoBom([string]$Path, [string]$Content) {
  $full = Join-Path (Get-Location) $Path
  $dir = Split-Path $full -Parent
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($full, $Content, $Utf8NoBom)
}

Write-FileNoBom "package.json" @'
{
  "name": "polypredict-live",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "ethers": "5.8.0",
    "lightweight-charts": "^4.2.0",
    "next": "14.2.35",
    "next-themes": "^0.3.0",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "technicalindicators": "3.1.0",
    "zod": "3.24.1"
  },
  "devDependencies": {
    "autoprefixer": "10.4.20",
    "postcss": "8.4.49",
    "tailwindcss": "3.4.15",
    "typescript": "5.6.3"
  }
}
'@

Write-FileNoBom "next.config.js" @'
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
module.exports = nextConfig;
'@

Write-FileNoBom "tsconfig.json" @'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["node"],
    "esModuleInterop": true,

    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", ".next/types/**/*.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
'@

Write-FileNoBom "postcss.config.js" @'
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} }
};
'@

Write-FileNoBom "tailwind.config.ts" @'
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: []
} satisfies Config;
'@

Write-FileNoBom "next-env.d.ts" @'
/// <reference types="next" />
/// <reference types="next/image-types/global" />
// NOTE: This file should not be edited
'@

Write-FileNoBom ".gitignore" @'
node_modules
.next
out
.vercel
.DS_Store
.env*
npm-debug.log*
yarn-debug.log*
yarn-error.log*
'@

Write-FileNoBom "README.md" @'
# Polypredict Live (Polymarket-aligned)

## Run
npm i
npm run dev

## Env (optional but recommended for Chainlink websocket)
Create .env.local:

NEXT_PUBLIC_RPC_WSS_URL=wss://YOUR_WSS_RPC
NEXT_PUBLIC_CHAINLINK_BTCUSD_FEED=0x... (Aggregator address)
'@

Write-FileNoBom "app/globals.css" @'
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: light; }
html.dark { color-scheme: dark; }
body { @apply antialiased; }
'@

Write-FileNoBom "app/providers.tsx" @'
"use client";

import { ThemeProvider } from "next-themes";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      {children}
    </ThemeProvider>
  );
}
'@

Write-FileNoBom "app/layout.tsx" @'
import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Polypredict Live",
  description: "Polymarket-aligned live price + TA"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
'@

Write-FileNoBom "lib/types.ts" @'
export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type Signal = "UP" | "DOWN" | "NEUTRAL";

export type IndicatorRow = {
  key: string;
  name: string;
  value: string;
  signal: Signal;
  note?: string;
};

export type Prediction = {
  up: number;
  down: number;
  neutral: number;
  total: number;
  verdict: Signal;
  confidence: number;
};
'@

Write-FileNoBom "lib/analyze.ts" @'
import {
  RSI, MACD, BollingerBands, EMA, SMA, Stochastic, ADX, CCI, OBV, MFI, WilliamsR, ROC
} from "technicalindicators";
import type { Candle, IndicatorRow, Prediction, Signal } from "./types";

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}
function signalBadge(up: boolean, down: boolean): Signal {
  if (up && !down) return "UP";
  if (down && !up) return "DOWN";
  return "NEUTRAL";
}
function last<T>(arr: T[]): T | undefined { return arr.length ? arr[arr.length - 1] : undefined; }
function n(x: unknown): number { const v = Number(x); return Number.isFinite(v) ? v : NaN; }

export function computeIndicators(candles: Candle[]): { indicators: IndicatorRow[]; prediction: Prediction } {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const rows: IndicatorRow[] = [];

  const rsi = last(RSI.calculate({ values: closes, period: 14 })) ?? NaN;
  rows.push({ key:"rsi14", name:"RSI (14)", value: fmt(rsi,1),
    signal: signalBadge(Number.isFinite(rsi) && rsi>=55, Number.isFinite(rsi) && rsi<=45), note: ">=55 up, <=45 down" });

  const macd = last(MACD.calculate({ values: closes, fastPeriod:12, slowPeriod:26, signalPeriod:9, SimpleMAOscillator:false, SimpleMASignal:false }));
  const macdLine = n(macd?.MACD);
  const sigLine = n(macd?.signal);
  rows.push({ key:"macd", name:"MACD (12/26/9)", value: macd?`MACD ${fmt(macdLine,3)} | Sig ${fmt(sigLine,3)}`:"-",
    signal: signalBadge(Number.isFinite(macdLine)&&Number.isFinite(sigLine)&&macdLine>sigLine, Number.isFinite(macdLine)&&Number.isFinite(sigLine)&&macdLine<sigLine), note:"MACD above/below signal" });

  const bb = last(BollingerBands.calculate({ values: closes, period:20, stdDev:2 }));
  const mid = n(bb?.middle);
  const close = closes[closes.length-1] ?? NaN;
  rows.push({ key:"bb", name:"Bollinger (20,2)", value: bb?`Mid ${fmt(mid)} | Close ${fmt(close)}`:"-",
    signal: signalBadge(Number.isFinite(mid)&&Number.isFinite(close)&&close>mid, Number.isFinite(mid)&&Number.isFinite(close)&&close<mid), note:"Close above/below mid" });

  const ema20 = last(EMA.calculate({ values: closes, period:20 })) ?? NaN;
  const ema50 = last(EMA.calculate({ values: closes, period:50 })) ?? NaN;
  rows.push({ key:"ema2050", name:"EMA 20 vs EMA 50", value:`EMA20 ${fmt(ema20)} | EMA50 ${fmt(ema50)}`,
    signal: signalBadge(Number.isFinite(ema20)&&Number.isFinite(ema50)&&ema20>ema50, Number.isFinite(ema20)&&Number.isFinite(ema50)&&ema20<ema50), note:"Trend cross" });

  const sma50 = last(SMA.calculate({ values: closes, period:50 })) ?? NaN;
  const sma200 = last(SMA.calculate({ values: closes, period:200 })) ?? NaN;
  rows.push({ key:"sma50200", name:"SMA 50 vs SMA 200", value:`SMA50 ${fmt(sma50)} | SMA200 ${fmt(sma200)}`,
    signal: signalBadge(Number.isFinite(sma50)&&Number.isFinite(sma200)&&sma50>sma200, Number.isFinite(sma50)&&Number.isFinite(sma200)&&sma50<sma200), note:"Longer trend bias" });

  const st = last(Stochastic.calculate({ high: highs, low: lows, close: closes, period:14, signalPeriod:3 }));
  const k = n(st?.k); const d = n(st?.d);
  rows.push({ key:"stoch", name:"Stochastic (14,3)", value: st?`%K ${fmt(k,1)} | %D ${fmt(d,1)}`:"-",
    signal: signalBadge(Number.isFinite(k)&&Number.isFinite(d)&&k>d, Number.isFinite(k)&&Number.isFinite(d)&&k<d), note:"%K above/below %D" });

  const ax = last(ADX.calculate({ high: highs, low: lows, close: closes, period:14 }));
  const adx = n(ax?.adx); const pdi = n(ax?.pdi); const mdi = n(ax?.mdi);
  const strong = Number.isFinite(adx) && adx >= 20;
  rows.push({ key:"adx", name:"ADX (14)", value: ax?`ADX ${fmt(adx,1)} | +DI ${fmt(pdi,1)} | -DI ${fmt(mdi,1)}`:"-",
    signal: strong ? signalBadge(Number.isFinite(pdi)&&Number.isFinite(mdi)&&pdi>mdi, Number.isFinite(pdi)&&Number.isFinite(mdi)&&mdi>pdi) : "NEUTRAL", note:"Votes only if ADX>=20" });

  const cci = last(CCI.calculate({ high: highs, low: lows, close: closes, period:20 })) ?? NaN;
  rows.push({ key:"cci", name:"CCI (20)", value: fmt(cci,1),
    signal: signalBadge(Number.isFinite(cci)&&cci>100, Number.isFinite(cci)&&cci<-100), note:">100 up, <-100 down" });

  const obvArr = OBV.calculate({ close: closes, volume: volumes });
  const obv1 = obvArr.length>=2 ? obvArr[obvArr.length-1] : NaN;
  const obv0 = obvArr.length>=2 ? obvArr[obvArr.length-2] : NaN;
  rows.push({ key:"obv", name:"OBV (slope)", value: Number.isFinite(obv1)&&Number.isFinite(obv0)?`${fmt(obv0,0)} -> ${fmt(obv1,0)}`:"-",
    signal: signalBadge(Number.isFinite(obv1)&&Number.isFinite(obv0)&&obv1>obv0, Number.isFinite(obv1)&&Number.isFinite(obv0)&&obv1<obv0), note:"Rising/falling OBV" });

  const mfi = last(MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period:14 })) ?? NaN;
  rows.push({ key:"mfi", name:"MFI (14)", value: fmt(mfi,1),
    signal: signalBadge(Number.isFinite(mfi)&&mfi>=55, Number.isFinite(mfi)&&mfi<=45), note:">=55 up, <=45 down" });

  const wr = last(WilliamsR.calculate({ high: highs, low: lows, close: closes, period:14 })) ?? NaN;
  rows.push({ key:"williamsr", name:"Williams %R (14)", value: fmt(wr,1),
    signal: signalBadge(Number.isFinite(wr)&&wr>-50, Number.isFinite(wr)&&wr<-50), note:"Above/below -50" });

  const roc = last(ROC.calculate({ values: closes, period:12 })) ?? NaN;
  rows.push({ key:"roc", name:"ROC (12)", value: Number.isFinite(roc)?`${fmt(roc,2)}%`:"-",
    signal: signalBadge(Number.isFinite(roc)&&roc>0, Number.isFinite(roc)&&roc<0), note:"Positive/negative momentum" });

  let up=0, down=0, neutral=0;
  for (const r of rows) { if (r.signal==="UP") up++; else if (r.signal==="DOWN") down++; else neutral++; }
  const totalVotes = up + down;
  let verdict: Signal = "NEUTRAL";
  if (totalVotes>0) verdict = up>down ? "UP" : down>up ? "DOWN" : "NEUTRAL";
  const confidence = totalVotes===0 ? 0 : Math.abs(up-down)/totalVotes;

  return { indicators: rows, prediction: { up, down, neutral, total: rows.length, verdict, confidence } };
}
'@

Write-FileNoBom "app/api/poly-market/route.ts" @'
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({ slug: z.string().min(3) });

async function fetchJson(url: string, timeoutMs = 10000) {
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.safeParse({ slug: searchParams.get("slug") ?? "" });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const slug = parsed.data.slug.trim();
    const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
    const res = await fetchJson(url);

    const market = Array.isArray(res) ? res[0] : res;
    if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });

    const clobTokenIds: string[] = market?.clobTokenIds ?? market?.clobTokenIDs ?? [];
    return NextResponse.json(
      {
        slug,
        question: market?.question ?? market?.title ?? slug,
        clobTokenIds,
        outcomes: market?.outcomes ?? [],
        outcomePrices: market?.outcomePrices ?? []
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
'@

Write-FileNoBom "app/components/PolyLiveChart.tsx" @'
"use client";

import { useEffect, useMemo, useRef } from "react";
import { createChart, ColorType, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";

type Props = {
  theme: "light" | "dark";
  yesTokenId: string | null;
  onMid?: (mid: number, tsMs: number) => void;
};

function num(x: any): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

export default function PolyLiveChart({ theme, yesTokenId, onMid }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastTRef = useRef<number>(0);

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      line: dark ? "#22c55e" : "#16a34a"
    };
  }, [theme]);

  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      height: 300
    });

    const series = chart.addLineSeries({ color: colors.line, lineWidth: 2 });
    seriesRef.current = series;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: elRef.current?.clientWidth ?? 800 }));
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      seriesRef.current = null;
    };
  }, [colors]);

  useEffect(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    lastTRef.current = 0;
    if (!yesTokenId) return;

    // Polymarket market channel websocket
    const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ assets_ids: [yesTokenId], type: "market" }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);

        if (msg?.event_type === "best_bid_ask" && String(msg.asset_id) === String(yesTokenId)) {
          const bid = num(msg.best_bid);
          const ask = num(msg.best_ask);
          const tsMs = num(msg.timestamp);
          if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(tsMs)) return;

          const mid = (bid + ask) / 2;
          const t = Math.floor(tsMs / 1000) as UTCTimestamp;
          if (t <= (lastTRef.current || 0)) return;
          lastTRef.current = t;

          const point: LineData = { time: t, value: mid };
          seriesRef.current?.update(point);
          onMid?.(mid, tsMs);
        }
      } catch {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [yesTokenId, onMid]);

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
        Polymarket YES live midpoint (WS)
      </div>
      <div className="bg-white dark:bg-zinc-950">
        <div ref={elRef} />
      </div>
    </div>
  );
}
'@

Write-FileNoBom "app/components/ChainlinkLiveChart.tsx" @'
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { createChart, ColorType, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";

type Props = {
  theme: "light" | "dark";
  rpcWssUrl: string | null;
  feedAddress: string | null;
};

const ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
  "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)"
];

export default function ChainlinkLiveChart({ theme, rpcWssUrl, feedAddress }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const providerRef = useRef<ethers.providers.WebSocketProvider | null>(null);
  const [status, setStatus] = useState<string>("Disconnected");
  const lastTRef = useRef<number>(0);

  const colors = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#09090b" : "#ffffff",
      text: dark ? "#e4e4e7" : "#18181b",
      grid: dark ? "rgba(63,63,70,0.35)" : "rgba(228,228,231,0.9)",
      line: dark ? "#3b82f6" : "#2563eb"
    };
  }, [theme]);

  useEffect(() => {
    if (!elRef.current) return;

    const chart = createChart(elRef.current, {
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      height: 260
    });

    const series = chart.addLineSeries({ color: colors.line, lineWidth: 2 });
    seriesRef.current = series;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: elRef.current?.clientWidth ?? 800 }));
    ro.observe(elRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      seriesRef.current = null;
    };
  }, [colors]);

  useEffect(() => {
    // Clean previous
    if (providerRef.current) {
      try { providerRef.current.destroy(); } catch {}
      providerRef.current = null;
    }
    lastTRef.current = 0;

    if (!rpcWssUrl || !feedAddress) {
      setStatus("Missing NEXT_PUBLIC_RPC_WSS_URL or feed address");
      return;
    }

    setStatus("Connecting...");
    const provider = new ethers.providers.WebSocketProvider(rpcWssUrl);
    providerRef.current = provider;

    const c = new ethers.Contract(feedAddress, ABI, provider);

    let decimals = 8;

    async function seed() {
      try {
        decimals = await c.decimals();
        const r = await c.latestRoundData();
        const price = Number(ethers.utils.formatUnits(r.answer, decimals));
        const tsMs = Number(r.updatedAt) * 1000;

        const t = Math.floor(tsMs / 1000) as UTCTimestamp;
        lastTRef.current = t;
        seriesRef.current?.update({ time: t, value: price } as LineData);
        setStatus("Live (listening AnswerUpdated)");
      } catch (e: any) {
        setStatus(e?.message ?? "Seed failed");
      }
    }

    seed();

    const handler = (current: ethers.BigNumber, _roundId: ethers.BigNumber, updatedAt: ethers.BigNumber) => {
      const price = Number(ethers.utils.formatUnits(current, decimals));
      const tsMs = Number(updatedAt) * 1000;
      const t = Math.floor(tsMs / 1000) as UTCTimestamp;
      if (t <= (lastTRef.current || 0)) return;
      lastTRef.current = t;
      seriesRef.current?.update({ time: t, value: price } as LineData);
    };

    c.on("AnswerUpdated", handler);

    provider._websocket?.addEventListener?.("close", () => setStatus("WS closed (reload to reconnect)"));
    provider._websocket?.addEventListener?.("error", () => setStatus("WS error (reload to reconnect)"));

    return () => {
      try { c.off("AnswerUpdated", handler); } catch {}
      try { provider.destroy(); } catch {}
      providerRef.current = null;
      setStatus("Disconnected");
    };
  }, [rpcWssUrl, feedAddress]);

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
      <div className="px-4 py-3 text-sm font-medium bg-white text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center justify-between">
        <span>Chainlink BTC/USD (WS RPC)</span>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>
      </div>
      <div className="bg-white dark:bg-zinc-950">
        <div ref={elRef} />
      </div>
    </div>
  );
}
'@

Write-FileNoBom "app/page.tsx" @'
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import PolyLiveChart from "./components/PolyLiveChart";
import ChainlinkLiveChart from "./components/ChainlinkLiveChart";
import type { Candle, IndicatorRow, Prediction, Signal } from "@/lib/types";
import { computeIndicators } from "@/lib/analyze";

function pillClasses(sig: Signal) {
  if (sig === "UP") return "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300";
  if (sig === "DOWN") return "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300";
  return "bg-zinc-500/15 text-zinc-700 ring-1 ring-zinc-500/30 dark:text-zinc-300";
}

type PolyMarketInfo = {
  slug: string;
  question: string;
  clobTokenIds: string[];
  outcomes: string[];
  outcomePrices: string[];
};

type TAState = {
  indicators: IndicatorRow[];
  prediction: Prediction;
  lastClose: number;
};

function floorToBucketMs(tsMs: number, bucketMs: number) {
  return Math.floor(tsMs / bucketMs) * bucketMs;
}

function buildCandlesFromTicks(ticks: Array<{ tsMs: number; px: number }>, bucketMs: number): Candle[] {
  const map = new Map<number, { open: number; high: number; low: number; close: number }>();

  for (const t of ticks) {
    const b = floorToBucketMs(t.tsMs, bucketMs);
    const cur = map.get(b);
    if (!cur) map.set(b, { open: t.px, high: t.px, low: t.px, close: t.px });
    else {
      cur.high = Math.max(cur.high, t.px);
      cur.low = Math.min(cur.low, t.px);
      cur.close = t.px;
    }
  }

  const keys = Array.from(map.keys()).sort((a, b) => a - b);
  return keys.map((openTime) => {
    const o = map.get(openTime)!;
    return { openTime, open: o.open, high: o.high, low: o.low, close: o.close, volume: 0, closeTime: openTime + bucketMs };
  });
}

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const effectiveTheme = (mounted ? (theme === "dark" ? "dark" : "light") : "light") as "light" | "dark";

  const [slug, setSlug] = useState("");
  const [market, setMarket] = useState<PolyMarketInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [liveMid, setLiveMid] = useState<number | null>(null);
  const ticksRef = useRef<Array<{ tsMs: number; px: number }>>([]);
  const [tickCount, setTickCount] = useState(0);

  const [ta, setTa] = useState<TAState | null>(null);

  const rpcWssUrl = process.env.NEXT_PUBLIC_RPC_WSS_URL ?? null;
  const chainlinkFeed = process.env.NEXT_PUBLIC_CHAINLINK_BTCUSD_FEED ?? null;

  const yesTokenId = useMemo(() => {
    const ids = market?.clobTokenIds ?? [];
    return ids.length ? String(ids[0]) : null; // typical yes/no ordering
  }, [market]);

  useEffect(() => setMounted(true), []);

  // Load Polymarket market -> get YES token id
  useEffect(() => {
    let ignore = false;

    async function run() {
      const s = slug.trim();
      if (!s) { setMarket(null); setErr(null); return; }

      try {
        setErr(null);
        const res = await fetch(`/api/poly-market?slug=${encodeURIComponent(s)}`, { cache: "no-store" });
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(json?.error ? String(json.error) : `HTTP ${res.status}`);
        if (!ignore) setMarket(json);
      } catch (e: any) {
        if (!ignore) { setMarket(null); setErr(e?.message ?? "Failed to load market"); }
      }
    }

    const t = setTimeout(run, 250);
    return () => { ignore = true; clearTimeout(t); };
  }, [slug]);

  // Compute TA from Polymarket midpoint ticks bucketed into 5m candles
  useEffect(() => {
    const bucketMs = 5 * 60_000;
    const candles = buildCandlesFromTicks(ticksRef.current.slice(-15000), bucketMs);

    if (candles.length < 60) { setTa(null); return; }

    const { indicators, prediction } = computeIndicators(candles);
    const last = candles[candles.length - 1];

    setTa({ indicators, prediction, lastClose: last?.close ?? NaN });
  }, [tickCount]);

  const verdict = ta?.prediction.verdict ?? "NEUTRAL";

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Polymarket-aligned live TA</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            TA runs on Polymarket YES live midpoint (WS). Chainlink updates only when its on-chain feed updates.
          </p>
        </div>

        <button
          onClick={() => mounted && setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 ring-1 ring-zinc-200 hover:bg-zinc-50
                     dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-800"
          disabled={!mounted}
        >
          {mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
        </button>
      </header>

      <section className="mt-6 grid gap-3 rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800">
        <label className="grid gap-1">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Polymarket market slug</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:ring-zinc-400
                       dark:bg-zinc-950 dark:ring-zinc-800 dark:focus:ring-zinc-600"
            placeholder="paste slug (the part after /market/...)"
          />
        </label>

        {market ? (
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            <div className="font-medium text-zinc-900 dark:text-zinc-100">{market.question}</div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              YES token id: <span className="font-mono">{yesTokenId ?? "-"}</span>
            </div>
          </div>
        ) : null}

        {err ? (
          <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-700 ring-1 ring-rose-500/20 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm ${pillClasses(verdict)}`}>
              Verdict: {verdict}
            </span>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              Live YES midpoint: <span className="font-mono">{liveMid === null ? "-" : liveMid.toFixed(4)}</span>
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Ticks: <span className="font-mono">{tickCount}</span>
            </span>
          </div>

          {ta ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Up {ta.prediction.up} | Down {ta.prediction.down} | Neutral {ta.prediction.neutral} | Confidence{" "}
              {(ta.prediction.confidence * 100).toFixed(0)}%
            </div>
          ) : (
            <div className="text-sm text-zinc-500">Waiting for more live data...</div>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-6">
        <PolyLiveChart
          theme={effectiveTheme}
          yesTokenId={yesTokenId}
          onMid={(mid, tsMs) => {
            setLiveMid(mid);
            ticksRef.current.push({ tsMs, px: mid });
            if (ticksRef.current.length > 20000) ticksRef.current.splice(0, ticksRef.current.length - 15000);
            setTickCount((x) => x + 1);
          }}
        />

        <ChainlinkLiveChart
          theme={effectiveTheme}
          rpcWssUrl={rpcWssUrl}
          feedAddress={chainlinkFeed}
        />
      </div>

      <section className="mt-6 overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
        <div className="bg-white px-4 py-3 text-sm font-medium text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
          Indicators (from Polymarket WS midpoints)
        </div>

        <div className="overflow-x-auto bg-white dark:bg-zinc-950">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              <tr className="border-b border-zinc-200 dark:border-zinc-900">
                <th className="px-4 py-3">Indicator</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Signal</th>
                <th className="px-4 py-3">Rule</th>
              </tr>
            </thead>

            <tbody>
              {ta?.indicators?.map((r) => (
                <tr key={r.key} className="border-b border-zinc-200/70 dark:border-zinc-900/70">
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-200">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-200">{r.value}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs ${pillClasses(r.signal)}`}>
                      {r.signal}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{r.note ?? "-"}</td>
                </tr>
              ))}

              {!ta ? (
                <tr>
                  <td className="px-4 py-6 text-zinc-500" colSpan={4}>
                    Loading...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
'@

Write-Host "Scaffold complete."
Write-Host ""
Write-Host "NEXT: run:"
Write-Host "  npm i"
Write-Host "  npm run dev"
Write-Host ""
Write-Host "For Chainlink WS (recommended): create .env.local with:"
Write-Host "  NEXT_PUBLIC_RPC_WSS_URL=wss://YOUR_WSS_RPC"
Write-Host "  NEXT_PUBLIC_CHAINLINK_BTCUSD_FEED=0xYOUR_FEED_ADDRESS"
