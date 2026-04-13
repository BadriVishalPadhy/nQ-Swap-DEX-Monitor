/**
 * PoolCard — Displays a single pool with pending/confirmed visual states.
 * 
 * Block Confirmation Guard UI:
 * - Finalized prices: white text, stable
 * - Pending prices: amber text with pulse animation and "PENDING" badge
 */

'use client';

import { memo, useCallback } from 'react';
import type { PoolWithStatus } from '@/lib/types';

interface PoolCardProps {
  pool: PoolWithStatus;
  isSelected: boolean;
  onSelect: (poolId: string) => void;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toPrecision(4);
}

function formatCompact(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function PoolCardComponent({ pool, isSelected, onSelect }: PoolCardProps) {
  const handleClick = useCallback(() => {
    onSelect(pool.poolId);
  }, [pool.poolId, onSelect]);

  const isPending = pool.confirmationStatus === 'pending';
  const displayPrice = isPending && pool.pendingPrice ? pool.pendingPrice : pool.price;
  const change = pool.priceChange24h;

  return (
    <div
      className={`pool-card ${isSelected ? 'pool-card--selected' : ''} ${isPending ? 'pool-card--pending' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      id={`pool-card-${pool.poolId}`}
    >
      {/* Row 1: Pair name + Price */}
      <div className="pool-card__pair">
        <span>{pool.token0}</span>
        <span className="pool-card__pair-separator">/</span>
        <span>{pool.token1}</span>
        {isPending && (
          <span className="pool-card__pending-badge">
            <span className="pool-card__pending-dot" />
            PENDING
          </span>
        )}
      </div>

      <div className={`pool-card__price ${isPending ? 'pool-card__price--pending' : 'pool-card__price--confirmed'}`}>
        {formatPrice(displayPrice)}
      </div>

      <div className={`pool-card__change ${change >= 0 ? 'pool-card__change--positive' : 'pool-card__change--negative'}`}>
        {change >= 0 ? '+' : ''}{change.toFixed(2)}%
      </div>
    </div>
  );
}

export const PoolCard = memo(PoolCardComponent);
