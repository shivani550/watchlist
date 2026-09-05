import { NewsItem, NewsIngestionResult } from '@watchlist/shared';
import { newsRepository } from './news.repository.js';
import { watchlistRepository } from '../watchlist/watchlist.repository.js';
import { getNewsProvider, NewsItemInput } from '../../providers/news.provider.js';

export class NewsService {
  /**
   * Performs an ingestion cycle for distinct watched symbols across all user watchlists.
   * Adheres strictly to the Batch 8 requirement:
   * 100 users watching RELIANCE -> exactly 1 logical news fetch.
   * Isolated per-symbol error handling ensures failure of one symbol never breaks others.
   */
  async ingestNewsForDistinctWatchedSymbols(): Promise<NewsIngestionResult> {
    const symbols = await watchlistRepository.findDistinctWatchedSymbols();
    const provider = getNewsProvider();

    let itemsSaved = 0;
    const errors: Array<{ symbol: string; error: string }> = [];

    for (const rawSymbol of symbols) {
      const symbol = rawSymbol.toUpperCase().trim();
      try {
        const fetchedItems: NewsItemInput[] = await provider.fetchNewsForSymbol(symbol);
        if (fetchedItems.length > 0) {
          const savedRows = await newsRepository.insertNewsBatch(fetchedItems);
          itemsSaved += savedRows.length;
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.warn(`[NewsService] Ingestion failed for symbol ${symbol}:`, errorMessage);
        errors.push({ symbol, error: errorMessage });
      }
    }

    return {
      success: errors.length === 0,
      symbolsAttempted: symbols.length,
      newsItemsSaved: itemsSaved,
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Retrieves news items for a single symbol, optionally bounded by a starting timestamp.
   */
  async getNewsForSymbol(symbol: string, since?: Date, limit = 10): Promise<NewsItem[]> {
    const cleanSymbol = symbol.toUpperCase().trim();
    const rows = since
      ? await newsRepository.getNewsSince(cleanSymbol, since, limit)
      : await newsRepository.getRecentNews(cleanSymbol, limit);

    return rows.map((r) => newsRepository.rowToDto(r));
  }

  /**
   * Retrieves a dictionary of recent news grouped by symbol published after the given timestamp.
   */
  async getNewsForSymbolsSince(symbols: string[], since: Date): Promise<Record<string, NewsItem[]>> {
    if (symbols.length === 0) return {};

    const rows = await newsRepository.getNewsForSymbolsSince(symbols, since);
    const map: Record<string, NewsItem[]> = {};

    for (const sym of symbols) {
      map[sym.toUpperCase().trim()] = [];
    }

    for (const row of rows) {
      const sym = row.symbol.toUpperCase().trim();
      if (!map[sym]) {
        map[sym] = [];
      }
      map[sym].push(newsRepository.rowToDto(row));
    }

    return map;
  }
}

export const newsService = new NewsService();
