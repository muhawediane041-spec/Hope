import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../logger';

const WS_BASE = 'wss://fstream.binance.com/stream?streams=';
const WS_TESTNET = 'wss://stream.binancefuture.com/stream?streams=';

export interface KlineWsData {
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  openTime: number;
  closeTime: number;
}

export interface TickerWsData {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePct: number;
  volume: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
}

export interface BookTickerData {
  symbol: string;
  bestBid: number;
  bestBidQty: number;
  bestAsk: number;
  bestAskQty: number;
}

export class BinanceWebSocketManager extends EventEmitter {
  private connections: Map<string, WebSocket> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private testnet: boolean;
  private isShuttingDown = false;

  constructor(testnet = false) {
    super();
    this.testnet = testnet;
  }

  private buildUrl(streams: string[]): string {
    const base = this.testnet ? WS_TESTNET : WS_BASE;
    return base + streams.join('/');
  }

  subscribeKlines(symbols: string[], interval: string, key: string): void {
    const streams = symbols.map(s => `${s.toLowerCase()}@kline_${interval}`);
    this.connect(key, streams, (data: any) => {
      if (data.e === 'kline') {
        const k = data.k;
        const payload: KlineWsData = {
          symbol: data.s,
          interval: k.i,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x,
          openTime: k.t,
          closeTime: k.T
        };
        this.emit('kline', payload);
      }
    });
  }

  subscribeBookTicker(symbols: string[], key: string): void {
    const streams = symbols.map(s => `${s.toLowerCase()}@bookTicker`);
    this.connect(key, streams, (data: any) => {
      const payload: BookTickerData = {
        symbol: data.s,
        bestBid: parseFloat(data.b),
        bestBidQty: parseFloat(data.B),
        bestAsk: parseFloat(data.a),
        bestAskQty: parseFloat(data.A)
      };
      this.emit('bookTicker', payload);
    });
  }

  subscribeMarkPrice(symbols: string[], key: string): void {
    const streams = symbols.map(s => `${s.toLowerCase()}@markPrice`);
    this.connect(key, streams, (data: any) => {
      this.emit('markPrice', {
        symbol: data.s,
        markPrice: parseFloat(data.p),
        indexPrice: parseFloat(data.i),
        fundingRate: parseFloat(data.r)
      });
    });
  }

  private connect(key: string, streams: string[], handler: (data: any) => void): void {
    if (this.connections.has(key)) {
      this.connections.get(key)!.close();
    }

    const url = this.buildUrl(streams);
    const ws = new WebSocket(url);

    ws.on('open', () => {
      logger.info(`[WS] Connected: ${key} (${streams.length} streams)`);
      this.emit('connected', key);
    });

    ws.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        const data = msg.data || msg;
        handler(data);
      } catch (e) {
        logger.debug(`[WS] Parse error on ${key}`);
      }
    });

    ws.on('error', (err) => {
      logger.warn(`[WS] Error on ${key}: ${err.message}`);
      this.emit('error', { key, error: err });
    });

    ws.on('close', (code) => {
      logger.warn(`[WS] Closed: ${key} (code=${code})`);
      this.connections.delete(key);
      if (!this.isShuttingDown) {
        const delay = Math.min(5000 + Math.random() * 3000, 30000);
        const timer = setTimeout(() => {
          logger.info(`[WS] Reconnecting: ${key}`);
          this.connect(key, streams, handler);
        }, delay);
        this.reconnectTimers.set(key, timer);
      }
    });

    this.connections.set(key, ws);
  }

  closeAll(): void {
    this.isShuttingDown = true;
    this.reconnectTimers.forEach(t => clearTimeout(t));
    this.reconnectTimers.clear();
    this.connections.forEach((ws, key) => {
      logger.info(`[WS] Closing ${key}`);
      ws.close();
    });
    this.connections.clear();
  }

  getStatus(): Record<string, string> {
    const states: Record<number, string> = {
      0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED'
    };
    const result: Record<string, string> = {};
    this.connections.forEach((ws, key) => {
      result[key] = states[ws.readyState] ?? 'UNKNOWN';
    });
    return result;
  }
}
