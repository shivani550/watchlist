import {
  RangeStatus,
  SparklinePoint,
  StockSparklineData,
  WatchlistSparklinesResponse,
} from '@watchlist/shared';
import { marketRepository, PriceSnapshotRow } from '../market/market.repository.js';
import { watchlistRepository } from '../watchlist/watchlist.repository.js';
import { WatchlistError } from '../watchlist/watchlist.service.js';
import { cacheService, CacheService } from '../../cache/cache.service.js';

export interface ComputeSparklineInput {
  symbol: string;
  historicalSnapshots: PriceSnapshotRow[];
  latestSnapshot?: PriceSnapshotRow | null;
  lastSeenAt?: Date | string | null;
}

export class SparklineService {
  /**
   * Pure domain calculation function that takes historical snapshots, latest quote, and lastSeenAt
   * and computes normalized 7-day points, ghost pin position, since-last-visit %, and prior 20-day range breach status.
   */
  computeSparklineData(input: ComputeSparklineInput): StockSparklineData {
    const { symbol, historicalSnapshots, latestSnapshot, lastSeenAt } = input;

    // Combine historical snapshots with latest snapshot if latest is newer
    let allSnapshots = [...historicalSnapshots];
    if (latestSnapshot) {
      const exists = allSnapshots.some(
        (s) => new Date(s.timestamp).getTime() === new Date(latestSnapshot.timestamp).getTime()
      );
      if (!exists) {
        // If not present, append if newer or insert chronologically
        allSnapshots.push(latestSnapshot);
        allSnapshots.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }
    }

    if (allSnapshots.length === 0) {
      return {
        symbol: symbol.toUpperCase(),
        points: [],
        lastSeenIndex: null,
        lastSeenPrice: null,
        currentPrice: latestSnapshot ? Number(latestSnapshot.price) : null,
        sinceLastVisitPercent: null,
        rangeStatus: 'UNKNOWN',
        prior20DayHigh: null,
        prior20DayLow: null,
      };
    }

    const currentPrice = latestSnapshot
      ? Number(latestSnapshot.price)
      : Number(allSnapshots[allSnapshots.length - 1].price);

    // 1. 20-Day Range Breach Detection (strictly prior to current observation)
    // We take daily snapshots strictly preceding the current observation
    const currentObservationTime = latestSnapshot
      ? new Date(latestSnapshot.timestamp).getTime()
      : new Date(allSnapshots[allSnapshots.length - 1].timestamp).getTime();

    const priorDailySnapshots = allSnapshots.filter(
      (s) => new Date(s.timestamp).getTime() < currentObservationTime
    );

    // Take up to the last 20 prior daily records
    const prior20Snapshots = priorDailySnapshots.slice(-20);

    let rangeStatus: RangeStatus = 'UNKNOWN';
    let prior20DayHigh: number | null = null;
    let prior20DayLow: number | null = null;

    if (prior20Snapshots.length >= 5) {
      const priorPrices = prior20Snapshots.map((s) => Number(s.price));
      prior20DayHigh = Math.max(...priorPrices);
      prior20DayLow = Math.min(...priorPrices);

      if (currentPrice > prior20DayHigh) {
        rangeStatus = 'BREAKOUT_HIGH';
      } else if (currentPrice < prior20DayLow) {
        rangeStatus = 'BREAKOUT_LOW';
      } else {
        rangeStatus = 'WITHIN_RANGE';
      }
    }

    // 2. 7-Day Sparkline Window (up to 7 most recent points including current)
    const sevenDaySnapshots = allSnapshots.slice(-7);

    // Normalize SVG points (width 100, height 30, with 3px padding top/bottom)
    const width = 100;
    const height = 30;
    const padY = 4;
    const usableHeight = height - padY * 2;

    const prices = sevenDaySnapshots.map((s) => Number(s.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceDelta = maxPrice - minPrice;

    const points: SparklinePoint[] = sevenDaySnapshots.map((snap, idx) => {
      const p = Number(snap.price);
      // X distributed across [0, width]
      const x = sevenDaySnapshots.length > 1
        ? Math.round((idx / (sevenDaySnapshots.length - 1)) * width * 10) / 10
        : width / 2;

      // Y inverted for SVG (0 is top/high, height is bottom/low)
      let y: number;
      if (priceDelta === 0) {
        y = height / 2;
      } else {
        const normalizedRatio = (p - minPrice) / priceDelta;
        y = Math.round((height - padY - normalizedRatio * usableHeight) * 10) / 10;
      }

      return {
        x,
        y,
        price: p,
        timestamp: new Date(snap.timestamp).toISOString(),
      };
    });

    // 3. Ghost Pin Index & Since Last Visit %
    let lastSeenIndex: number | null = null;
    let lastSeenPrice: number | null = null;
    let sinceLastVisitPercent: number | null = null;

    if (lastSeenAt) {
      const lastSeenTime = new Date(lastSeenAt).getTime();

      // Find the snapshot in sevenDaySnapshots at or immediately prior to lastSeenAt
      let bestIdx = -1;
      let minDiff = Infinity;

      for (let i = 0; i < sevenDaySnapshots.length; i++) {
        const snapTime = new Date(sevenDaySnapshots[i].timestamp).getTime();
        if (snapTime <= lastSeenTime) {
          bestIdx = i; // latest one that is <= lastSeenAt
        } else {
          // If no snapshot <= lastSeenTime was found yet, keep track of closest
          const diff = Math.abs(snapTime - lastSeenTime);
          if (diff < minDiff && bestIdx === -1) {
            minDiff = diff;
          }
        }
      }

      // If lastSeenTime is older than all 7-day points, fallback to index 0 (start of 7D window)
      if (bestIdx === -1) {
        bestIdx = 0;
      }

      lastSeenIndex = bestIdx;
      lastSeenPrice = points[lastSeenIndex].price;

      if (lastSeenPrice > 0) {
        const pct = ((currentPrice - lastSeenPrice) / lastSeenPrice) * 100;
        sinceLastVisitPercent = Math.round(pct * 100) / 100;
      }
    }

    return {
      symbol: symbol.toUpperCase(),
      points,
      lastSeenIndex,
      lastSeenPrice,
      currentPrice,
      sinceLastVisitPercent,
      rangeStatus,
      prior20DayHigh,
      prior20DayLow,
    };
  }

  /**
   * Batch retrieves and computes sparklines for all stocks in a watchlist with cache-aside.
   */
  async getWatchlistSparklines(userId: string, watchlistId: string): Promise<WatchlistSparklinesResponse> {
    const watchlist = await watchlistRepository.findById(watchlistId);
    if (!watchlist) {
      throw new WatchlistError('Watchlist not found', 404);
    }
    if (watchlist.user_id !== userId) {
      throw new WatchlistError('Unauthorized access to watchlist', 403);
    }

    // Check cache for computed watchlist sparklines
    const cacheKey = CacheService.keys.sparklinesWatchlist(watchlistId);
    const cached = await cacheService.get<WatchlistSparklinesResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const items = await watchlistRepository.findItemsByWatchlistId(watchlistId);
    const symbols = items.map((i) => i.symbol.toUpperCase());

    if (symbols.length === 0) {
      const emptyResult: WatchlistSparklinesResponse = {
        watchlistId,
        lastSeenAt: watchlist.last_seen_at ? new Date(watchlist.last_seen_at).toISOString() : null,
        sparklines: {},
      };
      await cacheService.set(cacheKey, emptyResult, 300);
      return emptyResult;
    }

    // 1. Batch fetch historical snapshots (up to 30 days per symbol) in a single DB query
    const allHistorical = await marketRepository.getBatchHistoricalSnapshots(symbols, 30);

    // Group historical snapshots by symbol
    const historicalBySymbol: Record<string, PriceSnapshotRow[]> = {};
    for (const snap of allHistorical) {
      const sym = snap.symbol.toUpperCase();
      if (!historicalBySymbol[sym]) {
        historicalBySymbol[sym] = [];
      }
      historicalBySymbol[sym].push(snap);
    }

    // 2. Batch fetch latest quotes in a single DB query
    const latestSnapshots = await marketRepository.getLatestSnapshotsForSymbols(symbols);
    const latestBySymbol: Record<string, PriceSnapshotRow> = {};
    for (const snap of latestSnapshots) {
      latestBySymbol[snap.symbol.toUpperCase()] = snap;
    }

    // 3. Compute sparklines for each symbol in memory
    const sparklines: Record<string, StockSparklineData> = {};
    for (const sym of symbols) {
      sparklines[sym] = this.computeSparklineData({
        symbol: sym,
        historicalSnapshots: historicalBySymbol[sym] || [],
        latestSnapshot: latestBySymbol[sym] || null,
        lastSeenAt: watchlist.last_seen_at,
      });
    }

    const result: WatchlistSparklinesResponse = {
      watchlistId,
      lastSeenAt: watchlist.last_seen_at ? new Date(watchlist.last_seen_at).toISOString() : null,
      sparklines,
    };

    // Cache computed sparklines for 5 minutes (300s)
    await cacheService.set(cacheKey, result, 300);

    return result;
  }
}

export const sparklineService = new SparklineService();
