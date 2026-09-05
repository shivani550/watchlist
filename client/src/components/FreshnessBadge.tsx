'use client';

import React from 'react';
import { FreshnessState } from '@watchlist/shared';

interface FreshnessBadgeProps {
  state: FreshnessState;
  timestamp?: string;
  showTooltip?: boolean;
}

export const FreshnessBadge: React.FC<FreshnessBadgeProps> = ({ state, timestamp }) => {
  const getBadgeConfig = () => {
    switch (state) {
      case 'FRESH':
        return {
          label: 'Live',
          bg: 'var(--freshness-fresh-bg)',
          border: 'var(--freshness-fresh-border)',
          color: 'var(--freshness-fresh-text)',
          dot: 'var(--freshness-fresh-dot)',
          tooltip: 'Live market data (< 5m old)',
        };
      case 'DELAYED':
        return {
          label: 'Delayed',
          bg: 'var(--freshness-delayed-bg)',
          border: 'var(--freshness-delayed-border)',
          color: 'var(--freshness-delayed-text)',
          dot: 'var(--freshness-delayed-dot)',
          tooltip: 'Delayed snapshot (5–15m old)',
        };
      case 'STALE':
        return {
          label: 'Closed',
          bg: 'var(--freshness-stale-bg)',
          border: 'var(--freshness-stale-border)',
          color: 'var(--freshness-stale-text)',
          dot: 'var(--freshness-stale-dot)',
          tooltip: 'Market closed or snapshot > 15m old',
        };
      case 'UNAVAILABLE':
      default:
        return {
          label: 'No Data',
          bg: 'var(--freshness-unavailable-bg)',
          border: 'var(--freshness-unavailable-border)',
          color: 'var(--freshness-unavailable-text)',
          dot: 'var(--freshness-unavailable-dot)',
          tooltip: 'No market snapshot available yet',
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <span
      title={config.tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        color: config.color,
        fontSize: '0.72rem',
        fontWeight: 600,
        letterSpacing: '0.01em',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          backgroundColor: config.dot,
        }}
      />
      {config.label}
    </span>
  );
};
