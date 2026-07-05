import { v4 as uuidv4 } from 'uuid';
import { FullAnalysis, TimeframeAnalysis } from './analysis';
import { db } from '../db';
import { logger } from '../logger';

export interface TradingSignal {
  uuid: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  confidence: number;
  probability: number;
  trendSummary: string;
  volumeConfirmation: string;
  marketStructureSummary: string;
  timeframe: string;
  atr: number;
  expiresAt: Date;
}

function scoreAnalysis(analysis: FullAnalysis, direction: 'LONG' | 'SHORT'): number {
  let score = 0;
  let max = 0;

  const isLong = direction === 'LONG';

  const h1 = analysis.timeframes['1h'];
  const h4 = analysis.timeframes['4h'];
  const d1 = analysis.timeframes['1d'];
  const m15 = analysis.timeframes['15m'];
  const m5 = analysis.timeframes['5m'];

  const higherTrend = analysis.primaryTrend;
  if (higherTrend === (isLong ? 'BULLISH' : 'BEARISH')) score += 20;
  max += 20;

  if (h4) {
    if (h4.trend === (isLong ? 'BULLISH' : 'BEARISH')) score += 15;
    if (h4.adx > 25) score += 10;
    if ((isLong && h4.macdHistogram > 0) || (!isLong && h4.macdHistogram < 0)) score += 8;
    if ((isLong && h4.rsi > 50 && h4.rsi < 70) || (!isLong && h4.rsi < 50 && h4.rsi > 30)) score += 7;
    if (h4.supertrend === (isLong ? 'BULLISH' : 'BEARISH')) score += 8;
    max += 48;
  }

  if (h1) {
    if (h1.trend === (isLong ? 'BULLISH' : 'BEARISH')) score += 10;
    if ((isLong && h1.rsi >= 45 && h1.rsi <= 65) || (!isLong && h1.rsi <= 55 && h1.rsi >= 35)) score += 5;
    if ((isLong && h1.macdHistogram > 0) || (!isLong && h1.macdHistogram < 0)) score += 5;
    if (h1.supertrend === (isLong ? 'BULLISH' : 'BEARISH')) score += 5;
    if (h1.obvTrend === (isLong ? 'UP' : 'DOWN')) score += 5;
    max += 30;
  }

  if (m15) {
    if (m15.trend === (isLong ? 'BULLISH' : 'BEARISH')) score += 8;
    if ((isLong && m15.rsi > 50) || (!isLong && m15.rsi < 50)) score += 4;
    if (m15.adx > 20) score += 3;
    max += 15;
  }

  const ms = analysis.marketStructure;
  const cp = analysis.currentPrice;

  if (isLong) {
    const nearBullishOB = ms.orderBlocks.bullish.some(ob => ob > cp * 0.98 && ob < cp * 1.02);
    if (nearBullishOB) score += 5;

    const nearBullishFVG = ms.fvg.bullishFVG.some(fvg => fvg > cp * 0.98 && fvg < cp);
    if (nearBullishFVG) score += 4;

    if (ms.liquiditySweep.type === 'bullish') score += 6;

    const nearSupport = ms.supports.some(s => s > cp * 0.97 && s < cp * 1.01);
    if (nearSupport) score += 4;
  } else {
    const nearBearishOB = ms.orderBlocks.bearish.some(ob => ob < cp * 1.02 && ob > cp * 0.98);
    if (nearBearishOB) score += 5;

    const nearBearishFVG = ms.fvg.bearishFVG.some(fvg => fvg < cp * 1.02 && fvg > cp);
    if (nearBearishFVG) score += 4;

    if (ms.liquiditySweep.type === 'bearish') score += 6;

    const nearResistance = ms.resistances.some(r => r < cp * 1.03 && r > cp * 0.99);
    if (nearResistance) score += 4;
  }
  max += 19;

  if (analysis.liquidityScore > 60) score += 5;
  max += 5;

  const rawScore = max > 0 ? (score / max) * 100 : 0;
  return Math.min(100, Math.round(rawScore));
}

function buildTrendSummary(analysis: FullAnalysis, direction: 'LONG' | 'SHORT'): string {
  const parts: string[] = [];
  const d1 = analysis.timeframes['1d'];
  const h4 = analysis.timeframes['4h'];
  const h1 = analysis.timeframes['1h'];

  if (d1) parts.push(`D1: ${d1.trend} (ADX ${d1.adx.toFixed(0)})`);
  if (h4) parts.push(`4H: ${h4.trend} (ADX ${h4.adx.toFixed(0)}, RSI ${h4.rsi.toFixed(0)})`);
  if (h1) parts.push(`1H: ${h1.trend} (RSI ${h1.rsi.toFixed(0)})`);

  const ms = analysis.marketStructure;
  if (ms.liquiditySweep.type !== 'none') {
    parts.push(`Liquidity sweep: ${ms.liquiditySweep.type} at ${ms.liquiditySweep.level.toFixed(4)}`);
  }
  if (direction === 'LONG' && ms.orderBlocks.bullish.length) {
    parts.push(`Bullish OB: ${ms.orderBlocks.bullish[ms.orderBlocks.bullish.length - 1].toFixed(4)}`);
  }
  if (direction === 'SHORT' && ms.orderBlocks.bearish.length) {
    parts.push(`Bearish OB: ${ms.orderBlocks.bearish[ms.orderBlocks.bearish.length - 1].toFixed(4)}`);
  }
  return parts.join(' | ');
}

function buildVolumeConfirmation(analysis: FullAnalysis, direction: 'LONG' | 'SHORT'): string {
  const h1 = analysis.timeframes['1h'];
  if (!h1) return 'Volume data unavailable';
  const obvConf = h1.obvTrend === (direction === 'LONG' ? 'UP' : 'DOWN');
  return `OBV ${h1.obvTrend} — ${obvConf ? '✅ confirms' : '⚠️ diverges from'} ${direction}. 24h liquidity score: ${analysis.liquidityScore.toFixed(0)}/100`;
}

function buildMarketStructureSummary(analysis: FullAnalysis, direction: 'LONG' | 'SHORT'): string {
  const ms = analysis.marketStructure;
  const parts: string[] = [];
  if (ms.supports.length) parts.push(`Support: ${ms.supports[ms.supports.length - 1].toFixed(4)}`);
  if (ms.resistances.length) parts.push(`Resistance: ${ms.resistances[ms.resistances.length - 1].toFixed(4)}`);
  if (ms.fvg.bullishFVG.length && direction === 'LONG') parts.push(`Bullish FVG: ${ms.fvg.bullishFVG[ms.fvg.bullishFVG.length - 1].toFixed(4)}`);
  if (ms.fvg.bearishFVG.length && direction === 'SHORT') parts.push(`Bearish FVG: ${ms.fvg.bearishFVG[ms.fvg.bearishFVG.length - 1].toFixed(4)}`);
  return parts.join(' | ') || 'No key levels detected';
}

export function generateSignal(analysis: FullAnalysis, confidenceThreshold = 85): TradingSignal | null {
  if (analysis.liquidityScore < 30) return null;

  const longScore = scoreAnalysis(analysis, 'LONG');
  const shortScore = scoreAnalysis(analysis, 'SHORT');

  const direction: 'LONG' | 'SHORT' = longScore > shortScore ? 'LONG' : 'SHORT';
  const confidence = Math.max(longScore, shortScore);

  if (confidence < confidenceThreshold) return null;
  if (Math.abs(longScore - shortScore) < 10) return null;

  const cp = analysis.currentPrice;
  const atr = analysis.atr1h;
  if (!atr || atr === 0) return null;

  const isLong = direction === 'LONG';
  const stopLossDistance = atr * 1.5;
  const stopLoss = isLong ? cp - stopLossDistance : cp + stopLossDistance;

  const h4 = analysis.timeframes['4h'];
  const trendStrength = h4?.strength ?? 50;
  const tpMultiplier = trendStrength > 70 ? 3.5 : trendStrength > 50 ? 2.5 : 2.0;
  const tpDistance = stopLossDistance * tpMultiplier;
  const takeProfit = isLong ? cp + tpDistance : cp - tpDistance;
  const riskReward = tpDistance / stopLossDistance;

  const ms = analysis.marketStructure;
  let finalTP = takeProfit;
  if (isLong && ms.resistances.length) {
    const nearRes = ms.resistances.filter(r => r > cp && r < takeProfit);
    if (nearRes.length) finalTP = Math.min(...nearRes) * 0.998;
  } else if (!isLong && ms.supports.length) {
    const nearSup = ms.supports.filter(s => s < cp && s > takeProfit);
    if (nearSup.length) finalTP = Math.max(...nearSup) * 1.002;
  }

  if (finalTP === cp) finalTP = takeProfit;
  const finalRR = Math.abs(finalTP - cp) / Math.abs(stopLoss - cp);
  if (finalRR < 1.5) return null;

  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

  const signal: TradingSignal = {
    uuid: uuidv4(),
    symbol: analysis.symbol,
    direction,
    entryPrice: cp,
    stopLoss,
    takeProfit: finalTP,
    riskReward: Math.round(finalRR * 100) / 100,
    confidence,
    probability: Math.round(50 + (confidence - 50) * 0.6),
    trendSummary: buildTrendSummary(analysis, direction),
    volumeConfirmation: buildVolumeConfirmation(analysis, direction),
    marketStructureSummary: buildMarketStructureSummary(analysis, direction),
    timeframe: analysis.entryTimeframe,
    atr,
    expiresAt
  };

  db.insertSignal({
    signal_uuid: signal.uuid,
    symbol: signal.symbol,
    direction: signal.direction,
    entry_price: signal.entryPrice,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    risk_reward: signal.riskReward,
    confidence: signal.confidence,
    probability: signal.probability,
    trend_summary: signal.trendSummary,
    volume_confirmation: signal.volumeConfirmation,
    market_structure: signal.marketStructureSummary,
    timeframe: signal.timeframe,
    status: 'PENDING',
    expires_at: signal.expiresAt.toISOString()
  });

  logger.info(`[Signal] ${signal.symbol} ${signal.direction} | conf=${signal.confidence}% | RR=${signal.riskReward}`);
  db.dbLog('info', 'SIGNAL', `Signal generated: ${signal.symbol} ${signal.direction}`, {
    confidence: signal.confidence, rr: signal.riskReward
  });

  return signal;
}

export function formatSignalMessage(signal: TradingSignal): string {
  const dir = signal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const priceStr = (n: number) => n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(4) : n.toFixed(2);

  return [
    `━━━━━━━━━━━━━━━━━━━━`,
    `📊 *${signal.symbol}* — ${dir}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📍 Entry:       \`${priceStr(signal.entryPrice)}\``,
    `🛑 Stop Loss:   \`${priceStr(signal.stopLoss)}\``,
    `🎯 Take Profit: \`${priceStr(signal.takeProfit)}\``,
    `📐 R/R Ratio:   \`${signal.riskReward}:1\``,
    ``,
    `🧠 Confidence:  \`${signal.confidence}%\``,
    `📈 Est. Prob.:  \`${signal.probability}%\` _(not guaranteed)_`,
    `⏱ Timeframe:   \`${signal.timeframe}\``,
    ``,
    `📉 *Trend:*`,
    `\`${signal.trendSummary}\``,
    ``,
    `📦 *Volume:*`,
    `\`${signal.volumeConfirmation}\``,
    ``,
    `🏗 *Market Structure:*`,
    `\`${signal.marketStructureSummary}\``,
    ``,
    `⏳ Expires: ${signal.expiresAt.toUTCString()}`,
    `🆔 ID: \`${signal.uuid.split('-')[0]}\``
  ].join('\n');
}
