'use client';

import React, { useState } from 'react';
import { StockSparklineData } from '@watchlist/shared';

interface GhostSparklineProps {
  data?: StockSparklineData | null;
  width?: number;
  height?: number;
}

export const GhostSparkline: React.FC<GhostSparklineProps> = ({
  data,
  width = 110,
  height = 32,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<{
    price: number;
    timestamp: string;
    isGhostPin: boolean;
  } | null>(null);

  if (!data || !data.points || data.points.length === 0) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: `${width}px`,
          height: `${height}px`,
          color: 'var(--text-muted)',
          fontSize: '0.75rem',
          fontStyle: 'italic',
        }}
      >
        —
      </div>
    );
  }

  const { points, lastSeenIndex, rangeStatus, sinceLastVisitPercent } = data;

  // Single point case
  if (points.length === 1) {
    return (
      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
        }}
      >
        <svg width={width} height={height} style={{ overflow: 'visible' }}>
          <circle
            cx={width / 2}
            cy={height / 2}
            r={3}
            fill="var(--text-muted)"
          />
        </svg>
      </div>
    );
  }

  // Scale normalized point coords (points are normalized on 0..100 X and 0..30 Y)
  const scaleX = (x: number) => (x / 100) * width;
  const scaleY = (y: number) => (y / 30) * height;

  // Build full polyline SVG points string
  const fullSvgPoints = points
    .map((p) => `${scaleX(p.x)},${scaleY(p.y)}`)
    .join(' ');

  // Base path: entire sparkline or pre-ghost-pin path
  // If there's a range breach and a ghost pin, split the line into pre-visit and post-visit
  const hasBreach = rangeStatus === 'BREAKOUT_HIGH' || rangeStatus === 'BREAKOUT_LOW';
  const hasGhostPin = lastSeenIndex !== null && lastSeenIndex >= 0 && lastSeenIndex < points.length;

  let prePointsStr = fullSvgPoints;
  let postPointsStr = '';

  if (hasGhostPin && hasBreach && lastSeenIndex < points.length - 1) {
    prePointsStr = points
      .slice(0, lastSeenIndex + 1)
      .map((p) => `${scaleX(p.x)},${scaleY(p.y)}`)
      .join(' ');

    postPointsStr = points
      .slice(lastSeenIndex)
      .map((p) => `${scaleX(p.x)},${scaleY(p.y)}`)
      .join(' ');
  }

  const ghostPoint = hasGhostPin ? points[lastSeenIndex!] : null;
  const lastPoint = points[points.length - 1];

  // Colors
  const baseColor = 'var(--text-muted)';
  let breachColor = 'var(--text-muted)';
  if (rangeStatus === 'BREAKOUT_HIGH') {
    breachColor = 'var(--market-up)';
  } else if (rangeStatus === 'BREAKOUT_LOW') {
    breachColor = 'var(--market-down)';
  }

  const isPositiveSinceVisit = sinceLastVisitPercent !== null && sinceLastVisitPercent >= 0;

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '3px',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: `${width}px`,
          height: `${height}px`,
          cursor: 'crosshair',
        }}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ overflow: 'visible' }}
        >
          {/* Base Sparkline Path */}
          <polyline
            fill="none"
            stroke={hasBreach && postPointsStr ? 'var(--border-subtle)' : baseColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={prePointsStr}
            opacity={hasBreach && postPointsStr ? 0.6 : 0.75}
          />

          {/* Emphasized Trailing Breach Segment */}
          {hasBreach && postPointsStr && (
            <polyline
              fill="none"
              stroke={breachColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={postPointsStr}
            />
          )}

          {/* Ghost Pin: Subtle Vertical Dashed Line */}
          {ghostPoint && (
            <line
              x1={scaleX(ghostPoint.x)}
              y1={2}
              x2={scaleX(ghostPoint.x)}
              y2={height - 2}
              stroke="var(--accent-blue)"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.85}
            />
          )}

          {/* Ghost Pin: Blue/Neutral Anchor Dot */}
          {ghostPoint && (
            <circle
              cx={scaleX(ghostPoint.x)}
              cy={scaleY(ghostPoint.y)}
              r={3}
              fill="var(--accent-blue)"
              stroke="var(--bg-card)"
              strokeWidth={1.5}
              style={{ transition: 'r 0.15s ease' }}
            />
          )}

          {/* Current / Last Observation Dot */}
          <circle
            cx={scaleX(lastPoint.x)}
            cy={scaleY(lastPoint.y)}
            r={2.5}
            fill={hasBreach ? breachColor : 'var(--text-primary)'}
          />

          {/* Interactive Invisible Hover Hit Targets for Points */}
          {points.map((p, idx) => (
            <circle
              key={idx}
              cx={scaleX(p.x)}
              cy={scaleY(p.y)}
              r={7}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() =>
                setHoveredPoint({
                  price: p.price,
                  timestamp: p.timestamp,
                  isGhostPin: idx === lastSeenIndex,
                })
              }
            />
          ))}
        </svg>

        {/* Hover Micro Tooltip */}
        {hoveredPoint && (
          <div
            style={{
              position: 'absolute',
              bottom: `${height + 4}px`,
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 6px',
              fontSize: '0.68rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: 'var(--shadow-md)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {hoveredPoint.isGhostPin && (
              <span style={{ color: 'var(--accent-blue)', marginRight: '4px' }}>[Last Visit]</span>
            )}
            ₹{hoveredPoint.price.toFixed(2)}
          </div>
        )}
      </div>

      {/* Sub-row Badges: Since Last Visit & Range Breakout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        {sinceLastVisitPercent !== null && (
          <span
            title={`Movement since your previous visit on ${data.lastSeenPrice ? `₹${data.lastSeenPrice.toFixed(2)}` : 'prior date'}`}
            style={{
              fontSize: '0.675rem',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              padding: '1px 5px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: isPositiveSinceVisit ? 'var(--market-up-light)' : 'var(--market-down-light)',
              color: isPositiveSinceVisit ? 'var(--market-up)' : 'var(--market-down)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            {isPositiveSinceVisit ? '+' : ''}
            {sinceLastVisitPercent.toFixed(1)}% visit
          </span>
        )}

        {rangeStatus === 'BREAKOUT_HIGH' && (
          <span
            title={`Current price exceeded prior 20-day high (₹${data.prior20DayHigh?.toFixed(2)})`}
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--market-up-light)',
              color: 'var(--market-up)',
              border: '1px solid var(--market-up-border, transparent)',
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
            }}
          >
            20D High
          </span>
        )}

        {rangeStatus === 'BREAKOUT_LOW' && (
          <span
            title={`Current price fell below prior 20-day low (₹${data.prior20DayLow?.toFixed(2)})`}
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--market-down-light)',
              color: 'var(--market-down)',
              border: '1px solid var(--market-down-border, transparent)',
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
            }}
          >
            20D Low
          </span>
        )}
      </div>
    </div>
  );
};
