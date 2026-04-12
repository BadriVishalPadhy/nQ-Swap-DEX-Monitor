/**
 * Pool Router — tRPC procedures for pool data access and subscriptions.
 * 
 * This is the core of the hybrid data layer:
 * - Queries fetch finalized state from the RPC client
 * - Subscriptions emit merged updates from both mempool and finalized blocks
 * - The Block Confirmation Guard tags each update with its confirmation status
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, publicProcedure } from '../trpc';
import { rpcClient } from '../services/rpc-client';
import { mempoolListener } from '../services/mempool-listener';
import type { PoolUpdate, Block, PendingSwap } from '@/lib/types';

// Start services on first import
let servicesStarted = false;
function ensureServicesStarted() {
  if (servicesStarted) return;
  servicesStarted = true;
  rpcClient.start();
  mempoolListener.start();
}

export const poolRouter = router({
  /**
   * Get all pools with their latest finalized state
   */
  getAll: publicProcedure.query(() => {
    ensureServicesStarted();
    const block = rpcClient.getLastBlock();
    if (!block) {
      return {
        pools: [],
        blockNumber: 0,
        timestamp: Date.now(),
      };
    }
    return {
      pools: block.pools,
      blockNumber: block.blockNumber,
      timestamp: block.timestamp,
    };
  }),

  /**
   * Get a single pool by ID  
   */
  getById: publicProcedure
    .input(z.object({ poolId: z.string() }))
    .query(({ input }) => {
      ensureServicesStarted();
      const block = rpcClient.getLastBlock();
      if (!block) return null;
      return block.pools.find(p => p.poolId === input.poolId) || null;
    }),

  /**
   * Get system metrics
   */
  getMetrics: publicProcedure.query(() => {
    ensureServicesStarted();
    const block = rpcClient.getLastBlock();
    return {
      updatesPerSecond: mempoolListener.getUpdateRate(),
      pendingTxCount: mempoolListener.getPendingCount(),
      lastBlockNumber: block?.blockNumber || 0,
      lastBlockTime: block?.timestamp || 0,
      rpcStatus: rpcClient.getStatus(),
    };
  }),

  /**
   * Set the mempool emission rate (for stress testing)
   */
  setEmissionRate: publicProcedure
    .input(z.object({ rate: z.number().min(1).max(5000) }))
    .mutation(({ input }) => {
      ensureServicesStarted();
      mempoolListener.sendControl({ type: 'set_rate', rate: input.rate });
      return { success: true, rate: input.rate };
    }),

  /**
   * Real-time subscription — The heart of the hybrid data layer.
   * 
   * Emits PoolUpdate events from both:
   * 1. Mempool (pending) — fast but unreliable
   * 2. Finalized blocks (confirmed) — slow but reliable
   * 
   * Each update is tagged with confirmationStatus for the Block Confirmation Guard.
   */
  onUpdate: publicProcedure.subscription(() => {
    ensureServicesStarted();

    return observable<PoolUpdate>((emit) => {
      // Track last known prices for computing deltas
      const lastPrices = new Map<string, number>();
      const block = rpcClient.getLastBlock();
      if (block) {
        block.pools.forEach(p => lastPrices.set(p.poolId, p.price));
      }

      /**
       * Handle pending mempool transactions
       */
      const onPending = (swap: PendingSwap) => {
        const previousPrice = lastPrices.get(swap.poolId) || swap.price;

        emit.next({
          poolId: swap.poolId,
          token0: swap.token0,
          token1: swap.token1,
          price: swap.price,
          previousPrice,
          confirmationStatus: 'pending',
          txHash: swap.txHash,
          timestamp: swap.timestamp,
        });
      };

      /**
       * Handle finalized blocks — this is the source of truth.
       * When a block is finalized:
       * 1. Emit confirmed updates for all pools
       * 2. Reconcile the pending buffer (remove stale txns)
       */
      const onFinalized = (finalizedBlock: Block) => {
        // Reconcile pending buffer
        mempoolListener.reconcileBlock(finalizedBlock.blockNumber);

        // Emit finalized updates for all pools
        finalizedBlock.pools.forEach(pool => {
          const previousPrice = lastPrices.get(pool.poolId) || pool.price;
          lastPrices.set(pool.poolId, pool.price);

          emit.next({
            poolId: pool.poolId,
            token0: pool.token0,
            token1: pool.token1,
            price: pool.price,
            previousPrice,
            confirmationStatus: 'finalized',
            blockNumber: finalizedBlock.blockNumber,
            timestamp: finalizedBlock.timestamp,
          });
        });
      };

      // Subscribe to events
      mempoolListener.on('mempool:pending', onPending);
      rpcClient.on('block:finalized', onFinalized);

      // Cleanup on unsubscribe
      return () => {
        mempoolListener.off('mempool:pending', onPending);
        rpcClient.off('block:finalized', onFinalized);
      };
    });
  }),
});
