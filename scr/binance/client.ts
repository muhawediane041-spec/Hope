import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { logger } from '../logger';

const MAINNET_BASE = 'https://fapi.binance.com';
const TESTNET_BASE = 'https://testnet.binancefuture.com';

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

export interface OrderBookDepth {
  bids: [number, number][];
  asks: [number, number][];
}

export interface FuturesPosition {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  liquidationPrice: number;
  leverage: number;
  marginType: string;
  positionSide: string;
}

export interface AccountInfo {
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  availableBalance: number;
  totalMarginBalance: number;
}

export class BinanceClient {
  private http: AxiosInstance;
  private apiKey: string;
  private apiSecret: string;
  private testnet: boolean;

  constructor(apiKey: string, apiSecret: string, testnet = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.testnet = testnet;
    const baseURL = testnet ? TESTNET_BASE : MAINNET_BASE;
    this.http = axios.create({
      baseURL,
      timeout: 10000,
      headers: { 'X-MBX-APIKEY': apiKey }
    });
  }

  private sign(params: Record<string, any>): Record<string, any> {
    const timestamp = Date.now();
    const query = new URLSearchParams({ ...params, timestamp: String(timestamp) }).toString();
    const signature = crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
    return { ...params, timestamp, signature };
  }

  async ping(): Promise<boolean> {
    try {
      await this.http.get('/fapi/v1/ping');
      return true;
    } catch {
      return false;
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const params = this.sign({});
    const res = await this.http.get('/fapi/v2/account', { params });
    return {
      totalWalletBalance: parseFloat(res.data.totalWalletBalance),
      totalUnrealizedProfit: parseFloat(res.data.totalUnrealizedProfit),
      availableBalance: parseFloat(res.data.availableBalance),
      totalMarginBalance: parseFloat(res.data.totalMarginBalance)
    };
  }

  async getOpenPositions(): Promise<FuturesPosition[]> {
    const params = this.sign({});
    const res = await this.http.get('/fapi/v2/positionRisk', { params });
    return (res.data as any[])
      .filter((p: any) => parseFloat(p.positionAmt) !== 0)
      .map((p: any) => ({
        symbol: p.symbol,
        positionAmt: parseFloat(p.positionAmt),
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        unrealizedProfit: parseFloat(p.unRealizedProfit),
        liquidationPrice: parseFloat(p.liquidationPrice),
        leverage: parseInt(p.leverage),
        marginType: p.marginType,
        positionSide: p.positionSide
      }));
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const params = this.sign({ symbol, leverage });
    await this.http.post('/fapi/v1/leverage', null, { params });
  }

  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    try {
      const params = this.sign({ symbol, marginType });
      await this.http.post('/fapi/v1/marginType', null, { params });
    } catch (e: any) {
      if (e?.response?.data?.code === -4046) return;
      throw e;
    }
  }

  async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    reduceOnly = false
  ): Promise<any> {
    const params = this.sign({
      symbol,
      side,
      type: 'MARKET',
      quantity: quantity.toFixed(8),
      ...(reduceOnly ? { reduceOnly: 'true' } : {})
    });
    const res = await this.http.post('/fapi/v1/order', null, { params });
    return res.data;
  }

  async placeStopOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopPrice: number,
    type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET'
  ): Promise<any> {
    const params = this.sign({
      symbol,
      side,
      type,
      stopPrice: stopPrice.toFixed(8),
      quantity: quantity.toFixed(8),
      reduceOnly: 'true',
      timeInForce: 'GTE_GTC',
      workingType: 'MARK_PRICE'
    });
    const res = await this.http.post('/fapi/v1/order', null, { params });
    return res.data;
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const params = this.sign({ symbol });
    await this.http.delete('/fapi/v1/allOpenOrders', { params });
  }

  async getOpenOrders(symbol?: string): Promise<any[]> {
    const params = this.sign(symbol ? { symbol } : {});
    const res = await this.http.get('/fapi/v1/openOrders', { params });
    return res.data;
  }

  async closePosition(symbol: string, positionAmt: number): Promise<any> {
    const side = positionAmt > 0 ? 'SELL' : 'BUY';
    const qty = Math.abs(positionAmt);
    return this.placeMarketOrder(symbol, side, qty, true);
  }

  static async getKlines(
    symbol: string,
    interval: string,
    limit = 200,
    testnet = false
  ): Promise<Kline[]> {
    const base = testnet ? TESTNET_BASE : MAINNET_BASE;
    const res = await axios.get(`${base}/fapi/v1/klines`, {
      params: { symbol, interval, limit },
      timeout: 10000
    });
    return (res.data as any[][]).map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      quoteVolume: parseFloat(k[7]),
      trades: k[8]
    }));
  }

  static async getAllUsdtFuturesPairs(testnet = false): Promise<string[]> {
    const base = testnet ? TESTNET_BASE : MAINNET_BASE;
    const res = await axios.get(`${base}/fapi/v1/exchangeInfo`, { timeout: 10000 });
    return (res.data.symbols as any[])
      .filter((s: any) => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL')
      .map((s: any) => s.symbol);
  }

  static async getTicker24h(symbol?: string, testnet = false): Promise<any> {
    const base = testnet ? TESTNET_BASE : MAINNET_BASE;
    const params = symbol ? { symbol } : {};
    const res = await axios.get(`${base}/fapi/v1/ticker/24hr`, { params, timeout: 10000 });
    return res.data;
  }

  static async getDepth(symbol: string, limit = 20, testnet = false): Promise<OrderBookDepth> {
    const base = testnet ? TESTNET_BASE : MAINNET_BASE;
    const res = await axios.get(`${base}/fapi/v1/depth`, { params: { symbol, limit }, timeout: 10000 });
    return {
      bids: res.data.bids.map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])]),
      asks: res.data.asks.map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])])
    };
  }

  static async getMarkPrice(symbol: string, testnet = false): Promise<number> {
    const base = testnet ? TESTNET_BASE : MAINNET_BASE;
    const res = await axios.get(`${base}/fapi/v1/premiumIndex`, { params: { symbol }, timeout: 5000 });
    return parseFloat(res.data.markPrice);
  }

  static async getAggTrades(symbol: string, limit = 100, testnet = false): Promise<any[]> {
    const base = testnet ? TESTNET_BASE : MAINNET_BASE;
    const res = await axios.get(`${base}/fapi/v1/aggTrades`, { params: { symbol, limit }, timeout: 10000 });
    return res.data;
  }
}
