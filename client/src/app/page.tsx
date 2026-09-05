'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  WatchlistSummary,
  WatchlistWithItems,
  Quote,
  MarketSignalEvent,
  CatchUpResponse,
  StockSparklineData,
} from '@watchlist/shared';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { AuthModal } from '../components/AuthModal';
import { WatchlistSelector } from '../components/WatchlistSelector';
import { StockTable } from '../components/StockTable';
import { AddStockModal } from '../components/AddStockModal';
import { StockChartModal } from '../components/StockChartModal';
import { SignalDetailModal } from '../components/SignalDetailModal';
import { SignalHistoryModal } from '../components/SignalHistoryModal';
import { GlobalSignalsModal } from '../components/GlobalSignalsModal';
import { DeleteWatchlistModal } from '../components/DeleteWatchlistModal';
import { MarketSignalsPanel } from '../components/MarketSignalsPanel';
import { ThemeToggle } from '../components/ThemeToggle';
import { WebSocketProvider, useWebSocket } from '../context/WebSocketContext';
import {
  TrendingUp,
  RefreshCw,
  Plus,
  LogOut,
  Layers,
  Activity,
  AlertCircle,
  Zap,
  X,
  Radio,
} from 'lucide-react';

export default function HomePage() {
  const token = typeof window !== 'undefined' ? api.getToken() : null;

  return (
    <WebSocketProvider token={token}>
      <WatchlistDashboard />
    </WebSocketProvider>
  );
}

function WatchlistDashboard() {
  const { user, isAuthenticated, loading: authLoading, login, register, logout } = useAuth();
  const {
    status: wsStatus,
    subscribeSymbols,
    subscribeWatchlist,
    addQuoteListener,
    addSignalListener,
    addSparklineListener,
  } = useWebSocket();

  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [currentWatchlist, setCurrentWatchlist] = useState<WatchlistWithItems | null>(null);
  const [quotesMap, setQuotesMap] = useState<Record<string, Quote>>({});
  const [sparklinesMap, setSparklinesMap] = useState<Record<string, StockSparklineData>>({});
  const [catchUpResult, setCatchUpResult] = useState<CatchUpResponse | null>(null);

  const [catchUpLoading, setCatchUpLoading] = useState<boolean>(false);
  const [activeSignals, setActiveSignals] = useState<MarketSignalEvent[]>([]);
  const [allGlobalSignals, setAllGlobalSignals] = useState<MarketSignalEvent[]>([]);
  const [globalActiveCount, setGlobalActiveCount] = useState<number>(0);
  const [diffLoading, setDiffLoading] = useState<boolean>(false);
  const [dataLoading, setDataLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Selected Stock for contextual Right Panel
  const [selectedWorkspaceStock, setSelectedWorkspaceStock] = useState<{ symbol: string; quote?: Quote } | null>(null);

  // --- Real-time WebSocket Subscriptions & Listeners ---

  // 1. Subscribe to symbols of current watchlist
  useEffect(() => {
    if (currentWatchlist && currentWatchlist.items) {
      const symbols = currentWatchlist.items.map((i) => i.symbol);
      subscribeSymbols(symbols);
      subscribeWatchlist(currentWatchlist.id);
    }
  }, [currentWatchlist, subscribeSymbols, subscribeWatchlist]);

  // 2. Real-time Quote updates listener
  useEffect(() => {
    const unsub = addQuoteListener((incomingQuotes) => {
      setQuotesMap((prev) => {
        const next = { ...prev };
        for (const q of incomingQuotes) {
          next[q.symbol.toUpperCase()] = q;
        }
        return next;
      });

      setSelectedWorkspaceStock((prev) => {
        if (!prev) return null;
        const matched = incomingQuotes.find(
          (q) => q.symbol.toUpperCase() === prev.symbol.toUpperCase()
        );
        return matched ? { ...prev, quote: matched } : prev;
      });
    });
    return unsub;
  }, [addQuoteListener]);

  // 3. Real-time Market Signals listener
  useEffect(() => {
    const unsub = addSignalListener((newSignal) => {
      setActiveSignals((prev) => {
        if (prev.some((s) => s.id === newSignal.id)) return prev;
        return [newSignal, ...prev];
      });
      setAllGlobalSignals((prev) => {
        if (prev.some((s) => s.id === newSignal.id)) return prev;
        return [newSignal, ...prev];
      });
      setGlobalActiveCount((prev) => prev + 1);
    });
    return unsub;
  }, [addSignalListener]);

  // 4. Real-time Sparklines listener
  useEffect(() => {
    const unsub = addSparklineListener((wId, newSparklines) => {
      if (wId === selectedWatchlistId) {
        setSparklinesMap(newSparklines);
      }
    });
    return unsub;
  }, [addSparklineListener, selectedWatchlistId]);

  // Modals state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAddStockOpen, setIsAddStockOpen] = useState(false);
  const [selectedChartStock, setSelectedChartStock] = useState<{ symbol: string; quote?: Quote } | null>(null);
  const [selectedSignalDetail, setSelectedSignalDetail] = useState<MarketSignalEvent | null>(null);
  const [selectedHistorySymbol, setSelectedHistorySymbol] = useState<string | null>(null);
  const [isGlobalSignalsOpen, setIsGlobalSignalsOpen] = useState(false);
  const [deleteTargetWatchlist, setDeleteTargetWatchlist] = useState<{ id: string; name: string } | null>(null);

  // --- Load Global Active Signals Count ---
  const loadGlobalActiveSignals = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.getActiveSignals();
      setGlobalActiveCount(res.activeCount || (res.signals ? res.signals.length : 0));
      setAllGlobalSignals(res.signals || []);
    } catch (err) {
      console.warn('Failed to load global active signals count:', err);
    }
  }, [isAuthenticated]);

  // --- Load Catch-Up Brief ---
  const loadCatchUp = useCallback(async () => {
    if (!selectedWatchlistId || !isAuthenticated) return;
    try {
      setCatchUpLoading(true);
      const brief = await api.getCatchUpBrief(selectedWatchlistId);
      setCatchUpResult(brief);
    } catch (err: unknown) {
      console.warn('Failed to load catch-up brief:', err);
    } finally {
      setCatchUpLoading(false);
    }
  }, [selectedWatchlistId, isAuthenticated]);

  // --- Load Watchlist Signals & Diff ---
  const loadSignalsAndDiff = useCallback(async (peek = false) => {
    if (!selectedWatchlistId || !isAuthenticated) return;
    try {
      setDiffLoading(true);

      // 1. Evaluate diff (which persists new Market Signals on backend)
      await api.getWatchlistDiff(selectedWatchlistId, peek);

      // 2. Fetch all currently active 24-hour signals for this watchlist
      const signalsRes = await api.getActiveSignalsForWatchlist(selectedWatchlistId);
      setActiveSignals(signalsRes.signals || []);

      // 3. Refresh global active count & Catch-Up brief
      loadGlobalActiveSignals();
      loadCatchUp();
    } catch (err: unknown) {
      console.warn('Failed to load watchlist signals:', err);
    } finally {
      setDiffLoading(false);
    }
  }, [selectedWatchlistId, isAuthenticated, loadGlobalActiveSignals, loadCatchUp]);

  // --- Handle Mark as Caught Up ---
  const handleMarkCaughtUp = async () => {
    if (!selectedWatchlistId) return;
    try {
      await api.acknowledgeCatchUp(selectedWatchlistId);
      await loadSignalsAndDiff(false);
    } catch (err: unknown) {
      console.error('Failed to mark as caught up:', err);
    }
  };

  // --- Load User's Watchlists ---
  const loadWatchlists = useCallback(async (selectId?: string) => {
    if (!isAuthenticated) return;
    try {
      setDataLoading(true);
      const { watchlists: lists } = await api.getWatchlists();
      setWatchlists(lists);

      if (lists.length > 0) {
        const targetId = selectId || selectedWatchlistId || lists[0].id;
        const exists = lists.some((l) => l.id === targetId);
        const activeId = exists ? targetId : lists[0].id;
        setSelectedWatchlistId(activeId);
      } else {
        // Automatically create a default watchlist if user has none
        const { watchlist: defaultWl } = await api.createWatchlist('My Watchlist');
        setWatchlists([{ ...defaultWl, itemCount: 0 }]);
        setSelectedWatchlistId(defaultWl.id);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load watchlists');
    } finally {
      setDataLoading(false);
    }
  }, [isAuthenticated, selectedWatchlistId]);

  // --- Load Current Watchlist Details & Stored Quotes ---
  const loadActiveWatchlist = useCallback(async () => {
    if (!selectedWatchlistId || !isAuthenticated) return;
    try {
      setDataLoading(true);
      const { watchlist } = await api.getWatchlist(selectedWatchlistId);
      setCurrentWatchlist(watchlist);

      // Fetch stored quotes and sparklines for all symbols in this watchlist
      const symbols = watchlist.items.map((i) => i.symbol);
      if (symbols.length > 0) {
        const [quotesRes, sparklinesRes] = await Promise.all([
          api.getQuotes(symbols).catch(() => ({ quotes: [] })),
          api.getWatchlistSparklines(selectedWatchlistId).catch(() => ({ sparklines: {} })),
        ]);

        const map: Record<string, Quote> = {};
        for (const q of quotesRes.quotes) {
          map[q.symbol.toUpperCase()] = q;
        }
        setQuotesMap(map);
        setSparklinesMap((sparklinesRes as any).sparklines || {});
      } else {
        setQuotesMap({});
        setSparklinesMap({});
      }
      setErrorMessage(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load watchlist data');
    } finally {
      setDataLoading(false);
    }
  }, [selectedWatchlistId, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      loadWatchlists();
      loadGlobalActiveSignals();
    } else {
      setWatchlists([]);
      setCurrentWatchlist(null);
      setQuotesMap({});
      setSparklinesMap({});
      setActiveSignals([]);
      setAllGlobalSignals([]);
      setSelectedWorkspaceStock(null);
      setGlobalActiveCount(0);
    }
  }, [isAuthenticated, loadWatchlists, loadGlobalActiveSignals]);

  useEffect(() => {
    if (selectedWatchlistId) {
      loadActiveWatchlist();
      loadSignalsAndDiff(false); // Evaluate signals on watchlist open/switch
    }
  }, [selectedWatchlistId, loadActiveWatchlist, loadSignalsAndDiff]);

  // Map of active signals by uppercase stock symbol
  const activeSignalsMap: Record<string, MarketSignalEvent> = {};
  for (const sig of activeSignals) {
    activeSignalsMap[sig.stockSymbol.toUpperCase()] = sig;
  }

  // --- Watchlist Actions ---

  const handleCreateWatchlist = async (name: string) => {
    try {
      const { watchlist } = await api.createWatchlist(name);
      await loadWatchlists(watchlist.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create watchlist');
    }
  };

  const handleRenameWatchlist = async (id: string, name: string) => {
    try {
      await api.renameWatchlist(id, name);
      await loadWatchlists(id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to rename watchlist');
    }
  };

  const handleDeleteWatchlist = async (id: string) => {
    try {
      await api.deleteWatchlist(id);
      setSelectedWatchlistId(null);
      await loadWatchlists();
    } catch (err: unknown) {
      throw err;
    }
  };

  // --- Stock Actions ---

  const handleAddStock = async (symbol: string) => {
    if (!selectedWatchlistId) return;
    try {
      await api.addSymbol(selectedWatchlistId, symbol);
      await api.triggerIngestion().catch(() => {});
      await api.triggerNewsIngestion().catch(() => {});
      await loadActiveWatchlist();
      await loadWatchlists(selectedWatchlistId);
      await loadSignalsAndDiff(true);
    } catch (err: unknown) {
      throw err;
    }
  };

  const handleRemoveStock = async (symbol: string) => {
    if (!selectedWatchlistId) return;
    try {
      await api.removeSymbol(selectedWatchlistId, symbol);
      await loadActiveWatchlist();
      await loadWatchlists(selectedWatchlistId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove stock');
    }
  };

  const handleManualSync = async () => {
    try {
      setSyncing(true);
      await api.triggerIngestion();
      await api.triggerNewsIngestion().catch(() => {});
      await loadActiveWatchlist();
      await loadSignalsAndDiff(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Market sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      {/* Top Navbar */}
      <header
        style={{
          backgroundColor: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-card)',
          padding: '0.75rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--accent-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <TrendingUp size={18} strokeWidth={2.5} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Watchlist<span style={{ color: 'var(--accent-blue)' }}>Pulse</span>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          {/* Global Market Signals Button */}
          {isAuthenticated && (
            <button
              onClick={() => setIsGlobalSignalsOpen(true)}
              title="View all active market signals across your watchlists"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 10px',
                backgroundColor: globalActiveCount > 0 ? 'var(--accent-blue-light)' : 'var(--bg-secondary)',
                border: `1px solid ${globalActiveCount > 0 ? 'var(--accent-blue-border)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                color: globalActiveCount > 0 ? 'var(--accent-blue-text)' : 'var(--text-secondary)',
                fontSize: '0.775rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--accent-blue)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = globalActiveCount > 0 ? 'var(--accent-blue-light)' : 'var(--bg-secondary)';
                e.currentTarget.style.color = globalActiveCount > 0 ? 'var(--accent-blue-text)' : 'var(--text-secondary)';
              }}
            >
              <Zap size={13} strokeWidth={2.5} />
              <span className="hidden-mobile">Market Signals</span>
              {globalActiveCount > 0 && (
                <span
                  style={{
                    fontSize: '0.675rem',
                    padding: '1px 5px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'var(--accent-blue)',
                    color: '#ffffff',
                    fontWeight: 700,
                  }}
                >
                  {globalActiveCount}
                </span>
              )}
            </button>
          )}

          {/* Real-time WebSocket Feed Status Badge */}
          {isAuthenticated && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 8px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: wsStatus === 'connected' ? 'var(--market-up-light)' : 'var(--bg-secondary)',
                border: `1px solid ${wsStatus === 'connected' ? 'var(--market-up-border)' : 'var(--border-subtle)'}`,
                fontSize: '0.725rem',
                fontWeight: 600,
                color: wsStatus === 'connected' ? 'var(--market-up)' : 'var(--text-muted)',
                transition: 'all 0.2s ease',
              }}
              title={
                wsStatus === 'connected'
                  ? 'Real-Time WebSocket Feed: Connected'
                  : wsStatus === 'connecting'
                  ? 'Connecting to Real-Time Feed...'
                  : 'Real-Time WebSocket: Offline'
              }
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: wsStatus === 'connected' ? 'var(--market-up)' : wsStatus === 'connecting' ? '#f59e0b' : 'var(--text-muted)',
                  animation: wsStatus === 'connected' ? 'pulse 1.8s ease-in-out infinite' : 'none',
                }}
              />
              <span className="hidden-mobile">
                {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting...' : 'Offline'}
              </span>
            </div>
          )}

          {/* Theme Toggle Button */}
          <ThemeToggle />

          {isAuthenticated ? (
            <>
              <button
                onClick={handleManualSync}
                disabled={syncing}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.775rem',
                  fontWeight: 600,
                  opacity: syncing ? 0.6 : 1,
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!syncing) {
                    e.currentTarget.style.borderColor = 'var(--accent-blue)';
                    e.currentTarget.style.color = 'var(--accent-blue)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <RefreshCw
                  size={13}
                  style={{
                    animation: syncing ? 'spin 0.8s linear infinite' : 'none',
                  }}
                />
                <span className="hidden-mobile">{syncing ? 'Syncing...' : 'Sync'}</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  {user?.email}
                </span>
                <button
                  onClick={logout}
                  title="Sign Out"
                  style={{
                    padding: '5px 8px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-muted)',
                    fontSize: '0.775rem',
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--market-down)';
                    e.currentTarget.style.borderColor = 'var(--market-down-border)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-muted)';
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }}
                >
                  <LogOut size={12} />
                  <span>Sign Out</span>
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              style={{
                padding: '6px 14px',
                backgroundColor: 'var(--accent-blue)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontWeight: 600,
                fontSize: '0.825rem',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-blue-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-blue)')}
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* Main Container - Full width with 16-20px padding */}
      <main style={{ width: '100%', maxWidth: '100%', padding: '0.85rem 1.25rem', flex: 1 }}>
        {errorMessage && (
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: 'var(--market-down-light)',
              border: '1px solid var(--market-down-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--market-down)',
              fontSize: '0.825rem',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={15} />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              style={{
                color: 'var(--market-down)',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '2px',
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {authLoading ? (
          <div
            style={{
              textAlign: 'center',
              padding: '4rem',
              color: 'var(--text-secondary)',
              fontSize: '0.875rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '22px',
                height: '22px',
                border: '2px solid var(--border-subtle)',
                borderTopColor: 'var(--accent-blue)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span>Loading workspace...</span>
          </div>
        ) : !isAuthenticated ? (
          /* Unauthenticated Landing Hero */
          <div
            className="animate-fade-in"
            style={{
              textAlign: 'center',
              padding: '3.5rem 1.5rem',
              backgroundColor: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--border-card)',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.5rem',
              maxWidth: '960px',
              margin: '0 auto',
            }}
          >
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: 'var(--radius-lg)',
                backgroundColor: 'var(--accent-blue-light)',
                color: 'var(--accent-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={28} strokeWidth={2.2} />
            </div>

            <div style={{ maxWidth: '540px' }}>
              <h1
                style={{
                  fontSize: '1.85rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.03em',
                  lineHeight: 1.25,
                  marginBottom: '8px',
                }}
              >
                Track market signals with persistent history
              </h1>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: '0.9rem' }}>
                Organize stocks across custom watchlists, track persistent 24-hour Market Signals, and explore auditable 30-day change history with rule-based reasons and contextual news citations.
              </p>
            </div>

            {/* Feature Highlights */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                width: '100%',
                maxWidth: '720px',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ color: 'var(--accent-blue)', marginBottom: '6px' }}>
                  <Zap size={18} />
                </div>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
                  Persistent Signals
                </h3>
                <p style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Detected price jumps and drops become 24-hour persistent signals that do not disappear on re-check.
                </p>
              </div>

              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ color: 'var(--accent-blue)', marginBottom: '6px' }}>
                  <Activity size={18} />
                </div>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
                  30-Day Change History
                </h3>
                <p style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Audit every past market movement and news citation recorded over the last 30 days.
                </p>
              </div>

              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ color: 'var(--accent-blue)', marginBottom: '6px' }}>
                  <Layers size={18} />
                </div>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
                  Multi-Watchlists
                </h3>
                <p style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Create custom watchlists for Nifty 50, Tech Giants, US Stocks, and more.
                </p>
              </div>
            </div>

            <div>
              <button
                onClick={() => setIsAuthModalOpen(true)}
                style={{
                  padding: '0.75rem 1.75rem',
                  backgroundColor: 'var(--accent-blue)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  boxShadow: 'var(--shadow-md)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-blue-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-blue)')}
              >
                Get Started — Sign In
              </button>
            </div>
          </div>
        ) : (
          /* Authenticated Watchlist Dashboard */
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Watchlist Tabs & Selector */}
            <WatchlistSelector
              watchlists={watchlists}
              selectedId={selectedWatchlistId}
              onSelect={(id) => setSelectedWatchlistId(id)}
              onCreate={handleCreateWatchlist}
              onRename={handleRenameWatchlist}
              onDelete={(id, name) => setDeleteTargetWatchlist({ id, name })}
            />

            {/* Two-Panel Workspace Grid */}
            <div className="workspace-grid">
              {/* Left Panel: Single Header + Stock Table */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border-card)',
                  boxShadow: 'var(--shadow-card)',
                  overflow: 'hidden',
                  minWidth: 0,
                }}
              >
                {/* Single Compact Watchlist Header */}
                {currentWatchlist && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      backgroundColor: 'var(--bg-secondary)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                        {currentWatchlist.name}
                      </h2>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        · {currentWatchlist.items.length} {currentWatchlist.items.length === 1 ? 'stock' : 'stocks'}
                      </span>
                    </div>

                    <button
                      onClick={() => setIsAddStockOpen(true)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 10px',
                        backgroundColor: 'var(--accent-blue)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 600,
                        fontSize: '0.775rem',
                        boxShadow: 'var(--shadow-sm)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-blue-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-blue)')}
                    >
                      <Plus size={13} strokeWidth={2.5} />
                      <span>Add Stock</span>
                    </button>
                  </div>
                )}

                {/* Stock Quotes Table */}
                <StockTable
                  items={currentWatchlist?.items || []}
                  quotesMap={quotesMap}
                  activeSignalsMap={activeSignalsMap}
                  sparklinesMap={sparklinesMap}
                  selectedSymbol={selectedWorkspaceStock?.symbol || null}
                  loading={dataLoading}
                  onRemoveStock={handleRemoveStock}
                  onOpenAddModal={() => setIsAddStockOpen(true)}
                  onSelectStock={(symbol, quote) => setSelectedWorkspaceStock({ symbol, quote })}
                  onOpenSignal={(sig) => {
                    const quote = quotesMap[sig.stockSymbol.toUpperCase()];
                    setSelectedWorkspaceStock({ symbol: sig.stockSymbol, quote });
                  }}
                  onOpenHistory={(symbol) => setSelectedHistorySymbol(symbol)}
                />
              </div>

              {/* Right Panel: Market Signals with embedded Catch-Up */}
              <div style={{ position: 'sticky', top: '70px' }}>
                <MarketSignalsPanel
                  selectedStock={selectedWorkspaceStock}
                  activeSignals={activeSignals}
                  globalActiveSignals={allGlobalSignals}
                  catchUp={catchUpResult}
                  catchUpLoading={catchUpLoading}
                  loading={diffLoading}
                  onMarkCaughtUp={handleMarkCaughtUp}
                  onSelectStock={(symbol) => {
                    const quote = quotesMap[symbol.toUpperCase()];
                    setSelectedWorkspaceStock({ symbol, quote });
                  }}
                  onClearSelection={() => setSelectedWorkspaceStock(null)}
                  onOpenSignalDetail={(sig) => setSelectedSignalDetail(sig)}
                  onOpenHistory={(symbol) => setSelectedHistorySymbol(symbol)}
                  onOpenChart={(symbol) => {
                    const quote = quotesMap[symbol.toUpperCase()];
                    setSelectedChartStock({ symbol, quote });
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLogin={login}
        onRegister={register}
      />

      <AddStockModal
        isOpen={isAddStockOpen}
        onClose={() => setIsAddStockOpen(false)}
        onAddStock={handleAddStock}
        existingSymbols={currentWatchlist?.items.map((i) => i.symbol) || []}
      />

      <StockChartModal
        isOpen={!!selectedChartStock}
        symbol={selectedChartStock?.symbol || null}
        quote={selectedChartStock?.quote}
        onClose={() => setSelectedChartStock(null)}
      />

      <SignalDetailModal
        isOpen={!!selectedSignalDetail}
        signal={selectedSignalDetail}
        onClose={() => setSelectedSignalDetail(null)}
        onOpenHistory={(symbol) => setSelectedHistorySymbol(symbol)}
      />

      <SignalHistoryModal
        isOpen={!!selectedHistorySymbol}
        symbol={selectedHistorySymbol}
        onClose={() => setSelectedHistorySymbol(null)}
      />

      <GlobalSignalsModal
        isOpen={isGlobalSignalsOpen}
        onClose={() => setIsGlobalSignalsOpen(false)}
        onSelectStock={(symbol) => {
          const quote = quotesMap[symbol.toUpperCase()];
          setSelectedChartStock({ symbol, quote });
        }}
      />

      <DeleteWatchlistModal
        isOpen={!!deleteTargetWatchlist}
        watchlistId={deleteTargetWatchlist?.id || null}
        watchlistName={deleteTargetWatchlist?.name || null}
        onClose={() => setDeleteTargetWatchlist(null)}
        onConfirmDelete={handleDeleteWatchlist}
      />
    </div>
  );
}
