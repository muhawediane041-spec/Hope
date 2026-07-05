# Binance Futures AI Trading Bot

AI-powered Telegram bot for automated Binance Futures trading with real-time market analysis.

## Features

- **Live Market Scanner** — Scans all Binance USDT Futures pairs continuously via WebSocket
- **AI Analysis Engine** — Multi-timeframe analysis (1M, 5M, 15M, 1H, 4H, 1D) with 10+ indicators
- **Smart Money Concepts** — Order blocks, Fair Value Gaps, liquidity sweeps, S/R levels
- **Auto Trading** — Automatically opens trades when confidence ≥ threshold
- **Risk Management** — ATR-based SL/TP, trailing stops, daily loss limits
- **Admin System** — User management, live logs, system health
- **Security** — AES-256 encrypted API key storage, no keys in logs

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
BOT_TOKEN=your_telegram_bot_token
ADMIN_CHAT_ID=your_telegram_chat_id
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

### 3. Run

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

## Deploy to Railway

1. Push to GitHub
2. Create new Railway project from GitHub repo
3. Add environment variables in Railway dashboard:
   - `BOT_TOKEN`
   - `ADMIN_CHAT_ID`
   - `ENCRYPTION_KEY`
4. Railway auto-detects `railway.json` and deploys

## Telegram Commands

### User Commands
| Command | Description |
|---------|-------------|
| `/start` | Start the bot |
| `/connect` | Connect Binance API keys |
| `/disconnect` | Remove API keys |
| `/account` | View account balance & positions |
| `/trades` | View open trades |
| `/history` | Trade history |
| `/signals` | Recent signals |
| `/scan` | Top market opportunities |
| `/analyse BTCUSDT` | Deep pair analysis |
| `/autotrade` | Toggle auto-trading |
| `/leverage 10` | Set leverage (1–125) |
| `/risk 1` | Set risk per trade % (0.1–5) |
| `/maxTrades 3` | Max concurrent trades |
| `/dailyLimit 3` | Daily loss limit % |
| `/threshold 85` | Confidence threshold % |
| `/settings` | View all settings |
| `/status` | Bot & WebSocket status |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/admin` | Admin panel |
| `/users` | All users |
| `/allTrades` | All open trades |
| `/tradeHistory` | All closed trades |
| `/liveSignals` | Recent signals |
| `/logs` | System logs |
| `/health` | System health + memory |
| `/broadcast <msg>` | Send to all users |
| `/banUser <id>` | Deactivate user |
| `/unbanUser <id>` | Activate user |
| `/wsstatus` | WebSocket connection status |

## Analysis Engine

### Indicators
- EMA 20/50/100/200
- RSI (14)
- MACD (12/26/9)
- ATR (14) — used for SL/TP sizing
- ADX (14)
- VWAP
- Supertrend (10, 3)
- Bollinger Bands (20, 2)
- OBV

### Smart Money Concepts
- Order Blocks (bullish/bearish)
- Fair Value Gaps (FVG)
- Liquidity Sweeps
- Support & Resistance (pivot-based)

### Signal Scoring
- Higher timeframe trend alignment (D1, 4H, 1H)
- Entry timeframe confirmation (15M, 5M)
- Market structure alignment
- Volume confirmation (OBV)
- Liquidity threshold filter

Signals only generated when confidence ≥ threshold (default 85%).

## Security

- Binance API keys are AES-256 encrypted before storage in SQLite
- Keys are never logged or exposed in Telegram messages
- Role-based access: Admin / User
- Keys are decrypted in-memory only when executing trades

## Configuration

All settings are per-user and configurable via Telegram commands:

| Setting | Default | Range |
|---------|---------|-------|
| Leverage | 10x | 1–125 |
| Risk per trade | 1% | 0.1–5% |
| Max open trades | 3 | 1–10 |
| Daily loss limit | 3% | 1–20% |
| Confidence threshold | 85% | 50–99% |

## Architecture

```
src/
├── index.ts              # Entry point
├── bot/
│   ├── index.ts          # Telegraf bot setup
│   ├── commands/
│   │   ├── user.ts       # User commands
│   │   └── admin.ts      # Admin commands
│   └── middleware/
│       └── auth.ts       # Auth & user registration
├── binance/
│   ├── client.ts         # REST API client
│   └── websocket.ts      # WebSocket manager
├── trading/
│   ├── indicators.ts     # Technical indicators
│   ├── analysis.ts       # Multi-timeframe analysis
│   ├── signals.ts        # Signal generation
│   ├── scanner.ts        # Market scanner
│   ├── autoTrader.ts     # Trade execution & monitoring
│   └── riskManager.ts    # Position sizing & risk rules
├── db/
│   ├── index.ts          # Database access layer
│   └── schema.ts         # SQLite schema
├── crypto/
│   └── encryption.ts     # AES-256 encrypt/decrypt
└── logger/
    └── index.ts          # Winston logger
```

## License

MIT
