'use client';

import React, { useState } from 'react';
import { MarketSignalEvent, Quote, CatchUpResponse } from '@watchlist/shared';
import {
  Zap,
  TrendingUp,
  TrendingDown,
  Newspaper,
  ExternalLink,
  Clock,
  History,
  LineChart,
  X,
  ChevronRight,
  ShieldCheck,
  Check,
} from 'lucide-react';

interface MarketSignalsPanelProps {
  selectedStock: { symbol: string; quote?: Quote } | null;
  activeSignals: MarketSignalEvent[];
  globalActiveSignals?: MarketSignalEvent[];
  catchUp?: CatchUpResponse | null;
  catchUpLoading?: boolean;
  loading?: boolean;
  onSelectStock: (symbol: string) => void;
  onClearSelection: () => void;
  onOpenSignalDetail?: (signal: MarketSignalEvent) => void;
  onOpenHistory?: (symbol: string) => void;
  onOpenChart?: (symbol: string) => void;
  onMarkCaughtUp?: () => Promise<void>;
}

export const MarketSignalsPanel: React.FC<MarketSignalsPanelProps> = ({
  selectedStock,
  activeSignals,
  globalActiveSignals = [],
  catchUp,
  catchUpLoading = false,
  loading = false,
  onSelectStock,
  onClearSelection,
  onOpenSignalDetail,
  onOpenHistory,
  onOpenChart,
  onMarkCaughtUp,
}) => {
  const [markingCaughtUp, setMarkingCaughtUp] = useState(false);
  const [catchUpDismissed, setCatchUpDismissed] = useState(false);

  const formatPrice = (price?: number | null) => {
    if (price === undefined || price === null || isNaN(price)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const formatRelativeTime = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  const handleMarkCaughtUp = async () => {
    if (markingCaughtUp || !onMarkCaughtUp) return;
    setMarkingCaughtUp(true);
    try {
      await onMarkCaughtUp();
      setCatchUpDismissed(true);
    } catch (err) {
      console.error('Failed to mark as caught up:', err);
    } finally {
      setMarkingCaughtUp(false);
    }
  };

  // Find active signal for selected stock
  const selectedSymbol = selectedStock?.symbol?.toUpperCase();
  const stockActiveSignal = selectedSymbol
    ? activeSignals.find((s) => s.stockSymbol.toUpperCase() === selectedSymbol) ||
      globalActiveSignals.find((s) => s.stockSymbol.toUpperCase() === selectedSymbol)
    : null;

  // Use either watchlist active signals or fallback to global signals
  const signalsToDisplay = activeSignals.length > 0 ? activeSignals : globalActiveSignals;

  const showActiveCatchUp =
    catchUp &&
    !catchUpDismissed &&
    catchUp.hasChanges &&
    catchUp.events &&
    catchUp.events.length > 0;

  return (
    <aside
      aria-label="Market Signals Panel"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-card)',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '0.85rem 1rem',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--accent-blue-light)',
              color: 'var(--accent-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Zap size={14} strokeWidth={2.5} />
          </div>
          <div>
            <h3
              style={{
                fontSize: '0.9rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              Market Signals
            </h3>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {selectedStock
                ? `Context for ${selectedStock.symbol}`
                : `${signalsToDisplay.length} active 24h ${signalsToDisplay.length === 1 ? 'signal' : 'signals'}`}
            </span>
          </div>
        </div>

        {selectedStock && (
          <button
            type="button"
            onClick={onClearSelection}
            title="Clear selection to view all signals"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              fontSize: '0.725rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-card)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <X size={12} strokeWidth={2.5} />
            <span>All Signals</span>
          </button>
        )}
      </div>

      {/* Main Panel Body */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {/* ------------------------------------------------------------- */}
        {/* Top Catch-Up Section (While You Were Away / Calm State)        */}
        {/* ------------------------------------------------------------- */}
        {catchUpLoading ? (
          <div
            style={{
              height: '40px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-secondary)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        ) : showActiveCatchUp ? (
          /* Active Catch-Up Card */
          <div
            className="animate-fade-in"
            style={{
              padding: '0.85rem',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--accent-blue-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.825rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  While You Were Away
                </span>
                <span
                  style={{
                    fontSize: '0.675rem',
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--accent-blue-light)',
                    color: 'var(--accent-blue)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {catchUp.awayTimeFormatted} away · {catchUp.significantEventsCount} event{catchUp.significantEventsCount === 1 ? '' : 's'}
                </span>
              </div>

              {onMarkCaughtUp && (
                <button
                  type="button"
                  onClick={handleMarkCaughtUp}
                  disabled={markingCaughtUp}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    fontSize: '0.725rem',
                    fontWeight: 600,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--accent-blue)',
                    backgroundColor: 'transparent',
                    color: 'var(--accent-blue)',
                    cursor: markingCaughtUp ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--accent-blue)';
                    e.currentTarget.style.color = '#ffffff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--accent-blue)';
                  }}
                >
                  <Check size={12} strokeWidth={2.5} />
                  <span>{markingCaughtUp ? 'Updating...' : 'Mark as Caught Up'}</span>
                </button>
              )}
            </div>

            <p style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              {catchUp.narrative}
            </p>
          </div>
        ) : catchUp ? (
          /* Calm / All Caught Up Status Line */
          <div
            style={{
              padding: '0.5rem 0.75rem',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={14} color="var(--market-up)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                All caught up
              </span>
              <span style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                · Nothing significant changed
              </span>
            </div>
            {catchUp.awayTimeFormatted && (
              <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {catchUp.awayTimeFormatted}
              </span>
            )}
          </div>
        ) : null}

        {/* ------------------------------------------------------------- */}
        {/* Main Section: Selected Stock Details OR Active Signals Stream */}
        {/* ------------------------------------------------------------- */}
        {loading ? (
          /* Loading Skeleton */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: '64px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-secondary)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
            ))}
          </div>
        ) : selectedStock ? (
          /* ------------------------------------------------------------- */
          /* State A: Selected Stock View                                  */
          /* ------------------------------------------------------------- */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {/* Stock Header Card */}
            <div
              style={{
                padding: '0.85rem',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {selectedStock.symbol}
                  </span>
                  {selectedStock.quote?.sector && (
                    <span
                      style={{
                        fontSize: '0.675rem',
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {selectedStock.quote.sector}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {selectedStock.quote?.name || `${selectedStock.symbol} Corporation`}
                </div>
              </div>

              {selectedStock.quote && (
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono, monospace)',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      color: 'var(--text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    ₹{formatPrice(selectedStock.quote.price)}
                  </div>
                  <div
                    style={{
                      fontSize: '0.725rem',
                      fontWeight: 600,
                      color: selectedStock.quote.change >= 0 ? 'var(--market-up)' : 'var(--market-down)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {selectedStock.quote.change >= 0 ? '+' : ''}
                    {selectedStock.quote.changePercent.toFixed(2)}% (24H)
                  </div>
                </div>
              )}
            </div>

            {/* Contextual Market Signal Details */}
            {stockActiveSignal ? (
              <div
                style={{
                  padding: '0.9rem',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--accent-blue-border)',
                  boxShadow: 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                {/* Signal Badge & Direction */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 7px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: 'var(--accent-blue-light)',
                      color: 'var(--accent-blue)',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    <Zap size={11} strokeWidth={2.5} />
                    {stockActiveSignal.changeType === 'NEWS_PRICE_REACTION'
                      ? 'News Reaction'
                      : stockActiveSignal.changeType === 'PRICE_MOVEMENT'
                      ? 'Price Move'
                      : 'Market Signal'}
                  </span>

                  {stockActiveSignal.percentageChange !== null && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor:
                          stockActiveSignal.direction === 'UP' ? 'var(--market-up-light)' : 'var(--market-down-light)',
                        color:
                          stockActiveSignal.direction === 'UP' ? 'var(--market-up)' : 'var(--market-down)',
                        fontWeight: 700,
                        fontSize: '0.775rem',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {stockActiveSignal.direction === 'UP' ? (
                        <TrendingUp size={12} strokeWidth={2.5} />
                      ) : (
                        <TrendingDown size={12} strokeWidth={2.5} />
                      )}
                      <span>
                        {stockActiveSignal.direction === 'UP' ? '+' : ''}
                        {stockActiveSignal.percentageChange.toFixed(2)}%
                      </span>
                    </span>
                  )}
                </div>

                {/* Non-Causal Reason Explanation */}
                <p
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-primary)',
                    lineHeight: 1.45,
                    margin: 0,
                    fontWeight: 500,
                  }}
                >
                  {stockActiveSignal.reason || stockActiveSignal.changeSummary}
                </p>

                {/* Temporal News Context */}
                {stockActiveSignal.newsHeadline && (
                  <div
                    style={{
                      padding: '0.65rem',
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.675rem',
                        fontWeight: 700,
                        color: 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      <Newspaper size={11} />
                      <span>Relevant News Citation</span>
                    </div>

                    <a
                      href={stockActiveSignal.newsUrl || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '0.775rem',
                        fontWeight: 600,
                        color: 'var(--accent-blue)',
                        textDecoration: 'none',
                        lineHeight: 1.35,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      <span>{stockActiveSignal.newsHeadline}</span>
                      <ExternalLink size={11} />
                    </a>

                    {stockActiveSignal.newsSource && (
                      <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>
                        Source: {stockActiveSignal.newsSource}
                      </div>
                    )}
                  </div>
                )}

                {/* Detected Timestamp & Active Status */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.6875rem',
                    color: 'var(--text-muted)',
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={11} />
                    <span>Detected {formatRelativeTime(stockActiveSignal.detectedAt)}</span>
                  </div>
                  <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>Active 24h Signal</span>
                </div>
              </div>
            ) : (
              /* Calm State: No active signal for selected stock */
              <div
                style={{
                  padding: '1.25rem 0.85rem',
                  textAlign: 'center',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'var(--market-up-light)',
                    color: 'var(--market-up)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ShieldCheck size={16} />
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  No Active Signals
                </div>
                <p
                  style={{
                    fontSize: '0.725rem',
                    color: 'var(--text-secondary)',
                    maxWidth: '240px',
                    lineHeight: 1.4,
                    margin: 0,
                  }}
                >
                  {selectedStock.symbol} has traded within normal thresholds with no correlated reaction signals in the last 24 hours.
                </p>
              </div>
            )}

            {/* Quick Actions (History & Chart) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => onOpenHistory?.(selectedStock.symbol)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                  e.currentTarget.style.borderColor = 'var(--border-card)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                }}
              >
                <History size={12} strokeWidth={2} />
                <span>30D History</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenChart?.(selectedStock.symbol)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--accent-blue-light)',
                  border: '1px solid var(--accent-blue-border)',
                  color: 'var(--accent-blue-text)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
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
                <span>Price Chart</span>
              </button>
            </div>
          </div>
        ) : (
          /* ------------------------------------------------------------- */
          /* State B: Global Active Signals Stream (Default / No Select)   */
          /* ------------------------------------------------------------- */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div
              style={{
                fontSize: '0.775rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Active Watchlist Events</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Click stock to inspect</span>
            </div>

            {signalsToDisplay.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {signalsToDisplay.map((sig) => {
                  const isUp = sig.direction === 'UP';
                  const isReaction = sig.changeType === 'NEWS_PRICE_REACTION';

                  return (
                    <div
                      key={sig.id || `${sig.stockSymbol}-${sig.detectedAt}`}
                      onClick={() => onSelectStock(sig.stockSymbol)}
                      style={{
                        padding: '0.75rem',
                        backgroundColor: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                        e.currentTarget.style.borderColor = 'var(--accent-blue-border)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                            {sig.stockSymbol}
                          </span>
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: isReaction ? 'var(--accent-blue-light)' : 'var(--bg-card)',
                              color: isReaction ? 'var(--accent-blue)' : 'var(--text-secondary)',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            {isReaction ? 'News Reaction' : 'Price Move'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          {sig.percentageChange !== null && (
                            <span
                              style={{
                                fontSize: '0.775rem',
                                fontWeight: 700,
                                color: isUp ? 'var(--market-up)' : 'var(--market-down)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {isUp ? '+' : ''}
                              {sig.percentageChange.toFixed(2)}%
                            </span>
                          )}
                          <ChevronRight size={13} color="var(--text-muted)" />
                        </div>
                      </div>

                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          lineHeight: 1.35,
                          margin: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {sig.reason || sig.changeSummary}
                      </p>

                      <div
                        style={{
                          fontSize: '0.675rem',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        <Clock size={10} />
                        <span>{formatRelativeTime(sig.detectedAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  padding: '1.5rem 1rem',
                  textAlign: 'center',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  All Stocks Quiet
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '240px', lineHeight: 1.4, margin: 0 }}>
                  No active watchlist signals.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
