import { Context, MiddlewareFn } from 'telegraf';
import { db } from '../../db';
import { logger } from '../../logger';

export function registerUser(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (!from) return next();
    const telegramId = String(from.id);

    let user = db.getUser(telegramId);
    if (!user) {
      const isAdmin = telegramId === process.env.ADMIN_CHAT_ID;
      db.upsertUser(telegramId, {
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        role: isAdmin ? 'admin' : 'user'
      });
      user = db.getUser(telegramId)!;
      logger.info(`[Auth] New user registered: ${telegramId} (${from.username || 'no username'}) role=${user.role}`);
    }

    if (!user.is_active) {
      await ctx.reply('⛔ Your account has been deactivated. Contact admin.');
      return;
    }

    (ctx as any).dbUser = user;
    return next();
  };
}

export function requireAdmin(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const user = (ctx as any).dbUser;
    if (!user || user.role !== 'admin') {
      await ctx.reply('⛔ Admin access required.');
      return;
    }
    return next();
  };
}

export function requireApiKeys(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const user = (ctx as any).dbUser;
    if (!user || !user.api_key_enc || !user.api_secret_enc) {
      await ctx.reply(
        '⚠️ No Binance API keys connected.\n\n' +
        'Use /connect to add your API keys first.'
      );
      return;
    }
    return next();
  };
}
