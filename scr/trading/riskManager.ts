import { User, db } from '../db';
import { logger } from '../logger';

export interface PositionSize {
  quantity: number;
  riskAmount: number;
  positionValue: number;
  leverage: number;
}

export function calcPositionSize(
  accountBalance: number,
  riskPct: number,
  entryPrice: number,
  stopLoss: number,
  leverage: number
): PositionSize {
  const riskAmount = accountBalance * (riskPct / 100);
  const priceDiff = Math.abs(entryPrice - stopLoss);
  if (priceDiff === 0) throw new Error('Entry and stop loss cannot be the same price');
  const quantity = riskAmount / priceDiff;
  const positionValue = quantity * entryPrice;
  const requiredMargin = positionValue / leverage;

  const maxMargin = accountBalance * 0.9;
  let finalQty = quantity;
  if (requiredMargin > maxMargin) {
    finalQty = (maxMargin * leverage) / entryPrice;
  }

  return {
    quantity: finalQty,
    riskAmount,
    positionValue: finalQty * entryPrice,
    leverage
  };
}

export async function canOpenTrade(user: User, accountBalance: number): Promise<{ allowed: boolean; reason?: string }> {
  const openTrades = db.getOpenTrades(user.telegram_id);
  if (openTrades.length >= user.max_open_trades) {
    return { allowed: false, reason: `Max open trades (${user.max_open_trades}) reached` };
  }

  const todayLoss = db.getTodayLoss(user.id);
  const todayLossPct = (Math.abs(todayLoss) / accountBalance) * 100;
  if (todayLossPct >= user.daily_loss_limit) {
    return { allowed: false, reason: `Daily loss limit (${user.daily_loss_limit}%) reached. Today's loss: ${todayLossPct.toFixed(2)}%` };
  }

  return { allowed: true };
}

export function calcTrailingStop(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  currentPrice: number,
  originalSL: number,
  atr: number,
  trailMultiplier = 1.5
): number {
  const isLong = direction === 'LONG';
  const trailDistance = atr * trailMultiplier;

  if (isLong) {
    const minProfit = entryPrice * 1.005;
    if (currentPrice < minProfit) return originalSL;
    const trailedSL = currentPrice - trailDistance;
    return Math.max(originalSL, trailedSL);
  } else {
    const minProfit = entryPrice * 0.995;
    if (currentPrice > minProfit) return originalSL;
    const trailedSL = currentPrice + trailDistance;
    return Math.min(originalSL, trailedSL);
  }
}

export function shouldCloseTrade(
  direction: 'LONG' | 'SHORT',
  currentPrice: number,
  stopLoss: number,
  takeProfit: number,
  reversalScore: number
): { close: boolean; reason: string } {
  const isLong = direction === 'LONG';

  if (isLong && currentPrice <= stopLoss) {
    return { close: true, reason: 'Stop loss hit' };
  }
  if (!isLong && currentPrice >= stopLoss) {
    return { close: true, reason: 'Stop loss hit' };
  }
  if (isLong && currentPrice >= takeProfit) {
    return { close: true, reason: 'Take profit hit' };
  }
  if (!isLong && currentPrice <= takeProfit) {
    return { close: true, reason: 'Take profit hit' };
  }
  if (reversalScore > 75) {
    return { close: true, reason: 'High reversal probability' };
  }
  return { close: false, reason: '' };
}

export function calcReversalScore(
  direction: 'LONG' | 'SHORT',
  currentPrice: number,
  entryPrice: number,
  rsi: number,
  macdHistogram: number,
  atr: number
): number {
  let score = 0;
  const isLong = direction === 'LONG';
  const pnlPct = isLong
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  if (isLong) {
    if (rsi > 75) score += 30;
    else if (rsi > 70) score += 15;
    if (macdHistogram < 0) score += 25;
    if (pnlPct < -1) score += 20;
  } else {
    if (rsi < 25) score += 30;
    else if (rsi < 30) score += 15;
    if (macdHistogram > 0) score += 25;
    if (pnlPct < -1) score += 20;
  }

  return Math.min(100, score);
}

export function calcPnL(direction: 'LONG' | 'SHORT', entryPrice: number, currentPrice: number, quantity: number): { pnl: number; pnlPct: number } {
  const isLong = direction === 'LONG';
  const pnl = isLong
    ? (currentPrice - entryPrice) * quantity
    : (entryPrice - currentPrice) * quantity;
  const pnlPct = isLong
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;
  return { pnl, pnlPct };
}
