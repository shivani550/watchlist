import { pool } from './pool.js';
import { hashPassword } from '../modules/auth/auth.utils.js';

export async function seedDatabase() {
  const client = await pool.connect();
  try {
    console.log('🌱 Checking / seeding demo trader account and initial data...');

    const demoEmail = 'trader@example.com';
    const demoPassword = 'Password123!';
    const passwordHash = await hashPassword(demoPassword);

    // 1. Upsert demo user
    let userId: string;
    const existingUser = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1;',
      [demoEmail]
    );

    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
      // Ensure password hash is valid
      await client.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2;',
        [passwordHash, userId]
      );
      console.log(`👤 Demo trader account verified (User ID: ${userId})`);
    } else {
      const newUser = await client.query<{ id: string }>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id;',
        [demoEmail, passwordHash]
      );
      userId = newUser.rows[0].id;
      console.log(`👤 Created demo trader account: ${demoEmail} (User ID: ${userId})`);
    }

    // 2. Seed initial instruments
    const instruments = [
      { symbol: 'RELIANCE', name: 'Reliance Industries Ltd.', sector: 'Energy & Petrochemicals' },
      { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'Information Technology' },
      { symbol: 'INFY', name: 'Infosys Limited', sector: 'Information Technology' },
      { symbol: 'HDFCBANK', name: 'HDFC Bank Limited', sector: 'Financial Services' },
      { symbol: 'TATAMOTORS', name: 'Tata Motors Limited', sector: 'Automobile' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Semiconductors & AI' },
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Consumer Electronics' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Cloud & Software' },
    ];

    for (const inst of instruments) {
      await client.query(
        `INSERT INTO instruments (symbol, name, sector)
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, sector = EXCLUDED.sector;`,
        [inst.symbol, inst.name, inst.sector]
      );
    }

    // 3. Seed initial price snapshots if none exist
    const defaultPrices: Record<string, { price: number; change: number; pct: number }> = {
      RELIANCE: { price: 2980.50, change: 45.20, pct: 1.54 },
      TCS: { price: 4120.00, change: -28.50, pct: -0.69 },
      INFY: { price: 1890.75, change: 35.10, pct: 1.89 },
      HDFCBANK: { price: 1640.20, change: 12.80, pct: 0.79 },
      TATAMOTORS: { price: 985.40, change: -14.20, pct: -1.42 },
      NVDA: { price: 128.50, change: 5.40, pct: 4.38 },
      AAPL: { price: 224.30, change: 1.10, pct: 0.49 },
      MSFT: { price: 448.90, change: -3.20, pct: -0.71 },
    };

    for (const [sym, data] of Object.entries(defaultPrices)) {
      const existingSnap = await client.query(
        'SELECT id FROM price_snapshots WHERE symbol = $1 LIMIT 1;',
        [sym]
      );
      if (existingSnap.rows.length === 0) {
        await client.query(
          `INSERT INTO price_snapshots (symbol, price, change, change_percent, freshness_state, timestamp)
           VALUES ($1, $2, $3, $4, 'FRESH', NOW());`,
          [sym, data.price, data.change, data.pct]
        );
      }
    }

    // 4. Seed default watchlists for demo user if user has none
    const userWatchlists = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM watchlists WHERE user_id = $1;',
      [userId]
    );

    if (userWatchlists.rows.length === 0) {
      // Create Watchlist 1: Core Leaders
      const wl1 = await client.query<{ id: string }>(
        `INSERT INTO watchlists (user_id, name, last_seen_at)
         VALUES ($1, $2, NOW() - INTERVAL '4 hours')
         RETURNING id;`,
        [userId, 'Core Leaders']
      );
      const wl1Id = wl1.rows[0].id;

      const wl1Symbols = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'TATAMOTORS'];
      for (const sym of wl1Symbols) {
        await client.query(
          `INSERT INTO watchlist_items (watchlist_id, symbol)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING;`,
          [wl1Id, sym]
        );
      }

      // Create Watchlist 2: Tech & Growth
      const wl2 = await client.query<{ id: string }>(
        `INSERT INTO watchlists (user_id, name, last_seen_at)
         VALUES ($1, $2, NOW() - INTERVAL '2 hours')
         RETURNING id;`,
        [userId, 'Tech & Growth']
      );
      const wl2Id = wl2.rows[0].id;

      const wl2Symbols = ['NVDA', 'AAPL', 'MSFT', 'INFY'];
      for (const sym of wl2Symbols) {
        await client.query(
          `INSERT INTO watchlist_items (watchlist_id, symbol)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING;`,
          [wl2Id, sym]
        );
      }

      console.log('📋 Seeded default watchlists for demo trader: "Core Leaders" & "Tech & Growth"');
    }

    console.log('✅ Database seeding finished successfully.');
  } catch (err) {
    console.error('❌ Error during database seeding:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Auto-run if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDatabase()
    .then(() => {
      console.log('Direct seed completed.');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
