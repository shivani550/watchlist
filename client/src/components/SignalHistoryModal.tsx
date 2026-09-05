'use client';

import React, { useState, useEffect } from 'react';
import { MarketSignalEvent } from '@watchlist/shared';
import { api } from '../lib/api';
import {
  X,
  History,
  TrendingUp,
  TrendingDown,
  Newspaper,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Calendar,
  Info,
} from 'lucide-react';

interface SignalHistoryModalProps {
  symbol: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const SignalHistoryModal: React.FC<SignalHistoryModalProps> = ({
  symbol,
  isOpen,
  onClose,
}) => {
  const [history, setHistory] = useState<MarketSignalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !symbol) {
      setHistory([]);
      setError(null);
      setExpandedId(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    api
      .getSignalHistory(symbol)
      .then((res) => {
        if (isMounted) {
          setHistory(res.history || []);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load signal history');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, symbol]);

  if (!isOpen || !symbol) return null;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatPrice = (price?: number | null) => {
    if (price === undefined || price === null || isNaN(price)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return isoString;
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

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
          maxWidth: '600px',
          maxHeight: '85vh',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          padding: '1.75rem',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
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
            paddingBottom: '0.75rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {symbol}
              </h3>
              <span
                style={{
                  fontSize: '0.725rem',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                30-Day Signal History
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '3px', margin: 0 }}>
              Immutable audit log of detected market movements and signals
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
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

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', minHeight: '240px' }}>
          {loading ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '200px',
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
              <span>Loading 30-day signal history...</span>
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--market-down)', fontSize: '0.875rem' }}>
              <p>{error}</p>
              <button
                onClick={() => {
                  setLoading(true);
                  api
                    .getSignalHistory(symbol)
                    .then((r) => setHistory(r.history || []))
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
                style={{
                  marginTop: '0.5rem',
                  padding: '4px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                  border: '1px solid var(--border-card)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <RotateCcw size={12} />
                Retry
              </button>
            </div>
          ) : history.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '200px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                gap: '8px',
              }}
            >
              <History size={32} strokeWidth={1.5} />
              <p style={{ fontWeight: 600, color: 'var(--text-primary)', margin: 0, fontSize: '0.95rem' }}>
                No signal history in the past 30 days
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '340px', margin: 0 }}>
                When significant price movements or company news are detected for {symbol}, they will be permanently recorded here for 30 days.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {history.map((event) => {
                const isExpanded = expandedId === event.id;
                const isUp = event.direction === 'UP';
                const isReaction = event.changeType === 'NEWS_PRICE_REACTION';
                const isMovement = event.changeType === 'PRICE_MOVEMENT' || isReaction || (event.percentageChange !== null && event.percentageChange !== 0);

                return (
                  <div
                    key={event.id}
                    style={{
                      border: '1px solid var(--border-card)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-card)',
                      overflow: 'hidden',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {/* Event Summary Bar (Clickable) */}
                    <div
                      onClick={() => toggleExpand(event.id)}
                      style={{
                        padding: '0.75rem 1rem',
                        backgroundColor: isExpanded ? 'var(--bg-secondary)' : 'var(--bg-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        gap: '8px',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded) e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                        <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                          <Calendar size={13} />
                        </div>
                        <span style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {formatDate(event.detectedAt)}
                        </span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {event.changeSummary}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isMovement && event.percentageChange !== null && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: isUp ? 'var(--market-up-light)' : 'var(--market-down-light)',
                              color: isUp ? 'var(--market-up)' : 'var(--market-down)',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                            }}
                          >
                            {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                            <span className="num-tabular">{isUp ? '+' : ''}{event.percentageChange.toFixed(2)}%</span>
                          </span>
                        )}

                        {event.isActive && (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-full)',
                              backgroundColor: 'var(--accent-blue-light)',
                              color: 'var(--accent-blue-text)',
                              border: '1px solid var(--accent-blue-border)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Active
                          </span>
                        )}

                        <div style={{ color: 'var(--text-muted)' }}>
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Historical Details */}
                    {isExpanded && (
                      <div
                        className="animate-fade-in"
                        style={{
                          padding: '0.875rem 1rem',
                          borderTop: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--bg-card)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          fontSize: '0.825rem',
                        }}
                      >
                        {/* Price Metrics */}
                        {event.currentPrice !== null && (
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            {event.previousPrice !== null && (
                              <span style={{ color: 'var(--text-muted)' }}>
                                Baseline Price: ₹<span className="num-tabular">{formatPrice(event.previousPrice)}</span>
                              </span>
                            )}
                            <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                              Detected Price: ₹<span className="num-tabular">{formatPrice(event.currentPrice)}</span>
                            </span>
                          </div>
                        )}

                        {/* Reason */}
                        {event.reason && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', color: 'var(--text-secondary)' }}>
                            <Info size={14} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: '2px' }} />
                            <span>{event.reason}</span>
                          </div>
                        )}

                        {/* News */}
                        {event.newsHeadline && (
                          <div
                            style={{
                              padding: '6px 8px',
                              backgroundColor: 'var(--bg-secondary)',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase' }}>
                              <Newspaper size={11} />
                              <span>News Signal</span>
                            </div>
                            <p style={{ margin: '2px 0 4px 0', color: 'var(--text-primary)', fontWeight: 500 }}>
                              {event.newsHeadline}
                            </p>
                            {event.newsUrl && (
                              <a
                                href={event.newsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  color: 'var(--accent-blue)',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                              >
                                <span>Article Link</span>
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        )}

                        {/* Audit Timestamps */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', paddingTop: '4px', borderTop: '1px solid var(--border-subtle)' }}>
                          <span>Detected at: {formatDate(event.detectedAt)} {formatTime(event.detectedAt)}</span>
                          <span>Retained in history until: {formatDate(event.historyUntil)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
