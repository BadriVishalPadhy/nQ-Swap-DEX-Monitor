/**
 * usePoolSubscription Hook — Manages tRPC WebSocket subscription lifecycle.
 * 
 * Architecture:
 * - Subscribes to pool.onUpdate via tRPC WebSocket
 * - Routes incoming data through the Web Worker for processing
 * - Worker processes OHLC aggregation off-main-thread
 * - Updates Zustand stores with processed results
 * - Throttles store updates to prevent render thrashing
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc-client';
import { usePoolStore } from '@/stores/pool-store';
import { useChartStore } from '@/stores/chart-store';
import type { WorkerAPI } from '@/workers/data-processor.worker';
import type { Remote } from 'comlink';

interface UsePoolSubscriptionOptions {
  workerApi: Remote<WorkerAPI> | null;
  isWorkerReady: boolean;
}

export function usePoolSubscription({ workerApi, isWorkerReady }: UsePoolSubscriptionOptions) {
  const applyUpdate = usePoolStore(s => s.applyUpdate);
  const setConfirmedCandles = useChartStore(s => s.setConfirmedCandles);
  const addConfirmedCandle = useChartStore(s => s.addConfirmedCandle);
  const setPendingCandle = useChartStore(s => s.setPendingCandle);
  const selectedPoolId = usePoolStore(s => s.selectedPoolId);

  // Throttle pending chart updates to 60fps
  const lastChartUpdate = useRef(0);
  const pendingChartUpdates = useRef<Map<string, unknown>>(new Map());
  const rafRef = useRef<number | null>(null);
  const updateCountRef = useRef(0);
  const lastMetricUpdate = useRef(Date.now());

  // Track updates per second
  const trackUpdate = useCallback(() => {
    updateCountRef.current++;
    const now = Date.now();
    if (now - lastMetricUpdate.current >= 1000) {
      usePoolStore.getState().updateMetrics({
        updatesPerSecond: updateCountRef.current,
      });
      updateCountRef.current = 0;
      lastMetricUpdate.current = now;
    }
  }, []);

  // Process chart update through worker (throttled to 60fps)
  const processChartUpdate = useCallback(async (
    poolId: string,
    price: number,
    amount: number,
    timestamp: number,
    confirmationStatus: 'pending' | 'confirmed' | 'finalized'
  ) => {
    if (!workerApi) return;

    try {
      const result = await workerApi.processTick({
        poolId,
        price,
        amount: amount || 0,
        timestamp,
        confirmationStatus,
      });

      // Only update chart for the selected pool
      if (poolId === usePoolStore.getState().selectedPoolId) {
        const now = performance.now();
        if (now - lastChartUpdate.current >= 16) { // ~60fps
          lastChartUpdate.current = now;

          if (result.confirmedCandle && result.isNewCandle) {
            addConfirmedCandle(poolId, result.confirmedCandle);
          } else if (result.confirmedCandle) {
            // Update the last candle
            addConfirmedCandle(poolId, result.confirmedCandle);
          }

          if (result.pendingCandle) {
            setPendingCandle(poolId, result.pendingCandle);
          } else {
            setPendingCandle(poolId, null);
          }
        }
      }
    } catch (err) {
      // Worker might be terminated during cleanup
    }
  }, [workerApi, addConfirmedCandle, setPendingCandle]);

  // tRPC subscription
  trpc.pools.onUpdate.useSubscription(undefined, {
    enabled: isWorkerReady,
    onData(update) {
      trackUpdate();

      // Update pool store (this is fast — just a Map set)
      applyUpdate(update);

      // Route to worker for OHLC processing (off main thread)
      processChartUpdate(
        update.poolId,
        update.price,
        0, // amount not in PoolUpdate, computed in worker
        update.timestamp,
        update.confirmationStatus
      );
    },
    onError(err) {
      console.error('[Subscription] Error:', err);
      usePoolStore.getState().setConnectionStatus('trpc', 'disconnected');
    },
    onStarted() {
      console.log('[Subscription] Started');
      usePoolStore.getState().setConnectionStatus('trpc', 'connected');
    },
  });

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);
}
