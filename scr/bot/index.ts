import { Telegraf } from 'telegraf';
import { registerUser } from './middleware/auth';
import { registerUserCommands } from './commands/user';
import { registerAdminCommands } from './commands/admin';
import { MarketScanner } from '../trading/scanner';
import { logger } from '../logger';

export function createBot(scanner: MarketScanner): Telegraf {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set');

  const bot = new Telegraf(token);

  bot.use(registerUser());

  registerUserCommands(bot, scanner);
  registerAdminCommands(bot, scanner);

  bot.catch((err: any, ctx) => {
    logger.error(`[Bot] Unhandled error for ${ctx.updateType}: ${err?.message || err}`);
    ctx.reply('❌ An internal error occurred. Please try again.').catch(() => {});
  });

  return bot;
}
