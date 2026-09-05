export type CatchUpEventType =
  | 'NEWS_PRICE_REACTION'
  | 'PRICE_MOVEMENT'
  | 'MATERIAL_NEWS'
  | 'MARKET_SIGNAL';

export interface CatchUpEvent {
  id?: string;
  symbol: string;
  companyName: string;
  eventType: CatchUpEventType;
  direction?: 'UP' | 'DOWN' | 'FLAT' | 'FIRST_RECORD';
  percentageChange?: number;
  previousPrice?: number | null;
  currentPrice?: number;
  summary: string;
  detectedAt: string;
  newsHeadline?: string;
  newsUrl?: string;
  newsProviderId?: string | null;
}

export interface CatchUpResponse {
  watchlistId: string;
  elapsedMinutes: number;
  awayTimeFormatted: string; // e.g. "18 hours", "45 minutes", "2 days"
  lastSeenAt: string | null;
  evaluatedAt: string;
  significantEventsCount: number;
  narrative: string;
  events: CatchUpEvent[];
  hasChanges: boolean;
}
