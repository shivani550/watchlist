'use client';

import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '34px',
        height: '34px',
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)';
        e.currentTarget.style.borderColor = 'var(--border-card)';
        e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
        e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
      }}
    >
      {theme === 'dark' ? (
        <Sun size={17} strokeWidth={2} />
      ) : (
        <Moon size={17} strokeWidth={2} />
      )}
    </button>
  );
};
