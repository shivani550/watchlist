import { CatchUpEvent, CatchUpEventType, CatchUpResponse } from '@watchlist/shared';
import { watchlistRepository } from '../watchlist/watchlist.repository.js';
import { marketRepository } from '../market/market.repository.js';
import { diffService } from '../diff/diff.service.js';
import { WatchlistError } from '../watchlist/watchlist.service.js';

export class CatchUpService {
  /**
   * Formats elapsed minutes into a concise human-readable duration (e.g., "18 hours", "45 minutes", "2 days").
   */
  formatAwayTime(elapsedMinutes: number): string {
    if (elapsedMinutes <= 0) {
      return 'less than a minute';
    }
    if (elapsedMinutes < 60) {
      return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'}`;
    }
    const hours = Math.floor(elapsedMinutes / 60);
    if (hours < 24) {
      return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  /**
   * Deterministically generates an executive narrative string based on real event counts.
   * Strictly non-causal and zero LLM / AI dependencies.
   */
  generateNarrative(awayTime: string, events: CatchUpEvent[]): string {
    const totalCount = events.length;
    if (totalCount === 0) {
      return `You were away for ${awayTime}. Nothing significant changed across your watchlist.`;
    }

    const priceMoves = events.filter(
      (e) => e.eventType === 'PRICE_MOVEMENT' || e.eventType === 'NEWS_PRICE_REACTION'
    ).length;
    const newsEvents = events.filter((e) => e.eventType === 'MATERIAL_NEWS').length;

    if (priceMoves > 0 && newsEvents > 0) {
      const moveStr = `${priceMoves} stock${priceMoves === 1 ? '' : 's'} crossed significant movement thresholds`;
      const newsStr = `${newsEvents} had notable news event${newsEvents === 1 ? '' : 's'}`;
      return `You were away for ${awayTime}. ${moveStr}, and ${newsStr}.`;
    }

    if (priceMoves > 0) {
      const moveStr = `${priceMoves} stock${priceMoves === 1 ? '' : 's'} crossed significant movement thresholds`;
      return `You were away for ${awayTime}. ${moveStr}.`;
    }

    const newsStr = `${newsEvents} stock${newsEvents === 1 ? '' : 's'} had notable news event${newsEvents === 1 ? '' : 's'}`;
    return `You were away for ${awayTime}. ${newsStr}.`;
  }

  /**
   * Computes the "While You Were Away" / Catch-Up executive brief for a watchlist.
   * NOTE: Does NOT mutate or advance watchlists.last_seen_at.
   */
  async getCatchUpBrief(userId: string, watchlistId: string): Promise<CatchUpResponse> {
    const watchlist = await watchlistRepository.findById(watchlistId);
    if (!watchlist || watchlist.user_id !== userId) {
      throw new WatchlistError('Watchlist not found', 404);
    }

    const now = new Date();
    const evaluatedAt = now.toISOString();
    const lastSeenDate = watchlist.last_seen_at || watchlist.created_at || new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastSeenAt = watchlist.last_seen_at ? watchlist.last_seen_at.toISOString() : null;

    const elapsedMs = now.getTime() - lastSeenDate.getTime();
    const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / (1000 * 60)));
    const awayTimeFormatted = this.formatAwayTime(elapsedMinutes);

    // 1. Calculate Session Delta WITHOUT updating last_seen_at
    const diffResult = await diffService.getWatchlistDiff(userId, watchlistId, {
      updateLastSeen: false
    });

    const items = await watchlistRepository.findItemsByWatchlistId(watchlistId);
    const symbols = items.map((i) => i.symbol.toUpperCase());

    // 2. Fetch instrument names in batch
    const instruments = await marketRepository.getInstrumentsForSymbols(symbols);
    const instrumentNameMap = new Map<string, string>();
    for (const inst of instruments) {
      instrumentNameMap.set(inst.symbol.toUpperCase(), inst.name);
    }

    // 3. Transform meaningful changes into CatchUpEvents
    const events: CatchUpEvent[] = [];

    for (const change of diffResult.changes) {
      let eventType: CatchUpEventType = 'PRICE_MOVEMENT';
      if (change.type === 'NEWS_PRICE_REACTION') {
        eventType = 'NEWS_PRICE_REACTION';
      } else if (change.type === 'PRICE_MOVEMENT') {
        eventType = 'PRICE_MOVEMENT';
      } else if (change.type === 'NEWS_ONLY' || change.type === 'NEW_NEWS') {
        eventType = 'MATERIAL_NEWS';
      }

      const firstNews = change.newsItems && change.newsItems.length > 0 ? change.newsItems[0] : undefined;

      // Determine detection timestamp
      let detectedAt = evaluatedAt;
      if (change.reactionDetails?.reactionTimestamp) {
        detectedAt = change.reactionDetails.reactionTimestamp;
      } else if (firstNews?.publishedAt) {
        detectedAt = firstNews.publishedAt;
      }

      const companyName = instrumentNameMap.get(change.symbol.toUpperCase()) || change.symbol;

      events.push({
        symbol: change.symbol,
        companyName,
        eventType,
        direction: change.direction,
        percentageChange: change.percentageChange,
        previousPrice: change.previousPrice,
        currentPrice: change.currentPrice,
        summary: change.likelyReason || change.summary,
        detectedAt,
        newsHeadline: firstNews?.headline,
        newsUrl: firstNews?.url,
        newsProviderId: firstNews?.providerId,
      });
    }

    // 4. Sort chronologically: Newest first (detectedAt DESC)
    events.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());

    // 5. Generate deterministic narrative
    const narrative = this.generateNarrative(awayTimeFormatted, events);

    return {
      watchlistId,
      elapsedMinutes,
      awayTimeFormatted,
      lastSeenAt,
      evaluatedAt,
      significantEventsCount: events.length,
      narrative,
      events,
      hasChanges: events.length > 0
    };
  }

  /**
   * Explicitly marks the user as caught up by persisting last_seen_at = NOW().
   */
  async acknowledgeCatchUp(
    userId: string,
    watchlistId: string
  ): Promise<{ success: boolean; lastSeenAt: string }> {
    const watchlist = await watchlistRepository.findById(watchlistId);
    if (!watchlist || watchlist.user_id !== userId) {
      throw new WatchlistError('Watchlist not found', 404);
    }

    const now = new Date();
    await watchlistRepository.updateLastSeen(watchlistId, now);

    return {
      success: true,
      lastSeenAt: now.toISOString()
    };
  }
}

export const catchUpService = new CatchUpService();
