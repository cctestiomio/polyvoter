import {
  RSI,
  MACD,
  BollingerBands,
  EMA,
  SMA,
  Stochastic,
  ADX,
  CCI,
  OBV,
  MFI,
  WilliamsR,
  ROC
} from "technicalindicators";
import type { Candle, IndicatorRow, Prediction, Signal } from "./types";

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
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

export function computeIndicators(candles: Candle[]): { indicators: IndicatorRow[]; prediction: Prediction } {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const rows: IndicatorRow[] = [];

  // 1) RSI(14)
  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const rsi = last(rsiArr);
  {
    const up = rsi !== undefined && rsi >= 55;
    const down = rsi !== undefined && rsi <= 45;
    rows.push({
      key: "rsi14",
      name: "RSI (14)",
      value: rsi === undefined ? "—" : fmt(rsi, 1),
      signal: signalBadge(up, down),
      note: ">=55 up, <=45 down"
    });
  }

  // 2) MACD(12,26,9)
  const macdArr = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const macd = last(macdArr);
  {
    const up = !!macd && macd.MACD > macd.signal;
    const down = !!macd && macd.MACD < macd.signal;
    rows.push({
      key: "macd",
      name: "MACD (12/26/9)",
      value: macd ? `MACD ${fmt(macd.MACD, 3)} | Sig ${fmt(macd.signal, 3)}` : "—",
      signal: signalBadge(up, down),
      note: "MACD above/below signal"
    });
  }

  // 3) Bollinger Bands(20,2) vs mid
  const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const bb = last(bbArr);
  {
    const close = last(closes);
    const up = !!bb && close !== undefined && close > bb.middle;
    const down = !!bb && close !== undefined && close < bb.middle;
    rows.push({
      key: "bb",
      name: "Bollinger (20,2)",
      value: bb ? `Mid ${fmt(bb.middle)} | Close ${fmt(close ?? NaN)}` : "—",
      signal: signalBadge(up, down),
      note: "Close above/below mid"
    });
  }

  // 4) EMA cross 20 vs 50
  const ema20 = last(EMA.calculate({ values: closes, period: 20 }));
  const ema50 = last(EMA.calculate({ values: closes, period: 50 }));
  {
    const up = ema20 !== undefined && ema50 !== undefined && ema20 > ema50;
    const down = ema20 !== undefined && ema50 !== undefined && ema20 < ema50;
    rows.push({
      key: "ema2050",
      name: "EMA 20 vs EMA 50",
      value: `EMA20 ${fmt(ema20 ?? NaN)} | EMA50 ${fmt(ema50 ?? NaN)}`,
      signal: signalBadge(up, down),
      note: "Trend cross"
    });
  }

  // 5) SMA cross 50 vs 200
  const sma50 = last(SMA.calculate({ values: closes, period: 50 }));
  const sma200 = last(SMA.calculate({ values: closes, period: 200 }));
  {
    const up = sma50 !== undefined && sma200 !== undefined && sma50 > sma200;
    const down = sma50 !== undefined && sma200 !== undefined && sma50 < sma200;
    rows.push({
      key: "sma50200",
      name: "SMA 50 vs SMA 200",
      value: `SMA50 ${fmt(sma50 ?? NaN)} | SMA200 ${fmt(sma200 ?? NaN)}`,
      signal: signalBadge(up, down),
      note: "Longer trend bias"
    });
  }

  // 6) Stochastic(14,3)
  const stochArr = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3
  });
  const st = last(stochArr);
  {
    const up = !!st && st.k > st.d;
    const down = !!st && st.k < st.d;
    rows.push({
      key: "stoch",
      name: "Stochastic (14,3)",
      value: st ? `%K ${fmt(st.k, 1)} | %D ${fmt(st.d, 1)}` : "—",
      signal: signalBadge(up, down),
      note: "%K above/below %D"
    });
  }

  // 7) ADX(14) direction via +DI/-DI; require ADX>20 to vote, else neutral
  const adxArr = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const ax = last(adxArr);
  {
    const strong = !!ax && ax.adx >= 20;
    const up = strong && ax!.pdi > ax!.mdi;
    const down = strong && ax!.mdi > ax!.pdi;
    rows.push({
      key: "adx",
      name: "ADX (14)",
      value: ax ? `ADX ${fmt(ax.adx, 1)} | +DI ${fmt(ax.pdi, 1)} | -DI ${fmt(ax.mdi, 1)}` : "—",
      signal: strong ? signalBadge(up, down) : "NEUTRAL",
      note: "Votes only if ADX>=20"
    });
  }

  // 8) CCI(20)
  const cciArr = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const cci = last(cciArr);
  {
    const up = cci !== undefined && cci > 100;
    const down = cci !== undefined && cci < -100;
    rows.push({
      key: "cci",
      name: "CCI (20)",
      value: cci === undefined ? "—" : fmt(cci, 1),
      signal: signalBadge(up, down),
      note: ">100 up, <-100 down"
    });
  }

  // 9) OBV slope (last vs prev)
  const obvArr = OBV.calculate({ close: closes, volume: volumes });
  const obv1 = obvArr.length >= 2 ? obvArr[obvArr.length - 1] : undefined;
  const obv0 = obvArr.length >= 2 ? obvArr[obvArr.length - 2] : undefined;
  {
    const up = obv1 !== undefined && obv0 !== undefined && obv1 > obv0;
    const down = obv1 !== undefined && obv0 !== undefined && obv1 < obv0;
    rows.push({
      key: "obv",
      name: "OBV (slope)",
      value: obv1 === undefined ? "—" : `${fmt(obv0 ?? NaN, 0)} → ${fmt(obv1, 0)}`,
      signal: signalBadge(up, down),
      note: "Rising/falling OBV"
    });
  }

  // 10) MFI(14)
  const mfiArr = MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 });
  const mfi = last(mfiArr);
  {
    const up = mfi !== undefined && mfi >= 55;
    const down = mfi !== undefined && mfi <= 45;
    rows.push({
      key: "mfi",
      name: "MFI (14)",
      value: mfi === undefined ? "—" : fmt(mfi, 1),
      signal: signalBadge(up, down),
      note: ">=55 up, <=45 down"
    });
  }

  // 11) Williams %R(14)
  const wrArr = WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const wr = last(wrArr);
  {
    // Williams %R ranges [-100..0]; use midpoint bias for direction
    const up = wr !== undefined && wr > -50;
    const down = wr !== undefined && wr < -50;
    rows.push({
      key: "williamsr",
      name: "Williams %R (14)",
      value: wr === undefined ? "—" : fmt(wr, 1),
      signal: signalBadge(up, down),
      note: "Above/below -50"
    });
  }

  // 12) ROC(12)
  const rocArr = ROC.calculate({ values: closes, period: 12 });
  const roc = last(rocArr);
  {
    const up = roc !== undefined && roc > 0;
    const down = roc !== undefined && roc < 0;
    rows.push({
      key: "roc",
      name: "ROC (12)",
      value: roc === undefined ? "—" : `${fmt(roc, 2)}%`,
      signal: signalBadge(up, down),
      note: "Positive/negative momentum"
    });
  }

  // Majority vote (ignore NEUTRAL)
  let up = 0, down = 0, neutral = 0;
  for (const r of rows) {
    if (r.signal === "UP") up++;
    else if (r.signal === "DOWN") down++;
    else neutral++;
  }
  const total = up + down;
  let verdict: Signal = "NEUTRAL";
  if (total > 0) {
    if (up > down) verdict = "UP";
    else if (down > up) verdict = "DOWN";
  }
  const confidence = total === 0 ? 0 : Math.abs(up - down) / total;

  return {
    indicators: rows,
    prediction: { up, down, neutral, total: rows.length, verdict, confidence }
  };
}
