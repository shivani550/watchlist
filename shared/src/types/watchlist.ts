export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  lastSeenAt: string | null; // ISO 8601
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  symbol: string;
  addedAt: string;
}

export interface WatchlistWithItems extends Watchlist {
  items: WatchlistItem[];
}

/** Summary returned when listing all watchlists (includes item count). */
export interface WatchlistSummary extends Watchlist {
  itemCount: number;
}

// --- Request types ---

export interface CreateWatchlistRequest {
  name: string;
}

export interface RenameWatchlistRequest {
  name: string;
}

export interface AddSymbolRequest {
  symbol: string;
}

