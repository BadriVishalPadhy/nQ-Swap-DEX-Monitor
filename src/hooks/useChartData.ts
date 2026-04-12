/**
 * useChartData Hook — Provides formatted candlestick data for the chart component.
 * 
 * - Selectively subscribes to chart store for the selected pool only
 * - Handles initial history generation via the worker
 * - Manages interval switching
 */

'use client';

import { useEffect, useCallback, useState } from 'react';
import { useChartStore } from '@/stores/chart-store';
import { usePoolStore } from '@/stores/pool-store';
import type { CandlestickData, CandleInterval } from '@/lib/types';
import type { WorkerAPI } from '@/workers/data-processor.worker';
import type { Remote } from 'comlink';

const BASE_PRICES: Record<string, number> = {
  'pool-1': 3200,
  'pool-2': 68000,
  'pool-3': 0.047,
  'pool-4': 145,
  'pool-5': 38,
  'pool-6': 1.15,
  'pool-7': 0.0045,
  'pool-8': 7.8,
  'pool-9': 0.72,
  'pool-10': 0.032,
};

const EMPTY_CANDLES: CandlestickData[] = [];

export function useChartData(workerApi: Remote<WorkerAPI> | null) {
  const selectedPoolId = usePoolStore(s => s.selectedPoolId);
  const confirmedCandles = useChartStore(s => {
    if (!selectedPoolId) return EMPTY_CANDLES;
    return s.confirmedCandles.get(selectedPoolId) ?? EMPTY_CANDLES;
  });
  const pendingCandle = useChartStore(s => {
    if (!selectedPoolId) return null;
    return s.pendingCandle.get(selectedPoolId) ?? null;
  });
  const selectedInterval = useChartStore(s => s.selectedInterval);
  const setConfirmedCandles = useChartStore(s => s.setConfirmedCandles);
  const setIntervalAction = useChartStore(s => s.setInterval);

  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);

  // Generate initial history when pool is selected
  useEffect(() => {
    if (!selectedPoolId || !workerApi) return;

    const loadHistory = async () => {
      try {
        const basePrice = BASE_PRICES[selectedPoolId] || 100;
        const history = await workerApi.generateHistory(selectedPoolId, basePrice, 100);
        setConfirmedCandles(selectedPoolId, history as CandlestickData[]);
        setIsHistoryLoaded(true);
      } catch (err) {
        console.error('[useChartData] Failed to generate history:', err);
      }
    };

    setIsHistoryLoaded(false);
    loadHistory();
  }, [selectedPoolId, workerApi, setConfirmedCandles]);

  // Handle interval change
  const changeInterval = useCallback(async (interval: CandleInterval) => {
    if (!workerApi) return;

    setIntervalAction(interval);
    await workerApi.setInterval(interval);

    // Regenerate history for new interval
    if (selectedPoolId) {
      const basePrice = BASE_PRICES[selectedPoolId] || 100;
      const history = await workerApi.generateHistory(selectedPoolId, basePrice, 100);
      setConfirmedCandles(selectedPoolId, history as CandlestickData[]);
    }
  }, [workerApi, selectedPoolId, setIntervalAction, setConfirmedCandles]);

  return {
    candles: confirmedCandles,
    pendingCandle,
    selectedInterval,
    changeInterval,
    isHistoryLoaded,
    selectedPoolId,
  };
}
