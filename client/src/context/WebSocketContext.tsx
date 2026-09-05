'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  Quote,
  MarketSignalEvent,
  StockSparklineData,
  ClientWebSocketMessage,
  ServerWebSocketMessage,
} from '@watchlist/shared';

export type WebSocketStatus = 'connected' | 'connecting' | 'disconnected';

interface WebSocketContextType {
  status: WebSocketStatus;
  subscribeSymbols: (symbols: string[]) => void;
  unsubscribeSymbols: (symbols: string[]) => void;
  subscribeWatchlist: (watchlistId: string) => void;
  unsubscribeWatchlist: (watchlistId: string) => void;
  addQuoteListener: (listener: (quotes: Quote[]) => void) => () => void;
  addSignalListener: (listener: (signal: MarketSignalEvent) => void) => () => void;
  addSparklineListener: (
    listener: (watchlistId: string, sparklines: Record<string, StockSparklineData>) => void
  ) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const WebSocketProvider: React.FC<{
  children: React.ReactNode;
  token?: string | null;
}> = ({ children, token }) => {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef<number>(1000);
  const activeSymbolsRef = useRef<Set<string>>(new Set());
  const activeWatchlistsRef = useRef<Set<string>>(new Set());

  // Listener sets
  const quoteListenersRef = useRef<Set<(quotes: Quote[]) => void>>(new Set());
  const signalListenersRef = useRef<Set<(signal: MarketSignalEvent) => void>>(new Set());
  const sparklineListenersRef = useRef<
    Set<(watchlistId: string, sparklines: Record<string, StockSparklineData>) => void>
  >(new Set());

  const getWsUrl = useCallback(() => {
    if (typeof window === 'undefined') return 'ws://localhost:5000/ws';
    const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envApiUrl) {
      const url = new URL(envApiUrl);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}/ws`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    // Default server port is 5000 if running locally
    return `${protocol}//${host}:5000/ws`;
  }, []);

  const send = useCallback((msg: ClientWebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus('connecting');
    const wsUrl = getWsUrl();
    const fullUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;

    try {
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        reconnectDelayRef.current = 1000;

        // If token exists, send auth payload as fallback
        if (token) {
          send({ type: 'AUTH', token });
        }

        // Resubscribe to active symbols & watchlists
        if (activeSymbolsRef.current.size > 0) {
          send({
            type: 'SUBSCRIBE_SYMBOLS',
            symbols: Array.from(activeSymbolsRef.current),
          });
        }
        for (const wId of activeWatchlistsRef.current) {
          send({ type: 'SUBSCRIBE_WATCHLIST', watchlistId: wId });
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerWebSocketMessage;
          switch (msg.type) {
            case 'QUOTE_UPDATE':
              for (const listener of quoteListenersRef.current) {
                listener(msg.quotes);
              }
              break;

            case 'SIGNAL_DETECTED':
              for (const listener of signalListenersRef.current) {
                listener(msg.signal);
              }
              break;

            case 'SPARKLINE_UPDATE':
              for (const listener of sparklineListenersRef.current) {
                listener(msg.watchlistId, msg.sparklines);
              }
              break;

            case 'AUTH_OK':
              // Authenticated successfully
              break;

            case 'PONG':
              break;

            default:
              break;
          }
        } catch {
          // Ignore unparseable message
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setStatus('disconnected');
      scheduleReconnect();
    }
  }, [getWsUrl, token, send]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    const delay = reconnectDelayRef.current;
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectDelayRef.current = Math.min(delay * 1.5, 15000);
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Handle token changes
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && token) {
      send({ type: 'AUTH', token });
    }
  }, [token, send]);

  const subscribeSymbols = useCallback(
    (symbols: string[]) => {
      const newSymbols: string[] = [];
      for (const raw of symbols) {
        const s = raw.toUpperCase().trim();
        if (!activeSymbolsRef.current.has(s)) {
          activeSymbolsRef.current.add(s);
          newSymbols.push(s);
        }
      }
      if (newSymbols.length > 0) {
        send({ type: 'SUBSCRIBE_SYMBOLS', symbols: newSymbols });
      }
    },
    [send]
  );

  const unsubscribeSymbols = useCallback(
    (symbols: string[]) => {
      const removed: string[] = [];
      for (const raw of symbols) {
        const s = raw.toUpperCase().trim();
        if (activeSymbolsRef.current.has(s)) {
          activeSymbolsRef.current.delete(s);
          removed.push(s);
        }
      }
      if (removed.length > 0) {
        send({ type: 'UNSUBSCRIBE_SYMBOLS', symbols: removed });
      }
    },
    [send]
  );

  const subscribeWatchlist = useCallback(
    (watchlistId: string) => {
      if (!activeWatchlistsRef.current.has(watchlistId)) {
        activeWatchlistsRef.current.add(watchlistId);
        send({ type: 'SUBSCRIBE_WATCHLIST', watchlistId });
      }
    },
    [send]
  );

  const unsubscribeWatchlist = useCallback(
    (watchlistId: string) => {
      if (activeWatchlistsRef.current.has(watchlistId)) {
        activeWatchlistsRef.current.delete(watchlistId);
        send({ type: 'UNSUBSCRIBE_WATCHLIST', watchlistId });
      }
    },
    [send]
  );

  const addQuoteListener = useCallback((listener: (quotes: Quote[]) => void) => {
    quoteListenersRef.current.add(listener);
    return () => {
      quoteListenersRef.current.delete(listener);
    };
  }, []);

  const addSignalListener = useCallback((listener: (signal: MarketSignalEvent) => void) => {
    signalListenersRef.current.add(listener);
    return () => {
      signalListenersRef.current.delete(listener);
    };
  }, []);

  const addSparklineListener = useCallback(
    (listener: (watchlistId: string, sparklines: Record<string, StockSparklineData>) => void) => {
      sparklineListenersRef.current.add(listener);
      return () => {
        sparklineListenersRef.current.delete(listener);
      };
    },
    []
  );

  return (
    <WebSocketContext.Provider
      value={{
        status,
        subscribeSymbols,
        unsubscribeSymbols,
        subscribeWatchlist,
        unsubscribeWatchlist,
        addQuoteListener,
        addSignalListener,
        addSparklineListener,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};
