'use client';

import React from 'react';
import { WatchlistItem, Quote, MarketSignalEvent, StockSparklineData } from '@watchlist/shared';
import { GhostSparkline } from './GhostSparkline';
import {
  TrendingUp,
  TrendingDown,
  LineChart,
  Trash2,
  Plus,
  Inbox,
  Zap,
} from 'lucide-react';

interface StockTableProps {
  items: WatchlistItem[];
  quotesMap: Record<string, Quote>;
  activeSignalsMap?: Record<string, MarketSignalEvent>;
  sparklinesMap?: Record<string, StockSparklineData>;
  selectedSymbol?: string | null;
  loading: boolean;
  onRemoveStock: (symbol: string) => Promise<any>;
  onOpenAddModal: () => void;
  onSelectStock: (symbol: string, quote?: Quote) => void;
  onOpenSignal?: (signal: MarketSignalEvent) => void;
  onOpenHistory?: (symbol: string) => void;
}

export const StockTable: React.FC<StockTableProps> = ({
  items,
  quotesMap,
  activeSignalsMap = {},
  sparklinesMap = {},
  selectedSymbol,
  loading,
  onRemoveStock,
  onOpenAddModal,
  onSelectStock,
  onOpenSignal,
}) => {
  const [flashingSymbols, setFlashingSymbols] = React.useState<Record<string, 'up' | 'down'>>({});
  const prevPricesRef = React.useRef<Record<string, number>>({});

  // Detect real-time price ticks and trigger subtle green/red flash
  React.useEffect(() => {
    const newFlashes: Record<string, 'up' | 'down'> = {};
    let hasChanges = false;

    for (const [sym, quote] of Object.entries(quotesMap)) {
      if (quote && typeof quote.price === 'number') {
        const prev = prevPricesRef.current[sym];
        if (prev !== undefined && prev !== quote.price) {
          newFlashes[sym] = quote.price > prev ? 'up' : 'down';
          hasChanges = true;
        }
        prevPricesRef.current[sym] = quote.price;
      }
    }

    if (hasChanges) {
      setFlashingSymbols((prev) => ({ ...prev, ...newFlashes }));
      const timer = setTimeout(() => {
        setFlashingSymbols((prev) => {
          const next = { ...prev };
          for (const sym of Object.keys(newFlashes)) {
            delete next[sym];
          }
          return next;
        });
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [quotesMap]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  // Loading skeleton state
  if (loading && items.length === 0) {
    return (
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-card)',
          overflow: 'hidden',
          padding: '1rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-secondary)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div
        className="animate-fade-in"
        style={{
          padding: '3.5rem 1.5rem',
          textAlign: 'center',
          backgroundColor: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--border-card)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
        >
          <Inbox size={24} strokeWidth={1.75} />
        </div>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Your watchlist is empty
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '340px', lineHeight: 1.45 }}>
            Add stocks like RELIANCE, TCS, or NVDA to start tracking live prices, trends, and market signals.
          </p>
        </div>
        <button
          onClick={onOpenAddModal}
          style={{
            marginTop: '0.25rem',
            padding: '0.55rem 1.1rem',
            backgroundColor: 'var(--brand-primary)',
            color: '#ffffff',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: '0.825rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--brand-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--brand-primary)')}
        >
          <Plus size={14} strokeWidth={2.5} />
          Add Your First Stock
        </button>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-card)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', tableLayout: 'auto' }}>
        <thead>
          <tr
            style={{
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-secondary)',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <th style={{ padding: '0.65rem 0.85rem' }}>Company / Symbol</th>
            <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right' }}>Price</th>
            <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left' }}>7D Trend</th>
            <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right' }}>24H Change</th>
            <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right', width: '90px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const cleanSym = item.symbol.toUpperCase();
            const quote = quotesMap[cleanSym];
            const activeSignal = activeSignalsMap[cleanSym];
            const isPositive = quote ? quote.change >= 0 : false;
            const hasPrice = quote && typeof quote.price === 'number';
            const isSelected = selectedSymbol?.toUpperCase() === cleanSym;

            return (
              <tr
                key={item.id}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  borderLeft: isSelected ? '3px solid var(--accent-blue)' : '3px solid transparent',
                  backgroundColor: isSelected ? 'var(--accent-blue-light)' : 'transparent',
                  transition: 'all 0.15s ease',
                  cursor: 'pointer',
                  height: '60px',
                }}
                onClick={() => onSelectStock(item.symbol, quote)}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {/* Symbol & Name */}
                <td style={{ padding: '0.6rem 0.85rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.875rem',
                          color: 'var(--text-primary)',
                          letterSpacing: '0.01em',
                        }}
                      >
                        {item.symbol}
                      </span>

                      {/* Active Market Signal Pill */}
                      {activeSignal && (
                        <button
                          type="button"
                          title="Active Market Signal — Click to view details"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSignal?.(activeSignal);
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '1px 5px',
                            borderRadius: 'var(--radius-full)',
                            backgroundColor: 'var(--accent-blue-light)',
                            color: 'var(--accent-blue)',
                            border: '1px solid var(--accent-blue-border)',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            gap: '2px',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--accent-blue)';
                            e.currentTarget.style.color = '#ffffff';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--accent-blue-light)';
                            e.currentTarget.style.color = 'var(--accent-blue)';
                          }}
                        >
                          <Zap size={10} strokeWidth={2.5} />
                          <span>Signal</span>
                        </button>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '0.725rem',
                        color: 'var(--text-secondary)',
                        marginTop: '1px',
                        maxWidth: '160px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {quote?.name || `${item.symbol} Corporation`}
                    </span>
                  </div>
                </td>

                {/* Price */}
                <td style={{ padding: '0.6rem 0.85rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {hasPrice ? (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        fontVariantNumeric: 'tabular-nums',
                        color: flashingSymbols[cleanSym] === 'up'
                          ? 'var(--market-up)'
                          : flashingSymbols[cleanSym] === 'down'
                          ? 'var(--market-down)'
                          : 'var(--text-primary)',
                        backgroundColor: flashingSymbols[cleanSym] === 'up'
                          ? 'var(--market-up-light)'
                          : flashingSymbols[cleanSym] === 'down'
                          ? 'var(--market-down-light)'
                          : 'transparent',
                        transition: 'all 0.3s ease',
                      }}
                    >
                      ₹{formatPrice(quote.price)}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.775rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      —
                    </span>
                  )}
                </td>

                {/* 7D Trend / Ghost Pin */}
                <td style={{ padding: '0.5rem 0.85rem', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                  <GhostSparkline data={sparklinesMap[cleanSym]} width={96} height={24} />
                </td>

                {/* Absolute & Percentage Change */}
                <td style={{ padding: '0.6rem 0.85rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {hasPrice ? (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: isPositive ? 'var(--market-up-light)' : 'var(--market-down-light)',
                        color: isPositive ? 'var(--market-up)' : 'var(--market-down)',
                        fontWeight: 700,
                        fontSize: '0.775rem',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {isPositive ? (
                        <TrendingUp size={12} strokeWidth={2.5} />
                      ) : (
                        <TrendingDown size={12} strokeWidth={2.5} />
                      )}
                      <span>
                        {isPositive ? '+' : ''}
                        {quote.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                  )}
                </td>

                {/* Actions (Chart & Remove) */}
                <td style={{ padding: '0.6rem 0.85rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                    <button
                      title={`View ${item.symbol} Historical Chart`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectStock(item.symbol, quote);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '4px 7px',
                        backgroundColor: 'var(--accent-blue-light)',
                        border: '1px solid var(--accent-blue-border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--accent-blue-text)',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--accent-blue)';
                        e.currentTarget.style.color = '#ffffff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--accent-blue-light)';
                        e.currentTarget.style.color = 'var(--accent-blue-text)';
                      }}
                    >
                      <LineChart size={12} strokeWidth={2.2} />
                      <span>Chart</span>
                    </button>

                    <button
                      title={`Remove ${item.symbol}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveStock(item.symbol);
                      }}
                      style={{
                        padding: '4px 6px',
                        color: 'var(--text-muted)',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        backgroundColor: 'transparent',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--market-down)';
                        e.currentTarget.style.backgroundColor = 'var(--market-down-light)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--text-muted)';
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
