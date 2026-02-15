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
  confidence: number; // 0..1
};

export type AnalyzeResponse = {
  symbol: string;
  interval: string;
  lastClose: number;
  lastCandleCloseTime: number;
  indicators: IndicatorRow[];
  prediction: Prediction;
  polymarket?: unknown;
};
