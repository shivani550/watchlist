'use client';

import React, { useState, useEffect } from 'react';
import { HistoricalDataPoint, Quote } from '@watchlist/shared';
import { api } from '../lib/api';
import {
  X,
  TrendingUp,
  TrendingDown,
  BarChart2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';

interface StockChartModalProps {
  symbol: string | null;
  quote?: Quote;
  isOpen: boolean;
  onClose: () => void;
}

export const StockChartModal: React.FC<StockChartModalProps> = ({
  symbol,
  quote,
  isOpen,
  onClose,
}) => {
  const [history, setHistory] = useState<HistoricalDataPoint[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<HistoricalDataPoint | null>(null);

  useEffect(() => {
    if (!isOpen || !symbol) {
      setHistory([]);
      setError(null);
      setHoveredPoint(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    api
      .getHistory(symbol)
      .then((res) => {
        if (isMounted) {
          setHistory(res.history || []);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load historical price chart');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, symbol]);

  if (!isOpen || !symbol) return null;

  const prices = history.map((h) => h.price);
  const hasValidData = prices.length >= 2;
  const minPrice = hasValidData ? Math.min(...prices) : 0;
  const maxPrice = hasValidData ? Math.max(...prices) : 0;
  const range = maxPrice - minPrice || 1;

  const firstPrice = hasValidData ? prices[0] : 0;
  const lastPrice = hasValidData ? prices[prices.length - 1] : 0;
  const periodChange = lastPrice - firstPrice;
  const periodChangePercent = firstPrice > 0 ? (periodChange / firstPrice) * 100 : 0;
  const isPositiveTrend = periodChange >= 0;

  // Chart dimensions
  const chartWidth = 580;
  const chartHeight = 240;
  const paddingX = 20;
  const paddingY = 24;

  const getCoordinates = (index: number, price: number) => {
    const x = paddingX + (index / (prices.length - 1)) * (chartWidth - 2 * paddingX);
    const y = chartHeight - paddingY - ((price - minPrice) / range) * (chartHeight - 2 * paddingY);
    return { x, y };
  };

  const points = hasValidData
    ? prices.map((price, idx) => {
        const { x, y } = getCoordinates(idx, price);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
    : [];

  const linePath = points.length > 0 ? `M ${points.join(' L ')}` : '';
  const areaPath =
    points.length > 0
      ? `M ${points[0]} L ${points.join(' L ')} L ${chartWidth - paddingX},${chartHeight - paddingY} L ${paddingX},${chartHeight - paddingY} Z`
      : '';

  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p);

  const formatDate = (tsStr: string) => {
    try {
      const d = new Date(tsStr);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return tsStr;
    }
  };

  const strokeColor = isPositiveTrend ? 'var(--market-up)' : 'var(--market-down)';
  const gradientId = `chart-gradient-${symbol}-${isPositiveTrend ? 'green' : 'red'}`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--modal-overlay)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '660px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          padding: '1.75rem',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3
                style={{
                  fontSize: '1.35rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  letterSpacing: '0.01em',
                }}
              >
                {symbol}
              </h3>
              {quote?.sector && (
                <span
                  style={{
                    fontSize: '0.725rem',
                    fontWeight: 500,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {quote.sector}
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
              {quote?.name || `${symbol} Corporation`}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontSize: '1.35rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                ₹
                {hoveredPoint
                  ? formatPrice(hoveredPoint.price)
                  : quote?.price
                  ? formatPrice(quote.price)
                  : lastPrice
                  ? formatPrice(lastPrice)
                  : '—'}
              </div>
              <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {hoveredPoint ? formatDate(hoveredPoint.timestamp) : 'Historical Snapshot: 30D'}
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                color: 'var(--text-muted)',
                padding: '6px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: 'var(--bg-secondary)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.backgroundColor = 'var(--border-card)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
              }}
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Period Return Pill */}
        {hasValidData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 10px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: isPositiveTrend ? 'var(--market-up-light)' : 'var(--market-down-light)',
                color: isPositiveTrend ? 'var(--market-up)' : 'var(--market-down)',
                fontSize: '0.8rem',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {isPositiveTrend ? (
                <TrendingUp size={14} strokeWidth={2.5} />
              ) : (
                <TrendingDown size={14} strokeWidth={2.5} />
              )}
              {isPositiveTrend ? '+' : ''}
              {formatPrice(periodChange)} ({periodChangePercent >= 0 ? '+' : ''}
              {periodChangePercent.toFixed(2)}%)
            </span>
            <span style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
              over 30-day historical window
            </span>
          </div>
        )}

        {/* Chart Canvas Area */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            position: 'relative',
            minHeight: '260px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {loading ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  border: '2px solid var(--border-subtle)',
                  borderTopColor: 'var(--accent-blue)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span>Loading historical price data...</span>
            </div>
          ) : error ? (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--market-down)',
                fontSize: '0.875rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={24} />
              <p>{error}</p>
              <button
                onClick={() => {
                  setLoading(true);
                  api
                    .getHistory(symbol)
                    .then((r) => setHistory(r.history))
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
                style={{
                  marginTop: '0.25rem',
                  padding: '5px 12px',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                  border: '1px solid var(--border-card)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={13} />
                Retry
              </button>
            </div>
          ) : history.length === 0 ? (
            /* Missing History State */
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <BarChart2 size={32} color="var(--text-muted)" strokeWidth={1.5} />
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No historical data available</p>
              <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                Price history will accumulate as market ingestion cycles run.
              </p>
            </div>
          ) : history.length === 1 ? (
            /* Insufficient History State (<2 data points) */
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <BarChart2 size={32} color="var(--text-muted)" strokeWidth={1.5} />
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Insufficient price history</p>
              <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)', maxWidth: '340px' }}>
                Only 1 data point recorded (₹{formatPrice(history[0].price)} at {formatDate(history[0].timestamp)}). Trend chart requires at least 2 points.
              </p>
            </div>
          ) : (
            /* Render Full Interactive SVG Chart */
            <div style={{ width: '100%', position: 'relative' }}>
              {/* Min/Max Price Labels */}
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  right: '6px',
                  fontSize: '0.725rem',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                High: ₹{formatPrice(maxPrice)}
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '6px',
                  fontSize: '0.725rem',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                Low: ₹{formatPrice(minPrice)}
              </div>

              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={isPositiveTrend ? '#10b981' : '#f87171'}
                      stopOpacity="0.28"
                    />
                    <stop
                      offset="100%"
                      stopColor={isPositiveTrend ? '#10b981' : '#f87171'}
                      stopOpacity="0.0"
                    />
                  </linearGradient>
                </defs>

                {/* Subtle Grid Lines */}
                <line
                  x1={paddingX}
                  y1={paddingY}
                  x2={chartWidth - paddingX}
                  y2={paddingY}
                  stroke="var(--chart-grid)"
                  strokeDasharray="4 4"
                />
                <line
                  x1={paddingX}
                  y1={chartHeight / 2}
                  x2={chartWidth - paddingX}
                  y2={chartHeight / 2}
                  stroke="var(--chart-grid)"
                  strokeDasharray="4 4"
                />
                <line
                  x1={paddingX}
                  y1={chartHeight - paddingY}
                  x2={chartWidth - paddingX}
                  y2={chartHeight - paddingY}
                  stroke="var(--chart-grid)"
                  strokeDasharray="4 4"
                />

                {/* Gradient Area Fill */}
                <path d={areaPath} fill={`url(#${gradientId})`} />

                {/* Trendline */}
                <path
                  d={linePath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Data Points / Interactive Hover Targets */}
                {history.map((pt, idx) => {
                  const { x, y } = getCoordinates(idx, pt.price);
                  const isHovered = hoveredPoint === pt;

                  return (
                    <g key={pt.timestamp}>
                      {/* Invisible hover hitbox */}
                      <circle
                        cx={x}
                        cy={y}
                        r={12}
                        fill="transparent"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredPoint(pt)}
                      />
                      {/* Visible circle on hover */}
                      {isHovered && (
                        <>
                          <circle cx={x} cy={y} r={5} fill={strokeColor} />
                          <circle cx={x} cy={y} r={9} fill={strokeColor} opacity={0.25} />
                          <line
                            x1={x}
                            y1={paddingY}
                            x2={x}
                            y2={chartHeight - paddingY}
                            stroke="var(--accent-blue)"
                            strokeDasharray="2 2"
                            strokeOpacity={0.6}
                          />
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
