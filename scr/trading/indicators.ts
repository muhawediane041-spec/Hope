import { Kline } from '../binance/client';

export interface EMAResult { values: number[] }
export interface RSIResult { values: number[] }
export interface MACDResult { MACD: number[]; signal: number[]; histogram: number[] }
export interface BollingerResult { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] }
export interface ATRResult { values: number[] }
export interface ADXResult { adx: number[]; pdi: number[]; mdi: number[] }
export interface SupertrendResult { trend: number[]; direction: number[] }
export interface IchimokuResult {
  tenkan: number[]; kijun: number[]; senkouA: number[];
  senkouB: number[]; chikou: number[];
}
export interface OBVResult { values: number[] }

function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period - 1; i < data.length; i++) {
    if (i === period - 1) {
      result.push(prev);
    } else {
      prev = data[i] * k + prev * (1 - k);
      result.push(prev);
    }
  }
  return result;
}

function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function highest(data: number[], period: number): number[] {
  return data.map((_, i) => {
    if (i < period - 1) return NaN;
    return Math.max(...data.slice(i - period + 1, i + 1));
  }).filter(v => !isNaN(v));
}

function lowest(data: number[], period: number): number[] {
  return data.map((_, i) => {
    if (i < period - 1) return NaN;
    return Math.min(...data.slice(i - period + 1, i + 1));
  }).filter(v => !isNaN(v));
}

export function calcEMA(closes: number[], period: number): EMAResult {
  return { values: ema(closes, period) };
}

export function calcRSI(closes: number[], period = 14): RSIResult {
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  if (gains.length < period) return { values: [] };

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const values: number[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  values.push(100 - 100 / (1 + rs));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    values.push(100 - 100 / (1 + rs2));
  }
  return { values };
}

export function calcMACD(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MACDResult {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const offset = slowPeriod - fastPeriod;
  const macdLine = fastEma.slice(offset).map((v, i) => v - slowEma[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const histOffset = signalPeriod - 1;
  const histogram = macdLine.slice(histOffset).map((v, i) => v - signalLine[i]);
  return { MACD: macdLine, signal: signalLine, histogram };
}

export function calcBollinger(closes: number[], period = 20, stdDevMult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
  for (let i = 0; i < middle.length; i++) {
    const slice = closes.slice(i + closes.length - middle.length - period + 1 + i, i + closes.length - middle.length + i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
    const stdDev = Math.sqrt(variance);
    upper.push(middle[i] + stdDevMult * stdDev);
    lower.push(middle[i] - stdDevMult * stdDev);
    bandwidth.push((2 * stdDevMult * stdDev) / middle[i]);
  }
  return { upper, middle, lower, bandwidth };
}

export function calcATR(klines: Kline[], period = 14): ATRResult {
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevClose = klines[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return { values: [] };
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const values: number[] = [atr];
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    values.push(atr);
  }
  return { values };
}

export function calcADX(klines: Kline[], period = 14): ADXResult {
  const pDM: number[] = [];
  const nDM: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < klines.length; i++) {
    const upMove = klines[i].high - klines[i - 1].high;
    const downMove = klines[i - 1].low - klines[i].low;
    pDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    nDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  if (trs.length < period * 2) return { adx: [], pdi: [], mdi: [] };

  function smooth(arr: number[], p: number): number[] {
    let v = arr.slice(0, p).reduce((a, b) => a + b, 0);
    const res = [v];
    for (let i = p; i < arr.length; i++) {
      v = v - v / p + arr[i];
      res.push(v);
    }
    return res;
  }

  const smoothTR = smooth(trs, period);
  const smoothPDM = smooth(pDM, period);
  const smoothNDM = smooth(nDM, period);

  const pdi = smoothPDM.map((v, i) => (v / smoothTR[i]) * 100);
  const mdi = smoothNDM.map((v, i) => (v / smoothTR[i]) * 100);
  const dx = pdi.map((v, i) => (Math.abs(v - mdi[i]) / (v + mdi[i])) * 100);

  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const adx = [adxVal];
  for (let i = period; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
    adx.push(adxVal);
  }

  const off = pdi.length - adx.length;
  return { adx, pdi: pdi.slice(off), mdi: mdi.slice(off) };
}

export function calcVWAP(klines: Kline[]): number[] {
  const result: number[] = [];
  let cumVolume = 0;
  let cumTPV = 0;
  for (const k of klines) {
    const tp = (k.high + k.low + k.close) / 3;
    cumTPV += tp * k.volume;
    cumVolume += k.volume;
    result.push(cumVolume > 0 ? cumTPV / cumVolume : tp);
  }
  return result;
}

export function calcSupertrend(klines: Kline[], period = 10, multiplier = 3): SupertrendResult {
  const atr = calcATR(klines, period).values;
  const offset = klines.length - atr.length - 1;
  const trend: number[] = [];
  const direction: number[] = [];
  let prevUpper = 0, prevLower = 0, prevDir = 1;

  for (let i = 0; i < atr.length; i++) {
    const idx = offset + 1 + i;
    const hl2 = (klines[idx].high + klines[idx].low) / 2;
    const upper = hl2 + multiplier * atr[i];
    const lower = hl2 - multiplier * atr[i];

    const finalUpper = (upper < prevUpper || klines[idx - 1]?.close > prevUpper) ? upper : prevUpper;
    const finalLower = (lower > prevLower || klines[idx - 1]?.close < prevLower) ? lower : prevLower;

    let dir: number;
    const close = klines[idx].close;
    if (prevDir === 1) {
      dir = close < finalLower ? -1 : 1;
    } else {
      dir = close > finalUpper ? 1 : -1;
    }

    trend.push(dir === 1 ? finalLower : finalUpper);
    direction.push(dir);
    prevUpper = finalUpper;
    prevLower = finalLower;
    prevDir = dir;
  }

  return { trend, direction };
}

export function calcIchimoku(klines: Kline[]): IchimokuResult {
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const closes = klines.map(k => k.close);

  const tenkan: number[] = [];
  const kijun: number[] = [];
  for (let i = 8; i < klines.length; i++) {
    tenkan.push((Math.max(...highs.slice(i - 8, i + 1)) + Math.min(...lows.slice(i - 8, i + 1))) / 2);
  }
  for (let i = 25; i < klines.length; i++) {
    kijun.push((Math.max(...highs.slice(i - 25, i + 1)) + Math.min(...lows.slice(i - 25, i + 1))) / 2);
  }

  const senkouA: number[] = tenkan.slice(tenkan.length - kijun.length).map((v, i) => (v + kijun[i]) / 2);

  const senkouB: number[] = [];
  for (let i = 51; i < klines.length; i++) {
    senkouB.push((Math.max(...highs.slice(i - 51, i + 1)) + Math.min(...lows.slice(i - 51, i + 1))) / 2);
  }

  const chikouOffset = 26;
  const chikou = closes.slice(chikouOffset);

  return { tenkan, kijun, senkouA, senkouB, chikou };
}

export function calcOBV(klines: Kline[]): OBVResult {
  const values: number[] = [0];
  for (let i = 1; i < klines.length; i++) {
    const prev = values[values.length - 1];
    if (klines[i].close > klines[i - 1].close) {
      values.push(prev + klines[i].volume);
    } else if (klines[i].close < klines[i - 1].close) {
      values.push(prev - klines[i].volume);
    } else {
      values.push(prev);
    }
  }
  return { values };
}

export function detectOrderBlocks(klines: Kline[]): { bullish: number[]; bearish: number[] } {
  const bullish: number[] = [];
  const bearish: number[] = [];
  for (let i = 2; i < klines.length - 1; i++) {
    const curr = klines[i];
    const next = klines[i + 1];
    if (curr.close < curr.open && next.close > next.open && next.high > curr.high) {
      bullish.push(curr.close);
    }
    if (curr.close > curr.open && next.close < next.open && next.low < curr.low) {
      bearish.push(curr.close);
    }
  }
  return { bullish, bearish };
}

export function detectFVG(klines: Kline[]): { bullishFVG: number[]; bearishFVG: number[] } {
  const bullishFVG: number[] = [];
  const bearishFVG: number[] = [];
  for (let i = 2; i < klines.length; i++) {
    const gap1High = klines[i - 2].high;
    const gap3Low = klines[i].low;
    if (gap3Low > gap1High) {
      bullishFVG.push((gap1High + gap3Low) / 2);
    }
    const gap1Low = klines[i - 2].low;
    const gap3High = klines[i].high;
    if (gap3High < gap1Low) {
      bearishFVG.push((gap1Low + gap3High) / 2);
    }
  }
  return { bullishFVG, bearishFVG };
}

export function detectLiquiditySweep(klines: Kline[], lookback = 20): { type: 'bullish' | 'bearish' | 'none'; level: number } {
  if (klines.length < lookback + 2) return { type: 'none', level: 0 };
  const recent = klines.slice(-lookback - 2);
  const prev = recent.slice(0, -2);
  const last = recent[recent.length - 1];
  const prevLast = recent[recent.length - 2];

  const swingHigh = Math.max(...prev.map(k => k.high));
  const swingLow = Math.min(...prev.map(k => k.low));

  if (prevLast.high > swingHigh && last.close < swingHigh) {
    return { type: 'bearish', level: swingHigh };
  }
  if (prevLast.low < swingLow && last.close > swingLow) {
    return { type: 'bullish', level: swingLow };
  }
  return { type: 'none', level: 0 };
}

export function detectSupportResistance(klines: Kline[], lookback = 50): { supports: number[]; resistances: number[] } {
  const supports: number[] = [];
  const resistances: number[] = [];
  const data = klines.slice(-lookback);

  for (let i = 2; i < data.length - 2; i++) {
    const isPivotLow = data[i].low < data[i - 1].low && data[i].low < data[i - 2].low &&
      data[i].low < data[i + 1].low && data[i].low < data[i + 2].low;
    const isPivotHigh = data[i].high > data[i - 1].high && data[i].high > data[i - 2].high &&
      data[i].high > data[i + 1].high && data[i].high > data[i + 2].high;

    if (isPivotLow) supports.push(data[i].low);
    if (isPivotHigh) resistances.push(data[i].high);
  }

  return { supports: supports.slice(-5), resistances: resistances.slice(-5) };
}

export function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}
