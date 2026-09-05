export type FreshnessState = 'FRESH' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';

export interface Instrument {
  symbol: string;
  name: string;
  sector?: string | null;
}

export interface PriceSnapshot {
  id: string;
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  freshnessState: FreshnessState;
  timestamp: string; // ISO 8601
  createdAt?: string;
}

export interface Quote {
  symbol: string;
  name?: string;
  sector?: string | null;
  price: number;
  change: number;
  changePercent: number;
  freshnessState: FreshnessState;
  timestamp: string;
}

export interface HistoricalDataPoint {
  timestamp: string;
  price: number;
}

export interface HistoricalDataResponse {
  symbol: string;
  history: HistoricalDataPoint[];
}

export interface IngestionResult {
  status: 'success' | 'partial' | 'failed' | 'idle';
  distinctSymbolsCount: number;
  fetchedCount: number;
  persistedCount: number;
  failedSymbols: Array<{ symbol: string; error: string }>;
  timestamp: string;
}
