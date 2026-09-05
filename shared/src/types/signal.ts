export interface MarketSignalEvent {
  id: string;
  userId: string;
  watchlistId: string;
  stockSymbol: string;
  companyName: string | null;
  changeType: 'PRICE_MOVEMENT' | 'NEWS_PRICE_REACTION' | 'NEWS_ONLY' | 'NEW_NEWS' | string;
  changeSummary: string;
  direction: 'UP' | 'DOWN' | 'FLAT' | null;
  percentageChange: number | null;
  previousPrice: number | null;
  currentPrice: number | null;
  reason: string | null;
  newsHeadline: string | null;
  newsUrl: string | null;
  newsSource: string | null;
  detectedAt: string;
  activeUntil: string;
  historyUntil: string;
  isActive: boolean;
  eventSignature: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveSignalsResponse {
  signals: MarketSignalEvent[];
  activeCount: number;
  timestamp: string;
}

export interface SignalHistoryResponse {
  symbol: string;
  history: MarketSignalEvent[];
  totalEvents: number;
  timestamp: string;
}
