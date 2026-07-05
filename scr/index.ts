import 'dotenv/config';
import { logger } from './logger';
import { getDb } from './db';
import { MarketScanner } from './trading/scanner';
import { createBot } from './bot';
import { executeSignal } from './trading/autoTrader';
import { restoreTradeMonitors } from './trading/autoTrader';
import { db } from './db';
import { formatSignalMessage, TradingSignal } from './trading/signals';

function validateEnv(): void {
  const required = ['BOT_TOKEN', 'ADMIN_CHAT_ID', 'ENCRYPTION_KEY'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

async function main(): Promise<void> {
  logger.info('==============================================');
  logger.info(' Binance Futures AI Trading Bot');
  logger.info('==============================================');

  validateEnv();

  getDb();
  logger.info('[Boot] Database initialized');

  const scanner = new MarketScanner(false, 85);

  const bot = createBot(scanner);

  scanner.on('signal', async (signal: TradingSignal) => {
    logger.info(`[Signal] Broadcasting: ${signal.symbol} ${signal.direction} (${signal.confidence}%)`);

    const users = db.getAllUsers().filter(u => u.is_active);

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(
          user.telegram_id,
          `📡 *New Signal*\n\n${formatSignalMessage(signal)}`,
          { parse_mode: 'Markdown' }
        );

        if (user.auto_trade && user.api_key_enc && signal.confidence >= user.confidence_threshold) {
          await executeSignal(signal, user, bot);
        }
      } catch (e) {
        logger.warn(`[Signal] Could not notify user ${user.telegram_id}: ${(e as Error).message}`);
      }

      await new Promise(r => setTimeout(r, 50));
    }

    const adminId = process.env.ADMIN_CHAT_ID!;
    try {
      await bot.telegram.sendMessage(
        adminId,
        `📡 *[ADMIN] Signal Generated*\n${signal.symbol} ${signal.direction} conf=${signal.confidence}%`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  });

  scanner.on('scanComplete', (results: any[]) => {
    logger.info(`[Scanner] Scan complete. Top: ${results.slice(0, 3).map((r: any) => r.symbol).join(', ')}`);
  });

  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'account', description: 'View account balance' },
    { command: 'connect', description: 'Connect Binance API keys' },
    { command: 'disconnect', description: 'Remove API keys' },
    { command: 'autotrade', description: 'Toggle auto-trading' },
    { command: 'trades', description: 'Open trades' },
    { command: 'history', description: 'Trade history' },
    { command: 'signals', description: 'Recent signals' },
    { command: 'scan', description: 'Top market opportunities' },
    { command: 'analyse', description: 'Analyse a pair (e.g. BTCUSDT)' },
    { command: 'settings', description: 'View/change settings' },
    { command: 'leverage', description: 'Set leverage' },
    { command: 'risk', description: 'Set risk per trade %' },
    { command: 'status', description: 'Bot status' },
    { command: 'help', description: 'Help' }
  ]);

  logger.info('[Boot] Starting bot (long polling)...');
  bot.launch({
    dropPendingUpdates: true
  });

  restoreTradeMonitors(bot);
  logger.info('[Boot] Trade monitors restored');

  await scanner.start();

  const adminId = process.env.ADMIN_CHAT_ID!;
  try {
    await bot.telegram.sendMessage(
      adminId,
      `✅ *Bot Started*\n\n🕐 ${new Date().toUTCString()}\n👁 Scanning ${scanner.getPairCount()} pairs\n\nUse /admin for admin panel.`,
      { parse_mode: 'Markdown' }
    );
  } catch {}

  process.once('SIGINT', () => {
    logger.info('[Boot] SIGINT received, shutting down...');
    scanner.stop();
    bot.stop('SIGINT');
  });

  process.once('SIGTERM', () => {
    logger.info('[Boot] SIGTERM received, shutting down...');
    scanner.stop();
    bot.stop('SIGTERM');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`[Boot] Unhandled rejection: ${reason}`);
    db.dbLog('error', 'SYSTEM', `Unhandled rejection: ${String(reason)}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error(`[Boot] Uncaught exception: ${err.message}`);
    db.dbLog('error', 'SYSTEM', `Uncaught exception: ${err.message}`);
  });

  logger.info('[Boot] Bot is running. Press Ctrl+C to stop.');
}

main().catch(err => {
  logger.error(`[Boot] Fatal error: ${err.message}`);
  process.exit(1);
});
