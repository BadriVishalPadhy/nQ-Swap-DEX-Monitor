/**
 * Dashboard — Main application shell that assembles all components.
 * 
 * Orchestrates:
 * - Web Worker lifecycle
 * - tRPC subscriptions
 * - FPS monitoring
 * - Keyboard shortcuts
 * - Initial data loading
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { trpc } from '@/lib/trpc-client';
import { useWorker } from '@/hooks/useWorker';
import { usePoolSubscription } from '@/hooks/usePoolSubscription';
import { useChartData } from '@/hooks/useChartData';
import { usePoolStore } from '@/stores/pool-store';
import { PoolTable } from './PoolTable';
import { CandlestickChart } from './CandlestickChart';
import { BlockStatus } from './BlockStatus';
import { StressTestPanel } from './StressTestPanel';
import type { CandleInterval } from '@/lib/types';

const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h'];

export function Dashboard() {
  const [stressPanelOpen, setStressPanelOpen] = useState(false);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now() });

  // Worker
  const { isReady: isWorkerReady, api: workerApi } = useWorker();

  // Pool subscription (routes data through worker)
  usePoolSubscription({ workerApi, isWorkerReady });

  // Chart data
  const { candles, pendingCandle, selectedInterval, changeInterval, selectedPoolId } =
    useChartData(workerApi);

  // Store selectors
  const pools = usePoolStore(s => s.pools);
  const selectedPool = usePoolStore(s =>
    s.selectedPoolId ? s.pools.get(s.selectedPoolId) : null
  );
  const setInitialPools = usePoolStore(s => s.setInitialPools);
  const updateMetrics = usePoolStore(s => s.updateMetrics);

  // Initial data fetch
  const { data: initialData } = trpc.pools.getAll.useQuery(undefined, {
    refetchInterval: 15000, // Refresh every 15s as backup
  });

  useEffect(() => {
    if (initialData?.pools?.length) {
      setInitialPools(initialData.pools, initialData.blockNumber);
    }
  }, [initialData, setInitialPools]);

  // Periodic metrics fetch
  const { data: metricsData } = trpc.pools.getMetrics.useQuery(undefined, {
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (metricsData) {
      updateMetrics({
        pendingTxCount: metricsData.pendingTxCount,
        lastBlockNumber: metricsData.lastBlockNumber,
        lastBlockTime: metricsData.lastBlockTime,
      });
      // Update connection status
      const store = usePoolStore.getState();
      store.setConnectionStatus('rpc', metricsData.rpcStatus as 'connected' | 'disconnected' | 'error');
    }
  }, [metricsData, updateMetrics]);

  // FPS monitoring
  useEffect(() => {
    let animationId: number;

    const measureFps = () => {
      fpsRef.current.frames++;
      const now = performance.now();
      const elapsed = now - fpsRef.current.lastTime;

      if (elapsed >= 1000) {
        const fps = Math.round((fpsRef.current.frames / elapsed) * 1000);
        updateMetrics({ fps });
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = now;
      }

      animationId = requestAnimationFrame(measureFps);
    };

    animationId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(animationId);
  }, [updateMetrics]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+D to toggle stress test panel
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setStressPanelOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Pool label for chart header
  const poolLabel = selectedPool
    ? `${selectedPool.token0}/${selectedPool.token1}`
    : '';

  const displayPrice = selectedPool
    ? selectedPool.confirmationStatus === 'pending' && selectedPool.pendingPrice
      ? selectedPool.pendingPrice
      : selectedPool.price
    : 0;

  const isPending = selectedPool?.confirmationStatus === 'pending';

  return (
    <div className="dashboard" id="dashboard">
      {/* Header */}
      <header className="header" id="header">
        <div className="header__brand">
          <div className="header__logo">nQ</div>
          <div>
            <div className="header__title">nQ-Swap Monitor</div>
            <div className="header__subtitle">Real-time DEX Analytics</div>
          </div>
        </div>

        <div className="header__controls">
          {/* Interval Selector */}
          <div className="header__interval-group" id="interval-selector">
            {INTERVALS.map(interval => (
              <button
                key={interval}
                className={`header__interval-btn ${selectedInterval === interval ? 'header__interval-btn--active' : ''}`}
                onClick={() => changeInterval(interval)}
                id={`interval-${interval}`}
              >
                {interval}
              </button>
            ))}
          </div>

          {/* Stress Test Toggle */}
          <button
            className={`header__stress-btn ${stressPanelOpen ? 'header__stress-btn--active' : ''}`}
            onClick={() => setStressPanelOpen(prev => !prev)}
            id="stress-test-toggle"
          >
            ⚡ Stress Test
          </button>
        </div>
      </header>

      {/* Sidebar — Pool Table */}
      <PoolTable />

      {/* Main — Chart Area */}
      <main className="main" id="main-area">
        {/* Chart Header */}
        {selectedPool && (
          <div className="chart-header" id="chart-header">
            <div className="chart-header__pool-info">
              <span className="chart-header__pair">{poolLabel}</span>
              <span
                className={`chart-header__price ${
                  isPending
                    ? 'chart-header__price--pending'
                    : (selectedPool.priceChange24h || 0) >= 0
                      ? 'chart-header__price--positive'
                      : 'chart-header__price--negative'
                }`}
              >
                {formatPriceDisplay(displayPrice)}
              </span>
              <span
                className={`chart-header__change ${(selectedPool.priceChange24h || 0) >= 0 ? 'text-positive' : 'text-negative'}`}
              >
                {(selectedPool.priceChange24h || 0) >= 0 ? '+' : ''}
                {(selectedPool.priceChange24h || 0).toFixed(2)}%
              </span>
            </div>

            <div
              className={`chart-header__confirmation ${isPending ? 'chart-header__confirmation--pending' : 'chart-header__confirmation--finalized'}`}
            >
              <div
                className={`chart-header__confirmation-dot ${isPending ? 'chart-header__confirmation-dot--pending' : 'chart-header__confirmation-dot--finalized'}`}
              />
              {isPending ? 'Pending Confirmation' : 'Finalized'}
            </div>
          </div>
        )}

        {/* Candlestick Chart */}
        <CandlestickChart
          candles={candles}
          pendingCandle={pendingCandle}
          selectedInterval={selectedInterval}
          poolId={selectedPoolId}
          poolLabel={poolLabel}
        />
      </main>

      {/* Status Bar */}
      <BlockStatus />

      {/* Stress Test Panel */}
      <StressTestPanel
        isOpen={stressPanelOpen}
        onClose={() => setStressPanelOpen(false)}
      />
    </div>
  );
}

function formatPriceDisplay(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(6)}`;
  return `$${price.toPrecision(4)}`;
}
