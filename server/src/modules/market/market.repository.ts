import { pool } from '../../db/pool.js';
import { FreshnessState } from '@watchlist/shared';

export interface InstrumentRow {
  symbol: string;
  name: string;
  sector: string | null;
}

export interface PriceSnapshotRow {
  id: string;
  symbol: string;
  price: string;
  change: string;
  change_percent: string;
  freshness_state: FreshnessState;
  timestamp: Date;
  created_at: Date;
  name?: string;
  sector?: string | null;
}

export interface PriceSnapshotInsertInput {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  freshnessState: FreshnessState;
  timestamp: Date;
}

export class MarketRepository {
  async upsertInstrument(symbol: string, name: string, sector?: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO instruments (symbol, name, sector)
       VALUES ($1, $2, $3)
       ON CONFLICT (symbol) DO UPDATE SET
         name = EXCLUDED.name,
         sector = COALESCE(EXCLUDED.sector, instruments.sector);`,
      [symbol, name, sector || null]
    );
  }

  async insertPriceSnapshot(
    symbol: string,
    price: number,
    change: number,
    changePercent: number,
    freshnessState: FreshnessState,
    timestamp: Date
  ): Promise<PriceSnapshotRow> {
    const { rows } = await pool.query<PriceSnapshotRow>(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, freshness_state, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, symbol, price, change, change_percent, freshness_state, timestamp, created_at;`,
      [symbol, price, change, changePercent, freshnessState, timestamp]
    );
    return rows[0];
  }

  async insertPriceSnapshotsBatch(snapshots: PriceSnapshotInsertInput[]): Promise<PriceSnapshotRow[]> {
    if (snapshots.length === 0) return [];

    // Construct multi-row parameterized INSERT
    const valuePlaceholders: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const snap of snapshots) {
      valuePlaceholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        snap.symbol,
        snap.price,
        snap.change,
        snap.changePercent,
        snap.freshnessState,
        snap.timestamp
      );
    }

    const query = `
      INSERT INTO price_snapshots (symbol, price, change, change_percent, freshness_state, timestamp)
      VALUES ${valuePlaceholders.join(', ')}
      RETURNING id, symbol, price, change, change_percent, freshness_state, timestamp, created_at;
    `;

    const { rows } = await pool.query<PriceSnapshotRow>(query, values);
    return rows;
  }

  async getLatestSnapshot(symbol: string): Promise<PriceSnapshotRow | null> {
    const { rows } = await pool.query<PriceSnapshotRow>(
      `SELECT ps.id, ps.symbol, ps.price, ps.change, ps.change_percent, ps.freshness_state, ps.timestamp, ps.created_at,
              i.name, i.sector
       FROM price_snapshots ps
       LEFT JOIN instruments i ON i.symbol = ps.symbol
       WHERE ps.symbol = $1
       ORDER BY ps.timestamp DESC
       LIMIT 1;`,
      [symbol]
    );
    return rows[0] || null;
  }

  /**
   * Efficiently retrieves the latest price snapshot and instrument metadata for multiple symbols in a single query.
   */
  async getLatestSnapshotsForSymbols(symbols: string[]): Promise<PriceSnapshotRow[]> {
    if (symbols.length === 0) return [];

    const { rows } = await pool.query<PriceSnapshotRow>(
      `SELECT DISTINCT ON (ps.symbol)
         ps.id, ps.symbol, ps.price, ps.change, ps.change_percent, ps.freshness_state, ps.timestamp, ps.created_at,
         i.name, i.sector
       FROM price_snapshots ps
       LEFT JOIN instruments i ON i.symbol = ps.symbol
       WHERE ps.symbol = ANY($1::varchar[])
       ORDER BY ps.symbol, ps.timestamp DESC;`,
      [symbols]
    );
    return rows;
  }

  /**
   * Retrieves bounded historical snapshots for a symbol, returning the latest N distinct daily records in chronological ASC order.
   */
  async getHistoricalSnapshots(symbol: string, limit = 30): Promise<PriceSnapshotRow[]> {
    const { rows } = await pool.query<PriceSnapshotRow>(
      `SELECT id, symbol, price, change, change_percent, freshness_state, timestamp, created_at
       FROM (
         SELECT DISTINCT ON (DATE(ps.timestamp))
           ps.id, ps.symbol, ps.price, ps.change, ps.change_percent, ps.freshness_state, ps.timestamp, ps.created_at
         FROM price_snapshots ps
         WHERE ps.symbol = $1
         ORDER BY DATE(ps.timestamp) DESC, ps.timestamp DESC
         LIMIT $2
       ) sub
       ORDER BY timestamp ASC;`,
      [symbol, limit]
    );
    return rows;
  }

  /**
   * Retrieves the price snapshot closest to or just prior to a given timestamp (e.g. user's last_seen_at).
   * Enables exact intraday & inter-visit comparison without relying on daily closes.
   */
  async getSnapshotAtOrBefore(symbol: string, timestamp: Date): Promise<PriceSnapshotRow | null> {
    const { rows } = await pool.query<PriceSnapshotRow>(
      `SELECT ps.id, ps.symbol, ps.price, ps.change, ps.change_percent, ps.freshness_state, ps.timestamp, ps.created_at,
              i.name, i.sector
       FROM price_snapshots ps
       LEFT JOIN instruments i ON i.symbol = ps.symbol
       WHERE ps.symbol = $1 AND ps.timestamp <= $2
       ORDER BY ps.timestamp DESC
       LIMIT 1;`,
      [symbol, timestamp]
    );
    return rows[0] || null;
  }

  /**
   * Batch retrieves the price snapshots closest to or just prior to a given timestamp for multiple symbols in a single query.
   * Eliminates N+1 database roundtrips during diff evaluation.
   */
  async getSnapshotsAtOrBeforeForSymbols(symbols: string[], timestamp: Date): Promise<PriceSnapshotRow[]> {
    if (symbols.length === 0) return [];

    const cleanSymbols = symbols.map((s) => s.toUpperCase().trim());
    const { rows } = await pool.query<PriceSnapshotRow>(
      `SELECT DISTINCT ON (ps.symbol)
         ps.id, ps.symbol, ps.price, ps.change, ps.change_percent, ps.freshness_state, ps.timestamp, ps.created_at,
         i.name, i.sector
       FROM price_snapshots ps
       LEFT JOIN instruments i ON i.symbol = ps.symbol
       WHERE ps.symbol = ANY($1::varchar[]) AND ps.timestamp <= $2
       ORDER BY ps.symbol, ps.timestamp DESC;`,
      [cleanSymbols, timestamp]
    );
    return rows;
  }

  /**
   * Batch retrieves all timestamped price snapshots since a given timestamp for multiple symbols.
   * Enables fine-grained news-to-price reaction analysis across reaction windows.
   */
  async getSnapshotsSinceForSymbols(symbols: string[], since: Date): Promise<PriceSnapshotRow[]> {
    if (symbols.length === 0) return [];

    const cleanSymbols = symbols.map((s) => s.toUpperCase().trim());
    const { rows } = await pool.query<PriceSnapshotRow>(
      `SELECT ps.id, ps.symbol, ps.price, ps.change, ps.change_percent, ps.freshness_state, ps.timestamp, ps.created_at
       FROM price_snapshots ps
       WHERE ps.symbol = ANY($1::varchar[]) AND ps.timestamp >= $2
       ORDER BY ps.symbol, ps.timestamp ASC;`,
      [cleanSymbols, since]
    );
    return rows;
  }

  /**
   * Batch retrieves instrument records (name, sector) for a list of symbols.
   */
  async getInstrumentsForSymbols(symbols: string[]): Promise<InstrumentRow[]> {
    if (symbols.length === 0) return [];
    const cleanSymbols = symbols.map((s) => s.toUpperCase().trim());
    const { rows } = await pool.query<InstrumentRow>(
      `SELECT symbol, name, sector
       FROM instruments
       WHERE symbol = ANY($1::varchar[]);`,
      [cleanSymbols]
    );
    return rows;
  }

  /**
   * Batch retrieves bounded historical snapshots for multiple symbols in a single query.
   * Returns up to `limitPerSymbol` distinct daily records per symbol in chronological ASC order.
   */
  async getBatchHistoricalSnapshots(symbols: string[], limitPerSymbol = 30): Promise<PriceSnapshotRow[]> {
    if (symbols.length === 0) return [];
    const cleanSymbols = symbols.map((s) => s.toUpperCase().trim());

    const { rows } = await pool.query<PriceSnapshotRow>(
      `SELECT id, symbol, price, change, change_percent, freshness_state, timestamp, created_at
       FROM (
         SELECT
           ps.id, ps.symbol, ps.price, ps.change, ps.change_percent, ps.freshness_state, ps.timestamp, ps.created_at,
           ROW_NUMBER() OVER (PARTITION BY ps.symbol ORDER BY ps.timestamp DESC) as rn
         FROM (
           SELECT DISTINCT ON (ps_inner.symbol, DATE(ps_inner.timestamp))
             ps_inner.id, ps_inner.symbol, ps_inner.price, ps_inner.change, ps_inner.change_percent, ps_inner.freshness_state, ps_inner.timestamp, ps_inner.created_at
           FROM price_snapshots ps_inner
           WHERE ps_inner.symbol = ANY($1::varchar[])
           ORDER BY ps_inner.symbol, DATE(ps_inner.timestamp) DESC, ps_inner.timestamp DESC
         ) ps
       ) ranked
       WHERE rn <= $2
       ORDER BY symbol ASC, timestamp ASC;`,
      [cleanSymbols, limitPerSymbol]
    );
    return rows;
  }
}

export const marketRepository = new MarketRepository();



