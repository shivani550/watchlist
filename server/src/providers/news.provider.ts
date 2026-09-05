import { env } from '../config/env.js';

export interface NewsItemInput {
  symbol: string;
  headline: string;
  url: string;
  publishedAt: Date;
  providerId?: string | null;
}

export interface NewsProvider {
  /**
   * Fetches recent news items for a single symbol.
   */
  fetchNewsForSymbol(symbol: string): Promise<NewsItemInput[]>;

  /**
   * Fetches recent news items across multiple distinct watched symbols.
   */
  fetchNewsForSymbols(symbols: string[]): Promise<NewsItemInput[]>;
}

export interface MarketauxEntity {
  symbol?: string;
  name?: string;
  match_score?: number;
  sentiment_score?: number;
  industry?: string;
}

export interface MarketauxArticle {
  uuid: string;
  title: string;
  description?: string;
  snippet?: string;
  url: string;
  image_url?: string;
  language?: string;
  published_at: string;
  source?: string;
  entities?: MarketauxEntity[];
}

export interface MarketauxResponse {
  meta?: {
    found: number;
    returned: number;
    limit: number;
    page: number;
  };
  data?: MarketauxArticle[];
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Real Marketaux Financial News API Provider.
 * Conforms strictly to the NewsProvider interface.
 */
export class MarketauxNewsProvider implements NewsProvider {
  private apiToken: string;
  private baseUrl: string;

  constructor(apiToken?: string, baseUrl = 'https://api.marketaux.com/v1') {
    this.apiToken = (apiToken ?? env.MARKETAUX_API_TOKEN ?? '').trim();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async fetchNewsForSymbol(symbol: string): Promise<NewsItemInput[]> {
    const cleanSym = symbol.toUpperCase().trim();
    if (!cleanSym) return [];

    if (!this.apiToken) {
      throw new Error('Marketaux API token is not configured (MARKETAUX_API_TOKEN)');
    }

    const url = new URL(`${this.baseUrl}/news/all`);
    url.searchParams.set('symbols', cleanSym);
    url.searchParams.set('filter_entities', 'true');
    url.searchParams.set('language', 'en');
    url.searchParams.set('limit', '5');
    url.searchParams.set('api_token', this.apiToken);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'WatchlistGrow-App/1.0',
        },
        signal: AbortSignal.timeout(10000), // 10s timeout
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Marketaux network failure for ${cleanSym}: ${msg}`);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Marketaux authentication failed (HTTP ${response.status}): Invalid API token`);
      }
      if (response.status === 429) {
        throw new Error('Marketaux rate limit exceeded (HTTP 429)');
      }
      throw new Error(`Marketaux API error (HTTP ${response.status}): ${response.statusText}`);
    }

    let payload: MarketauxResponse;
    try {
      payload = (await response.json()) as MarketauxResponse;
    } catch (jsonErr) {
      throw new Error(`Marketaux malformed JSON response for ${cleanSym}`);
    }

    if (payload.error) {
      throw new Error(`Marketaux API error: ${payload.error.message || payload.error.code}`);
    }

    if (!payload.data || !Array.isArray(payload.data)) {
      return [];
    }

    const results: NewsItemInput[] = [];
    for (const article of payload.data) {
      if (!article.title && !article.snippet) continue;
      if (!article.url) continue;

      const publishedAtDate = article.published_at ? new Date(article.published_at) : new Date();
      if (isNaN(publishedAtDate.getTime())) continue;

      results.push({
        symbol: cleanSym,
        headline: (article.title || article.snippet || '').trim(),
        url: article.url.trim(),
        publishedAt: publishedAtDate,
        providerId: article.uuid ? String(article.uuid) : null,
      });
    }

    return results;
  }

  async fetchNewsForSymbols(symbols: string[]): Promise<NewsItemInput[]> {
    const allNews: NewsItemInput[] = [];

    for (const sym of symbols) {
      try {
        const items = await this.fetchNewsForSymbol(sym);
        allNews.push(...items);
      } catch (err) {
        console.warn(`[MarketauxNewsProvider] Failed fetching news for ${sym}:`, err instanceof Error ? err.message : err);
      }
    }

    return allNews;
  }
}

export class MockNewsProvider implements NewsProvider {
  private simulateFailure = false;
  private simulateRateLimit = false;
  private failSymbols: Set<string> = new Set();

  private static readonly SAMPLE_HEADLINES: Record<string, string[]> = {
    RELIANCE: [
      'Reliance Retail expands footprint with new fulfillment hubs across Western India',
      'Jio announces nationwide launch of new 5G enterprise cloud suite',
      'Reliance Industries advances green energy capex for new gigafactory',
    ],
    TCS: [
      'TCS wins major multi-year digital transformation deal with European insurer',
      'TCS expands AI Centers of Excellence with new generative intelligence partnerships',
      'TCS reports steady client additions and margin resilience in quarterly review',
    ],
    INFY: [
      'Infosys deepens cloud collaboration with leading global financial institutions',
      'Infosys expands Cobalt portfolio with automated enterprise AI blueprints',
      'Infosys recognized as a market leader in ESG and sustainable tech delivery',
    ],
    HDFCBANK: [
      'HDFC Bank reports quarterly deposit growth outpacing branch expansion target',
      'HDFC Bank rolls out automated commercial lending platform for MSME sector',
      'HDFC Bank strengthens retail banking presence in tier-2 cities',
    ],
    ICICIBANK: [
      'ICICI Bank launches digital trade finance hub for corporate exporters',
      'ICICI Bank sees strong adoption of instant credit lines on mobile platform',
      'ICICI Bank expands institutional wealth management services',
    ],
    AAPL: [
      'Apple introduces next-generation silicon chipset for professional workstation lineup',
      'Services revenue reaches all-time high amid robust subscription ecosystem growth',
      'Apple expands developer tools with on-device generative AI acceleration',
    ],
    GOOGL: [
      'Google Cloud posts accelerated enterprise growth driven by foundational AI services',
      'Search intelligence updates roll out to global enterprise workspace customers',
      'Alphabet advances data center efficiency investments for scalable compute',
    ],
  };

  /** Test helper to simulate total provider outage */
  setSimulateFailure(fail: boolean) {
    this.simulateFailure = fail;
  }

  /** Test helper to simulate rate limits (HTTP 429) */
  setSimulateRateLimit(rateLimit: boolean) {
    this.simulateRateLimit = rateLimit;
  }

  /** Test helper to simulate failure on specific symbols */
  setSymbolFailure(symbol: string, fail: boolean) {
    if (fail) {
      this.failSymbols.add(symbol.toUpperCase().trim());
    } else {
      this.failSymbols.delete(symbol.toUpperCase().trim());
    }
  }

  async fetchNewsForSymbol(symbol: string): Promise<NewsItemInput[]> {
    const cleanSym = symbol.toUpperCase().trim();

    if (this.simulateFailure) {
      throw new Error(`MockNewsProvider failure during news fetch for ${cleanSym}`);
    }

    if (this.simulateRateLimit) {
      throw new Error('MockNewsProvider rate limit exceeded (HTTP 429)');
    }

    if (this.failSymbols.has(cleanSym)) {
      throw new Error(`Simulated symbol-specific news failure for ${cleanSym}`);
    }

    const templateHeadlines = MockNewsProvider.SAMPLE_HEADLINES[cleanSym] || [
      `${cleanSym} quarterly results show steady operating momentum across core segments`,
      `${cleanSym} announces strategic business expansion and new enterprise partnerships`,
      `${cleanSym} management highlights resilient demand and strong governance metrics`,
    ];

    const now = Date.now();
    const results: NewsItemInput[] = [];

    // Generate 2-3 deterministic news items published within the last few hours
    templateHeadlines.forEach((headline, idx) => {
      // Publish times staggered: 30 mins ago, 2 hours ago, 5 hours ago
      const publishedAt = new Date(now - (idx * 3600 * 1000 * 2 + 1800 * 1000));
      const slug = headline
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40);
      const url = `https://news.watchlistpulse.internal/stocks/${cleanSym.toLowerCase()}/${slug}`;
      const providerId = `mock-news-${cleanSym.toLowerCase()}-${idx + 1}`;

      results.push({
        symbol: cleanSym,
        headline,
        url,
        publishedAt,
        providerId,
      });
    });

    return results;
  }

  async fetchNewsForSymbols(symbols: string[]): Promise<NewsItemInput[]> {
    if (this.simulateFailure) {
      throw new Error('MockNewsProvider global failure during batch news fetch');
    }

    if (this.simulateRateLimit) {
      throw new Error('MockNewsProvider rate limit exceeded (HTTP 429)');
    }

    const allNews: NewsItemInput[] = [];

    for (const sym of symbols) {
      try {
        const items = await this.fetchNewsForSymbol(sym);
        allNews.push(...items);
      } catch (err) {
        // Individual symbol failures are handled by the caller or isolated here
        if (this.failSymbols.has(sym.toUpperCase().trim())) {
          throw err;
        }
        console.warn(`[MockNewsProvider] Error fetching news for ${sym}:`, err);
      }
    }

    return allNews;
  }
}

let activeNewsProvider: NewsProvider | null = null;

export function getNewsProvider(): NewsProvider {
  if (!activeNewsProvider) {
    // Production default: MarketauxNewsProvider
    activeNewsProvider = new MarketauxNewsProvider();
  }
  return activeNewsProvider;
}

export function setNewsProvider(provider: NewsProvider): void {
  activeNewsProvider = provider;
}

