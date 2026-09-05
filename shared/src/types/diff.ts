import { FreshnessState } from './market.js';
import { NewsItem } from './news.js';

export type ChangeType = 'PRICE_MOVEMENT' | 'NEWS_PRICE_REACTION' | 'NEWS_ONLY' | 'NEW_NEWS' | 'NO_CHANGE';

export interface PriceObservation {
  price: number;
  timestamp: string;
}

export interface MeaningfulChange {
  symbol: string;
  type: ChangeType;
  direction: 'UP' | 'DOWN' | 'FLAT' | 'FIRST_RECORD';
  headline?: string;
  summary: string;
  previousPrice: number | null;
  currentPrice: number;
  percentageChange: number;
  percentChangeSinceLastSeen: number;
  absoluteChangeSinceLastSeen: number;
  newsItems?: NewsItem[];
  likelyReason?: string | null;
  freshnessState?: FreshnessState;
  reactionDetails?: {
    baselinePrice: number;
    reactionPrice: number;
    percentageChange: number;
    newsPublishedAt: string;
    reactionTimestamp: string;
  } | null;
}

export interface DiffCalculationInput {
  watchlistId: string;
  lastSeenAt: string | null;
  currentTimestamp: string;
  symbols: string[];
  currentQuotes: Record<string, {
    price: number;
    change: number;
    changePercent: number;
    timestamp: string;
    freshnessState: FreshnessState;
  }>;
  historicalBaselineQuotes: Record<string, {
    price: number;
    timestamp: string;
  }>;
  recentNewsBySymbol: Record<string, NewsItem[]>;
  priceObservationsBySymbol?: Record<string, PriceObservation[]>;
  reactionWindowMinutes?: number;
  thresholdPercent?: number; // default 2%
}

export interface DiffResult {
  watchlistId: string;
  evaluatedAt: string;
  lastSeenAt: string | null;
  hasMeaningfulChanges: boolean;
  changes: MeaningfulChange[];
  message: string;
}

