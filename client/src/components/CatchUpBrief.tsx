'use client';

import React, { useState } from 'react';
import { CatchUpResponse, CatchUpEvent } from '@watchlist/shared';
import {
  Clock,
  Check,
  TrendingUp,
  TrendingDown,
  Newspaper,
  Zap,
  ExternalLink,
  ChevronRight,
  Sparkles,
  CheckCircle2
} from 'lucide-react';

interface CatchUpBriefProps {
  catchUp: CatchUpResponse | null;
  loading?: boolean;
  onMarkCaughtUp: () => Promise<void>;
  onSelectStock?: (symbol: string) => void;
  onOpenSignalDetail?: (symbol: string) => void;
}

export const CatchUpBrief: React.FC<CatchUpBriefProps> = ({
  catchUp,
  loading = false,
  onMarkCaughtUp,
  onSelectStock,
  onOpenSignalDetail,
}) => {
  const [marking, setMarking] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!catchUp) return null;

  const handleCatchUpClick = async () => {
    if (marking) return;
    setMarking(true);
    try {
      await onMarkCaughtUp();
      setIsCollapsed(true);
    } catch (err) {
      console.error('Failed to mark as caught up:', err);
    } finally {
      setMarking(false);
    }
  };

  const formatEventTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const timeStr = date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    if (isToday) {
      return timeStr;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
      return `Yesterday ${timeStr}`;
    }

    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${timeStr}`;
  };

  const formatPrice = (price?: number | null) => {
    if (price === undefined || price === null || isNaN(price)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  // If collapsed or 0 changes, show calm executive state
  if (isCollapsed || !catchUp.hasChanges || catchUp.events.length === 0) {
    return (
      <div
        className="animate-fade-in"
        style={{
          marginBottom: '1.25rem',
          padding: '0.875rem 1.25rem',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: 'var(--market-up-bg, rgba(0, 179, 134, 0.1))',
              color: 'var(--market-up)',
            }}
          >
            <CheckCircle2 size={16} />
          </div>
          <div>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              All caught up
            </span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
              {catchUp.narrative || 'Nothing significant changed across your watchlist.'}
            </span>
          </div>
        </div>

        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted, #94a3b8)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {catchUp.awayTimeFormatted} away
        </span>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in"
      style={{
        marginBottom: '1.5rem',
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: '14px',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05))',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Top Brief Header */}
      <div
        style={{
          padding: '1.125rem 1.25rem',
          borderBottom: '1px solid var(--border-card)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          backgroundColor: 'var(--bg-secondary, rgba(0,0,0,0.01))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem', flex: 1, minWidth: '260px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: 'rgba(37, 99, 235, 0.1)',
              color: 'var(--accent-blue)',
              flexShrink: 0,
              marginTop: '2px',
            }}
          >
            <Clock size={18} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                While You Were Away
              </h3>
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  color: 'var(--accent-blue)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {catchUp.awayTimeFormatted} away
              </span>
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  padding: '0.125rem 0.5rem',
                  borderRadius: '999px',
                  backgroundColor: 'var(--border-card)',
                  color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {catchUp.significantEventsCount} event{catchUp.significantEventsCount === 1 ? '' : 's'}
              </span>
            </div>

            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              {catchUp.narrative}
            </p>
          </div>
        </div>

        {/* Mark as Caught Up Button */}
        <button
          onClick={handleCatchUpClick}
          disabled={marking || loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 0.875rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            borderRadius: '8px',
            border: '1px solid var(--accent-blue)',
            backgroundColor: 'transparent',
            color: 'var(--accent-blue)',
            cursor: marking || loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0,
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
          <Check size={14} />
          <span>{marking ? 'Updating...' : 'Mark as Caught Up'}</span>
        </button>
      </div>

      {/* Chronological Timeline Stream */}
      <div style={{ padding: '0.5rem 1.25rem' }}>
        {catchUp.events.map((event, idx) => {
          const isUp = event.direction === 'UP' || (event.percentageChange && event.percentageChange > 0);
          const isDown = event.direction === 'DOWN' || (event.percentageChange && event.percentageChange < 0);
          const hasPct = event.percentageChange !== undefined && event.percentageChange !== null;
          const isReaction = event.eventType === 'NEWS_PRICE_REACTION';
          const isNews = event.eventType === 'MATERIAL_NEWS';

          return (
            <div
              key={`${event.symbol}-${event.detectedAt}-${idx}`}
              onClick={() => onSelectStock && onSelectStock(event.symbol)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '0.75rem 0',
                borderBottom: idx === catchUp.events.length - 1 ? 'none' : '1px solid var(--border-card)',
                cursor: onSelectStock ? 'pointer' : 'default',
                gap: '1rem',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (onSelectStock) e.currentTarget.style.backgroundColor = 'var(--table-row-hover, rgba(0,0,0,0.01))';
              }}
              onMouseLeave={(e) => {
                if (onSelectStock) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {/* Left timeline info */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                {/* Time badge */}
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    paddingTop: '2px',
                    minWidth: '54px',
                  }}
                >
                  {formatEventTime(event.detectedAt)}
                </span>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {event.symbol}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {event.companyName}
                    </span>

                    {/* Event Type Badge */}
                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px',
                        backgroundColor: isReaction
                          ? 'rgba(37, 99, 235, 0.1)'
                          : isNews
                          ? 'rgba(100, 116, 139, 0.1)'
                          : isUp
                          ? 'var(--market-up-bg, rgba(0, 179, 134, 0.1))'
                          : 'var(--market-down-bg, rgba(235, 91, 91, 0.1))',
                        color: isReaction
                          ? 'var(--accent-blue)'
                          : isNews
                          ? 'var(--text-secondary)'
                          : isUp
                          ? 'var(--market-up)'
                          : 'var(--market-down)',
                      }}
                    >
                      {isReaction ? 'News Reaction' : isNews ? 'Notable News' : 'Price Move'}
                    </span>
                  </div>

                  {/* Summary / Reason */}
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
                    {event.summary}
                  </p>

                  {/* Optional news headline link */}
                  {event.newsHeadline && (
                    <div style={{ marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Newspaper size={12} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                      <a
                        href={event.newsUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--accent-blue)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          maxWidth: '450px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {event.newsHeadline}
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Percentage Change Pill */}
              {hasPct && (
                <div style={{ textAlign: 'right', flexShrink: 0, paddingTop: '2px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.2rem',
                      fontSize: '0.8125rem',
                      fontWeight: 700,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '6px',
                      backgroundColor: isUp
                        ? 'var(--market-up-bg, rgba(0, 179, 134, 0.1))'
                        : isDown
                        ? 'var(--market-down-bg, rgba(235, 91, 91, 0.1))'
                        : 'var(--border-card)',
                      color: isUp ? 'var(--market-up)' : isDown ? 'var(--market-down)' : 'var(--text-secondary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {isUp && <TrendingUp size={13} />}
                    {isDown && <TrendingDown size={13} />}
                    {isUp ? '+' : ''}
                    {event.percentageChange?.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
