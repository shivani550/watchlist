import { Quote } from './market.js';
import { MarketSignalEvent } from './signal.js';
import { StockSparklineData } from './sparkline.js';

// --- Client -> Server Message Types ---

export type ClientMessageType =
  | 'AUTH'
  | 'SUBSCRIBE_SYMBOLS'
  | 'UNSUBSCRIBE_SYMBOLS'
  | 'SUBSCRIBE_WATCHLIST'
  | 'UNSUBSCRIBE_WATCHLIST'
  | 'PING';

export interface ClientAuthMessage {
  type: 'AUTH';
  token: string;
}

export interface ClientSubscribeSymbolsMessage {
  type: 'SUBSCRIBE_SYMBOLS';
  symbols: string[];
}

export interface ClientUnsubscribeSymbolsMessage {
  type: 'UNSUBSCRIBE_SYMBOLS';
  symbols: string[];
}

export interface ClientSubscribeWatchlistMessage {
  type: 'SUBSCRIBE_WATCHLIST';
  watchlistId: string;
}

export interface ClientUnsubscribeWatchlistMessage {
  type: 'UNSUBSCRIBE_WATCHLIST';
  watchlistId: string;
}

export interface ClientPingMessage {
  type: 'PING';
}

export type ClientWebSocketMessage =
  | ClientAuthMessage
  | ClientSubscribeSymbolsMessage
  | ClientUnsubscribeSymbolsMessage
  | ClientSubscribeWatchlistMessage
  | ClientUnsubscribeWatchlistMessage
  | ClientPingMessage;

// --- Server -> Client Message Types ---

export type ServerMessageType =
  | 'AUTH_OK'
  | 'AUTH_ERROR'
  | 'QUOTE_UPDATE'
  | 'SIGNAL_DETECTED'
  | 'SPARKLINE_UPDATE'
  | 'PONG'
  | 'ERROR';

export interface ServerAuthOkMessage {
  type: 'AUTH_OK';
  userId: string;
}

export interface ServerAuthErrorMessage {
  type: 'AUTH_ERROR';
  message: string;
}

export interface ServerQuoteUpdateMessage {
  type: 'QUOTE_UPDATE';
  quotes: Quote[];
  timestamp: string;
}

export interface ServerSignalDetectedMessage {
  type: 'SIGNAL_DETECTED';
  signal: MarketSignalEvent;
  timestamp: string;
}

export interface ServerSparklineUpdateMessage {
  type: 'SPARKLINE_UPDATE';
  watchlistId: string;
  sparklines: Record<string, StockSparklineData>;
  timestamp: string;
}

export interface ServerPongMessage {
  type: 'PONG';
}

export interface ServerErrorMessage {
  type: 'ERROR';
  message: string;
}

export type ServerWebSocketMessage =
  | ServerAuthOkMessage
  | ServerAuthErrorMessage
  | ServerQuoteUpdateMessage
  | ServerSignalDetectedMessage
  | ServerSparklineUpdateMessage
  | ServerPongMessage
  | ServerErrorMessage;
