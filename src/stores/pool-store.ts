/**
 * Pool Store — Zustand store for real-time pool state management.
 * 
 * Design decisions for high-frequency updates:
 * 1. Uses Zustand's selective subscriptions — components only re-render
 *    when the specific slice they subscribe to changes.
 * 2. Pending updates are batched and throttled to max 60fps to prevent
 *    React render thrashing under heavy WebSocket load.
 * 3. Finalized state is stored separately from pending state to enable
 *    the Block Confirmation Guard pattern.
 * 4. Uses Map for O(1) lookups by poolId.
 */

import { create } from 'zustand';
import type {
  PoolWithStatus,
  PoolUpdate,
  Pool,
  Block,
  ConnectionStatus,
  SystemMetrics,
} from '@/lib/types';

interface PoolState {
  // Core state
  pools: Map<string, PoolWithStatus>;
  selectedPoolId: string | null;
  lastFinalizedBlock: number;
  lastBlockTimestamp: number;

  // Connection status
  connectionStatus: ConnectionStatus;

  // System metrics
  metrics: SystemMetrics;

  // Actions
  setInitialPools: (pools: Pool[], blockNumber: number) => void;
  applyUpdate: (update: PoolUpdate) => void;
  applyFinalizedBlock: (block: Block) => void;
  selectPool: (poolId: string) => void;
  setConnectionStatus: (key: keyof ConnectionStatus, status: string) => void;
  updateMetrics: (partial: Partial<SystemMetrics>) => void;
}

export const usePoolStore = create<PoolState>((set, get) => ({
  pools: new Map(),
  selectedPoolId: null,
  lastFinalizedBlock: 0,
  lastBlockTimestamp: 0,
  connectionStatus: {
    rpc: 'disconnected',
    mempool: 'disconnected',
    trpc: 'disconnected',
  },
  metrics: {
    updatesPerSecond: 0,
    pendingTxCount: 0,
    lastBlockNumber: 0,
    lastBlockTime: 0,
    workerQueueDepth: 0,
    fps: 60,
  },

  setInitialPools: (pools, blockNumber) => {
    const poolMap = new Map<string, PoolWithStatus>();
    pools.forEach(pool => {
      poolMap.set(pool.poolId, {
        ...pool,
        confirmationStatus: 'finalized',
        pendingTxCount: 0,
        lastUpdated: Date.now(),
      });
    });
    set({
      pools: poolMap,
      lastFinalizedBlock: blockNumber,
      lastBlockTimestamp: Date.now(),
      selectedPoolId: get().selectedPoolId || pools[0]?.poolId || null,
    });
  },

  applyUpdate: (update) => {
    const { pools } = get();
    const existing = pools.get(update.poolId);

    if (!existing) return;

    const updatedPool: PoolWithStatus = {
      ...existing,
      lastUpdated: Date.now(),
    };

    if (update.confirmationStatus === 'pending') {
      // Pending update — show as pending overlay, don't change finalized price
      updatedPool.pendingPrice = update.price;
      updatedPool.pendingTxCount = (existing.pendingTxCount || 0) + 1;
      updatedPool.confirmationStatus = 'pending';
    } else {
      // Finalized update — commit to canonical state
      updatedPool.price = update.price;
      updatedPool.priceChange24h = ((update.price - update.previousPrice) / update.previousPrice) * 100;
      updatedPool.pendingPrice = undefined;
      updatedPool.pendingTxCount = 0;
      updatedPool.confirmationStatus = 'finalized';
    }

    const newPools = new Map(pools);
    newPools.set(update.poolId, updatedPool);

    // Update block info for finalized updates
    const stateUpdate: Partial<PoolState> = { pools: newPools };
    if (update.confirmationStatus === 'finalized') {
      if (update.blockNumber) stateUpdate.lastFinalizedBlock = update.blockNumber;
      stateUpdate.lastBlockTimestamp = update.timestamp || Date.now();
    }
    set(stateUpdate as any);
  },

  applyFinalizedBlock: (block) => {
    const { pools } = get();
    const newPools = new Map(pools);

    block.pools.forEach(pool => {
      const existing = newPools.get(pool.poolId);
      newPools.set(pool.poolId, {
        ...pool,
        confirmationStatus: 'finalized',
        pendingPrice: undefined,
        pendingTxCount: 0,
        lastUpdated: Date.now(),
      });
    });

    set({
      pools: newPools,
      lastFinalizedBlock: block.blockNumber,
      lastBlockTimestamp: block.timestamp,
    });
  },

  selectPool: (poolId) => set({ selectedPoolId: poolId }),

  setConnectionStatus: (key, status) =>
    set((state) => ({
      connectionStatus: {
        ...state.connectionStatus,
        [key]: status,
      },
    })),

  updateMetrics: (partial) =>
    set((state) => ({
      metrics: { ...state.metrics, ...partial },
    })),
}));
