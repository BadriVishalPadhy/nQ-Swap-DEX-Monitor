/**
 * Chart Store — Zustand store for candlestick chart data.
 * 
 * Separates confirmed candles from the pending (live) candle.
 * The chart only commits data points from confirmed candles;
 * the pending candle is rendered with a distinct visual style.
 */

import { create } from 'zustand';
import type { CandlestickData, CandleInterval } from '@/lib/types';

interface ChartState {
  // OHLC data per pool
  confirmedCandles: Map<string, CandlestickData[]>;
  pendingCandle: Map<string, CandlestickData | null>;

  // Settings
  selectedInterval: CandleInterval;
  maxCandles: number;

  // Actions
  setConfirmedCandles: (poolId: string, candles: CandlestickData[]) => void;
  addConfirmedCandle: (poolId: string, candle: CandlestickData) => void;
  setPendingCandle: (poolId: string, candle: CandlestickData | null) => void;
  setInterval: (interval: CandleInterval) => void;
  clearPool: (poolId: string) => void;
}

export const useChartStore = create<ChartState>((set, get) => ({
  confirmedCandles: new Map(),
  pendingCandle: new Map(),
  selectedInterval: '1m',
  maxCandles: 200,

  setConfirmedCandles: (poolId, candles) => {
    const { confirmedCandles, maxCandles } = get();
    const newMap = new Map(confirmedCandles);
    // Keep only the last maxCandles
    newMap.set(poolId, candles.slice(-maxCandles));
    set({ confirmedCandles: newMap });
  },

  addConfirmedCandle: (poolId, candle) => {
    const { confirmedCandles, maxCandles } = get();
    const existing = confirmedCandles.get(poolId) || [];
    const newMap = new Map(confirmedCandles);

    // Check if we need to update the last candle or add a new one
    const last = existing[existing.length - 1];
    if (last && last.time === candle.time) {
      // Update existing candle
      const updated = [...existing];
      updated[updated.length - 1] = candle;
      newMap.set(poolId, updated.slice(-maxCandles));
    } else {
      // Add new candle
      newMap.set(poolId, [...existing, candle].slice(-maxCandles));
    }

    set({ confirmedCandles: newMap });
  },

  setPendingCandle: (poolId, candle) => {
    const { pendingCandle } = get();
    const newMap = new Map(pendingCandle);
    newMap.set(poolId, candle);
    set({ pendingCandle: newMap });
  },

  setInterval: (interval) => {
    set({
      selectedInterval: interval,
      confirmedCandles: new Map(),
      pendingCandle: new Map(),
    });
  },

  clearPool: (poolId) => {
    const { confirmedCandles, pendingCandle } = get();
    const newConfirmed = new Map(confirmedCandles);
    const newPending = new Map(pendingCandle);
    newConfirmed.delete(poolId);
    newPending.delete(poolId);
    set({ confirmedCandles: newConfirmed, pendingCandle: newPending });
  },
}));
