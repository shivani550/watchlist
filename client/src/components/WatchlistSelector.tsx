'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { WatchlistSummary } from '@watchlist/shared';
import { Plus, MoreVertical, Edit2, Trash2, Check, X } from 'lucide-react';

interface WatchlistSelectorProps {
  watchlists: WatchlistSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<any>;
  onRename: (id: string, name: string) => Promise<any>;
  onDelete: (id: string, name: string) => void;
}

export const WatchlistSelector: React.FC<WatchlistSelectorProps> = ({
  watchlists,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; openUpward: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle outside click, scroll, resize, and keyboard Escape
  useEffect(() => {
    if (!menuOpenId) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setMenuOpenId(null);
        setMenuPos(null);
      }
    };

    const handleScrollOrResize = () => {
      setMenuOpenId(null);
      setMenuPos(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpenId(null);
        setMenuPos(null);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpenId]);

  const handleMenuToggle = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation();
    if (menuOpenId === id) {
      setMenuOpenId(null);
      setMenuPos(null);
    } else {
      menuButtonRef.current = e.currentTarget;
      const rect = e.currentTarget.getBoundingClientRect();
      const menuWidth = 175;
      const menuHeight = 90;

      let top = rect.bottom + 6;
      let openUpward = false;
      if (rect.bottom + menuHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - menuHeight - 6);
        openUpward = true;
      }

      let left = rect.left;
      if (left + menuWidth > window.innerWidth - 16) {
        left = Math.max(12, rect.right - menuWidth);
      }

      setMenuPos({ top, left, openUpward });
      setMenuOpenId(id);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWatchlistName.trim()) return;
    setLoading(true);
    try {
      await onCreate(newWatchlistName.trim());
      setNewWatchlistName('');
      setIsCreating(false);
    } finally {
      setLoading(false);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !editName.trim()) return;
    setLoading(true);
    try {
      await onRename(editingId, editName.trim());
      setEditingId(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
      {/* Tab Navigation Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          borderBottom: '1px solid var(--border-card)',
          paddingBottom: '0.75rem',
          flexWrap: 'nowrap',
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            paddingBottom: '2px',
          }}
        >
          {watchlists.map((wl) => {
            const isSelected = wl.id === selectedId;
            const isEditing = editingId === wl.id;
            const isMenuOpen = menuOpenId === wl.id;

            if (isEditing) {
              return (
                <form
                  key={wl.id}
                  onSubmit={handleRenameSubmit}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--accent-blue)',
                    borderRadius: 'var(--radius-full)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <input
                    type="text"
                    required
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{
                      border: 'none',
                      outline: 'none',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      backgroundColor: 'transparent',
                      color: 'var(--text-primary)',
                      padding: '2px 4px',
                      width: '120px',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={loading || !editName.trim()}
                    style={{
                      color: 'var(--accent-blue)',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px',
                    }}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    style={{
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px',
                    }}
                  >
                    <X size={14} />
                  </button>
                </form>
              );
            }

            return (
              <div
                key={wl.id}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <div
                  onClick={() => onSelect(wl.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: isSelected ? 'var(--accent-blue-light)' : 'var(--bg-card)',
                    color: isSelected ? 'var(--accent-blue-text)' : 'var(--text-secondary)',
                    border: `1px solid ${isSelected ? 'var(--accent-blue-border)' : 'var(--border-card)'}`,
                    fontSize: '0.85rem',
                    fontWeight: isSelected ? 600 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = 'var(--border-hover)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = 'var(--border-card)';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                    }
                  }}
                >
                  <span>{wl.name}</span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: isSelected ? 'var(--bg-card)' : 'var(--bg-secondary)',
                      color: isSelected ? 'var(--accent-blue)' : 'var(--text-muted)',
                      border: isSelected ? '1px solid var(--accent-blue-border)' : 'none',
                      fontWeight: 600,
                    }}
                  >
                    {wl.itemCount}
                  </span>

                  {isSelected && (
                    <button
                      type="button"
                      title="Watchlist Options"
                      aria-expanded={isMenuOpen}
                      aria-haspopup="true"
                      onClick={(e) => handleMenuToggle(e, wl.id)}
                      style={{
                        color: 'var(--accent-blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '1px 2px',
                        marginLeft: '2px',
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: isMenuOpen ? 'var(--accent-blue-border)' : 'transparent',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <MoreVertical size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add New Watchlist Button */}
          {!isCreating && (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '7px 12px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'transparent',
                border: '1px dashed var(--border-card)',
                color: 'var(--text-secondary)',
                fontSize: '0.82rem',
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-blue)';
                e.currentTarget.style.color = 'var(--accent-blue)';
                e.currentTarget.style.backgroundColor = 'var(--accent-blue-light)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-card)';
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Plus size={14} />
              New Watchlist
            </button>
          )}

          {/* Create Watchlist Inline Form */}
          {isCreating && (
            <form
              onSubmit={handleCreateSubmit}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--accent-blue)',
                borderRadius: 'var(--radius-full)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <input
                type="text"
                required
                autoFocus
                placeholder="Watchlist Name"
                value={newWatchlistName}
                onChange={(e) => setNewWatchlistName(e.target.value)}
                style={{
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                  padding: '2px 4px',
                  width: '130px',
                }}
              />
              <button
                type="submit"
                disabled={loading || !newWatchlistName.trim()}
                style={{
                  color: 'var(--accent-blue)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px',
                }}
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setNewWatchlistName('');
                }}
                style={{
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px',
                }}
              >
                <X size={14} />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Viewport-Level Portal Dropdown Menu (Escapes Parent Overflow & Stacking Contexts) */}
      {mounted &&
        menuOpenId &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="animate-fade-in"
            style={{
              position: 'fixed',
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-popover)',
              zIndex: 1000,
              minWidth: '175px',
              width: 'max-content',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              overflow: 'visible',
              height: 'auto',
              maxHeight: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const targetWl = watchlists.find((w) => w.id === menuOpenId);
                if (targetWl) {
                  setEditingId(targetWl.id);
                  setEditName(targetWl.name);
                }
                setMenuOpenId(null);
                setMenuPos(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 10px',
                fontSize: '0.825rem',
                fontWeight: 500,
                color: 'var(--text-primary)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background-color 0.12s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Edit2 size={13} style={{ color: 'var(--text-secondary)' }} />
              <span>Rename Watchlist</span>
            </button>

            {watchlists.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const targetWl = watchlists.find((w) => w.id === menuOpenId);
                  const idToDelete = menuOpenId;
                  const nameToDelete = targetWl?.name || '';
                  setMenuOpenId(null);
                  setMenuPos(null);
                  onDelete(idToDelete, nameToDelete);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '0.825rem',
                  fontWeight: 500,
                  color: 'var(--market-down)',
                  borderRadius: 'var(--radius-sm)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color 0.12s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--market-down-light)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <Trash2 size={13} />
                <span>Delete Watchlist</span>
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
