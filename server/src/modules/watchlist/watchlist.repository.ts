import { pool } from '../../db/pool.js';

export interface WatchlistRow {
  id: string;
  user_id: string;
  name: string;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WatchlistItemRow {
  id: string;
  watchlist_id: string;
  symbol: string;
  added_at: Date;
}

export interface WatchlistSummaryRow extends WatchlistRow {
  item_count: string; // COUNT returns bigint → string in pg driver
}

export class WatchlistRepository {
  async create(userId: string, name: string): Promise<WatchlistRow> {
    const { rows } = await pool.query<WatchlistRow>(
      `INSERT INTO watchlists (user_id, name)
       VALUES ($1, $2)
       RETURNING id, user_id, name, last_seen_at, created_at, updated_at;`,
      [userId, name]
    );
    return rows[0];
  }

  async findById(id: string): Promise<WatchlistRow | null> {
    const { rows } = await pool.query<WatchlistRow>(
      'SELECT id, user_id, name, last_seen_at, created_at, updated_at FROM watchlists WHERE id = $1;',
      [id]
    );
    return rows[0] || null;
  }

  async findByUserId(userId: string): Promise<WatchlistSummaryRow[]> {
    const { rows } = await pool.query<WatchlistSummaryRow>(
      `SELECT w.id, w.user_id, w.name, w.last_seen_at, w.created_at, w.updated_at,
              COUNT(wi.id)::text AS item_count
       FROM watchlists w
       LEFT JOIN watchlist_items wi ON wi.watchlist_id = w.id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.created_at ASC;`,
      [userId]
    );
    return rows;
  }

  async updateName(id: string, name: string): Promise<WatchlistRow> {
    const { rows } = await pool.query<WatchlistRow>(
      `UPDATE watchlists SET name = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id, name, last_seen_at, created_at, updated_at;`,
      [id, name]
    );
    return rows[0];
  }

  async updateLastSeen(id: string, timestamp: Date = new Date()): Promise<void> {
    await pool.query(
      `UPDATE watchlists SET last_seen_at = $2, updated_at = NOW()
       WHERE id = $1;`,
      [id, timestamp]
    );
  }

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM watchlists WHERE id = $1;', [id]);
  }

  async addItem(watchlistId: string, symbol: string): Promise<WatchlistItemRow> {
    const { rows } = await pool.query<WatchlistItemRow>(
      `INSERT INTO watchlist_items (watchlist_id, symbol)
       VALUES ($1, $2)
       RETURNING id, watchlist_id, symbol, added_at;`,
      [watchlistId, symbol]
    );
    return rows[0];
  }

  async removeItem(watchlistId: string, symbol: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM watchlist_items WHERE watchlist_id = $1 AND symbol = $2;',
      [watchlistId, symbol]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findItemsByWatchlistId(watchlistId: string): Promise<WatchlistItemRow[]> {
    const { rows } = await pool.query<WatchlistItemRow>(
      'SELECT id, watchlist_id, symbol, added_at FROM watchlist_items WHERE watchlist_id = $1 ORDER BY added_at ASC;',
      [watchlistId]
    );
    return rows;
  }

  /**
   * System Spec Principle 1:
   * Every user gets standard default watchlists on creation.
   * Ingestion poller must operate on DISTINCT watched symbols across all watchlists.
   */
  async findDistinctWatchedSymbols(): Promise<string[]> {
    const { rows } = await pool.query<{ symbol: string }>(
      'SELECT DISTINCT symbol FROM watchlist_items ORDER BY symbol ASC;'
    );
    return rows.map((r) => r.symbol);
  }
}

export const watchlistRepository = new WatchlistRepository();
