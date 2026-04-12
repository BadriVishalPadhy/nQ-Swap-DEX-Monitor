/**
 * StressTestPanel — Developer controls for adjusting WebSocket emission rate
 * and viewing performance metrics. Toggled with Ctrl+Shift+D.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { trpc } from '@/lib/trpc-client';
import { usePoolStore } from '@/stores/pool-store';

interface StressTestPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StressTestPanel({ isOpen, onClose }: StressTestPanelProps) {
  const [rate, setRate] = useState(50);
  const [localRate, setLocalRate] = useState(50);
  const metrics = usePoolStore(s => s.metrics);

  const mutation = trpc.pools.setEmissionRate.useMutation();

  const handleRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newRate = parseInt(e.target.value);
    setLocalRate(newRate);
  }, []);

  const applyRate = useCallback(() => {
    setRate(localRate);
    mutation.mutate({ rate: localRate });
  }, [localRate, mutation]);

  // Debounce slider changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localRate !== rate) {
        setRate(localRate);
        mutation.mutate({ rate: localRate });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localRate]);

  if (!isOpen) return null;

  const fpsStatus = metrics.fps >= 50 ? 'good' : metrics.fps >= 30 ? 'warn' : 'danger';

  return (
    <div className="stress-panel" id="stress-test-panel">
      <div className="stress-panel__title">
        <span className="stress-panel__title-icon">⚡</span>
        Stress Test Controls
      </div>

      <div className="stress-panel__field">
        <div className="stress-panel__label">
          <span>Emission Rate</span>
          <span className="text-mono" style={{ color: 'var(--accent-primary)' }}>
            {localRate}/sec
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="1000"
          value={localRate}
          onChange={handleRateChange}
          className="stress-panel__slider"
          id="emission-rate-slider"
        />
        <div className="stress-panel__label" style={{ marginTop: '4px' }}>
          <span>1/s</span>
          <span>1,000/s</span>
        </div>
      </div>

      <div className="stress-panel__stats">
        <div className="stress-panel__stat">
          <span className="stress-panel__stat-label">FPS</span>
          <span className={`stress-panel__stat-value stress-panel__stat-value--${fpsStatus}`}>
            {metrics.fps}
          </span>
        </div>

        <div className="stress-panel__stat">
          <span className="stress-panel__stat-label">Updates/s</span>
          <span className="stress-panel__stat-value">
            {metrics.updatesPerSecond}
          </span>
        </div>

        <div className="stress-panel__stat">
          <span className="stress-panel__stat-label">Pending TXs</span>
          <span className="stress-panel__stat-value">
            {metrics.pendingTxCount}
          </span>
        </div>

        <div className="stress-panel__stat">
          <span className="stress-panel__stat-label">Worker Queue</span>
          <span className="stress-panel__stat-value">
            {metrics.workerQueueDepth}
          </span>
        </div>
      </div>
    </div>
  );
}
