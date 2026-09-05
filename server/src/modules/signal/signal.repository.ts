import { pool } from '../../db/pool.js';
import { MarketSignalEvent } from '@watchlist/shared';

export interface CreateSignalEventInput {
  userId: string;
  watchlistId: string;
  stockSymbol: string;
  companyName?: string | null;
  changeType: string;
  changeSummary: string;
  direction?: 'UP' | 'DOWN' | 'FLAT' | null;
  percentageChange?: number | null;
  previousPrice?: number | null;
  currentPrice?: number | null;
  reason?: string | null;
  newsHeadline?: string | null;
  newsUrl?: string | null;
  newsSource?: string | null;
  detectedAt?: Date;
  activeUntil?: Date;
  historyUntil?: Date;
  eventSignature: string;
}

export interface SignalEventRow {
  id: string;
  user_id: string;
  watchlist_id: string;
  stock_symbol: string;
  company_name: string | null;
  change_type: string;
  change_summary: string;
  direction: 'UP' | 'DOWN' | 'FLAT' | null;
  percentage_change: string | number | null;
  previous_price: string | number | null;
  current_price: string | number | null;
  reason: string | null;
  news_headline: string | null;
  news_url: string | null;
  news_source: string | null;
  detected_at: Date;
  active_until: Date;
  history_until: Date;
  is_active: boolean;
  event_signature: string;
  created_at: Date;
  updated_at: Date;
}

export class SignalRepository {
  private rowToDto(row: SignalEventRow): MarketSignalEvent {
    return {
      id: row.id,
      userId: row.user_id,
      watchlistId: row.watchlist_id,
      stockSymbol: row.stock_symbol,
      companyName: row.company_name,
      changeType: row.change_type,
      changeSummary: row.change_summary,
      direction: row.direction,
      percentageChange: row.percentage_change !== null ? parseFloat(String(row.percentage_change)) : null,
      previousPrice: row.previous_price !== null ? parseFloat(String(row.previous_price)) : null,
      currentPrice: row.current_price !== null ? parseFloat(String(row.current_price)) : null,
      reason: row.reason,
      newsHeadline: row.news_headline,
      newsUrl: row.news_url,
      newsSource: row.news_source,
      detectedAt: row.detected_at.toISOString(),
      activeUntil: row.active_until.toISOString(),
      historyUntil: row.history_until.toISOString(),
      isActive: row.is_active && new Date(row.active_until).getTime() > Date.now(),
      eventSignature: row.event_signature,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  /**
   * Inserts a new market signal event.
   * If an event with the exact same (user_id, watchlist_id, event_signature) exists, it is ignored (deduplicated).
   */
  async insertSignalEvent(input: CreateSignalEventInput): Promise<MarketSignalEvent | null> {
    const detectedAt = input.detectedAt || new Date();
    const activeUntil = input.activeUntil || new Date(detectedAt.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    const historyUntil = input.historyUntil || new Date(detectedAt.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const query = `
      INSERT INTO market_signal_events (
        user_id, watchlist_id, stock_symbol, company_name,
        change_type, change_summary, direction, percentage_change,
        previous_price, current_price, reason, news_headline,
        news_url, news_source, detected_at, active_until,
        history_until, is_active, event_signature
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, TRUE, $18)
      ON CONFLICT (user_id, watchlist_id, event_signature) DO NOTHING
      RETURNING *;
    `;

    const values = [
      input.userId,
      input.watchlistId,
      input.stockSymbol.toUpperCase().trim(),
      input.companyName || null,
      input.changeType,
      input.changeSummary,
      input.direction || null,
      input.percentageChange !== undefined && input.percentageChange !== null ? input.percentageChange : null,
      input.previousPrice !== undefined && input.previousPrice !== null ? input.previousPrice : null,
      input.currentPrice !== undefined && input.currentPrice !== null ? input.currentPrice : null,
      input.reason || null,
      input.newsHeadline || null,
      input.newsUrl || null,
      input.newsSource || null,
      detectedAt,
      activeUntil,
      historyUntil,
      input.eventSignature,
    ];

    const result = await pool.query<SignalEventRow>(query, values);
    if (result.rows.length === 0) {
      return null; // Duplicate signal ignored
    }
    return this.rowToDto(result.rows[0]);
  }

  /**
   * Retrieves all currently active signals for an authenticated user across watchlists.
   * Uses DISTINCT ON to ensure each unique stock symbol has at most 1 active signal globally.
   * active_until > NOW()
   */
  async findActiveSignalsByUser(userId: string): Promise<MarketSignalEvent[]> {
    const query = `
      SELECT * FROM (
        SELECT DISTINCT ON (mse.stock_symbol) mse.*
        FROM market_signal_events mse
        INNER JOIN watchlists w ON w.id = mse.watchlist_id
        WHERE mse.user_id = $1 AND mse.active_until > NOW()
        ORDER BY mse.stock_symbol, mse.detected_at DESC
      ) latest_user_signals
      ORDER BY detected_at DESC;
    `;
    const result = await pool.query<SignalEventRow>(query, [userId]);
    return result.rows.map((r) => this.rowToDto(r));
  }

  /**
   * Retrieves active signals for a specific watchlist.
   * Uses DISTINCT ON to ensure each stock symbol has at most 1 active signal for the watchlist.
   */
  async findActiveSignalsByWatchlist(userId: string, watchlistId: string): Promise<MarketSignalEvent[]> {
    const query = `
      SELECT * FROM (
        SELECT DISTINCT ON (mse.stock_symbol) mse.*
        FROM market_signal_events mse
        INNER JOIN watchlists w ON w.id = mse.watchlist_id
        WHERE mse.user_id = $1 AND mse.watchlist_id = $2 AND mse.active_until > NOW()
        ORDER BY mse.stock_symbol, mse.detected_at DESC
      ) latest_signals
      ORDER BY detected_at DESC;
    `;
    const result = await pool.query<SignalEventRow>(query, [userId, watchlistId]);
    return result.rows.map((r) => this.rowToDto(r));
  }

  /**
   * Retrieves 30-day change history for a stock symbol for the authenticated user.
   * history_until > NOW()
   */
  async find30DayHistoryBySymbol(userId: string, symbol: string): Promise<MarketSignalEvent[]> {
    const query = `
      SELECT *
      FROM market_signal_events
      WHERE user_id = $1 AND stock_symbol = $2 AND history_until > NOW()
      ORDER BY detected_at DESC;
    `;
    const result = await pool.query<SignalEventRow>(query, [userId, symbol.toUpperCase().trim()]);
    return result.rows.map((r) => this.rowToDto(r));
  }

  /**
   * Retrieves a single signal event by ID with user ownership check.
   */
  async findById(userId: string, id: string): Promise<MarketSignalEvent | null> {
    const query = `
      SELECT *
      FROM market_signal_events
      WHERE user_id = $1 AND id = $2;
    `;
    const result = await pool.query<SignalEventRow>(query, [userId, id]);
    if (result.rows.length === 0) return null;
    return this.rowToDto(result.rows[0]);
  }

  /**
   * Retrieves distinct stock symbols with at least one active signal for a watchlist.
   */
  async findActiveSignaledSymbolsForWatchlist(userId: string, watchlistId: string): Promise<string[]> {
    const query = `
      SELECT DISTINCT stock_symbol
      FROM market_signal_events
      WHERE user_id = $1 AND watchlist_id = $2 AND active_until > NOW();
    `;
    const result = await pool.query<{ stock_symbol: string }>(query, [userId, watchlistId]);
    return result.rows.map((r) => r.stock_symbol.toUpperCase());
  }

  /**
   * Cleanup / state maintenance: flags events where active_until has passed as is_active = FALSE.
   */
  async flagInactiveExpiredSignals(): Promise<number> {
    const query = `
      UPDATE market_signal_events
      SET is_active = FALSE
      WHERE active_until <= NOW() AND is_active = TRUE;
    `;
    const result = await pool.query(query);
    return result.rowCount || 0;
  }
}

export const signalRepository = new SignalRepository();
