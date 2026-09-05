import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('🔄 Running database migrations...');
  const client = await pool.connect();

  try {
    // 1. Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Read migration files
    const migrationsDir = path.resolve(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    // 3. Find already applied migrations
    const { rows: appliedRows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations;'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    let appliedCount = 0;

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`⏩ Skipping already applied migration: ${file}`);
        continue;
      }

      console.log(`▶️ Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [file]);
        await client.query('COMMIT');
        console.log(`✅ Applied migration: ${file}`);
        appliedCount++;
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        console.error(`❌ Migration failed in ${file}:`, migrationErr);
        throw migrationErr;
      }
    }

    console.log(`✨ Migrations completed. Total newly applied: ${appliedCount}`);
  } finally {
    client.release();
  }
}

// Auto-run if executed directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runMigrations()
    .then(() => {
      console.log('Migration process finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration process failed:', err);
      process.exit(1);
    });
}

