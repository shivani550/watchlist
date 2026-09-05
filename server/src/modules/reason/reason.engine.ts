import { ChangeType, NewsItem } from '@watchlist/shared';

export interface ReasonInput {
  symbol?: string;
  percentageChange?: number | null;
  direction?: 'UP' | 'DOWN' | 'FLAT' | 'FIRST_RECORD';
  newsItems?: NewsItem[];
  thresholdPercent?: number;
  type?: ChangeType;
  isReactionInWindow?: boolean;
}

export const DEFAULT_REASON_THRESHOLD = 2.0;

/**
 * Deterministic, rule-based Reason Engine for market movement attribution.
 * 
 * Rules:
 * 1. NEWS_PRICE_REACTION (Significant subsequent movement within reaction window after news):
 *    -> "{symbol} moved {+X.XX% / -X.XX%} shortly after relevant news was published."
 * 2. PRICE_MOVEMENT (Significant price movement with no relevant news):
 *    -> "{symbol} moved {+X.XX% / -X.XX%}; no relevant news signal was identified."
 * 3. NEWS_ONLY / NEW_NEWS (Relevant news without significant price reaction):
 *    -> "Relevant {symbol} news was detected, but no significant price reaction was observed."
 * 4. No meaningful movement and no news:
 *    -> null
 * 
 * Strict non-causal constraints:
 * - Zero LLM or generative models.
 * - Zero machine learning or sentiment analysis.
 * - Zero unsupported causal claims (describes temporal correlation, never claims definite causation).
 * - Zero external API calls.
 */
export function determineLikelyReason(input: ReasonInput): string | null {
  const threshold = input.thresholdPercent ?? DEFAULT_REASON_THRESHOLD;
  const hasNews = Array.isArray(input.newsItems) && input.newsItems.length > 0;
  const hasValidChange = typeof input.percentageChange === 'number' && !isNaN(input.percentageChange);
  const isMovementSignificant = hasValidChange && Math.abs(input.percentageChange!) >= threshold;
  const sym = input.symbol ? input.symbol.toUpperCase().trim() : 'The stock';

  const formatPercentStr = () => {
    if (!hasValidChange) return 'significantly';
    const sign = input.percentageChange! > 0 ? '+' : '';
    return `${sign}${input.percentageChange!.toFixed(2)}%`;
  };

  // Case 1: News followed by significant price reaction
  if (input.type === 'NEWS_PRICE_REACTION' || (isMovementSignificant && hasNews && input.isReactionInWindow !== false)) {
    return `${sym} moved ${formatPercentStr()} shortly after relevant news was published.`;
  }

  // Case 2: Significant price movement without relevant news
  if (input.type === 'PRICE_MOVEMENT' || (isMovementSignificant && !hasNews)) {
    return `${sym} moved ${formatPercentStr()}; no relevant news signal was identified.`;
  }

  // Case 3: Relevant news detected with no significant price reaction
  if (input.type === 'NEWS_ONLY' || input.type === 'NEW_NEWS' || (!isMovementSignificant && hasNews)) {
    return `Relevant ${sym} news was detected, but no significant price reaction was observed.`;
  }

  // Case 4: No meaningful signal or missing data
  return null;
}
