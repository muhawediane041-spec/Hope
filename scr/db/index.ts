import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA_SQL } from './schema';
import { logger } from '../logger';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'database.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.exec(SCHEMA_SQL);
    logger.info(`Database initialized at ${DB_PATH}`);
  }
  return _db;
}

export interface User {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  role: 'admin' | 'user';
  is_active: number;
  api_key_enc: string | null;
  api_secret_enc: string | null;
  testnet: number;
  auto_trade: number;
  leverage: number;
  risk_per_trade: number;
  max_open_trades: number;
  daily_loss_limit: number;
  confidence_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: number;
  user_id: number;
  telegram_id: string;
  order_id: string | null;
  client_order_id: string | null;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number | null;
  current_price: number | null;
  quantity: number | null;
  leverage: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  pnl: number | null;
  pnl_pct: number | null;
  risk_reward: number | null;
  confidence: number | null;
  signal_id: string | null;
  close_reason: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface Signal {
  id: number;
  signal_uuid: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  confidence: number;
  probability: number | null;
  trend_summary: string | null;
  volume_confirmation: string | null;
  market_structure: string | null;
  timeframe: string | null;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'FILLED';
  created_at: string;
  expires_at: string | null;
}

export const db = {
  getUser(telegramId: string): User | undefined {
    return getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as User | undefined;
  },

  upsertUser(telegramId: string, data: Partial<User>): void {
    const existing = db.getUser(telegramId);
    if (existing) {
      const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
      const values = Object.values(data);
      getDb().prepare(`UPDATE users SET ${fields}, updated_at = datetime('now') WHERE telegram_id = ?`)
        .run(...values, telegramId);
    } else {
      getDb().prepare(`
        INSERT INTO users (telegram_id, username, first_name, role)
        VALUES (?, ?, ?, ?)
      `).run(
        telegramId,
        data.username ?? null,
        data.first_name ?? null,
        data.role ?? 'user'
      );
    }
  },

  getAllUsers(): User[] {
    return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all() as User[];
  },

  setUserApiKeys(telegramId: string, apiKeyEnc: string, apiSecretEnc: string): void {
    getDb().prepare(`
      UPDATE users SET api_key_enc = ?, api_secret_enc = ?, updated_at = datetime('now')
      WHERE telegram_id = ?
    `).run(apiKeyEnc, apiSecretEnc, telegramId);
  },

  clearUserApiKeys(telegramId: string): void {
    getDb().prepare(`
      UPDATE users SET api_key_enc = NULL, api_secret_enc = NULL, updated_at = datetime('now')
      WHERE telegram_id = ?
    `).run(telegramId);
  },

  updateUserSettings(telegramId: string, settings: Partial<User>): void {
    const allowed = ['auto_trade', 'leverage', 'risk_per_trade', 'max_open_trades', 'daily_loss_limit', 'confidence_threshold', 'testnet'];
    const fields = Object.keys(settings).filter(k => allowed.includes(k));
    if (!fields.length) return;
    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (settings as any)[f]);
    getDb().prepare(`UPDATE users SET ${setClauses}, updated_at = datetime('now') WHERE telegram_id = ?`)
      .run(...values, telegramId);
  },

  insertTrade(trade: Omit<Trade, 'id' | 'opened_at' | 'closed_at'>): number {
    const result = getDb().prepare(`
      INSERT INTO trades (user_id, telegram_id, order_id, client_order_id, symbol, direction,
        entry_price, current_price, quantity, leverage, stop_loss, take_profit, status,
        pnl, pnl_pct, risk_reward, confidence, signal_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.user_id, trade.telegram_id, trade.order_id, trade.client_order_id,
      trade.symbol, trade.direction, trade.entry_price, trade.current_price,
      trade.quantity, trade.leverage, trade.stop_loss, trade.take_profit, trade.status,
      trade.pnl, trade.pnl_pct, trade.risk_reward, trade.confidence, trade.signal_id
    );
    return result.lastInsertRowid as number;
  },

  getOpenTrades(telegramId?: string): Trade[] {
    if (telegramId) {
      return getDb().prepare("SELECT * FROM trades WHERE status = 'OPEN' AND telegram_id = ? ORDER BY opened_at DESC")
        .all(telegramId) as Trade[];
    }
    return getDb().prepare("SELECT * FROM trades WHERE status = 'OPEN' ORDER BY opened_at DESC").all() as Trade[];
  },

  getAllTrades(limit = 50): Trade[] {
    return getDb().prepare('SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?').all(limit) as Trade[];
  },

  closeTrade(tradeId: number, pnl: number, pnlPct: number, closeReason: string, currentPrice: number): void {
    getDb().prepare(`
      UPDATE trades SET status = 'CLOSED', pnl = ?, pnl_pct = ?, close_reason = ?,
        current_price = ?, closed_at = datetime('now')
      WHERE id = ?
    `).run(pnl, pnlPct, closeReason, currentPrice, tradeId);
  },

  updateTradePrice(tradeId: number, currentPrice: number, pnl: number, pnlPct: number): void {
    getDb().prepare('UPDATE trades SET current_price = ?, pnl = ?, pnl_pct = ? WHERE id = ?')
      .run(currentPrice, pnl, pnlPct, tradeId);
  },

  updateTradeSL(tradeId: number, newSl: number): void {
    getDb().prepare('UPDATE trades SET stop_loss = ? WHERE id = ?').run(newSl, tradeId);
  },

  insertSignal(signal: Omit<Signal, 'id' | 'created_at'>): void {
    getDb().prepare(`
      INSERT INTO signals (signal_uuid, symbol, direction, entry_price, stop_loss, take_profit,
        risk_reward, confidence, probability, trend_summary, volume_confirmation, market_structure, timeframe, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signal.signal_uuid, signal.symbol, signal.direction, signal.entry_price,
      signal.stop_loss, signal.take_profit, signal.risk_reward, signal.confidence,
      signal.probability, signal.trend_summary, signal.volume_confirmation,
      signal.market_structure, signal.timeframe, signal.status, signal.expires_at
    );
  },

  getRecentSignals(limit = 20): Signal[] {
    return getDb().prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?').all(limit) as Signal[];
  },

  dbLog(level: string, category: string, message: string, meta?: object): void {
    try {
      getDb().prepare('INSERT INTO system_logs (level, category, message, meta) VALUES (?, ?, ?, ?)')
        .run(level, category, message, meta ? JSON.stringify(meta) : null);
    } catch {}
  },

  getRecentDbLogs(limit = 100): any[] {
    return getDb().prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  getTodayLoss(userId: number): number {
    const today = new Date().toISOString().split('T')[0];
    const row = getDb().prepare('SELECT daily_loss FROM daily_stats WHERE user_id = ? AND date = ?').get(userId, today) as any;
    return row?.daily_loss ?? 0;
  },

  recordDailyLoss(userId: number, loss: number): void {
    const today = new Date().toISOString().split('T')[0];
    getDb().prepare(`
      INSERT INTO daily_stats (user_id, date, daily_loss, trades_closed)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, date) DO UPDATE SET
        daily_loss = daily_loss + excluded.daily_loss,
        trades_closed = trades_closed + 1
    `).run(userId, today, loss);
  }
};
