export type RangeStatus = 'BREAKOUT_HIGH' | 'BREAKOUT_LOW' | 'WITHIN_RANGE' | 'UNKNOWN';

export interface SparklinePoint {
  x: number;
  y: number;
  price: number;
  timestamp: string;
}

export interface StockSparklineData {
  symbol: string;
  points: SparklinePoint[];
  lastSeenIndex: number | null;
  lastSeenPrice: number | null;
  currentPrice: number | null;
  sinceLastVisitPercent: number | null;
  rangeStatus: RangeStatus;
  prior20DayHigh: number | null;
  prior20DayLow: number | null;
}

export interface WatchlistSparklinesResponse {
  watchlistId: string;
  lastSeenAt: string | null;
  sparklines: Record<string, StockSparklineData>;
}
