import { Watchlist, WatchlistItem, WatchlistSummary, WatchlistWithItems } from '@watchlist/shared';
import { watchlistRepository, WatchlistRow, WatchlistItemRow, WatchlistSummaryRow } from './watchlist.repository.js';
import { cacheService, CacheService } from '../../cache/cache.service.js';

// --- Symbol validation ---

const SYMBOL_REGEX = /^[A-Z]{1,20}$/;

/** Normalize a raw symbol input: trim whitespace, uppercase. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Validate that a normalized symbol matches expected format. */
export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_REGEX.test(symbol);
}

// --- Error class ---

export class WatchlistError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'WatchlistError';
    this.statusCode = statusCode;
  }
}

// --- Row → DTO helpers ---

function toWatchlist(row: WatchlistRow): Watchlist {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toWatchlistSummary(row: WatchlistSummaryRow): WatchlistSummary {
  return {
    ...toWatchlist(row),
    itemCount: parseInt(row.item_count, 10),
  };
}

function toWatchlistItem(row: WatchlistItemRow): WatchlistItem {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    symbol: row.symbol,
    addedAt: row.added_at.toISOString(),
  };
}

// --- Service ---

export class WatchlistService {
  /**
   * Verify that the watchlist exists AND belongs to the given user.
   * Returns the row on success, throws 404 on any mismatch (never reveals existence to wrong user).
   */
  private async verifyOwnership(watchlistId: string, userId: string): Promise<WatchlistRow> {
    const row = await watchlistRepository.findById(watchlistId);
    if (!row || row.user_id !== userId) {
      throw new WatchlistError('Watchlist not found', 404);
    }
    return row;
  }

  async createWatchlist(userId: string, name: string): Promise<Watchlist> {
    const row = await watchlistRepository.create(userId, name);
    // Invalidate user watchlists cache
    await cacheService.del(CacheService.keys.userWatchlists(userId));
    return toWatchlist(row);
  }

  async getUserWatchlists(userId: string): Promise<WatchlistSummary[]> {
    const cacheKey = CacheService.keys.userWatchlists(userId);
    const cached = await cacheService.get<WatchlistSummary[]>(cacheKey);
    if (cached) return cached;

    const rows = await watchlistRepository.findByUserId(userId);
    const result = rows.map(toWatchlistSummary);
    await cacheService.set(cacheKey, result, 300); // 5 min TTL
    return result;
  }

  async getWatchlist(watchlistId: string, userId: string): Promise<WatchlistWithItems> {
    const row = await this.verifyOwnership(watchlistId, userId);
    const itemRows = await watchlistRepository.findItemsByWatchlistId(watchlistId);
    return {
      ...toWatchlist(row),
      items: itemRows.map(toWatchlistItem),
    };
  }

  async renameWatchlist(watchlistId: string, userId: string, name: string): Promise<Watchlist> {
    await this.verifyOwnership(watchlistId, userId);
    const updated = await watchlistRepository.updateName(watchlistId, name);
    await cacheService.del([
      CacheService.keys.userWatchlists(userId),
      CacheService.keys.watchlistDetail(watchlistId),
    ]);
    return toWatchlist(updated);
  }

  async deleteWatchlist(watchlistId: string, userId: string): Promise<void> {
    await this.verifyOwnership(watchlistId, userId);
    await watchlistRepository.delete(watchlistId);
    await cacheService.del([
      CacheService.keys.userWatchlists(userId),
      CacheService.keys.watchlistDetail(watchlistId),
      CacheService.keys.sparklinesWatchlist(watchlistId),
      CacheService.keys.activeSignalsWatchlist(watchlistId),
    ]);
  }

  async addSymbol(watchlistId: string, userId: string, rawSymbol: string): Promise<WatchlistItem> {
    await this.verifyOwnership(watchlistId, userId);

    const symbol = normalizeSymbol(rawSymbol);
    if (!isValidSymbol(symbol)) {
      throw new WatchlistError(
        `Invalid symbol format: "${rawSymbol}". Symbols must be 1-20 uppercase letters.`,
        400
      );
    }

    try {
      const row = await watchlistRepository.addItem(watchlistId, symbol);
      await cacheService.del([
        CacheService.keys.userWatchlists(userId),
        CacheService.keys.watchlistDetail(watchlistId),
        CacheService.keys.sparklinesWatchlist(watchlistId),
        CacheService.keys.activeSignalsWatchlist(watchlistId),
      ]);
      return toWatchlistItem(row);
    } catch (err: any) {
      // PostgreSQL unique_violation code
      if (err.code === '23505') {
        throw new WatchlistError('Symbol already in watchlist', 409);
      }
      throw err;
    }
  }

  async removeSymbol(watchlistId: string, userId: string, rawSymbol: string): Promise<void> {
    await this.verifyOwnership(watchlistId, userId);

    const symbol = normalizeSymbol(rawSymbol);
    const removed = await watchlistRepository.removeItem(watchlistId, symbol);
    if (!removed) {
      throw new WatchlistError('Symbol not found in watchlist', 404);
    }

    await cacheService.del([
      CacheService.keys.userWatchlists(userId),
      CacheService.keys.watchlistDetail(watchlistId),
      CacheService.keys.sparklinesWatchlist(watchlistId),
      CacheService.keys.activeSignalsWatchlist(watchlistId),
    ]);
  }

  async getDistinctSymbols(): Promise<string[]> {
    return watchlistRepository.findDistinctWatchedSymbols();
  }
}

export const watchlistService = new WatchlistService();
