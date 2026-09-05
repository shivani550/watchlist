import { Quote, FreshnessState, HistoricalDataPoint, IngestionResult } from '@watchlist/shared';
import { pool } from '../../db/pool.js';
import { marketRepository } from './market.repository.js';
import { watchlistRepository } from '../watchlist/watchlist.repository.js';
import { MarketDataProvider, getMarketDataProvider } from '../../providers/market.provider.js';
import { cacheService, CacheService } from '../../cache/cache.service.js';
import { wsServer } from '../../websocket/websocket.server.js';

export const FRESHNESS_THRESHOLDS = {
  FRESH_MAX_AGE_MS: 5 * 60 * 1000,       // 5 minutes
  DELAYED_MAX_AGE_MS: 15 * 60 * 1000,    // 15 minutes
};

export class MarketService {
  /**
   * Core Batch 4 Ingestion Flow:
   * watchlist_items -> DISTINCT symbols -> provider adapter -> PostgreSQL
   *
   * Guarantees:
   * 1. 100 users watching RELIANCE -> exactly 1 logical fetch.
   * 2. Controlled batching & concurrency.
   * 3. One failed symbol does NOT stop remaining symbols.
   * 4. Provider failures/rate-limits handled gracefully without crashing.
   */
  async ingestMarketData(customProvider?: MarketDataProvider): Promise<IngestionResult> {
    const provider = customProvider || getMarketDataProvider();
    const distinctSymbols = await watchlistRepository.findDistinctWatchedSymbols();

    const timestamp = new Date().toISOString();

    if (distinctSymbols.length === 0) {
      return {
        status: 'idle',
        distinctSymbolsCount: 0,
        fetchedCount: 0,
        persistedCount: 0,
        failedSymbols: [],
        timestamp
      };
    }

    const failedSymbols: Array<{ symbol: string; error: string }> = [];
    const successfulQuotes: Quote[] = [];

    // Process in controlled batches of up to 25 symbols
    const BATCH_SIZE = 25;
    for (let i = 0; i < distinctSymbols.length; i += BATCH_SIZE) {
      const batch = distinctSymbols.slice(i, i + BATCH_SIZE);

      try {
        // Attempt batch retrieval from provider
        const quotes = await provider.getLatestQuotes(batch);
        successfulQuotes.push(...quotes);
      } catch (err: unknown) {
        // If the batch call threw, isolate failure per-symbol using controlled fallback
        const batchError = err instanceof Error ? err.message : String(err);

        // Try individual fetches to isolate which symbol failed
        for (const symbol of batch) {
          try {
            const singleQuote = await provider.getLatestQuotes([symbol]);
            if (singleQuote.length > 0) {
              successfulQuotes.push(singleQuote[0]);
            } else {
              failedSymbols.push({ symbol, error: 'No quote data returned' });
            }
          } catch (individualErr: unknown) {
            const msg = individualErr instanceof Error ? individualErr.message : String(individualErr);
            failedSymbols.push({ symbol, error: msg || batchError });
          }
        }
      }
    }

    let persistedCount = 0;

    // Persist successful quotes to PostgreSQL & Cache
    for (const quote of successfulQuotes) {
      try {
        // 1. Upsert instrument metadata
        await marketRepository.upsertInstrument(
          quote.symbol,
          quote.name || `${quote.symbol} Corporation`,
          quote.sector || null
        );

        // 2. Insert price snapshot
        await marketRepository.insertPriceSnapshot(
          quote.symbol,
          quote.price,
          quote.change,
          quote.changePercent,
          quote.freshnessState,
          new Date(quote.timestamp)
        );

        // 3. Populate / warm cache with updated quote (60s TTL)
        await cacheService.set(CacheService.keys.quote(quote.symbol), quote, 60);

        persistedCount++;
      } catch (dbErr: unknown) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        failedSymbols.push({ symbol: quote.symbol, error: `Database persistence failed: ${msg}` });
      }
    }

    // Invalidate sparkline caches and broadcast real-time quotes to connected WebSocket clients
    if (persistedCount > 0) {
      await cacheService.delPattern('sparklines:wl:*');
      wsServer.broadcastQuoteUpdates(successfulQuotes);
    }

    let status: IngestionResult['status'] = 'success';
    if (persistedCount === 0 && distinctSymbols.length > 0) {
      status = 'failed';
    } else if (failedSymbols.length > 0) {
      status = 'partial';
    }

    return {
      status,
      distinctSymbolsCount: distinctSymbols.length,
      fetchedCount: successfulQuotes.length,
      persistedCount,
      failedSymbols,
      timestamp
    };
  }

  /**
   * Retrieves latest stored quotes using cache-aside pattern (Redis/in-memory -> PostgreSQL).
   */
  async getQuotesForSymbols(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    const upperSymbols = symbols.map((s) => s.toUpperCase().trim());
    const cachedQuotes: Quote[] = [];
    const uncachedSymbols: string[] = [];

    // 1. Check cache for each symbol
    for (const sym of upperSymbols) {
      const cached = await cacheService.get<Quote>(CacheService.keys.quote(sym));
      if (cached) {
        // Re-evaluate freshness in case time passed
        cached.freshnessState = this.evaluateFreshness(cached.timestamp, cached.freshnessState);
        cachedQuotes.push(cached);
      } else {
        uncachedSymbols.push(sym);
      }
    }

    // 2. Query DB for symbols not present in cache
    if (uncachedSymbols.length > 0) {
      const snapshots = await marketRepository.getLatestSnapshotsForSymbols(uncachedSymbols);
      for (const snap of snapshots) {
        const freshnessState = this.evaluateFreshness(snap.timestamp, snap.freshness_state);
        const quote: Quote = {
          symbol: snap.symbol,
          name: snap.name || `${snap.symbol} Corporation`,
          sector: snap.sector || null,
          price: parseFloat(snap.price),
          change: parseFloat(snap.change),
          changePercent: parseFloat(snap.change_percent),
          freshnessState,
          timestamp: snap.timestamp.toISOString()
        };

        // Cache the retrieved quote for 60s
        await cacheService.set(CacheService.keys.quote(quote.symbol), quote, 60);
        cachedQuotes.push(quote);
      }
    }

    return cachedQuotes;
  }

  /**
   * Retrieves single latest stored quote.
   */
  async getLatestQuote(symbol: string): Promise<Quote | null> {
    const quotes = await this.getQuotesForSymbols([symbol]);
    return quotes[0] || null;
  }

  /**
   * Retrieves bounded historical chart data from PostgreSQL (default 30 data points).
   * If database history is empty/sparse, seeds historical data points from provider once.
   */
  async getHistoricalData(symbol: string, limit = 30, seedIfEmpty = true): Promise<HistoricalDataPoint[]> {
    const sym = symbol.toUpperCase().trim();
    const storedSnapshots = await marketRepository.getHistoricalSnapshots(sym, limit);

    const hasSufficientHistory = storedSnapshots.length >= 15 && (() => {
      if (storedSnapshots.length < 2) return false;
      const first = new Date(storedSnapshots[0].timestamp).getTime();
      const last = new Date(storedSnapshots[storedSnapshots.length - 1].timestamp).getTime();
      return Math.abs(last - first) > 86400000 * 2; // at least 2 days of historical spread
    })();

    if (hasSufficientHistory || !seedIfEmpty) {
      return storedSnapshots.map((s) => ({
        timestamp: s.timestamp.toISOString(),
        price: parseFloat(s.price)
      }));
    }

    // If historical data in DB is sparse (< 15 points or < 2 days span), query provider and persist full 30-day history
    try {
      const provider = getMarketDataProvider();
      const points = await provider.getHistoricalData(sym);

      // Seed instrument if needed
      await marketRepository.upsertInstrument(sym, `${sym} Corporation`);

      // Delete dense intraday duplicate snapshots from test/dev runs
      await pool.query(
        `DELETE FROM price_snapshots WHERE symbol = $1 AND timestamp < NOW() - INTERVAL '10 minutes';`,
        [sym]
      );

      // Seed 30 daily historical snapshots
      for (const pt of points) {
        await marketRepository.insertPriceSnapshot(
          sym,
          pt.price,
          0,
          0,
          'FRESH',
          new Date(pt.timestamp)
        );
      }

      const refreshed = await marketRepository.getHistoricalSnapshots(sym, limit);
      return refreshed.map((s) => ({
        timestamp: s.timestamp.toISOString(),
        price: parseFloat(s.price)
      }));
    } catch {
      // Fallback to whatever snapshots exist in DB
      return storedSnapshots.map((s) => ({
        timestamp: s.timestamp.toISOString(),
        price: parseFloat(s.price)
      }));
    }
  }

  /**
   * Evaluates freshness state based on snapshot age and declared state.
   */
  evaluateFreshness(timestamp: Date | string, declaredState?: FreshnessState): FreshnessState {
    if (declaredState === 'UNAVAILABLE') return 'UNAVAILABLE';

    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const ageMs = Date.now() - date.getTime();

    if (isNaN(ageMs) || ageMs < 0) {
      return declaredState || 'FRESH';
    }

    if (ageMs <= FRESHNESS_THRESHOLDS.FRESH_MAX_AGE_MS) {
      return declaredState === 'DELAYED' ? 'DELAYED' : 'FRESH';
    }

    if (ageMs <= FRESHNESS_THRESHOLDS.DELAYED_MAX_AGE_MS) {
      return 'DELAYED';
    }

    return 'STALE';
  }
}

export const marketService = new MarketService();

/**
 * Background / Scheduled Ingestion Poller
 */
export class MarketIngestionPoller {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private service: MarketService = marketService,
    private intervalMs: number = 60000
  ) {}

  start(intervalMs?: number): void {
    if (intervalMs) {
      this.intervalMs = intervalMs;
    }
    if (this.timer) {
      return; // Already running
    }

    // Schedule periodic polling
    this.timer = setInterval(() => {
      this.pollOnce().catch((err) => {
        console.error('❌ Scheduled market data ingestion error:', err);
      });
    }, this.intervalMs);

    // Initial pass immediately
    this.pollOnce().catch((err) => {
      console.error('❌ Initial market data ingestion error:', err);
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<IngestionResult> {
    if (this.isRunning) {
      // Guard against overlapping runs
      return {
        status: 'idle',
        distinctSymbolsCount: 0,
        fetchedCount: 0,
        persistedCount: 0,
        failedSymbols: [],
        timestamp: new Date().toISOString()
      };
    }

    this.isRunning = true;
    try {
      return await this.service.ingestMarketData();
    } finally {
      this.isRunning = false;
    }
  }

  isActive(): boolean {
    return this.timer !== null;
  }
}

export const marketPoller = new MarketIngestionPoller();
