import { pool } from '../../db/pool.js';
import { NewsItem } from '@watchlist/shared';
import { NewsItemInput } from '../../providers/news.provider.js';

export interface NewsItemRow {
  id: string;
  symbol: string;
  headline: string;
  url: string;
  published_at: Date;
  provider_id: string | null;
  fetched_at: Date;
}

export class NewsRepository {
  /**
   * Inserts a single news item, ignoring duplicates on (symbol, url).
   */
  async insertNewsItem(
    symbol: string,
    headline: string,
    url: string,
    publishedAt: Date,
    providerId?: string | null
  ): Promise<NewsItemRow | null> {
    const { rows } = await pool.query<NewsItemRow>(
      `INSERT INTO news_items (symbol, headline, url, published_at, provider_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (symbol, url) DO NOTHING
       RETURNING id, symbol, headline, url, published_at, provider_id, fetched_at;`,
      [symbol, headline, url, publishedAt, providerId || null]
    );
    return rows[0] || null;
  }

  /**
   * Batch inserts multiple news items in a single query with ON CONFLICT DO NOTHING.
   */
  async insertNewsBatch(items: NewsItemInput[]): Promise<NewsItemRow[]> {
    if (items.length === 0) return [];

    const valuePlaceholders: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const item of items) {
      valuePlaceholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        item.symbol.toUpperCase().trim(),
        item.headline.trim(),
        item.url.trim(),
        item.publishedAt,
        item.providerId || null
      );
    }

    const query = `
      INSERT INTO news_items (symbol, headline, url, published_at, provider_id)
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (symbol, url) DO NOTHING
      RETURNING id, symbol, headline, url, published_at, provider_id, fetched_at;
    `;

    const { rows } = await pool.query<NewsItemRow>(query, values);
    return rows;
  }

  /**
   * Retrieves news headlines published after a given timestamp (e.g. user's last_seen_at) for a symbol.
   */
  async getNewsSince(symbol: string, since: Date, limit = 10): Promise<NewsItemRow[]> {
    const { rows } = await pool.query<NewsItemRow>(
      `SELECT id, symbol, headline, url, published_at, provider_id, fetched_at
       FROM news_items
       WHERE symbol = $1 AND published_at > $2
       ORDER BY published_at DESC
       LIMIT $3;`,
      [symbol.toUpperCase().trim(), since, limit]
    );
    return rows;
  }

  /**
   * Retrieves recent news headlines for a symbol without a timestamp lower bound.
   */
  async getRecentNews(symbol: string, limit = 10): Promise<NewsItemRow[]> {
    const { rows } = await pool.query<NewsItemRow>(
      `SELECT id, symbol, headline, url, published_at, provider_id, fetched_at
       FROM news_items
       WHERE symbol = $1
       ORDER BY published_at DESC
       LIMIT $2;`,
      [symbol.toUpperCase().trim(), limit]
    );
    return rows;
  }

  /**
   * Retrieves news published since a given timestamp for a set of symbols.
   */
  async getNewsForSymbolsSince(symbols: string[], since: Date, limitPerSymbol = 5): Promise<NewsItemRow[]> {
    if (symbols.length === 0) return [];

    const cleanSymbols = symbols.map((s) => s.toUpperCase().trim());
    const { rows } = await pool.query<NewsItemRow>(
      `SELECT id, symbol, headline, url, published_at, provider_id, fetched_at
       FROM (
         SELECT id, symbol, headline, url, published_at, provider_id, fetched_at,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY published_at DESC) as rn
         FROM news_items
         WHERE symbol = ANY($1::varchar[]) AND published_at > $2
       ) sub
       WHERE rn <= $3
       ORDER BY published_at DESC;`,
      [cleanSymbols, since, limitPerSymbol]
    );
    return rows;
  }

  /**
   * Converts a database row to a shared NewsItem DTO.
   */
  rowToDto(row: NewsItemRow): NewsItem {
    return {
      id: row.id,
      symbol: row.symbol,
      headline: row.headline,
      url: row.url,
      publishedAt: row.published_at.toISOString(),
      providerId: row.provider_id,
      fetchedAt: row.fetched_at.toISOString(),
    };
  }
}

export const newsRepository = new NewsRepository();
