import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool(
  env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.PGHOST,
        port: env.PGPORT,
        user: env.PGUSER,
        password: env.PGPASSWORD,
        database: env.PGDATABASE,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export async function checkDbConnection(): Promise<{ connected: boolean; version?: string; error?: string }> {
  try {
    const result = await pool.query('SELECT version() AS version;');
    return {
      connected: true,
      version: result.rows[0]?.version
    };
  } catch (err: any) {
    return {
      connected: false,
      error: err.message || 'Failed to connect to database'
    };
  }
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

