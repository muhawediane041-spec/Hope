import { Telegraf, Context } from 'telegraf';
import { BinanceClient } from '../binance/client';
import { decrypt } from '../crypto/encryption';
import { db, User, Trade } from '../db';
import { TradingSignal } from './signals';
import { calcPositionSize, canOpenTrade, calcTrailingStop, shouldCloseTrade, calcReversalScore, calcPnL } from './riskManager';
import { analyseSymbol } from './analysis';
import { calcATR } from './indicators';
import { logger } from '../logger';

const activeMonitors: Map<number, NodeJS.Timeout> = new Map();

function makeClient(user: User): BinanceClient | null {
  if (!user.api_key_enc || !user.api_secret_enc) return null;
  try {
    const apiKey = decrypt(user.api_key_enc);
    const apiSecret = decrypt(user.api_secret_enc);
    return new BinanceClient(apiKey, apiSecret, user.testnet === 1);
  } catch {
    return null;
  }
}

export async function executeSignal(signal: TradingSignal, user: User, bot: Telegraf): Promise<void> {
  const client = makeClient(user);
  if (!client) {
    logger.warn(`[AutoTrade] ${user.telegram_id} no API keys configured`);
    return;
  }

  try {
    const account = await client.getAccountInfo();
    const check = await canOpenTrade(user, account.availableBalance);
    if (!check.allowed) {
      await bot.telegram.sendMessage(user.telegram_id, `⛔ Cannot open trade: ${check.reason}`);
      return;
    }

    await client.setMarginType(signal.symbol, 'ISOLATED');
    await client.setLeverage(signal.symbol, user.leverage);

    const pos = calcPositionSize(
      account.availableBalance,
      user.risk_per_trade,
      signal.entryPrice,
      signal.stopLoss,
      user.leverage
    );

    const side = signal.direction === 'LONG' ? 'BUY' : 'SELL';
    const order = await client.placeMarketOrder(signal.symbol, side, pos.quantity);

    const fillPrice = parseFloat(order.avgPrice || order.price || String(signal.entryPrice));

    const tradeId = db.insertTrade({
      user_id: user.id,
      telegram_id: user.telegram_id,
      order_id: String(order.orderId),
      client_order_id: order.clientOrderId,
      symbol: signal.symbol,
      direction: signal.direction,
      entry_price: fillPrice,
      current_price: fillPrice,
      quantity: pos.quantity,
      leverage: user.leverage,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      status: 'OPEN',
      pnl: 0,
      pnl_pct: 0,
      risk_reward: signal.riskReward,
      confidence: signal.confidence,
      signal_id: signal.uuid,
      close_reason: null
    });

    try {
      const slSide = signal.direction === 'LONG' ? 'SELL' : 'BUY';
      await client.placeStopOrder(signal.symbol, slSide, pos.quantity, signal.stopLoss, 'STOP_MARKET');
      await client.placeStopOrder(signal.symbol, slSide, pos.quantity, signal.takeProfit, 'TAKE_PROFIT_MARKET');
    } catch (stopErr) {
      logger.warn(`[AutoTrade] Could not place SL/TP orders: ${(stopErr as Error).message}`);
    }

    db.dbLog('info', 'AUTO_TRADE', `Trade opened: ${signal.symbol} ${signal.direction}`, {
      tradeId, qty: pos.quantity, fillPrice, sl: signal.stopLoss, tp: signal.takeProfit
    });

    const priceStr = (n: number) => n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(4) : n.toFixed(2);
    await bot.telegram.sendMessage(user.telegram_id,
      `✅ *Trade Opened*\n\n` +
      `📊 ${signal.symbol} ${signal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}\n` +
      `📍 Entry: \`${priceStr(fillPrice)}\`\n` +
      `🛑 SL: \`${priceStr(signal.stopLoss)}\`\n` +
      `🎯 TP: \`${priceStr(signal.takeProfit)}\`\n` +
      `📦 Qty: \`${pos.quantity.toFixed(4)}\`\n` +
      `⚡ Leverage: \`${user.leverage}x\`\n` +
      `💵 Risk: \`$${pos.riskAmount.toFixed(2)}\`\n` +
      `🆔 Trade ID: \`${tradeId}\``,
      { parse_mode: 'Markdown' }
    );

    startTradeMonitor(tradeId, user, client, bot);
  } catch (e) {
    const msg = (e as Error).message;
    logger.error(`[AutoTrade] executeSignal failed: ${msg}`);
    db.dbLog('error', 'AUTO_TRADE', `Trade execution failed: ${msg}`);
    await bot.telegram.sendMessage(user.telegram_id, `❌ Trade execution failed: ${msg}`).catch(() => {});
  }
}

function startTradeMonitor(tradeId: number, user: User, client: BinanceClient, bot: Telegraf): void {
  if (activeMonitors.has(tradeId)) return;

  const interval = setInterval(async () => {
    try {
      const openTrades = db.getOpenTrades(user.telegram_id);
      const trade = openTrades.find(t => t.id === tradeId);

      if (!trade) {
        clearInterval(interval);
        activeMonitors.delete(tradeId);
        return;
      }

      if (!trade.entry_price || !trade.stop_loss || !trade.take_profit || !trade.quantity) return;

      const positions = await client.getOpenPositions();
      const pos = positions.find(p => p.symbol === trade.symbol);

      if (!pos || Math.abs(pos.positionAmt) < 0.0001) {
        const currentPrice = await BinanceClient.getMarkPrice(trade.symbol, user.testnet === 1);
        const { pnl, pnlPct } = calcPnL(trade.direction, trade.entry_price, currentPrice, trade.quantity);
        db.closeTrade(tradeId, pnl, pnlPct, 'Position closed externally or SL/TP hit', currentPrice);
        if (pnl < 0) db.recordDailyLoss(user.id, Math.abs(pnl));

        const priceStr = (n: number) => n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(4) : n.toFixed(2);
        await bot.telegram.sendMessage(user.telegram_id,
          `📋 *Trade Closed*\n\n` +
          `📊 ${trade.symbol} ${trade.direction}\n` +
          `📍 Entry: \`${priceStr(trade.entry_price)}\`\n` +
          `📍 Close: \`${priceStr(currentPrice)}\`\n` +
          `${pnl >= 0 ? '✅' : '❌'} PnL: \`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\``,
          { parse_mode: 'Markdown' }
        );

        clearInterval(interval);
        activeMonitors.delete(tradeId);
        return;
      }

      const currentPrice = pos.markPrice;
      const { pnl, pnlPct } = calcPnL(trade.direction, trade.entry_price, currentPrice, trade.quantity);
      db.updateTradePrice(tradeId, currentPrice, pnl, pnlPct);

      const klines1h = await BinanceClient.getKlines(trade.symbol, '1h', 30, user.testnet === 1);
      const atr = klines1h.length > 14
        ? (calcATR(klines1h, 14).values.slice(-1)[0] ?? trade.stop_loss)
        : trade.stop_loss;

      const newSL = calcTrailingStop(trade.direction, trade.entry_price, currentPrice, trade.stop_loss, atr);
      if (newSL !== trade.stop_loss) {
        db.updateTradeSL(tradeId, newSL);
        logger.debug(`[Monitor] Trade ${tradeId} SL adjusted to ${newSL.toFixed(4)}`);
      }

      const h1 = await analyseSymbol(trade.symbol, user.testnet === 1);
      const rsi = h1?.timeframes['1h']?.rsi ?? 50;
      const macdHist = h1?.timeframes['1h']?.macdHistogram ?? 0;
      const reversalScore = calcReversalScore(trade.direction, currentPrice, trade.entry_price, rsi, macdHist, atr);

      const closeCheck = shouldCloseTrade(trade.direction, currentPrice, newSL, trade.take_profit, reversalScore);
      if (closeCheck.close) {
        await client.cancelAllOrders(trade.symbol);
        await client.closePosition(trade.symbol, pos.positionAmt);
        db.closeTrade(tradeId, pnl, pnlPct, closeCheck.reason, currentPrice);
        if (pnl < 0) db.recordDailyLoss(user.id, Math.abs(pnl));

        const priceStr = (n: number) => n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(4) : n.toFixed(2);
        await bot.telegram.sendMessage(user.telegram_id,
          `📋 *Trade Closed — ${closeCheck.reason}*\n\n` +
          `📊 ${trade.symbol} ${trade.direction}\n` +
          `📍 Entry: \`${priceStr(trade.entry_price)}\`\n` +
          `📍 Close: \`${priceStr(currentPrice)}\`\n` +
          `${pnl >= 0 ? '✅' : '❌'} PnL: \`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\``,
          { parse_mode: 'Markdown' }
        );

        clearInterval(interval);
        activeMonitors.delete(tradeId);
      }
    } catch (e) {
      logger.error(`[Monitor] Trade ${tradeId} monitor error: ${(e as Error).message}`);
    }
  }, 30_000);

  activeMonitors.set(tradeId, interval);
}

export function restoreTradeMonitors(bot: Telegraf): void {
  const users = db.getAllUsers().filter(u => u.auto_trade === 1 && u.api_key_enc && u.api_secret_enc);
  for (const user of users) {
    const client = makeClient(user);
    if (!client) continue;
    const openTrades = db.getOpenTrades(user.telegram_id);
    for (const trade of openTrades) {
      logger.info(`[AutoTrade] Restoring monitor for trade ${trade.id} (${trade.symbol})`);
      startTradeMonitor(trade.id, user, client, bot);
    }
  }
}
