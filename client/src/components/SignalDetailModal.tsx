'use client';

import React from 'react';
import { MarketSignalEvent } from '@watchlist/shared';
import {
  X,
  Zap,
  TrendingUp,
  TrendingDown,
  Newspaper,
  ExternalLink,
  Clock,
  History,
  Info,
} from 'lucide-react';

interface SignalDetailModalProps {
  signal: MarketSignalEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenHistory?: (symbol: string) => void;
}

export const SignalDetailModal: React.FC<SignalDetailModalProps> = ({
  signal,
  isOpen,
  onClose,
  onOpenHistory,
}) => {
  if (!isOpen || !signal) return null;

  const isUp = signal.direction === 'UP';
  const isReaction = signal.changeType === 'NEWS_PRICE_REACTION';
  const isMovement = signal.changeType === 'PRICE_MOVEMENT' || isReaction || (signal.percentageChange !== null && signal.percentageChange !== 0);

  const getSignalBadgeLabel = () => {
    if (signal.changeType === 'NEWS_PRICE_REACTION') return 'News Reaction Signal';
    if (signal.changeType === 'PRICE_MOVEMENT') return 'Price Movement Signal';
    if (signal.changeType === 'NEWS_ONLY' || signal.changeType === 'NEW_NEWS') return 'News Signal';
    return 'Active Signal';
  };

  const formatPrice = (price?: number | null) => {
    if (price === undefined || price === null || isNaN(price)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
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
          maxWidth: '540px',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  {signal.stockSymbol}
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
                  {getSignalBadgeLabel()}
                </span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', margin: 0 }}>
                {signal.companyName || `${signal.stockSymbol} Corporation`}
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

        {/* Change Summary Card */}
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              What Changed?
            </span>
            {isMovement && signal.percentageChange !== null && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: isUp ? 'var(--market-up-light)' : 'var(--market-down-light)',
                  color: isUp ? 'var(--market-up)' : 'var(--market-down)',
                  border: `1px solid ${isUp ? 'var(--market-up-border)' : 'var(--market-down-border)'}`,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                {isUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                <span className="num-tabular">{isUp ? '+' : ''}{signal.percentageChange.toFixed(2)}%</span>
              </span>
            )}
          </div>

          <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.5, margin: 0 }}>
            {signal.changeSummary}
          </p>

          {signal.currentPrice !== null && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '0.85rem', marginTop: '2px' }}>
              {signal.previousPrice !== null && (
                <span style={{ color: 'var(--text-muted)' }}>
                  Baseline: ₹<span className="num-tabular">{formatPrice(signal.previousPrice)}</span>
                </span>
              )}
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                Current: ₹<span className="num-tabular">{formatPrice(signal.currentPrice)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Reason / Explanation */}
        {signal.reason && (
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <Info size={15} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Why Was It Detected?
              </span>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', margin: '2px 0 0 0', lineHeight: 1.45 }}>
                {signal.reason}
              </p>
            </div>
          </div>
        )}

        {/* Contextual News Citation */}
        {signal.newsHeadline && (
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <Newspaper size={13} />
              <span>Supporting News Citation</span>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 500, margin: '0 0 6px 0', lineHeight: 1.4 }}>
              {signal.newsHeadline}
            </p>
            {signal.newsUrl && (
              <a
                href={signal.newsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.8rem',
                  color: 'var(--accent-blue)',
                  fontWeight: 600,
                }}
              >
                <span>View Full Article</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}

        {/* Timestamp Metadata */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.75rem',
            padding: '0.75rem 0',
            borderTop: '1px solid var(--border-subtle)',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: '1.25rem',
            fontSize: '0.8rem',
          }}
        >
          <div>
            <span style={{ color: 'var(--text-muted)', display: 'block' }}>Detected At</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatDateTime(signal.detectedAt)}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', display: 'block' }}>Active Until</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatDateTime(signal.activeUntil)}</span>
          </div>
        </div>

        {/* Action Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {onOpenHistory && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenHistory(signal.stockSymbol);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                fontSize: '0.825rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent-blue)';
                e.currentTarget.style.borderColor = 'var(--accent-blue)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              <History size={14} />
              <span>View 30-Day History</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 16px',
              backgroundColor: 'var(--accent-blue)',
              color: '#ffffff',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
