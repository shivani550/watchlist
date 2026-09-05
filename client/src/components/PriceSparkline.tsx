'use client';

import React from 'react';
import { HistoricalDataPoint } from '@watchlist/shared';

interface PriceSparklineProps {
  data: HistoricalDataPoint[];
  width?: number;
  height?: number;
  isPositive?: boolean;
}

export const PriceSparkline: React.FC<PriceSparklineProps> = ({
  data,
  width = 90,
  height = 28,
  isPositive = true,
}) => {
  if (!data || data.length < 2) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.75rem',
        }}
      >
        —
      </div>
    );
  }

  const prices = data.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  // Compute SVG points
  const points = prices.map((price, idx) => {
    const x = (idx / (prices.length - 1)) * (width - 4) + 2;
    const y = height - 4 - ((price - minPrice) / range) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathData = `M ${points.join(' L ')}`;
  const strokeColor = isPositive ? 'var(--market-up)' : 'var(--market-down)';

  return (
    <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}>
      <path
        d={pathData}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
