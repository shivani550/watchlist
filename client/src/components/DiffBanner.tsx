'use client';

import React, { useState } from 'react';
import { DiffResult, MeaningfulChange, MarketSignalEvent } from '@watchlist/shared';
import {
  TrendingUp,
  TrendingDown,
  Newspaper,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Zap,
  Info,
} from 'lucide-react';
import { FreshnessBadge } from './FreshnessBadge';

interface DiffBannerProps {
  diff: DiffResult | null;
  activeSignals?: MarketSignalEvent[];
  loading?: boolean;
  onRefresh?: () => void;
  onSelectStock?: (symbol: string) => void;
  onOpenSignalDetail?: (signal: MarketSignalEvent) => void;
}

export const DiffBanner: React.FC<DiffBannerProps> = ({
  diff,
  activeSignals = [],
  loading = false,
  onRefresh,
  onSelectStock,
  onOpenSignalDetail,
}) => {
  const [expandedNews, setExpandedNews] = useState<Record<string, boolean>>({});
  const [isExpandedAll, setIsExpandedAll] = useState(false);

  const toggleNews = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNews((prev) => ({
      ...prev,
      [symbol]: !prev[symbol],
    }));
  };

  const formatPrice = (price?: number | null) => {
    if (price === undefined || price === null || isNaN(price)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return 'never';
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatRelativeTime = (isoString: string) => {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  // Loading State
  if (loading) {
    return (
      <div
        style={{
          padding: '1rem 1.25rem',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--text-secondary)',
          fontSize: '0.85rem',
        }}
      >
        <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-blue)' }} />
        <span>Evaluating market signals and news since your last visit...</span>
      </div>
    );
  }

  if (!diff && activeSignals.length === 0) return null;

  // 1. First Visit State (Baseline Initialization with no prior active signals)
  if (diff && diff.lastSeenAt === null && activeSignals.length === 0) {
    return (
      <div
        className="animate-fade-in"
        style={{
          padding: '1.25rem 1.5rem',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--accent-blue-light)',
            color: 'var(--accent-blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: '2px',
          }}
        >
          <Sparkles size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '4px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Market Signals
            </h3>
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--accent-blue-text)',
                backgroundColor: 'var(--accent-blue-light)',
                border: '1px solid var(--accent-blue-border)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                fontWeight: 600,
              }}
            >
              Baseline Established
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Welcome! Baseline prices have been established. As market movements (±2.0% or more) and news occur, persistent 24-hour Market Signals will appear here and in your 30-day history.
          </p>
        </div>
      </div>
    );
  }

  // 2. Determine display changes & strictly deduplicate by stock symbol (latest per company)
  const rawItems = activeSignals.length > 0
    ? activeSignals.map((sig) => ({
        symbol: sig.stockSymbol,
        type: sig.changeType as MeaningfulChange['type'],
        direction: (sig.direction || 'FLAT') as MeaningfulChange['direction'],
        summary: sig.changeSummary,
        headline: sig.newsHeadline || undefined,
        previousPrice: sig.previousPrice,
        currentPrice: sig.currentPrice || 0,
        percentageChange: sig.percentageChange || 0,
        percentChangeSinceLastSeen: sig.percentageChange || 0,
        absoluteChangeSinceLastSeen: 0,
        likelyReason: sig.reason,
        newsItems: sig.newsHeadline
          ? [{ symbol: sig.stockSymbol, headline: sig.newsHeadline, url: sig.newsUrl || '', publishedAt: sig.detectedAt, providerId: sig.eventSignature }]
          : [],
        rawSignal: sig,
      }))
    : (diff?.changes || []).map((c) => ({
        ...c,
        rawSignal: undefined as MarketSignalEvent | undefined,
      }));

  // Ensure each stock symbol appears only once in the active signals display
  const uniqueMap = new Map<string, typeof rawItems[0]>();
  for (const item of rawItems) {
    const sym = item.symbol.toUpperCase().trim();
    if (!uniqueMap.has(sym)) {
      uniqueMap.set(sym, item);
    }
  }
  const displayItems = Array.from(uniqueMap.values());
  const visibleItems = isExpandedAll ? displayItems : displayItems.slice(0, 1);
  const hiddenCount = displayItems.length - 1;

  // Reassuring Calm State: No Active Market Signals
  if (displayItems.length === 0) {
    return (
      <div
        className="animate-fade-in"
        style={{
          padding: '0.875rem 1.25rem',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              backgroundColor: 'var(--market-up-light)',
              color: 'var(--market-up)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckCircle2 size={15} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              No active market signals
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {diff?.lastSeenAt ? `since your last check (${formatTime(diff.lastSeenAt)})` : 'for this watchlist'}
            </span>
          </div>
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            title="Re-check for latest market signals"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              fontWeight: 500,
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-subtle)',
              transition: 'all 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <RefreshCw size={12} />
            Check again
          </button>
        )}
      </div>
    );
  }

  // 3. Active Market Signals List
  return (
    <section
      className="animate-fade-in"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
      }}
    >
      {/* Section Header */}
      <div
        style={{
          padding: '0.875rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: 'var(--radius-xs)',
              backgroundColor: 'var(--accent-blue-light)',
              color: 'var(--accent-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Zap size={14} strokeWidth={2.5} />
          </div>
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Market Signals
          </h3>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--accent-blue-light)',
              color: 'var(--accent-blue-text)',
              border: '1px solid var(--accent-blue-border)',
            }}
          >
            {displayItems.length} active {displayItems.length === 1 ? 'signal' : 'signals'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {diff?.lastSeenAt && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Evaluated {formatTime(diff.lastSeenAt)}
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                color: 'var(--text-secondary)',
                fontSize: '0.76rem',
                fontWeight: 500,
                borderRadius: 'var(--radius-xs)',
                transition: 'color 0.12s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              <RefreshCw size={11} />
              Check again
            </button>
          )}
        </div>
      </div>

      {/* Cards List */}
      <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {visibleItems.map((change, idx) => {
          const isUp = change.direction === 'UP';
          const isReaction = change.type === 'NEWS_PRICE_REACTION';
          const isMovement = change.type === 'PRICE_MOVEMENT';
          const isNewsOnly = change.type === 'NEWS_ONLY' || change.type === 'NEW_NEWS';
          const hasPriceMove = (isReaction || isMovement) && change.percentageChange !== 0;
          const isNewsExpanded = !!expandedNews[change.symbol];
          const hasNews = (change.newsItems?.length || 0) > 0;

          return (
            <div
              key={`${change.symbol}-${idx}`}
              onClick={() => {
                if (change.rawSignal && onOpenSignalDetail) {
                  onOpenSignalDetail(change.rawSignal);
                } else {
                  onSelectStock?.(change.symbol);
                }
              }}
              style={{
                padding: '1rem',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-hover)';
                e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-card)';
                e.currentTarget.style.backgroundColor = 'var(--bg-card)';
              }}
            >
              {/* Card Header / Stock & Movement Row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '6px',
                }}
              >
                {/* Symbol & Classification Badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '0.98rem',
                      color: 'var(--text-primary)',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {change.symbol}
                  </span>

                  {hasPriceMove && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: isUp ? 'var(--market-up-light)' : 'var(--market-down-light)',
                        color: isUp ? 'var(--market-up)' : 'var(--market-down)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}
                    >
                      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      <span className="num-tabular">
                        {isUp ? '+' : ''}
                        {change.percentageChange?.toFixed(2)}%
                      </span>
                    </span>
                  )}

                  {isReaction && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--accent-blue-light)',
                        color: 'var(--accent-blue-text)',
                        border: '1px solid var(--accent-blue-border)',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      <Zap size={11} strokeWidth={2.5} />
                      News Reaction
                    </span>
                  )}

                  {isMovement && !isReaction && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      Price Movement
                    </span>
                  )}

                  {isNewsOnly && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      <Newspaper size={11} />
                      News Signal
                    </span>
                  )}
                </div>

                {/* Price Information */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  {change.previousPrice && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Baseline ₹<span className="num-tabular">{formatPrice(change.previousPrice)}</span>
                    </span>
                  )}
                  {change.currentPrice > 0 && (
                    <span
                      style={{
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      ₹<span className="num-tabular">{formatPrice(change.currentPrice)}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Likely Reason Callout */}
              {change.likelyReason && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    marginTop: '6px',
                    marginBottom: '6px',
                  }}
                >
                  <Info size={13} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                  <span>{change.likelyReason}</span>
                </div>
              )}

              {/* Contextual Supporting News Toggle */}
              {hasNews && (
                <div style={{ marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={(e) => toggleNews(change.symbol, e)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: 'var(--accent-blue)',
                      padding: '2px 0',
                    }}
                  >
                    <Newspaper size={13} />
                    <span>
                      {change.newsItems!.length}{' '}
                      {change.newsItems!.length === 1 ? 'recent article' : 'recent articles'}
                    </span>
                    {isNewsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {/* Expanded News Articles Drawer */}
                  {isNewsExpanded && (
                    <div
                      style={{
                        marginTop: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        paddingLeft: '10px',
                        borderLeft: '2px solid var(--border-card)',
                      }}
                    >
                      {change.newsItems!.map((news, nIdx) => (
                        <div
                          key={news.providerId || nIdx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <a
                              href={news.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                fontSize: '0.8rem',
                                color: 'var(--text-primary)',
                                fontWeight: 500,
                                lineHeight: 1.4,
                                display: 'inline',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue)')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                            >
                              {news.headline}
                            </a>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '6px' }}>
                              • {formatRelativeTime(news.publishedAt)}
                            </span>
                          </div>
                          {news.url && (
                            <a
                              href={news.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open article"
                              style={{ color: 'var(--text-muted)', padding: '2px' }}
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* See More / Show Less Button */}
        {displayItems.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
            <button
              type="button"
              onClick={() => setIsExpandedAll(!isExpandedAll)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 16px',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--accent-blue)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                e.currentTarget.style.borderColor = 'var(--accent-blue)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              {isExpandedAll ? (
                <>
                  <ChevronUp size={14} />
                  <span>Show less</span>
                </>
              ) : (
                <>
                  <ChevronDown size={14} />
                  <span>See {hiddenCount} more {hiddenCount === 1 ? 'signal' : 'signals'}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
