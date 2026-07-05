import { EventEmitter } from 'events';
import { BinanceClient } from '../binance/client';
import { BinanceWebSocketManager } from '../binance/websocket';
import { analyseSymbol, FullAnalysis } from './analysis';
import { generateSignal, TradingSignal } from './signals';
import { logger } from '../logger';
import { db } from '../db';

export interface ScanResult {
  symbol: string;
  analysis: FullAnalysis;
  signal: TradingSignal | null;
  rank: number;
}

export class MarketScanner extends EventEmitter {
  private pairs: string[] = [];
  private wsManager: BinanceWebSocketManager;
  private scanInterval: NodeJS.Timeout | null = null;
  private analysisCache: Map<string, { analysis: FullAnalysis; ts: number }> = new Map();
  private testnet: boolean;
  private isRunning = false;
  private confidenceThreshold = 85;
  private readonly CACHE_TTL = 5 * 60 * 1000;
  private readonly SCAN_INTERVAL = 15 * 60 * 1000;
  private readonly WS_BATCH_SIZE = 50;

  constructor(testnet = false, confidenceThreshold = 85) {
    super();
    this.testnet = testnet;
    this.confidenceThreshold = confidenceThreshold;
    this.wsManager = new BinanceWebSocketManager(testnet);
    this.wsManager.on('kline', this.onKline.bind(this));
  }

  private onKline(data: any): void {
    if (data.isClosed) {
      this.scheduleAnalysis(data.symbol);
    }
    const cached = this.analysisCache.get(data.symbol);
    if (cached) {
      cached.analysis.currentPrice = data.close;
    }
  }

  private scheduleAnalysis(symbol: string): void {
    setTimeout(async () => {
      try {
        await this.analyseOne(symbol);
      } catch {}
    }, 1000 + Math.random() * 5000);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('[Scanner] Starting market scanner...');

    try {
      this.pairs = await BinanceClient.getAllUsdtFuturesPairs(this.testnet);
      logger.info(`[Scanner] Found ${this.pairs.length} USDT Futures pairs`);
      db.dbLog('info', 'SCANNER', `Scanner started with ${this.pairs.length} pairs`);
    } catch (e) {
      logger.error(`[Scanner] Failed to load pairs: ${(e as Error).message}`);
      this.pairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT'];
    }

    this.startWebSocketFeeds();

    await this.runFullScan();

    this.scanInterval = setInterval(async () => {
      if (this.isRunning) await this.runFullScan();
    }, this.SCAN_INTERVAL);
  }

  private startWebSocketFeeds(): void {
    const batches: string[][] = [];
    for (let i = 0; i < this.pairs.length; i += this.WS_BATCH_SIZE) {
      batches.push(this.pairs.slice(i, i + this.WS_BATCH_SIZE));
    }

    batches.forEach((batch, idx) => {
      setTimeout(() => {
        this.wsManager.subscribeKlines(batch, '15m', `klines_15m_batch${idx}`);
        this.wsManager.subscribeMarkPrice(batch, `markPrice_batch${idx}`);
      }, idx * 500);
    });

    logger.info(`[Scanner] WebSocket feeds started for ${this.pairs.length} pairs in ${batches.length} batches`);
  }

  private async analyseOne(symbol: string): Promise<ScanResult | null> {
    const cached = this.analysisCache.get(symbol);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
      return { symbol, analysis: cached.analysis, signal: null, rank: 0 };
    }

    const analysis = await analyseSymbol(symbol, this.testnet);
    if (!analysis) return null;

    this.analysisCache.set(symbol, { analysis, ts: Date.now() });

    const signal = generateSignal(analysis, this.confidenceThreshold);
    if (signal) {
      logger.info(`[Scanner] Signal: ${signal.symbol} ${signal.direction} ${signal.confidence}%`);
      db.dbLog('info', 'SCANNER', `Signal generated for ${signal.symbol}`, { confidence: signal.confidence });
      this.emit('signal', signal);
    }

    return { symbol, analysis, signal, rank: analysis.primaryStrength + analysis.liquidityScore };
  }

  private async runFullScan(): Promise<void> {
    logger.info(`[Scanner] Full scan starting (${this.pairs.length} pairs)...`);
    db.dbLog('info', 'SCANNER', 'Full market scan started');

    const BATCH_SIZE = 5;
    const results: ScanResult[] = [];

    for (let i = 0; i < this.pairs.length; i += BATCH_SIZE) {
      if (!this.isRunning) break;
      const batch = this.pairs.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(batch.map(s => this.analyseOne(s)));

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value);
        }
      }

      if (i % 50 === 0 && i > 0) {
        logger.info(`[Scanner] Progress: ${i}/${this.pairs.length}`);
      }

      await new Promise(res => setTimeout(res, 200));
    }

    results.sort((a, b) => b.rank - a.rank);
    this.emit('scanComplete', results.slice(0, 20));
    db.dbLog('info', 'SCANNER', `Full scan complete. Top opportunities: ${results.slice(0, 5).map(r => r.symbol).join(', ')}`);
    logger.info(`[Scanner] Full scan complete. Analyzed ${results.length} pairs.`);
  }

  getTopOpportunities(n = 10): Array<{ symbol: string; analysis: FullAnalysis }> {
    const entries = Array.from(this.analysisCache.entries())
      .filter(([_, v]) => Date.now() - v.ts < this.CACHE_TTL * 2)
      .map(([symbol, v]) => ({ symbol, analysis: v.analysis }))
      .sort((a, b) => (b.analysis.primaryStrength + b.analysis.liquidityScore) - (a.analysis.primaryStrength + a.analysis.liquidityScore));
    return entries.slice(0, n);
  }

  getWsStatus(): Record<string, string> {
    return this.wsManager.getStatus();
  }

  stop(): void {
    this.isRunning = false;
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.wsManager.closeAll();
    logger.info('[Scanner] Market scanner stopped');
  }

  setConfidenceThreshold(val: number): void {
    this.confidenceThreshold = val;
  }

  getPairCount(): number {
    return this.pairs.length;
  }
}
