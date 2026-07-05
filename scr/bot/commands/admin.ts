import { Telegraf, Context } from 'telegraf';
import { db } from '../../db';
import { MarketScanner } from '../../trading/scanner';
import { logger, getRecentLogs } from '../../logger';

export function registerAdminCommands(bot: Telegraf, scanner: MarketScanner): void {

  bot.command('admin', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');
    await ctx.reply(
      `👑 *Admin Panel*\n\n` +
      `/users — All users\n` +
      `/allTrades — All open trades\n` +
      `/tradeHistory — All closed trades\n` +
      `/liveSignals — Recent signals\n` +
      `/logs — Recent system logs\n` +
      `/health — System health\n` +
      `/broadcast <msg> — Broadcast to all users\n` +
      `/banUser <id> — Deactivate user\n` +
      `/unbanUser <id> — Activate user\n` +
      `/wsstatus — WebSocket status`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('users', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const users = db.getAllUsers();
    let msg = `👥 *Users (${users.length}):*\n\n`;
    for (const u of users) {
      const apiStatus = u.api_key_enc ? '🔑' : '❌';
      const autoStatus = u.auto_trade ? '🤖' : '⏸';
      const active = u.is_active ? '✅' : '🚫';
      msg += `${active} \`${u.telegram_id}\` — ${u.username || u.first_name || 'Unknown'}\n`;
      msg += `   ${apiStatus} API | ${autoStatus} Auto | ${u.role === 'admin' ? '👑' : '👤'}\n\n`;
    }
    if (msg.length > 4000) msg = msg.slice(0, 3990) + '\n...';
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('allTrades', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const trades = db.getOpenTrades();
    if (!trades.length) return ctx.reply('📭 No open trades.');
    let msg = `📊 *All Open Trades (${trades.length}):*\n\n`;
    for (const t of trades) {
      const dir = t.direction === 'LONG' ? '🟢' : '🔴';
      const pnlSign = (t.pnl ?? 0) >= 0 ? '+' : '';
      msg += `${dir} \`${t.symbol}\` | ${t.telegram_id}\n`;
      msg += `  PnL: \`${pnlSign}$${(t.pnl ?? 0).toFixed(2)}\` | Opened: ${t.opened_at}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('tradeHistory', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const trades = db.getAllTrades(30);
    let msg = `📜 *Recent Trades (${trades.length}):*\n\n`;
    for (const t of trades) {
      const dir = t.direction === 'LONG' ? '🟢' : '🔴';
      const pnlSign = (t.pnl ?? 0) >= 0 ? '✅ +' : '❌ ';
      msg += `${dir} \`${t.symbol}\` | ${t.telegram_id} | ${t.status}\n`;
      msg += `  ${pnlSign}$${(t.pnl ?? 0).toFixed(2)} | ${t.close_reason || ''}\n\n`;
    }
    if (msg.length > 4000) msg = msg.slice(0, 3990) + '...';
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('liveSignals', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const signals = db.getRecentSignals(20);
    if (!signals.length) return ctx.reply('📭 No signals yet.');
    let msg = `📡 *Recent Signals (${signals.length}):*\n\n`;
    for (const s of signals) {
      const dir = s.direction === 'LONG' ? '🟢' : '🔴';
      msg += `${dir} \`${s.symbol}\` ${s.direction} | ${s.confidence}% | RR:${s.risk_reward}\n`;
      msg += `  ${new Date(s.created_at).toUTCString()}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('logs', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const logs = db.getRecentDbLogs(50);
    let msg = `📋 *System Logs (last ${logs.length}):*\n\n\`\`\`\n`;
    for (const l of logs.slice(0, 30)) {
      msg += `[${l.created_at}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}\n`;
    }
    msg += '```';
    if (msg.length > 4000) msg = msg.slice(0, 3980) + '\n```';
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('health', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const wsStatus = scanner.getWsStatus();
    const wsConnected = Object.values(wsStatus).filter(s => s === 'OPEN').length;
    const wsTotal = Object.keys(wsStatus).length;
    const openTrades = db.getOpenTrades();
    const users = db.getAllUsers();
    const autoTraders = users.filter(u => u.auto_trade);
    const memUsage = process.memoryUsage();

    await ctx.reply(
      `🏥 *System Health:*\n\n` +
      `⏰ Uptime: \`${Math.floor(process.uptime() / 60)} min\`\n` +
      `🔗 WebSocket: \`${wsConnected}/${wsTotal} live\`\n` +
      `👁 Scanning: \`${scanner.getPairCount()} pairs\`\n` +
      `👥 Users: \`${users.length}\` (${autoTraders.length} auto-trading)\n` +
      `📊 Open Trades: \`${openTrades.length}\`\n` +
      `🧠 Heap: \`${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB\`\n` +
      `💾 RSS: \`${Math.round(memUsage.rss / 1024 / 1024)}MB\`\n` +
      `🕐 Time: \`${new Date().toUTCString()}\``,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('broadcast', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) return ctx.reply('Usage: /broadcast <message>');

    const users = db.getAllUsers().filter(u => u.is_active);
    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.telegram_id, `📢 *Admin Broadcast:*\n\n${text}`, { parse_mode: 'Markdown' });
        sent++;
      } catch {
        failed++;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    await ctx.reply(`✅ Broadcast complete: ${sent} sent, ${failed} failed.`);
  });

  bot.command('banUser', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');
    const args = ctx.message.text.split(' ').slice(1);
    const targetId = args[0];
    if (!targetId) return ctx.reply('Usage: /banUser <telegram_id>');
    db.upsertUser(targetId, { is_active: 0 } as any);
    await ctx.reply(`✅ User ${targetId} deactivated.`);
  });

  bot.command('unbanUser', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');
    const args = ctx.message.text.split(' ').slice(1);
    const targetId = args[0];
    if (!targetId) return ctx.reply('Usage: /unbanUser <telegram_id>');
    db.upsertUser(targetId, { is_active: 1 } as any);
    await ctx.reply(`✅ User ${targetId} activated.`);
  });

  bot.command('wsstatus', async (ctx) => {
    const user = (ctx as any).dbUser;
    if (user?.role !== 'admin') return ctx.reply('⛔ Admin only.');

    const wsStatus = scanner.getWsStatus();
    let msg = `📡 *WebSocket Status:*\n\n\`\`\`\n`;
    for (const [key, state] of Object.entries(wsStatus)) {
      const icon = state === 'OPEN' ? '✅' : '❌';
      msg += `${icon} ${key}: ${state}\n`;
    }
    msg += '```';
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });
}
