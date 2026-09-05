import { DiffCalculationInput, DiffResult, MeaningfulChange } from '@watchlist/shared';
import { determineLikelyReason } from '../reason/reason.engine.js';

export const DEFAULT_MEANINGFUL_CHANGE_THRESHOLD = 2.0; // 2.0%
export const DEFAULT_REACTION_WINDOW_MINUTES = 120; // 2 hours (120 min)

/**
 * Isolated, Deterministic Temporal Diff Engine.
 * Computes exact state deltas between baseline and current market snapshot.
 * 
 * Conceptually: calculateChanges(inputs) -> DiffResult
 * 
 * Pure function: Zero side effects, zero HTTP dependencies, zero database calls, zero React imports.
 */
export function calculateChanges(input: DiffCalculationInput): DiffResult {
  const threshold = input.thresholdPercent ?? DEFAULT_MEANINGFUL_CHANGE_THRESHOLD;
  const reactionWindowMinutes = input.reactionWindowMinutes ?? DEFAULT_REACTION_WINDOW_MINUTES;
  const reactionWindowMs = reactionWindowMinutes * 60 * 1000;
  const changes: MeaningfulChange[] = [];

  // First visit: no previous visit state exists to compare against
  if (!input.lastSeenAt) {
    return {
      watchlistId: input.watchlistId,
      evaluatedAt: input.currentTimestamp,
      lastSeenAt: null,
      hasMeaningfulChanges: false,
      changes: [],
      message: 'Initial visit to this watchlist. Baseline prices recorded.'
    };
  }

  // Subsequent visit: evaluate each watched symbol against its historical baseline, price observations, and recent news
  for (const rawSymbol of input.symbols) {
    const symbol = rawSymbol.toUpperCase().trim();
    const current = input.currentQuotes[symbol];
    const baseline = input.historicalBaselineQuotes[symbol];
    const recentNews = input.recentNewsBySymbol?.[symbol] || [];
    const observations = input.priceObservationsBySymbol?.[symbol] || [];

    const hasValidPriceComparison = current && baseline && baseline.price > 0;
    const priceDelta = hasValidPriceComparison ? current.price - baseline.price : 0;
    const generalPercentageChange = hasValidPriceComparison ? (priceDelta / baseline.price) * 100 : 0;
    const absGeneralPercentageChange = Math.abs(generalPercentageChange);
    const isGeneralMovementSignificant = hasValidPriceComparison && absGeneralPercentageChange >= threshold;

    // Check for News-to-Price Reaction
    let detectedReaction: {
      newsItem: typeof recentNews[0];
      baselinePrice: number;
      reactionPrice: number;
      percentageChange: number;
      reactionTimestamp: string;
    } | null = null;

    if (recentNews.length > 0) {
      // Build a full chronological timeline of price observations
      const timeline: Array<{ price: number; timestampMs: number; timestampIso: string }> = [];
      if (baseline) {
        timeline.push({
          price: baseline.price,
          timestampMs: new Date(baseline.timestamp).getTime(),
          timestampIso: baseline.timestamp,
        });
      }
      for (const obs of observations) {
        timeline.push({
          price: obs.price,
          timestampMs: new Date(obs.timestamp).getTime(),
          timestampIso: obs.timestamp,
        });
      }
      if (current) {
        timeline.push({
          price: current.price,
          timestampMs: new Date(current.timestamp).getTime(),
          timestampIso: current.timestamp,
        });
      }
      // Sort timeline ASC
      timeline.sort((a, b) => a.timestampMs - b.timestampMs);

      for (const news of recentNews) {
        const newsPublishedMs = new Date(news.publishedAt).getTime();
        if (isNaN(newsPublishedMs)) continue;

        // Baseline: Latest price observation at or before news published time
        let preNewsPrice = baseline ? baseline.price : (timeline[0]?.price || 0);
        for (const pt of timeline) {
          if (pt.timestampMs <= newsPublishedMs && pt.price > 0) {
            preNewsPrice = pt.price;
          }
        }

        if (preNewsPrice <= 0) continue;

        // Subsequent observations strictly after news publication within reaction window
        const subsequentObservations = timeline.filter(
          (pt) => pt.timestampMs > newsPublishedMs && pt.timestampMs <= newsPublishedMs + reactionWindowMs
        );

        if (subsequentObservations.length > 0) {
          // Find the observation with the highest magnitude reaction
          for (const obs of subsequentObservations) {
            const reactionPct = ((obs.price - preNewsPrice) / preNewsPrice) * 100;
            if (Math.abs(reactionPct) >= threshold) {
              if (!detectedReaction || Math.abs(reactionPct) > Math.abs(detectedReaction.percentageChange)) {
                detectedReaction = {
                  newsItem: news,
                  baselinePrice: preNewsPrice,
                  reactionPrice: obs.price,
                  percentageChange: parseFloat(reactionPct.toFixed(2)),
                  reactionTimestamp: obs.timestampIso,
                };
              }
            }
          }
        }
      }
    }

    // Classify into signal types
    if (detectedReaction) {
      // 1. NEWS_PRICE_REACTION
      const pct = detectedReaction.percentageChange;
      const isUp = pct > 0;
      const direction: 'UP' | 'DOWN' | 'FLAT' = isUp ? 'UP' : pct < 0 ? 'DOWN' : 'FLAT';
      const formattedPercent = pct.toFixed(2);
      const summary = `${symbol} is ${isUp ? 'up' : 'down'} ${isUp ? '+' : ''}${formattedPercent}% shortly after relevant news was published.`;

      const likelyReason = determineLikelyReason({
        symbol,
        percentageChange: pct,
        direction,
        newsItems: [detectedReaction.newsItem],
        thresholdPercent: threshold,
        type: 'NEWS_PRICE_REACTION',
        isReactionInWindow: true,
      });

      changes.push({
        symbol,
        type: 'NEWS_PRICE_REACTION',
        direction,
        summary,
        previousPrice: detectedReaction.baselinePrice,
        currentPrice: detectedReaction.reactionPrice,
        percentageChange: pct,
        percentChangeSinceLastSeen: parseFloat(generalPercentageChange.toFixed(2)),
        absoluteChangeSinceLastSeen: parseFloat(priceDelta.toFixed(2)),
        newsItems: [detectedReaction.newsItem],
        likelyReason,
        freshnessState: current?.freshnessState,
        reactionDetails: {
          baselinePrice: detectedReaction.baselinePrice,
          reactionPrice: detectedReaction.reactionPrice,
          percentageChange: pct,
          newsPublishedAt: detectedReaction.newsItem.publishedAt,
          reactionTimestamp: detectedReaction.reactionTimestamp,
        },
      });
    } else if (isGeneralMovementSignificant) {
      // 2. PRICE_MOVEMENT (Significant price movement without news reaction)
      const formattedPercent = generalPercentageChange.toFixed(2);
      const isUp = generalPercentageChange > 0;
      const direction: 'UP' | 'DOWN' | 'FLAT' = isUp ? 'UP' : generalPercentageChange < 0 ? 'DOWN' : 'FLAT';
      const summary = `${symbol} is ${isUp ? 'up' : 'down'} ${isUp ? '+' : ''}${formattedPercent}% since your last visit.`;

      const likelyReason = determineLikelyReason({
        symbol,
        percentageChange: parseFloat(generalPercentageChange.toFixed(2)),
        direction,
        newsItems: [],
        thresholdPercent: threshold,
        type: 'PRICE_MOVEMENT',
      });

      changes.push({
        symbol,
        type: 'PRICE_MOVEMENT',
        direction,
        summary,
        previousPrice: baseline.price,
        currentPrice: current.price,
        percentageChange: parseFloat(generalPercentageChange.toFixed(2)),
        percentChangeSinceLastSeen: parseFloat(generalPercentageChange.toFixed(2)),
        absoluteChangeSinceLastSeen: parseFloat(priceDelta.toFixed(2)),
        newsItems: [],
        likelyReason,
        freshnessState: current.freshnessState,
        reactionDetails: null,
      });
    } else if (recentNews.length > 0) {
      // 3. NEWS_ONLY (Relevant news detected, but no significant reaction)
      const currentPrice = current ? current.price : (baseline ? baseline.price : 0);
      const prevPrice = baseline ? baseline.price : null;

      const likelyReason = determineLikelyReason({
        symbol,
        percentageChange: hasValidPriceComparison ? parseFloat(generalPercentageChange.toFixed(2)) : 0,
        direction: 'FLAT',
        newsItems: recentNews,
        thresholdPercent: threshold,
        type: 'NEWS_ONLY',
      });

      changes.push({
        symbol,
        type: 'NEWS_ONLY',
        direction: 'FLAT',
        summary: `Relevant ${symbol} news was detected; price remained relatively stable.`,
        previousPrice: prevPrice,
        currentPrice,
        percentageChange: parseFloat(generalPercentageChange.toFixed(2)),
        percentChangeSinceLastSeen: parseFloat(generalPercentageChange.toFixed(2)),
        absoluteChangeSinceLastSeen: parseFloat(priceDelta.toFixed(2)),
        newsItems: recentNews,
        likelyReason,
        freshnessState: current?.freshnessState,
        reactionDetails: null,
      });
    }
  }

  // Deterministic sorting:
  // 1. NEWS_PRICE_REACTION and PRICE_MOVEMENT first by highest absolute % change magnitude descending
  // 2. NEWS_ONLY / NEW_NEWS next by news count descending
  // 3. Alphabetical by symbol
  changes.sort((a, b) => {
    const isMajorA = a.type === 'NEWS_PRICE_REACTION' || a.type === 'PRICE_MOVEMENT';
    const isMajorB = b.type === 'NEWS_PRICE_REACTION' || b.type === 'PRICE_MOVEMENT';
    if (isMajorA !== isMajorB) {
      return isMajorA ? -1 : 1;
    }
    if (isMajorA && isMajorB) {
      const magA = Math.abs(a.percentageChange ?? 0);
      const magB = Math.abs(b.percentageChange ?? 0);
      if (magB !== magA) {
        return magB - magA;
      }
    } else {
      const countA = a.newsItems?.length ?? 0;
      const countB = b.newsItems?.length ?? 0;
      if (countB !== countA) {
        return countB - countA;
      }
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const hasMeaningfulChanges = changes.length > 0;
  const message = hasMeaningfulChanges
    ? `${changes.length} meaningful ${changes.length === 1 ? 'signal' : 'signals'} detected since your last check.`
    : 'Nothing significant changed since your last visit.';

  return {
    watchlistId: input.watchlistId,
    evaluatedAt: input.currentTimestamp,
    lastSeenAt: input.lastSeenAt,
    hasMeaningfulChanges,
    changes,
    message
  };
}
