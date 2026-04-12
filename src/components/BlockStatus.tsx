/**
 * BlockStatus — Status bar showing connection health, block info, and metrics.
 */

'use client';

import { usePoolStore } from '@/stores/pool-store';

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return '--';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function BlockStatus() {
  const connectionStatus = usePoolStore(s => s.connectionStatus);
  const metrics = usePoolStore(s => s.metrics);
  const lastFinalizedBlock = usePoolStore(s => s.lastFinalizedBlock);
  const lastBlockTimestamp = usePoolStore(s => s.lastBlockTimestamp);

  return (
    <footer className="status-bar" id="status-bar">
      <div className="status-bar__left">
        {/* RPC Status */}
        <div className="status-bar__item">
          <div className={`status-bar__dot status-bar__dot--${connectionStatus.rpc}`} />
          <span className="status-bar__label">RPC</span>
        </div>

        {/* WebSocket Status */}
        <div className="status-bar__item">
          <div className={`status-bar__dot status-bar__dot--${connectionStatus.mempool}`} />
          <span className="status-bar__label">Mempool</span>
        </div>

        {/* tRPC Subscription */}
        <div className="status-bar__item">
          <div className={`status-bar__dot status-bar__dot--${connectionStatus.trpc}`} />
          <span className="status-bar__label">Stream</span>
        </div>

        {/* Block Info */}
        <div className="status-bar__item">
          <span className="status-bar__label">Block</span>
          <span className="status-bar__value">#{lastFinalizedBlock || '--'}</span>
        </div>

        <div className="status-bar__item">
          <span className="status-bar__label">Finalized</span>
          <span className="status-bar__value">{formatTimeAgo(lastBlockTimestamp)}</span>
        </div>
      </div>

      <div className="status-bar__right">
        {/* Pending Count */}
        <div className="status-bar__item">
          <span className="status-bar__label">Pending</span>
          <span className="status-bar__value">{metrics.pendingTxCount}</span>
        </div>

        {/* Update Rate */}
        <div className="status-bar__item">
          <span className="status-bar__label">Rate</span>
          <span className="status-bar__value--highlight">{metrics.updatesPerSecond}/s</span>
        </div>

        {/* FPS */}
        <div className="status-bar__item">
          <span className="status-bar__label">FPS</span>
          <span className={`status-bar__value ${metrics.fps < 30 ? 'text-negative' : metrics.fps < 50 ? 'text-pending' : ''}`}>
            {metrics.fps}
          </span>
        </div>
      </div>
    </footer>
  );
}
