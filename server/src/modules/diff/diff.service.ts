import { DiffCalculationInput, DiffResult, FreshnessState, NewsItem, PriceObservation } from '@watchlist/shared';
import { calculateChanges, DEFAULT_MEANINGFUL_CHANGE_THRESHOLD } from './diff.engine.js';
import { watchlistRepository } from '../watchlist/watchlist.repository.js';
import { marketRepository } from '../market/market.repository.js';
import { marketService } from '../market/market.service.js';
import { newsService } from '../news/news.service.js';
import { signalService } from '../signal/signal.service.js';
import { WatchlistError } from '../watchlist/watchlist.service.js';
import { env } from '../../config/env.js';

export class DiffService {
  /**
   * Orchestrates the complete last-visit diff flow:
   * 1. Reads the PREVIOUS last_seen_at (never overwrites before comparison).
   * 2. Gathers current market quotes, baseline prices, timestamped observations, and news items.
   * 3. Calls the isolated, deterministic calculateChanges() pure domain function.
   * 4. Persists detected meaningful changes into persistent market_signal_events (deduplicated).
   * 5. Updates last_seen_at in PostgreSQL ONLY after successful calculation.
   * 6. Returns structured DiffResult.
   */
  async getWatchlistDiff(
    userId: string,
    watchlistId: string,
    options: { updateLastSeen?: boolean; thresholdPercent?: number; reactionWindowMinutes?: number } = {}
  ): Promise<DiffResult> {
    const {
      updateLastSeen = true,
      thresholdPercent = DEFAULT_MEANINGFUL_CHANGE_THRESHOLD,
      reactionWindowMinutes = env.NEWS_REACTION_WINDOW_MINUTES || 120,
    } = options;

    // 1. Authorization & Previous State Retrieval
    const watchlist = await watchlistRepository.findById(watchlistId);
    if (!watchlist || watchlist.user_id !== userId) {
      throw new WatchlistError('Watchlist not found', 404);
    }

    const previousLastSeenAt = watchlist.last_seen_at;
    const items = await watchlistRepository.findItemsByWatchlistId(watchlistId);
    const symbols = items.map((i) => i.symbol.toUpperCase());
    const currentTimestamp = new Date().toISOString();

    if (symbols.length === 0) {
      if (updateLastSeen) {
        await watchlistRepository.updateLastSeen(watchlistId, new Date());
      }
      return {
        watchlistId,
        evaluatedAt: currentTimestamp,
        lastSeenAt: previousLastSeenAt ? previousLastSeenAt.toISOString() : null,
        hasMeaningfulChanges: false,
        changes: [],
        message: 'Watchlist is empty. Add stocks to start tracking price changes.'
      };
    }

    // 2. Gather Current Market Snapshots
    const latestSnapshots = await marketRepository.getLatestSnapshotsForSymbols(symbols);
    const currentQuotes: DiffCalculationInput['currentQuotes'] = {};

    for (const snap of latestSnapshots) {
      const sym = snap.symbol.toUpperCase();
      const freshnessState = marketService.evaluateFreshness(snap.timestamp, snap.freshness_state);
      currentQuotes[sym] = {
        price: parseFloat(snap.price),
        change: parseFloat(snap.change),
        changePercent: parseFloat(snap.change_percent),
        timestamp: snap.timestamp.toISOString(),
        freshnessState
      };
    }

    // 3. Gather Baseline Historical Quotes, Price Observations & Recent News (Single batch queries)
    const historicalBaselineQuotes: DiffCalculationInput['historicalBaselineQuotes'] = {};
    const priceObservationsBySymbol: Record<string, PriceObservation[]> = {};
    let recentNewsBySymbol: Record<string, NewsItem[]> = {};

    for (const sym of symbols) {
      priceObservationsBySymbol[sym] = [];
    }

    if (previousLastSeenAt) {
      const baselineSnapshots = await marketRepository.getSnapshotsAtOrBeforeForSymbols(symbols, previousLastSeenAt);
      for (const snap of baselineSnapshots) {
        historicalBaselineQuotes[snap.symbol.toUpperCase()] = {
          price: parseFloat(snap.price),
          timestamp: snap.timestamp.toISOString(),
        };
      }

      // Query all timestamped snapshots observed between previous last_seen_at and now
      const intervalSnapshots = await marketRepository.getSnapshotsSinceForSymbols(symbols, previousLastSeenAt);
      for (const snap of intervalSnapshots) {
        const sym = snap.symbol.toUpperCase();
        if (!priceObservationsBySymbol[sym]) {
          priceObservationsBySymbol[sym] = [];
        }
        priceObservationsBySymbol[sym].push({
          price: parseFloat(snap.price),
          timestamp: snap.timestamp.toISOString(),
        });
      }

      recentNewsBySymbol = await newsService.getNewsForSymbolsSince(symbols, previousLastSeenAt);
    }

    // 4. Pure Deterministic Diff Calculation (Zero side effects)
    const calculationInput: DiffCalculationInput = {
      watchlistId,
      lastSeenAt: previousLastSeenAt ? previousLastSeenAt.toISOString() : null,
      currentTimestamp,
      symbols,
      currentQuotes,
      historicalBaselineQuotes,
      recentNewsBySymbol,
      priceObservationsBySymbol,
      reactionWindowMinutes,
      thresholdPercent
    };

    const diffResult = calculateChanges(calculationInput);

    // 5. Persist genuinely new Market Signal Events
    if (diffResult.hasMeaningfulChanges && diffResult.changes.length > 0) {
      try {
        await signalService.persistSignalsFromDiff(userId, watchlistId, diffResult.changes);
      } catch (signalErr) {
        console.warn('[DiffService] Failed to persist market signals:', signalErr);
      }
    }

    // 6. Update last_seen_at ONLY AFTER successful calculation and persistence
    if (updateLastSeen) {
      await watchlistRepository.updateLastSeen(watchlistId, new Date());
    }

    return diffResult;
  }
}

export const diffService = new DiffService();
