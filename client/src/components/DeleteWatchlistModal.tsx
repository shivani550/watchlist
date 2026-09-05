'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

interface DeleteWatchlistModalProps {
  isOpen: boolean;
  watchlistId: string | null;
  watchlistName: string | null;
  onClose: () => void;
  onConfirmDelete: (id: string) => Promise<void>;
}

export const DeleteWatchlistModal: React.FC<DeleteWatchlistModalProps> = ({
  isOpen,
  watchlistId,
  watchlistName,
  onClose,
  onConfirmDelete,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management & body scroll lock
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setLoading(false);
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const timer = setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);

      return () => {
        document.body.style.overflow = originalOverflow;
        clearTimeout(timer);
      };
    }
  }, [isOpen]);

  // Keyboard navigation (Escape to close, Tab trap)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!loading) onClose();
      } else if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === cancelButtonRef.current) {
            e.preventDefault();
            deleteButtonRef.current?.focus();
          }
        } else {
          if (document.activeElement === deleteButtonRef.current) {
            e.preventDefault();
            cancelButtonRef.current?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen || !watchlistId) return null;

  const handleDelete = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirmDelete(watchlistId);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete watchlist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-watchlist-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--modal-overlay)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="animate-fade-in"
        style={{
          width: 'min(400px, calc(100vw - 32px))',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-popover)',
          padding: '1.25rem 1.35rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          height: 'auto',
          maxHeight: 'none',
          overflow: 'visible',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header & Copy */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--market-down-light)',
              color: 'var(--market-down)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: '2px',
            }}
          >
            <Trash2 size={16} strokeWidth={2.2} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              id="delete-watchlist-title"
              style={{
                fontSize: '0.975rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: '0 0 4px 0',
                lineHeight: 1.3,
              }}
            >
              Delete watchlist?
            </h3>
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-secondary)',
                margin: 0,
                lineHeight: 1.45,
              }}
            >
              Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>&ldquo;{watchlistName}&rdquo;</strong>? This action cannot be undone.
            </p>
          </div>
        </div>

        {/* Error Notice */}
        {error && (
          <div
            style={{
              padding: '0.5rem 0.75rem',
              backgroundColor: 'var(--market-down-light)',
              border: '1px solid var(--market-down-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--market-down)',
              fontSize: '0.775rem',
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '0.25rem',
          }}
        >
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={loading}
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                e.currentTarget.style.borderColor = 'var(--border-card)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }
            }}
          >
            Cancel
          </button>

          <button
            ref={deleteButtonRef}
            type="button"
            disabled={loading}
            onClick={handleDelete}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--market-down)',
              backgroundColor: 'var(--market-down)',
              color: '#ffffff',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.filter = 'brightness(0.9)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.filter = 'none';
              }
            }}
          >
            <Trash2 size={13} strokeWidth={2.2} />
            <span>{loading ? 'Deleting...' : 'Delete'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
