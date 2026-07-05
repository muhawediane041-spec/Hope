export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  is_active INTEGER NOT NULL DEFAULT 1,
  api_key_enc TEXT,
  api_secret_enc TEXT,
  testnet INTEGER NOT NULL DEFAULT 0,
  auto_trade INTEGER NOT NULL DEFAULT 0,
  leverage INTEGER NOT NULL DEFAULT 10,
  risk_per_trade REAL NOT NULL DEFAULT 1.0,
  max_open_trades INTEGER NOT NULL DEFAULT 3,
  daily_loss_limit REAL NOT NULL DEFAULT 3.0,
  confidence_threshold REAL NOT NULL DEFAULT 85.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  telegram_id TEXT NOT NULL,
  order_id TEXT,
  client_order_id TEXT,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price REAL,
  current_price REAL,
  quantity REAL,
  leverage INTEGER,
  stop_loss REAL,
  take_profit REAL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  pnl REAL,
  pnl_pct REAL,
  risk_reward REAL,
  confidence REAL,
  signal_id TEXT,
  close_reason TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_uuid TEXT UNIQUE NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  risk_reward REAL NOT NULL,
  confidence REAL NOT NULL,
  probability REAL,
  trend_summary TEXT,
  volume_confirmation TEXT,
  market_structure TEXT,
  timeframe TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  trades_opened INTEGER NOT NULL DEFAULT 0,
  trades_closed INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_pnl REAL NOT NULL DEFAULT 0,
  daily_loss REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
`;
