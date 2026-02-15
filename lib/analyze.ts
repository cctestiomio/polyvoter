import { RSI, MACD, BollingerBands, EMA, SMA, ROC } from "technicalindicators";
import type { Candle, IndicatorRow, Prediction, Signal } from "./types";

type ComputeOptions = {
  // Core knobs
  rsiPeriod?: number;
  rsiUp?: number;     // RSI >= this => UP vote
  rsiDown?: number;   // RSI <= this => DOWN vote

  emaFast?: number;
  emaSlow?: number;

  bbPeriod?: number;
  bbStdDev?: number;

  rocPeriod?: number;

  // Commit filter (raise accuracy by avoiding low-signal regimes)
  minVotes?: number;        // how many non-neutral votes required
  minConfidence?: number;   // abs(up-down)/totalVotes required
};

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}
function signalBadge(up: boolean, down: boolean): Signal {
  if (up && !down) return "UP";
  if (down && !up) return "DOWN";
  return "NEUTRAL";
}
function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}
function n(x: unknown): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

export function computeIndicators(
  candles: Candle[],
  opts: ComputeOptions = {}
): { indicators: IndicatorRow[]; prediction: Prediction } {
  const closes = candles.map((c) => c.close);

  // Defaults tuned for short-horizon/noisy series:
  // - RSI slightly stricter than 50/50
  // - EMA fast/slow for trend bias
  // - Commit filter prevents “always guess”
  const {
    rsiPeriod = 14,
    rsiUp = 54,
    rsiDown = 46,
    emaFast = 9,
    emaSlow = 21,
    bbPeriod = 20,
    bbStdDev = 2,
    rocPeriod = 12,
    minVotes = 3,
    minConfidence = 0.25
  } = opts;

  const rows: IndicatorRow[] = [];

  // RSI (close-only)
  const rsi = last(RSI.calculate({ values: closes, period: rsiPeriod })) ?? NaN;
  rows.push({
    key: `rsi${rsiPeriod}`,
    name: `RSI (${rsiPeriod})`,
    value: fmt(rsi, 1),
    signal: signalBadge(Number.isFinite(rsi) && rsi >= rsiUp, Number.isFinite(rsi) && rsi <= rsiDown),
    note: `>=${rsiUp} up, <=${rsiDown} down`
  });

  // MACD (close-only)
  const macd = last(
    MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    })
  );
  const macdLine = n(macd?.MACD);
  const sigLine = n(macd?.signal);
  rows.push({
    key: "macd",
    name: "MACD (12/26/9)",
    value: macd ? `MACD ${fmt(macdLine, 3)} | Sig ${fmt(sigLine, 3)}` : "-",
    signal: signalBadge(
      Number.isFinite(macdLine) && Number.isFinite(sigLine) && macdLine > sigLine,
      Number.isFinite(macdLine) && Number.isFinite(sigLine) && macdLine < sigLine
    ),
    note: "MACD above/below signal"
  });

  // Bollinger (close-only)
  const bb = last(BollingerBands.calculate({ values: closes, period: bbPeriod, stdDev: bbStdDev }));
  const bbMid = n(bb?.middle);
  const close = closes[closes.length - 1] ?? NaN;
  rows.push({
    key: "bb",
    name: `Bollinger (${bbPeriod},${bbStdDev})`,
    value: bb ? `Mid ${fmt(bbMid)} | Close ${fmt(close)}` : "-",
    signal: signalBadge(
      Number.isFinite(bbMid) && Number.isFinite(close) && close > bbMid,
      Number.isFinite(bbMid) && Number.isFinite(close) && close < bbMid
    ),
    note: "Close above/below mid"
  });

  // EMA fast/slow (trend bias)
  const emaF = last(EMA.calculate({ values: closes, period: emaFast })) ?? NaN;
  const emaS = last(EMA.calculate({ values: closes, period: emaSlow })) ?? NaN;
  rows.push({
    key: `ema${emaFast}_${emaSlow}`,
    name: `EMA ${emaFast} vs EMA ${emaSlow}`,
    value: `EMA${emaFast} ${fmt(emaF)} | EMA${emaSlow} ${fmt(emaS)}`,
    signal: signalBadge(
      Number.isFinite(emaF) && Number.isFinite(emaS) && emaF > emaS,
      Number.isFinite(emaF) && Number.isFinite(emaS) && emaF < emaS
    ),
    note: "Trend cross"
  });

  // Optional longer trend: only meaningful if enough points
  const sma50 = last(SMA.calculate({ values: closes, period: 50 })) ?? NaN;
  const sma200 = last(SMA.calculate({ values: closes, period: 200 })) ?? NaN;
  rows.push({
    key: "sma50200",
    name: "SMA 50 vs SMA 200",
    value: Number.isFinite(sma50) && Number.isFinite(sma200) ? `SMA50 ${fmt(sma50)} | SMA200 ${fmt(sma200)}` : "-",
    signal: signalBadge(
      Number.isFinite(sma50) && Number.isFinite(sma200) && sma50 > sma200,
      Number.isFinite(sma50) && Number.isFinite(sma200) && sma50 < sma200
    ),
    note: "Longer trend bias (requires enough data)"
  });

  // ROC (close-only momentum)
  const roc = last(ROC.calculate({ values: closes, period: rocPeriod })) ?? NaN;
  rows.push({
    key: `roc${rocPeriod}`,
    name: `ROC (${rocPeriod})`,
    value: Number.isFinite(roc) ? `${fmt(roc, 2)}%` : "-",
    signal: signalBadge(Number.isFinite(roc) && roc > 0, Number.isFinite(roc) && roc < 0),
    note: "Positive/negative momentum"
  });

  // Vote tally
  let up = 0,
    down = 0,
    neutral = 0;
  for (const r of rows) {
    if (r.signal === "UP") up++;
    else if (r.signal === "DOWN") down++;
    else neutral++;
  }

  const totalVotes = up + down;
  const rawVerdict: Signal =
    totalVotes > 0 ? (up > down ? "UP" : down > up ? "DOWN" : "NEUTRAL") : "NEUTRAL";
  const confidence = totalVotes === 0 ? 0 : Math.abs(up - down) / totalVotes;

  // Commit filter: if weak/close call => NEUTRAL
  let verdict: Signal = rawVerdict;
  if (totalVotes < minVotes || confidence < minConfidence) verdict = "NEUTRAL";

  rows.push({
    key: "commit",
    name: "Commit filter",
    value: `votes ${totalVotes} | conf ${fmt(confidence, 2)}`,
    signal: verdict,
    note: `Commit only if votes>=${minVotes} and conf>=${minConfidence}`
  });

  return {
    indicators: rows,
    prediction: {
      up,
      down,
      neutral,
      total: rows.length,
      verdict,
      confidence
    }
  };
}
