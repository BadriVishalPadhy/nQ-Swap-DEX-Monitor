/**
 * Data Processor Web Worker
 * 
 * Offloads heavy data processing from the main thread:
 * 1. OHLC Aggregation — Converts raw ticks into candlestick bars
 * 2. State Diffing — Computes minimal diffs for store updates
 * 3. Price Calculations — Derives metrics from raw data
 * 
 * Memory Safety:
 * - Fixed-size circular buffer (max 10,000 ticks per pool)
 * - Candle history pruned beyond visible window
 * - Exposed via Comlink for type-safe RPC communication
 */

import * as Comlink from 'comlink';

// ─── Types (duplicated to avoid import issues in worker context) ─────────

interface TickData {
  poolId: string;
  price: number;
  amount: number;
  timestamp: number;
  confirmationStatus: 'pending' | 'confirmed' | 'finalized';
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirmationStatus: 'pending' | 'confirmed' | 'finalized';
}

interface BlockData {
  blockNumber: number;
  timestamp: number;
  pools: Array<{
    poolId: string;
    price: number;
    ohlc: { open: number; high: number; low: number; close: number };
    volume24h: number;
  }>;
}

type CandleInterval = '1m' | '5m' | '15m' | '1h';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

// ─── State ──────────────────────────────────────────────────────────────────

const MAX_TICK_BUFFER = 10_000;
const MAX_CANDLES = 300;

// Circular buffers per pool
const tickBuffers = new Map<string, TickData[]>();
// Confirmed candles per pool (per interval)
const candleCache = new Map<string, Map<CandleInterval, CandleData[]>>();
// Current forming candle per pool
const pendingCandles = new Map<string, CandleData>();

let currentInterval: CandleInterval = '1m';
let ticksProcessed = 0;

// ─── Worker API ─────────────────────────────────────────────────────────────

const workerApi = {
  /**
   * Process a single price tick from the mempool or finalized block.
   * Aggregates into OHLC candles at the current interval.
   */
  processTick(tick: TickData): {
    confirmedCandle: CandleData | null;
    pendingCandle: CandleData | null;
    isNewCandle: boolean;
  } {
    ticksProcessed++;

    // Add to circular buffer
    let buffer = tickBuffers.get(tick.poolId);
    if (!buffer) {
      buffer = [];
      tickBuffers.set(tick.poolId, buffer);
    }
    buffer.push(tick);
    if (buffer.length > MAX_TICK_BUFFER) {
      buffer.splice(0, buffer.length - MAX_TICK_BUFFER);
    }

    // Compute candle time bucket
    const intervalMs = INTERVAL_MS[currentInterval];
    const candleTime = Math.floor(tick.timestamp / intervalMs) * intervalMs;
    const candleTimeSec = Math.floor(candleTime / 1000);

    // Get or create candle cache for this pool
    let poolCandles = candleCache.get(tick.poolId);
    if (!poolCandles) {
      poolCandles = new Map();
      candleCache.set(tick.poolId, poolCandles);
    }
    let candles = poolCandles.get(currentInterval);
    if (!candles) {
      candles = [];
      poolCandles.set(currentInterval, candles);
    }

    const existingPending = pendingCandles.get(tick.poolId);
    let isNewCandle = false;
    let confirmedCandle: CandleData | null = null;

    if (tick.confirmationStatus === 'finalized') {
      // Finalized tick — commit the pending candle and start fresh
      if (existingPending && existingPending.time !== candleTimeSec) {
        // The pending candle belongs to a previous interval — finalize it
        confirmedCandle = { ...existingPending, confirmationStatus: 'finalized' };
        candles.push(confirmedCandle);
        if (candles.length > MAX_CANDLES) candles.splice(0, candles.length - MAX_CANDLES);
        isNewCandle = true;
      }

      // Update or create candle for this time bucket
      const lastCandle = candles[candles.length - 1];
      if (lastCandle && lastCandle.time === candleTimeSec) {
        // Update existing confirmed candle
        lastCandle.high = Math.max(lastCandle.high, tick.price);
        lastCandle.low = Math.min(lastCandle.low, tick.price);
        lastCandle.close = tick.price;
        lastCandle.volume += tick.amount || 0;
        lastCandle.confirmationStatus = 'finalized';
        confirmedCandle = { ...lastCandle };
      } else {
        // New confirmed candle
        confirmedCandle = {
          time: candleTimeSec,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tick.amount || 0,
          confirmationStatus: 'finalized',
        };
        candles.push(confirmedCandle);
        if (candles.length > MAX_CANDLES) candles.splice(0, candles.length - MAX_CANDLES);
        isNewCandle = true;
      }

      // Clear pending candle
      pendingCandles.delete(tick.poolId);

      return { confirmedCandle, pendingCandle: null, isNewCandle };
    } else {
      // Pending tick — update the forming candle
      let pending = existingPending;

      if (!pending || pending.time !== candleTimeSec) {
        // New time bucket — the old pending becomes a (soft) confirmed candle
        if (pending && pending.time !== candleTimeSec) {
          confirmedCandle = { ...pending, confirmationStatus: 'confirmed' };
          candles.push(confirmedCandle);
          if (candles.length > MAX_CANDLES) candles.splice(0, candles.length - MAX_CANDLES);
          isNewCandle = true;
        }

        pending = {
          time: candleTimeSec,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tick.amount || 0,
          confirmationStatus: 'pending',
        };
      } else {
        pending.high = Math.max(pending.high, tick.price);
        pending.low = Math.min(pending.low, tick.price);
        pending.close = tick.price;
        pending.volume += tick.amount || 0;
      }

      pendingCandles.set(tick.poolId, pending);

      return { confirmedCandle, pendingCandle: { ...pending }, isNewCandle };
    }
  },

  /**
   * Process a finalized block — commit all pool candles.
   */
  processBlock(block: BlockData): Map<string, CandleData> {
    const results = new Map<string, CandleData>();

    for (const pool of block.pools) {
      const result = this.processTick({
        poolId: pool.poolId,
        price: pool.price,
        amount: pool.volume24h / 1000, // approximate per-block volume
        timestamp: block.timestamp,
        confirmationStatus: 'finalized',
      });

      if (result.confirmedCandle) {
        results.set(pool.poolId, result.confirmedCandle);
      }
    }

    return results;
  },

  /**
   * Get all confirmed candles for a pool at the current interval.
   */
  getCandles(poolId: string): CandleData[] {
    const poolCandles = candleCache.get(poolId);
    if (!poolCandles) return [];
    return poolCandles.get(currentInterval) || [];
  },

  /**
   * Get the pending (forming) candle for a pool.
   */
  getPendingCandle(poolId: string): CandleData | null {
    return pendingCandles.get(poolId) || null;
  },

  /**
   * Set the candle interval (resets candle cache).
   */
  setInterval(interval: CandleInterval) {
    currentInterval = interval;
    // Clear candle cache since interval changed
    candleCache.clear();
    pendingCandles.clear();
  },

  /**
   * Get processing stats.
   */
  getStats() {
    let totalBufferSize = 0;
    tickBuffers.forEach(buf => { totalBufferSize += buf.length; });

    return {
      ticksProcessed,
      totalBufferSize,
      poolCount: tickBuffers.size,
      currentInterval,
    };
  },

  /**
   * Generate initial candle history from seed data.
   * Creates realistic-looking historical candles for chart initialization.
   */
  generateHistory(poolId: string, basePrice: number, count: number): CandleData[] {
    const intervalMs = INTERVAL_MS[currentInterval];
    const now = Date.now();
    const candles: CandleData[] = [];
    let price = basePrice * (0.95 + Math.random() * 0.1);

    for (let i = count; i > 0; i--) {
      const time = Math.floor((now - i * intervalMs) / 1000);
      const volatility = 0.005 + Math.random() * 0.01;
      const open = price;
      const change = (Math.random() - 0.5) * 2 * volatility * price;
      const close = price + change;
      const high = Math.max(open, close) * (1 + Math.random() * volatility);
      const low = Math.min(open, close) * (1 - Math.random() * volatility);

      candles.push({
        time,
        open: Number(open.toPrecision(6)),
        high: Number(high.toPrecision(6)),
        low: Number(low.toPrecision(6)),
        close: Number(close.toPrecision(6)),
        volume: Math.random() * basePrice * 1000,
        confirmationStatus: 'finalized',
      });

      price = close;
    }

    // Store in cache
    let poolCandles = candleCache.get(poolId);
    if (!poolCandles) {
      poolCandles = new Map();
      candleCache.set(poolId, poolCandles);
    }
    poolCandles.set(currentInterval, candles);

    return candles;
  },

  /**
   * Cleanup — clear all state.
   */
  cleanup() {
    tickBuffers.clear();
    candleCache.clear();
    pendingCandles.clear();
    ticksProcessed = 0;
  },
};

export type WorkerAPI = typeof workerApi;

Comlink.expose(workerApi);
