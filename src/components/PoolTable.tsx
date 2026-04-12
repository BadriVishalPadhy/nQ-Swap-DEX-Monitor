/**
 * PoolTable — Sidebar listing the top 10 pools sorted by TVL.
 * 
 * Uses shallow selectors to minimize re-renders.
 * Only the specific pool cards that have changed will re-render.
 */

'use client';

import { useCallback, useMemo } from 'react';
import { usePoolStore } from '@/stores/pool-store';
import { PoolCard } from './PoolCard';
import type { PoolWithStatus } from '@/lib/types';

export function PoolTable() {
  const pools = usePoolStore(s => s.pools);
  const selectedPoolId = usePoolStore(s => s.selectedPoolId);
  const selectPool = usePoolStore(s => s.selectPool);

  // Sort pools by TVL descending and take top 10
  const sortedPools = useMemo(() => {
    const arr = Array.from(pools.values()) as PoolWithStatus[];
    return arr.sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 10);
  }, [pools]);

  const handleSelect = useCallback((poolId: string) => {
    selectPool(poolId);
  }, [selectPool]);

  return (
    <aside className="sidebar" id="pool-sidebar">
      <div className="sidebar__header">
        <h2 className="sidebar__title">Top 10 Pools</h2>
      </div>
      <div className="pool-list">
        {sortedPools.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
            Connecting to data sources...
          </div>
        ) : (
          sortedPools.map(pool => (
            <PoolCard
              key={pool.poolId}
              pool={pool}
              isSelected={selectedPoolId === pool.poolId}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </aside>
  );
}
