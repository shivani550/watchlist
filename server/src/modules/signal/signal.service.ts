import { MeaningfulChange, MarketSignalEvent } from '@watchlist/shared';
import { signalRepository, CreateSignalEventInput } from './signal.repository.js';
import { watchlistRepository } from '../watchlist/watchlist.repository.js';
import { WatchlistError } from '../watchlist/watchlist.service.js';
import { cacheService, CacheService } from '../../cache/cache.service.js';
import { wsServer } from '../../websocket/websocket.server.js';

export class SignalService {
  /**
   * Generates a deterministic signature for deduplicating market signal events.
   */
  generateEventSignature(symbol: string, change: MeaningfulChange): string {
    const cleanSym = symbol.toUpperCase().trim();
    const type = change.type;

    // 1. News-to-Price Reaction signal signature (combines symbol, news item ID/key, direction, and magnitude)
    if (type === 'NEWS_PRICE_REACTION' && change.newsItems && change.newsItems.length > 0) {
      const primaryNews = change.newsItems[0];
      const newsKey = primaryNews.providerId || primaryNews.url || primaryNews.headline;
      const normalizedNewsKey = newsKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      const dir = change.direction || 'FLAT';
      const pct = Math.round((change.percentageChange || 0) * 10) / 10;
      return `${cleanSym}:NEWS_PRICE_REACTION:${normalizedNewsKey}:${dir}:${pct}`;
    }

    // 2. News-only signal signature (uses stable provider ID or normalized URL)
    if ((type === 'NEWS_ONLY' || type === 'NEW_NEWS' || (change.newsItems && change.newsItems.length > 0 && type !== 'PRICE_MOVEMENT'))) {
      const primaryNews = change.newsItems && change.newsItems.length > 0 ? change.newsItems[0] : null;
      if (primaryNews) {
        const newsKey = primaryNews.providerId || primaryNews.url || primaryNews.headline;
        const normalizedNewsKey = newsKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
        return `${cleanSym}:NEWS_ONLY:${normalizedNewsKey}`;
      }
    }

    // 3. Pure price movement signal signature
    // Groups by direction, rounded percentage change delta, and previous baseline price
    const dir = change.direction || 'FLAT';
    const pct = Math.round((change.percentageChange || 0) * 10) / 10;
    const prevPrice = change.previousPrice ? Math.round(change.previousPrice) : '0';
    return `${cleanSym}:PRICE_MOVEMENT:${dir}:${pct}:${prevPrice}`;
  }

  /**
   * Persists meaningful changes detected by the Diff Engine as persistent Market Signal events.
   * Genuinely new events are inserted with active_until = NOW() + 24h and history_until = NOW() + 30d.
   * Duplicate events are ignored and do not reset timers.
   * Returns the list of all currently active signals for the watchlist.
   */
  async persistSignalsFromDiff(
    userId: string,
    watchlistId: string,
    changes: MeaningfulChange[]
  ): Promise<MarketSignalEvent[]> {
    const watchlist = await watchlistRepository.findById(watchlistId);
    if (!watchlist || watchlist.user_id !== userId) {
      throw new WatchlistError('Watchlist not found', 404);
    }

    const now = new Date();
    let hasInserted = false;

    for (const change of changes) {
      if (change.type === 'NO_CHANGE') continue;

      const signature = this.generateEventSignature(change.symbol, change);
      const primaryNews = change.newsItems && change.newsItems.length > 0 ? change.newsItems[0] : null;

      const input: CreateSignalEventInput = {
        userId,
        watchlistId,
        stockSymbol: change.symbol,
        companyName: null, // will be resolved or populated from quote/instruments
        changeType: change.type,
        changeSummary: change.summary,
        direction: change.direction === 'FIRST_RECORD' ? 'FLAT' : change.direction,
        percentageChange: change.percentageChange,
        previousPrice: change.previousPrice,
        currentPrice: change.currentPrice,
        reason: change.likelyReason || null,
        newsHeadline: primaryNews?.headline || change.headline || null,
        newsUrl: primaryNews?.url || null,
        newsSource: primaryNews?.url ? (() => { try { return new URL(primaryNews.url).hostname; } catch { return null; } })() : null,
        detectedAt: now,
        activeUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours
        historyUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
        eventSignature: signature,
      };

      try {
        const created = await signalRepository.insertSignalEvent(input);
        if (created) {
          hasInserted = true;
          // Broadcast real-time signal event to connected WebSocket clients
          wsServer.broadcastSignalEvent(created);
        }
      } catch (err) {
        console.warn(`[SignalService] Failed to insert signal event for ${change.symbol}:`, err);
      }
    }

    // Invalidate cached active signals if new signals were registered
    if (hasInserted) {
      await cacheService.del([
        CacheService.keys.activeSignalsWatchlist(watchlistId),
        `signals:active:user:${userId}`,
        CacheService.keys.activeSignalsGlobal(),
      ]);
    }

    // Return all currently active signals for this watchlist
    const active = await signalRepository.findActiveSignalsByWatchlist(userId, watchlistId);
    await cacheService.set(CacheService.keys.activeSignalsWatchlist(watchlistId), active, 120);
    return active;
  }

  /**
   * Retrieves all active signals across the user's watchlists with cache-aside.
   */
  async getActiveSignalsForUser(userId: string): Promise<MarketSignalEvent[]> {
    const cacheKey = `signals:active:user:${userId}`;
    const cached = await cacheService.get<MarketSignalEvent[]>(cacheKey);
    if (cached) return cached;

    const signals = await signalRepository.findActiveSignalsByUser(userId);
    await cacheService.set(cacheKey, signals, 120); // 2 min TTL
    return signals;
  }

  /**
   * Retrieves active signals for a single watchlist with cache-aside.
   */
  async getActiveSignalsForWatchlist(userId: string, watchlistId: string): Promise<MarketSignalEvent[]> {
    const watchlist = await watchlistRepository.findById(watchlistId);
    if (!watchlist || watchlist.user_id !== userId) {
      throw new WatchlistError('Watchlist not found', 404);
    }

    const cacheKey = CacheService.keys.activeSignalsWatchlist(watchlistId);
    const cached = await cacheService.get<MarketSignalEvent[]>(cacheKey);
    if (cached) return cached;

    const signals = await signalRepository.findActiveSignalsByWatchlist(userId, watchlistId);
    await cacheService.set(cacheKey, signals, 120); // 2 min TTL
    return signals;
  }

  /**
   * Retrieves 30-day change history for a stock symbol for the authenticated user.
   */
  async get30DayHistoryForSymbol(userId: string, symbol: string): Promise<MarketSignalEvent[]> {
    const cleanSym = symbol.toUpperCase().trim();
    return await signalRepository.find30DayHistoryBySymbol(userId, cleanSym);
  }

  /**
   * Retrieves detail of a single signal event.
   */
  async getSignalById(userId: string, id: string): Promise<MarketSignalEvent> {
    const signal = await signalRepository.findById(userId, id);
    if (!signal) {
      throw new WatchlistError('Market signal event not found', 404);
    }
    return signal;
  }
}

export const signalService = new SignalService();
