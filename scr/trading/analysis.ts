import { BinanceClient, Kline } from '../binance/client';
import {
  calcEMA, calcRSI, calcMACD, calcBollinger, calcATR, calcADX,
  calcVWAP, calcSupertrend, calcIchimoku, calcOBV,
  detectOrderBlocks, detectFVG, detectLiquiditySweep,
  detectSupportResistance, last
} from './indicators';
import { logger } from '../logger';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number;
  ema20: number;
  ema50: number;
  ema100: number;
  ema200: number;
  rsi: number;
  macdHistogram: number;
  adx: number;
  supertrend: 'BULLISH' | 'BEARISH';
  supertrendValue: number;
  atr: number;
  vwap: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbBandwidth: number;
  obvTrend: 'UP' | 'DOWN' | 'FLAT';
  currentClose: number;
}

export interface MarketStructure {
  orderBlocks: { bullish: number[]; bearish: number[] };
  fvg: { bullishFVG: number[]; bearishFVG: number[] };
  liquiditySweep: { type: 'bullish' | 'bearish' | 'none'; level: number };
  supports: number[];
  resistances: number[];
}

export interface FullAnalysis {
  symbol: string;
  analysedAt: Date;
  timeframes: Partial<Record<Timeframe, TimeframeAnalysis>>;
  marketStructure: MarketStructure;
  primaryTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  primaryStrength: number;
  entryTimeframe: Timeframe;
  currentPrice: number;
  atr1h: number;
  volume24hRank: number;
  liquidityScore: number;
}

async function fetchAndAnalyse(symbol: string, tf: Timeframe, limit = 200, testnet = false): Promise<TimeframeAnalysis | null> {
  try {
    const klines = await BinanceClient.getKlines(symbol, tf, limit, testnet);
    if (klines.length < 60) return null;

    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume);

    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema100 = calcEMA(closes, 100);
    const ema200 = calcEMA(closes, 200);
    const rsiRes = calcRSI(closes, 14);
    const macdRes = calcMACD(closes);
    const bbRes = calcBollinger(closes);
    const atrRes = calcATR(klines, 14);
    const adxRes = calcADX(klines, 14);
    const vwapRes = calcVWAP(klines);
    const stRes = calcSupertrend(klines, 10, 3);
    const obvRes = calcOBV(klines);

    const e20 = last(ema20.values) ?? 0;
    const e50 = last(ema50.values) ?? 0;
    const e100 = last(ema100.values) ?? 0;
    const e200 = last(ema200.values) ?? 0;
    const rsi = last(rsiRes.values) ?? 50;
    const macdHist = last(macdRes.histogram) ?? 0;
    const adx = last(adxRes.adx) ?? 0;
    const pdi = last(adxRes.pdi) ?? 0;
    const mdi = last(adxRes.mdi) ?? 0;
    const atr = last(atrRes.values) ?? 0;
    const vwap = last(vwapRes) ?? 0;
    const bbUpper = last(bbRes.upper) ?? 0;
    const bbMiddle = last(bbRes.middle) ?? 0;
    const bbLower = last(bbRes.lower) ?? 0;
    const bbBw = last(bbRes.bandwidth) ?? 0;
    const stDir = last(stRes.direction) ?? 1;
    const stVal = last(stRes.trend) ?? 0;
    const currentClose = last(closes);

    const obvValues = obvRes.values;
    const obvRecent = obvValues.slice(-10);
    const obvChange = obvRecent[obvRecent.length - 1] - obvRecent[0];
    const obvTrend = obvChange > 0 ? 'UP' : obvChange < 0 ? 'DOWN' : 'FLAT';

    let bullishPoints = 0, bearishPoints = 0, total = 0;

    if (currentClose > e20) bullishPoints++; else bearishPoints++;
    total++;
    if (currentClose > e50) bullishPoints++; else bearishPoints++;
    total++;
    if (e20 > e50) bullishPoints++; else bearishPoints++;
    total++;
    if (e50 > e100) bullishPoints++; else bearishPoints++;
    total++;
    if (e100 > e200) bullishPoints++; else bearishPoints++;
    total++;
    if (rsi > 50) bullishPoints++; else bearishPoints++;
    total++;
    if (macdHist > 0) bullishPoints++; else bearishPoints++;
    total++;
    if (pdi > mdi) bullishPoints++; else bearishPoints++;
    total++;
    if (stDir === 1) bullishPoints++; else bearishPoints++;
    total++;
    if (currentClose > vwap) bullishPoints++; else bearishPoints++;
    total++;
    if (obvTrend === 'UP') bullishPoints++; else if (obvTrend === 'DOWN') bearishPoints++;
    total++;

    const netBull = bullishPoints / total;
    const netBear = bearishPoints / total;
    const strength = Math.abs(netBull - netBear);

    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    if (netBull > 0.6) trend = 'BULLISH';
    else if (netBear > 0.6) trend = 'BEARISH';
    else trend = 'NEUTRAL';

    return {
      timeframe: tf,
      trend,
      strength: Math.round(strength * 100),
      ema20: e20,
      ema50: e50,
      ema100: e100,
      ema200: e200,
      rsi,
      macdHistogram: macdHist,
      adx,
      supertrend: stDir === 1 ? 'BULLISH' : 'BEARISH',
      supertrendValue: stVal,
      atr,
      vwap,
      bbUpper,
      bbMiddle,
      bbLower,
      bbBandwidth: bbBw,
      obvTrend,
      currentClose
    };
  } catch (e) {
    logger.debug(`[Analysis] Failed ${symbol} ${tf}: ${(e as Error).message}`);
    return null;
  }
}

export async function analyseSymbol(symbol: string, testnet = false): Promise<FullAnalysis | null> {
  try {
    const tfOrder: Timeframe[] = ['1d', '4h', '1h', '15m', '5m', '1m'];

    const [d1, h4, h1, m15] = await Promise.all([
      fetchAndAnalyse(symbol, '1d', 200, testnet),
      fetchAndAnalyse(symbol, '4h', 200, testnet),
      fetchAndAnalyse(symbol, '1h', 200, testnet),
      fetchAndAnalyse(symbol, '15m', 200, testnet)
    ]);

    if (!d1 || !h4 || !h1) return null;

    const [m5, m1] = await Promise.all([
      fetchAndAnalyse(symbol, '5m', 100, testnet),
      fetchAndAnalyse(symbol, '1m', 60, testnet)
    ]);

    const klines1h = await BinanceClient.getKlines(symbol, '1h', 100, testnet);
    const atr1h = last(calcATR(klines1h, 14).values) ?? 0;

    const klines4h = await BinanceClient.getKlines(symbol, '4h', 100, testnet);
    const ms = klines4h.length >= 10 ? {
      orderBlocks: detectOrderBlocks(klines4h),
      fvg: detectFVG(klines4h),
      liquiditySweep: detectLiquiditySweep(klines4h),
      ...detectSupportResistance(klines4h)
    } : { orderBlocks: { bullish: [], bearish: [] }, fvg: { bullishFVG: [], bearishFVG: [] }, liquiditySweep: { type: 'none' as const, level: 0 }, supports: [], resistances: [] };

    const higherTFs = [d1, h4, h1].filter(Boolean) as TimeframeAnalysis[];
    let bullCount = 0, bearCount = 0;
    for (const tf of higherTFs) {
      if (tf.trend === 'BULLISH') bullCount++;
      else if (tf.trend === 'BEARISH') bearCount++;
    }
    const primaryTrend = bullCount > bearCount ? 'BULLISH' : bearCount > bullCount ? 'BEARISH' : 'NEUTRAL';
    const primaryStrength = Math.round((Math.max(bullCount, bearCount) / higherTFs.length) * 100);

    const vol24h = await BinanceClient.getTicker24h(symbol, testnet).catch(() => null);
    const quoteVol = vol24h ? parseFloat(vol24h.quoteVolume ?? 0) : 0;
    const liquidityScore = Math.min(100, Math.log10(quoteVol + 1) * 10);

    const timeframes: Partial<Record<Timeframe, TimeframeAnalysis>> = {};
    if (d1) timeframes['1d'] = d1;
    if (h4) timeframes['4h'] = h4;
    if (h1) timeframes['1h'] = h1;
    if (m15) timeframes['15m'] = m15;
    if (m5) timeframes['5m'] = m5;
    if (m1) timeframes['1m'] = m1;

    return {
      symbol,
      analysedAt: new Date(),
      timeframes,
      marketStructure: {
        orderBlocks: ms.orderBlocks,
        fvg: ms.fvg,
        liquiditySweep: ms.liquiditySweep,
        supports: ms.supports,
        resistances: ms.resistances
      },
      primaryTrend,
      primaryStrength,
      entryTimeframe: m15 ? '15m' : '1h',
      currentPrice: h1.currentClose,
      atr1h,
      volume24hRank: liquidityScore,
      liquidityScore
    };
  } catch (e) {
    logger.error(`[Analysis] analyseSymbol ${symbol} failed: ${(e as Error).message}`);
    return null;
  }
}
