'use client';

import React, { useState } from 'react';
import { X, AlertCircle, LogIn, UserPlus } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onLogin: (email: string, pass: string) => Promise<any>;
  onRegister: (email: string, pass: string) => Promise<any>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLogin,
  onRegister,
}) => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        await onRegister(email, password);
      } else {
        await onLogin(email, password);
      }
      if (onClose) onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = () => {
    setEmail('trader@example.com');
    setPassword('Password123!');
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
    >
      <div
        className="animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          padding: '2rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {isRegister ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
              {isRegister ? 'Start tracking your customized stock watchlists' : 'Sign in to access your watchlists'}
            </p>
          </div>
          {onClose && (
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
          )}
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>

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
              Password (min 8 characters)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.5rem',
              padding: '0.8rem',
              backgroundColor: 'var(--accent-blue)',
              color: '#ffffff',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600,
              fontSize: '0.9rem',
              opacity: loading ? 0.7 : 1,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: 'var(--shadow-sm)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = 'var(--accent-blue-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--accent-blue)';
            }}
          >
            {isRegister ? <UserPlus size={16} /> : <LogIn size={16} />}
            {loading ? 'Please wait...' : isRegister ? 'Register Account' : 'Sign In'}
          </button>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '0.75rem',
              fontSize: '0.8rem',
            }}
          >
            <button
              type="button"
              onClick={fillDemo}
              style={{
                color: 'var(--accent-blue)',
                fontWeight: 600,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Fill Demo Credentials
            </button>

            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
              }}
              style={{
                color: 'var(--text-secondary)',
                fontWeight: 500,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {isRegister ? 'Already registered? Sign in' : "Don't have an account? Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
