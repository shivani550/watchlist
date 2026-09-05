import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import {
  ClientWebSocketMessage,
  ServerWebSocketMessage,
  Quote,
  MarketSignalEvent,
  StockSparklineData,
} from '@watchlist/shared';

export class AppWebSocketServer {
  private wss: WebSocketServer | null = null;
  private userSockets = new Map<string, Set<WebSocket>>();
  private socketUser = new Map<WebSocket, string>();
  private symbolSubscriptions = new Map<string, Set<WebSocket>>();
  private watchlistSubscriptions = new Map<string, Set<WebSocket>>();
  private pingInterval: NodeJS.Timeout | null = null;

  /**
   * Initializes and binds WebSocketServer to an existing Node.js HTTP server.
   */
  init(server: HttpServer): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.handleConnection(ws, req.url);
    });

    // Heartbeat to purge dead connections every 30 seconds
    this.pingInterval = setInterval(() => {
      if (!this.wss) return;
      for (const client of this.wss.clients) {
        if ((client as any).isAlive === false) {
          this.cleanupSocket(client);
          client.terminate();
          continue;
        }
        (client as any).isAlive = false;
        try {
          client.ping();
        } catch {
          this.cleanupSocket(client);
        }
      }
    }, 30000);

    if (this.pingInterval.unref) {
      this.pingInterval.unref();
    }

    console.log('[WebSocketServer] Real-time WebSocket server attached at /ws');
  }

  private handleConnection(ws: WebSocket, url?: string): void {
    (ws as any).isAlive = true;

    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    // Check token in query parameters (e.g. /ws?token=...)
    if (url) {
      try {
        const queryIndex = url.indexOf('?');
        if (queryIndex !== -1) {
          const params = new URLSearchParams(url.slice(queryIndex));
          const token = params.get('token');
          if (token) {
            this.authenticateSocket(ws, token);
          }
        }
      } catch (err) {
        // Ignore malformed URL
      }
    }

    ws.on('message', (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientWebSocketMessage;
        this.handleClientMessage(ws, msg);
      } catch (err) {
        this.send(ws, { type: 'ERROR', message: 'Invalid JSON message payload' });
      }
    });

    ws.on('close', () => {
      this.cleanupSocket(ws);
    });

    ws.on('error', () => {
      this.cleanupSocket(ws);
    });
  }

  private authenticateSocket(ws: WebSocket, token: string): void {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { userId?: string; id?: string; email?: string };
      const userId = decoded.userId || decoded.id;

      if (!userId) {
        this.send(ws, { type: 'AUTH_ERROR', message: 'Invalid JWT payload: missing userId' });
        return;
      }

      this.socketUser.set(ws, userId);
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(ws);

      this.send(ws, { type: 'AUTH_OK', userId });
    } catch {
      this.send(ws, { type: 'AUTH_ERROR', message: 'Invalid or expired JWT token' });
    }
  }

  private handleClientMessage(ws: WebSocket, msg: ClientWebSocketMessage): void {
    switch (msg.type) {
      case 'AUTH': {
        this.authenticateSocket(ws, msg.token);
        break;
      }

      case 'SUBSCRIBE_SYMBOLS': {
        if (Array.isArray(msg.symbols)) {
          for (const rawSym of msg.symbols) {
            const sym = rawSym.toUpperCase().trim();
            if (!this.symbolSubscriptions.has(sym)) {
              this.symbolSubscriptions.set(sym, new Set());
            }
            this.symbolSubscriptions.get(sym)!.add(ws);
          }
        }
        break;
      }

      case 'UNSUBSCRIBE_SYMBOLS': {
        if (Array.isArray(msg.symbols)) {
          for (const rawSym of msg.symbols) {
            const sym = rawSym.toUpperCase().trim();
            const set = this.symbolSubscriptions.get(sym);
            if (set) {
              set.delete(ws);
              if (set.size === 0) {
                this.symbolSubscriptions.delete(sym);
              }
            }
          }
        }
        break;
      }

      case 'SUBSCRIBE_WATCHLIST': {
        if (msg.watchlistId) {
          const wId = msg.watchlistId;
          if (!this.watchlistSubscriptions.has(wId)) {
            this.watchlistSubscriptions.set(wId, new Set());
          }
          this.watchlistSubscriptions.get(wId)!.add(ws);
        }
        break;
      }

      case 'UNSUBSCRIBE_WATCHLIST': {
        if (msg.watchlistId) {
          const set = this.watchlistSubscriptions.get(msg.watchlistId);
          if (set) {
            set.delete(ws);
            if (set.size === 0) {
              this.watchlistSubscriptions.delete(msg.watchlistId);
            }
          }
        }
        break;
      }

      case 'PING': {
        this.send(ws, { type: 'PONG' });
        break;
      }

      default: {
        this.send(ws, { type: 'ERROR', message: `Unknown message type: ${(msg as any).type}` });
      }
    }
  }

  private cleanupSocket(ws: WebSocket): void {
    const userId = this.socketUser.get(ws);
    if (userId) {
      const userSet = this.userSockets.get(userId);
      if (userSet) {
        userSet.delete(ws);
        if (userSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.socketUser.delete(ws);
    }

    for (const [sym, set] of this.symbolSubscriptions.entries()) {
      set.delete(ws);
      if (set.size === 0) {
        this.symbolSubscriptions.delete(sym);
      }
    }

    for (const [wId, set] of this.watchlistSubscriptions.entries()) {
      set.delete(ws);
      if (set.size === 0) {
        this.watchlistSubscriptions.delete(wId);
      }
    }
  }

  private send(ws: WebSocket, message: ServerWebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // Socket write error
      }
    }
  }

  // --- Real-Time Broadcast Methods ---

  /**
   * Broadcasts updated quotes to all clients subscribed to these symbols.
   */
  broadcastQuoteUpdates(quotes: Quote[]): void {
    if (!this.wss || quotes.length === 0) return;

    const timestamp = new Date().toISOString();
    // Group quotes by target WebSocket
    const clientQuotesMap = new Map<WebSocket, Quote[]>();

    for (const quote of quotes) {
      const sym = quote.symbol.toUpperCase();
      const subscribedSockets = this.symbolSubscriptions.get(sym);
      if (subscribedSockets) {
        for (const ws of subscribedSockets) {
          if (ws.readyState === WebSocket.OPEN) {
            if (!clientQuotesMap.has(ws)) {
              clientQuotesMap.set(ws, []);
            }
            clientQuotesMap.get(ws)!.push(quote);
          }
        }
      }
    }

    for (const [ws, socketQuotes] of clientQuotesMap.entries()) {
      this.send(ws, {
        type: 'QUOTE_UPDATE',
        quotes: socketQuotes,
        timestamp,
      });
    }
  }

  /**
   * Broadcasts a newly detected market signal to relevant users, watchlists, and symbol subscribers.
   */
  broadcastSignalEvent(signal: MarketSignalEvent): void {
    if (!this.wss) return;

    const timestamp = new Date().toISOString();
    const targetSockets = new Set<WebSocket>();

    // 1. Sockets belonging to the signal's owner
    if (signal.userId) {
      const uSockets = this.userSockets.get(signal.userId);
      if (uSockets) {
        for (const ws of uSockets) targetSockets.add(ws);
      }
    }

    // 2. Sockets subscribed to this watchlist
    if (signal.watchlistId) {
      const wSockets = this.watchlistSubscriptions.get(signal.watchlistId);
      if (wSockets) {
        for (const ws of wSockets) targetSockets.add(ws);
      }
    }

    // 3. Sockets watching this stock symbol
    if (signal.stockSymbol) {
      const sSockets = this.symbolSubscriptions.get(signal.stockSymbol.toUpperCase());
      if (sSockets) {
        for (const ws of sSockets) targetSockets.add(ws);
      }
    }

    const payload: ServerWebSocketMessage = {
      type: 'SIGNAL_DETECTED',
      signal,
      timestamp,
    };

    for (const ws of targetSockets) {
      this.send(ws, payload);
    }
  }

  /**
   * Broadcasts updated sparklines calculations to clients viewing this watchlist.
   */
  broadcastSparklineUpdate(watchlistId: string, sparklines: Record<string, StockSparklineData>): void {
    if (!this.wss) return;

    const wSockets = this.watchlistSubscriptions.get(watchlistId);
    if (!wSockets || wSockets.size === 0) return;

    const payload: ServerWebSocketMessage = {
      type: 'SPARKLINE_UPDATE',
      watchlistId,
      sparklines,
      timestamp: new Date().toISOString(),
    };

    for (const ws of wSockets) {
      this.send(ws, payload);
    }
  }

  /**
   * Close and clean up WebSocket server (useful for test teardown).
   */
  close(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          this.userSockets.clear();
          this.socketUser.clear();
          this.symbolSubscriptions.clear();
          this.watchlistSubscriptions.clear();
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export const wsServer = new AppWebSocketServer();
