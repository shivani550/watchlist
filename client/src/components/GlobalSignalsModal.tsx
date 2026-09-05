'use client';

import React, { useState, useEffect } from 'react';
import { MarketSignalEvent } from '@watchlist/shared';
import { api } from '../lib/api';
import {
  X,
  Zap,
  TrendingUp,
  TrendingDown,
  Newspaper,
  RotateCcw,
  ExternalLink,
  Info,
} from 'lucide-react';

interface GlobalSignalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStock?: (symbol: string) => void;
}

export const GlobalSignalsModal: React.FC<GlobalSignalsModalProps> = ({
  isOpen,
  onClose,
  onSelectStock,
}) => {
  const [signals, setSignals] = useState<MarketSignalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActiveSignals = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getActiveSignals();
      setSignals(res.signals || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load active signals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadActiveSignals();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatPrice = (price?: number | null) => {
    if (price === undefined || price === null || isNaN(price)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // Group active signals into "Today", "Yesterday", and "Earlier"
  const groupSignalsByDate = (items: MarketSignalEvent[]) => {
    // Deduplicate so only the latest signal per stock symbol per watchlist is displayed
    const unique = new Map<string, MarketSignalEvent>();
    for (const item of items) {
      const key = `${item.watchlistId || ''}:${item.stockSymbol.toUpperCase()}`;
      if (!unique.has(key)) {
        unique.set(key, item);
      }
    }
    const dedupedItems = Array.from(unique.values());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups: { label: string; items: MarketSignalEvent[] }[] = [];
    const todayItems: MarketSignalEvent[] = [];
    const yesterdayItems: MarketSignalEvent[] = [];
    const earlierItems: MarketSignalEvent[] = [];

    for (const item of dedupedItems) {
      const itemDate = new Date(item.detectedAt);
      itemDate.setHours(0, 0, 0, 0);

      if (itemDate.getTime() === today.getTime()) {
        todayItems.push(item);
      } else if (itemDate.getTime() === yesterday.getTime()) {
        yesterdayItems.push(item);
      } else {
        earlierItems.push(item);
      }
    }

    if (todayItems.length > 0) groups.push({ label: 'Today', items: todayItems });
    if (yesterdayItems.length > 0) groups.push({ label: 'Yesterday', items: yesterdayItems });
    if (earlierItems.length > 0) groups.push({ label: 'Earlier', items: earlierItems });

    return groups;
  };

  const groups = groupSignalsByDate(signals);

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
          maxWidth: '580px',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
              }}
            >
              <Zap size={18} strokeWidth={2.5} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Active Market Signals
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', margin: 0 }}>
                All active 24-hour signals across your watchlists
              </p>
            </div>
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

        {/* Body Content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', minHeight: '220px' }}>
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
              <span>Loading active market signals...</span>
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--market-down)', fontSize: '0.875rem' }}>
              <p>{error}</p>
              <button
                onClick={loadActiveSignals}
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
          ) : signals.length === 0 ? (
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
              <Zap size={32} strokeWidth={1.5} />
              <p style={{ fontWeight: 600, color: 'var(--text-primary)', margin: 0, fontSize: '0.95rem' }}>
                No active market signals
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '340px', margin: 0 }}>
                Significant price movements or news signals detected within the last 24 hours will appear here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {groups.map((group) => (
                <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span
                    style={{
                      fontSize: '0.725rem',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      paddingLeft: '2px',
                    }}
                  >
                    {group.label}
                  </span>

                  {group.items.map((sig) => {
                    const isUp = sig.direction === 'UP';
                    const isReaction = sig.changeType === 'NEWS_PRICE_REACTION';
                    const isMovement = sig.changeType === 'PRICE_MOVEMENT' || isReaction;

                    return (
                      <div
                        key={sig.id}
                        onClick={() => {
                          onClose();
                          onSelectStock?.(sig.stockSymbol);
                        }}
                        style={{
                          padding: '0.875rem 1rem',
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent-blue-border)';
                          e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-subtle)';
                          e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                              {sig.stockSymbol}
                            </span>

                            {isMovement && sig.percentageChange !== null ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '1px 6px',
                                  borderRadius: 'var(--radius-sm)',
                                  backgroundColor: isUp ? 'var(--market-up-light)' : 'var(--market-down-light)',
                                  color: isUp ? 'var(--market-up)' : 'var(--market-down)',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                }}
                              >
                                {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                                <span className="num-tabular">{isUp ? '+' : ''}{sig.percentageChange.toFixed(2)}%</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '1px 6px',
                                  borderRadius: 'var(--radius-sm)',
                                  backgroundColor: 'var(--bg-card)',
                                  color: 'var(--text-secondary)',
                                  border: '1px solid var(--border-subtle)',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                }}
                              >
                                <Newspaper size={11} />
                                News
                              </span>
                            )}

                            {isReaction && (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  padding: '1px 5px',
                                  borderRadius: 'var(--radius-xs)',
                                  backgroundColor: 'var(--accent-blue-light)',
                                  color: 'var(--accent-blue-text)',
                                  border: '1px solid var(--accent-blue-border)',
                                }}
                              >
                                Reaction
                              </span>
                            )}
                          </div>

                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {formatTime(sig.detectedAt)}
                          </span>
                        </div>

                        <p style={{ fontSize: '0.825rem', color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>
                          {sig.changeSummary}
                        </p>

                        {sig.reason && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
                            <Info size={12} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                            <span>{sig.reason}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
