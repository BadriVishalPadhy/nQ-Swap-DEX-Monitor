/**
 * Shared type definitions for the nQ-Swap DEX monitoring system.
 * Used across backend services, stores, and UI components.
 */

// ─── Core Pool Types ────────────────────────────────────────────────────────

export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Pool {
  poolId: string;
  token0: string;
  token1: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  tvl: number;
  reserveA: number;
  reserveB: number;
  ohlc: OHLC;
}

export interface Block {
  blockNumber: number;
  timestamp: number;
  parentHash: string;
  pools: Pool[];
}

// ─── Mempool Types ──────────────────────────────────────────────────────────

export interface PendingSwap {
  type: 'pending_swap';
  poolId: string;
  token0: string;
  token1: string;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  timestamp: number;
  txHash: string;
  nonce: number;
  status: 'pending';
  gasPrice: number;
}

export interface MempoolConfig {
  type: 'config';
  emissionRate: number;
  pools: { id: string; token0: string; token1: string }[];
}

export interface MempoolConfigUpdate {
  type: 'config_update';
  emissionRate: number;
}

export type MempoolMessage = PendingSwap | MempoolConfig | MempoolConfigUpdate;

// ─── Application State Types ─────────────────────────────────────────────────

export type ConfirmationStatus = 'pending' | 'confirmed' | 'finalized';

export interface PoolUpdate {
  poolId: string;
  token0: string;
  token1: string;
  price: number;
  previousPrice: number;
  confirmationStatus: ConfirmationStatus;
  blockNumber?: number;
  txHash?: string;
  timestamp: number;
}

export interface CandlestickData {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  confirmationStatus: ConfirmationStatus;
}

export interface PoolWithStatus extends Pool {
  confirmationStatus: ConfirmationStatus;
  pendingPrice?: number;
  pendingTxCount: number;
  lastUpdated: number;
}

// ─── Worker Message Types ────────────────────────────────────────────────────

export interface WorkerProcessTickRequest {
  type: 'process_tick';
  poolId: string;
  price: number;
  amount: number;
  timestamp: number;
  confirmationStatus: ConfirmationStatus;
}

export interface WorkerFinalizeBlockRequest {
  type: 'finalize_block';
  block: Block;
}

export interface WorkerGetCandlesRequest {
  type: 'get_candles';
  poolId: string;
  interval: CandleInterval;
  limit: number;
}

export interface WorkerSetIntervalRequest {
  type: 'set_interval';
  interval: CandleInterval;
}

export type WorkerRequest =
  | WorkerProcessTickRequest
  | WorkerFinalizeBlockRequest
  | WorkerGetCandlesRequest
  | WorkerSetIntervalRequest;

export interface WorkerCandleUpdate {
  type: 'candle_update';
  poolId: string;
  candles: CandlestickData[];
  pendingCandle: CandlestickData | null;
}

export interface WorkerPoolStats {
  type: 'pool_stats';
  poolId: string;
  ticksProcessed: number;
  bufferSize: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '1h';

export const CANDLE_INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

// ─── UI Types ────────────────────────────────────────────────────────────────

export interface ConnectionStatus {
  rpc: 'connected' | 'disconnected' | 'error';
  mempool: 'connected' | 'disconnected' | 'reconnecting' | 'error';
  trpc: 'connected' | 'disconnected' | 'reconnecting';
}

export interface SystemMetrics {
  updatesPerSecond: number;
  pendingTxCount: number;
  lastBlockNumber: number;
  lastBlockTime: number;
  workerQueueDepth: number;
  fps: number;
}
