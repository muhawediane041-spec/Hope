import { Telegraf, Context, Markup } from 'telegraf';
import { BinanceClient } from '../../binance/client';
import { encrypt, decrypt, maskKey } from '../../crypto/encryption';
import { db, User } from '../../db';
import { analyseSymbol } from '../../trading/analysis';
import { generateSignal, formatSignalMessage } from '../../trading/signals';
import { MarketScanner } from '../../trading/scanner';
import { logger } from '../../logger';

const pendingApiInput: Map<string, { step: 'apiKey' | 'apiSecret'; apiKey?: string }> = new Map();

function priceStr(n: number): string {
  return n < 1 ? n.toFixed(6) : n < 100 ? n.toFixed(4) : n.toFixed(2);
}

export function registerUserCommands(bot: Telegraf, scanner: MarketScanner): void {

  bot.command('start', async (ctx) => {
    const user = (ctx as any).dbUser as User;
    const adminBadge = user.role === 'admin' ? ' 👑 Admin' : '';
    await ctx.reply(
      `🤖 *Binance Futures AI Trading Bot*${adminBadge}\n\n` +
      `Welcome, ${ctx.from?.first_name ?? 'trader'}!\n\n` +
      `*Commands:*\n` +
      `/connect — Connect Binance API keys\n` +
      `/disconnect — Remove API keys\n` +
      `/account — View account balance\n` +
      `/trades — View open trades\n` +
      `/history — Trade history\n` +
      `/signals — Latest signals\n` +
      `/scan — Top market opportunities\n` +
      `/analyse <PAIR> — Deep analysis\n` +
      `/settings — View/change settings\n` +
      `/autotrade — Toggle auto-trading\n` +
      `/leverage <N> — Set leverage\n` +
      `/risk <N> — Set risk % per trade\n` +
      `/status — Bot status\n` +
      `/help — Help\n\n` +
      `_Your API keys are AES-256 encrypted and never exposed in logs._`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📖 *Help*\n\n` +
      `*Setup:*\n` +
      `/connect — Add Binance API keys (Futures read + trade permission)\n` +
      `/disconnect — Remove your keys\n\n` +
      `*Trading:*\n` +
      `/autotrade — Enable/disable auto-trading\n` +
      `/leverage <1-125> — Set leverage (default 10)\n` +
      `/risk <0.1-5> — Risk per trade % (default 1%)\n` +
      `/maxTrades <1-10> — Max concurrent trades\n` +
      `/dailyLimit <1-20> — Daily loss limit %\n` +
      `/threshold <50-99> — Confidence threshold %\n\n` +
      `*Monitoring:*\n` +
      `/account — Balance & positions\n` +
      `/trades — Open trades\n` +
      `/history — Recent closed trades\n` +
      `/signals — Recent signals\n` +
      `/scan — Top ranked pairs\n` +
      `/analyse BTCUSDT — Analyse specific pair`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('connect', async (ctx) => {
    const telegramId = String(ctx.from!.id);
    pendingApiInput.set(telegramId, { step: 'apiKey' });
    await ctx.reply(
      `🔑 *Connect Binance API Keys*\n\n` +
      `Your keys will be AES-256 encrypted before storage.\n\n` +
      `*Step 1/2:* Send your Binance API Key\n\n` +
      `_Make sure your key has Futures READ + TRADE permission._\n` +
      `_IP restriction recommended for security._`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('disconnect', async (ctx) => {
    const telegramId = String(ctx.from!.id);
    db.clearUserApiKeys(telegramId);
    await ctx.reply('✅ API keys removed successfully. Auto-trading disabled.');
    db.updateUserSettings(telegramId, { auto_trade: 0 });
  });

  bot.command('account', async (ctx) => {
    const user = (ctx as any).dbUser as User;
    if (!user.api_key_enc || !user.api_secret_enc) {
      return ctx.reply('⚠️ No API keys. Use /connect first.');
    }
    try {
      const apiKey = decrypt(user.api_key_enc);
      const apiSecret = decrypt(user.api_secret_enc);
      const client = new BinanceClient(apiKey, apiSecret, user.testnet === 1);
      const account = await client.getAccountInfo();
      const positions = await client.getOpenPositions();

      let posText = '';
      if (positions.length) {
        posText = '\n\n*Open Positions:*\n';
        for (const p of positions) {
          const side = p.positionAmt > 0 ? '🟢 LONG' : '🔴 SHORT';
          const pnlSign = p.unrealizedProfit >= 0 ? '+' : '';
          posText += `${p.symbol} ${side} — PnL: \`${pnlSign}$${p.unrealizedProfit.toFixed(2)}\`\n`;
        }
      }

      await ctx.reply(
        `💼 *Account Overview*\n\n` +
        `💵 Balance: \`$${account.totalWalletBalance.toFixed(2)}\`\n` +
        `🔒 Margin: \`$${account.totalMarginBalance.toFixed(2)}\`\n` +
        `✅ Available: \`$${account.availableBalance.toFixed(2)}\`\n` +
        `📊 Unrealized PnL: \`$${account.totalUnrealizedProfit.toFixed(2)}\`\n` +
        `🌐 Mode: \`${user.testnet ? 'Testnet' : 'Mainnet'}\`` +
        posText,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      await ctx.reply(`❌ Error: ${(e as Error).message}`);
    }
  });

  bot.command('trades', async (ctx) => {
    const user = (ctx as any).dbUser as User;
    const trades = db.getOpenTrades(String(ctx.from!.id));
    if (!trades.length) {
      return ctx.reply('📭 No open trades.');
    }
    let msg = `📊 *Open Trades (${trades.length}):*\n\n`;
    for (const t of trades) {
      const dir = t.direction === 'LONG' ? '🟢 L' : '🔴 S';
      const pnlSign = (t.pnl ?? 0) >= 0 ? '+' : '';
      msg += `\`${t.symbol}\` ${dir} | PnL: \`${pnlSign}$${(t.pnl ?? 0).toFixed(2)}\` (${pnlSign}${(t.pnl_pct ?? 0).toFixed(2)}%)\n`;
      msg += `  SL: \`${priceStr(t.stop_loss!)}\` | TP: \`${priceStr(t.take_profit!)}\`\n\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('history', async (ctx) => {
    const trades = db.getAllTrades(20);
    const userTrades = trades.filter(t => t.telegram_id === String(ctx.from!.id));
    if (!userTrades.length) return ctx.reply('📭 No trade history.');
    let msg = `📜 *Trade History (last ${userTrades.length}):*\n\n`;
    for (const t of userTrades.slice(0, 10)) {
      const dir = t.direction === 'LONG' ? '🟢' : '🔴';
      const pnlSign = (t.pnl ?? 0) >= 0 ? '✅ +' : '❌ ';
      msg += `${dir} \`${t.symbol}\` — ${pnlSign}$${(t.pnl ?? 0).toFixed(2)} | ${t.status}\n`;
      if (t.close_reason) msg += `  _${t.close_reason}_\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('signals', async (ctx) => {
    const signals = db.getRecentSignals(10);
    if (!signals.length) return ctx.reply('📭 No signals yet.');
    let msg = `📡 *Recent Signals:*\n\n`;
    for (const s of signals) {
      const dir = s.direction === 'LONG' ? '🟢' : '🔴';
      msg += `${dir} \`${s.symbol}\` ${s.direction} — conf: \`${s.confidence}%\` | RR: \`${s.risk_reward}:1\`\n`;
      msg += `  ${new Date(s.created_at).toUTCString()}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('scan', async (ctx) => {
    const msg = await ctx.reply('🔍 Getting top opportunities from scanner...');
    const tops = scanner.getTopOpportunities(10);
    if (!tops.length) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No data yet. Scanner is warming up — try again in a minute.');
      return;
    }
    let text = `🏆 *Top Opportunities:*\n\n`;
    for (let i = 0; i < tops.length; i++) {
      const { symbol, analysis } = tops[i];
      const trend = analysis.primaryTrend === 'BULLISH' ? '🟢' : analysis.primaryTrend === 'BEARISH' ? '🔴' : '⚪';
      text += `${i + 1}. ${trend} \`${symbol}\` — ${analysis.primaryTrend} (${analysis.primaryStrength}%) | Liq: ${analysis.liquidityScore.toFixed(0)}\n`;
    }
    text += `\nUse /analyse <PAIR> for deep analysis.`;
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'Markdown' });
  });

  bot.command('analyse', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const symbol = args[0]?.toUpperCase();
    if (!symbol) return ctx.reply('Usage: /analyse BTCUSDT');
    const user = (ctx as any).dbUser as User;

    const msg = await ctx.reply(`🔍 Analysing ${symbol}...`);
    try {
      const analysis = await analyseSymbol(symbol, user.testnet === 1);
      if (!analysis) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ Could not analyse ${symbol}. Check pair name.`);
        return;
      }

      const h1 = analysis.timeframes['1h'];
      const h4 = analysis.timeframes['4h'];
      const d1 = analysis.timeframes['1d'];

      let text = `📊 *${symbol} Analysis*\n\n`;
      text += `💵 Price: \`${priceStr(analysis.currentPrice)}\`\n`;
      text += `🌊 Primary Trend: \`${analysis.primaryTrend}\` (${analysis.primaryStrength}%)\n`;
      text += `💧 Liquidity Score: \`${analysis.liquidityScore.toFixed(0)}/100\`\n\n`;

      if (d1) text += `📅 *D1:* ${d1.trend} | RSI ${d1.rsi.toFixed(0)} | ADX ${d1.adx.toFixed(0)}\n`;
      if (h4) text += `⏰ *4H:* ${h4.trend} | RSI ${h4.rsi.toFixed(0)} | ADX ${h4.adx.toFixed(0)}\n`;
      if (h1) text += `⏱ *1H:* ${h1.trend} | RSI ${h1.rsi.toFixed(0)} | MACD ${h1.macdHistogram > 0 ? '▲' : '▼'}\n`;

      text += `\n🏗 *Market Structure:*\n`;
      const ms = analysis.marketStructure;
      if (ms.supports.length) text += `Support: \`${priceStr(ms.supports[ms.supports.length - 1])}\`\n`;
      if (ms.resistances.length) text += `Resistance: \`${priceStr(ms.resistances[ms.resistances.length - 1])}\`\n`;
      if (ms.liquiditySweep.type !== 'none') text += `Liquidity sweep: ${ms.liquiditySweep.type} at \`${priceStr(ms.liquiditySweep.level)}\`\n`;

      const signal = generateSignal(analysis, user.confidence_threshold);
      if (signal) {
        text += `\n${formatSignalMessage(signal)}`;
      } else {
        text += `\n⚠️ No signal — confidence below threshold (${user.confidence_threshold}%)`;
      }

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ Error: ${(e as Error).message}`);
    }
  });

  bot.command('autotrade', async (ctx) => {
    const user = (ctx as any).dbUser as User;
    const telegramId = String(ctx.from!.id);
    if (!user.api_key_enc) {
      return ctx.reply('⚠️ Connect API keys first with /connect');
    }
    const newVal = user.auto_trade ? 0 : 1;
    db.updateUserSettings(telegramId, { auto_trade: newVal });
    await ctx.reply(
      newVal
        ? `✅ *Auto-trading ENABLED*\n\nThe bot will automatically open trades when signals meet your confidence threshold (${user.confidence_threshold}%).\n\nRisk: ${user.risk_per_trade}% per trade | Leverage: ${user.leverage}x | Max trades: ${user.max_open_trades}`
        : `⛔ *Auto-trading DISABLED*\n\nYou will only receive signal notifications without automatic execution.`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('settings', async (ctx) => {
    const user = (ctx as any).dbUser as User;
    await ctx.reply(
      `⚙️ *Your Settings:*\n\n` +
      `🔑 API Keys: \`${user.api_key_enc ? '✅ Connected' : '❌ Not set'}\`\n` +
      `🤖 Auto-Trade: \`${user.auto_trade ? 'ON' : 'OFF'}\`\n` +
      `⚡ Leverage: \`${user.leverage}x\`\n` +
      `💰 Risk/Trade: \`${user.risk_per_trade}%\`\n` +
      `📊 Max Trades: \`${user.max_open_trades}\`\n` +
      `📉 Daily Limit: \`${user.daily_loss_limit}%\`\n` +
      `🎯 Confidence: \`${user.confidence_threshold}%\`\n` +
      `🌐 Mode: \`${user.testnet ? 'Testnet' : 'Mainnet'}\`\n\n` +
      `Commands:\n` +
      `/leverage <1-125>\n` +
      `/risk <0.1-5>\n` +
      `/maxTrades <1-10>\n` +
      `/dailyLimit <1-20>\n` +
      `/threshold <50-99>`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('leverage', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const val = parseInt(args[0]);
    if (!val || val < 1 || val > 125) return ctx.reply('Usage: /leverage <1-125>');
    db.updateUserSettings(String(ctx.from!.id), { leverage: val });
    await ctx.reply(`✅ Leverage set to ${val}x`);
  });

  bot.command('risk', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const val = parseFloat(args[0]);
    if (!val || val < 0.1 || val > 5) return ctx.reply('Usage: /risk <0.1-5>');
    db.updateUserSettings(String(ctx.from!.id), { risk_per_trade: val });
    await ctx.reply(`✅ Risk per trade set to ${val}%`);
  });

  bot.command('maxTrades', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const val = parseInt(args[0]);
    if (!val || val < 1 || val > 10) return ctx.reply('Usage: /maxTrades <1-10>');
    db.updateUserSettings(String(ctx.from!.id), { max_open_trades: val });
    await ctx.reply(`✅ Max open trades set to ${val}`);
  });

  bot.command('dailyLimit', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const val = parseFloat(args[0]);
    if (!val || val < 1 || val > 20) return ctx.reply('Usage: /dailyLimit <1-20>');
    db.updateUserSettings(String(ctx.from!.id), { daily_loss_limit: val });
    await ctx.reply(`✅ Daily loss limit set to ${val}%`);
  });

  bot.command('threshold', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const val = parseFloat(args[0]);
    if (!val || val < 50 || val > 99) return ctx.reply('Usage: /threshold <50-99>');
    db.updateUserSettings(String(ctx.from!.id), { confidence_threshold: val });
    await ctx.reply(`✅ Confidence threshold set to ${val}%`);
  });

  bot.command('status', async (ctx) => {
    const wsStatus = scanner.getWsStatus();
    const wsConnected = Object.values(wsStatus).filter(s => s === 'OPEN').length;
    const wsTotal = Object.keys(wsStatus).length;
    const openTrades = db.getOpenTrades();

    await ctx.reply(
      `📡 *Bot Status:*\n\n` +
      `🔗 WebSocket: \`${wsConnected}/${wsTotal} connected\`\n` +
      `👁 Watching: \`${scanner.getPairCount()} pairs\`\n` +
      `📊 Open Trades: \`${openTrades.length}\`\n` +
      `🕐 Time: \`${new Date().toUTCString()}\``,
      { parse_mode: 'Markdown' }
    );
  });

  bot.on('text', async (ctx) => {
    const telegramId = String(ctx.from!.id);
    const pending = pendingApiInput.get(telegramId);
    if (!pending) return;

    const text = ctx.message.text.trim();

    if (pending.step === 'apiKey') {
      pendingApiInput.set(telegramId, { step: 'apiSecret', apiKey: text });
      await ctx.reply(
        `✅ API Key received.\n\n*Step 2/2:* Send your Binance API Secret\n\n` +
        `_This message will be deleted after storing encrypted._`,
        { parse_mode: 'Markdown' }
      );
      try { await ctx.deleteMessage(); } catch {}
    } else if (pending.step === 'apiSecret') {
      const apiKey = pending.apiKey!;
      const apiSecret = text;
      pendingApiInput.delete(telegramId);

      try {
        await ctx.reply('🔐 Verifying connection...');
        const client = new BinanceClient(apiKey, apiSecret, false);
        const ok = await client.ping();
        if (!ok) throw new Error('Ping failed');

        const apiKeyEnc = encrypt(apiKey);
        const apiSecretEnc = encrypt(apiSecret);
        db.setUserApiKeys(telegramId, apiKeyEnc, apiSecretEnc);

        try { await ctx.deleteMessage(); } catch {}

        logger.info(`[Auth] User ${telegramId} connected API keys (masked: ${maskKey(apiKey)})`);
        await ctx.reply(
          `✅ *Binance API Connected!*\n\n` +
          `🔑 Key: \`${maskKey(apiKey)}\`\n` +
          `🔐 Encrypted & stored securely\n\n` +
          `Use /autotrade to enable automatic trading.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        await ctx.reply(`❌ Connection failed: ${(e as Error).message}\n\nCheck your API key has Futures permission and try /connect again.`);
      }
    }
  });
}
