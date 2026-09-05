'use client';

import React, { useState } from 'react';
import { X, Search, Plus, Check, AlertCircle } from 'lucide-react';

interface AddStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddStock: (symbol: string) => Promise<any>;
  existingSymbols: string[];
}

const POPULAR_SUGGESTIONS = [
  'RELIANCE',
  'TCS',
  'INFY',
  'HDFCBANK',
  'ICICIBANK',
  'AAPL',
  'MSFT',
  'GOOG',
  'NVDA',
  'TSLA',
];

export const AddStockModal: React.FC<AddStockModalProps> = ({
  isOpen,
  onClose,
  onAddStock,
  existingSymbols,
}) => {
  const [symbolInput, setSymbolInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAdd = async (rawSym: string) => {
    const symbol = rawSym.trim().toUpperCase();
    if (!symbol) return;

    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
      setError('Symbols must be 1–20 uppercase characters.');
      return;
    }

    if (existingSymbols.map((s) => s.toUpperCase()).includes(symbol)) {
      setError(`${symbol} is already in this watchlist.`);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await onAddStock(symbol);
      setSymbolInput('');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add stock');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAdd(symbolInput);
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
          maxWidth: '460px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          padding: '1.75rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Add Stock to Watchlist
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Search Indian & Global NSE/BSE/US ticker symbols
            </p>
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

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: 'var(--market-down-light)',
              border: '1px solid var(--market-down-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--market-down)',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.775rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Stock Symbol
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Search size={16} />
              </div>
              <input
                type="text"
                autoFocus
                placeholder="e.g. RELIANCE, TCS, AAPL"
                value={symbolInput}
                onChange={(e) => {
                  setSymbolInput(e.target.value.toUpperCase());
                  setError(null);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem 0.75rem 2.25rem',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={loading || !symbolInput.trim()}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: 'var(--accent-blue)',
                  color: '#ffffff',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  opacity: loading || !symbolInput.trim() ? 0.6 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: loading || !symbolInput.trim() ? 'not-allowed' : 'pointer',
                  border: 'none',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!loading && symbolInput.trim()) {
                    e.currentTarget.style.backgroundColor = 'var(--accent-blue-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--accent-blue)';
                }}
              >
                <Plus size={16} strokeWidth={2.5} />
                {loading ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>

          <div>
            <span
              style={{
                fontSize: '0.775rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Popular Stocks:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {POPULAR_SUGGESTIONS.map((sym) => {
                const isAdded = existingSymbols.map((s) => s.toUpperCase()).includes(sym);
                return (
                  <button
                    key={sym}
                    type="button"
                    disabled={isAdded || loading}
                    onClick={() => handleAdd(sym)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: isAdded ? 'var(--bg-secondary)' : 'var(--bg-card)',
                      border: `1px solid ${isAdded ? 'var(--border-subtle)' : 'var(--border-card)'}`,
                      color: isAdded ? 'var(--text-muted)' : 'var(--text-primary)',
                      fontSize: '0.775rem',
                      fontWeight: 600,
                      cursor: isAdded ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isAdded && !loading) {
                        e.currentTarget.style.borderColor = 'var(--accent-blue)';
                        e.currentTarget.style.color = 'var(--accent-blue)';
                        e.currentTarget.style.backgroundColor = 'var(--accent-blue-light)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isAdded) {
                        e.currentTarget.style.borderColor = 'var(--border-card)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                        e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                      }
                    }}
                  >
                    <span>{sym}</span>
                    {isAdded ? (
                      <Check size={12} strokeWidth={2.5} color="var(--market-up)" />
                    ) : (
                      <Plus size={12} strokeWidth={2.5} color="var(--text-muted)" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
