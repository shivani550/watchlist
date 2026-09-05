import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { calculateChanges, DEFAULT_MEANINGFUL_CHANGE_THRESHOLD } from '../src/modules/diff/diff.engine.js';
import { DiffCalculationInput } from '@watchlist/shared';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function assert(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ PASS: ${name}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message });
    console.error(`  ❌ FAIL: ${name} -> ${message}`);
  }
}

const PORT = 5005;

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const jsonBody = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method,
        headers: {
          ...(jsonBody
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonBody),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsedBody: any;
          try {
            parsedBody = rawData ? JSON.parse(rawData) : {};
          } catch {
            parsedBody = rawData;
          }
          resolve({ status: res.statusCode || 500, body: parsedBody });
        });
      }
    );
    req.on('error', reject);
    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

async function runTests() {
  console.log('\n========================================');
  console.log('🧪 BATCH 7: DIFF ENGINE & LAST VISIT TESTS');
  console.log('========================================\n');

  // =========================================================================
  // PART 1: PURE DOMAIN ENGINE UNIT TESTS (ZERO I/O, ZERO HTTP, ZERO DB)
  // =========================================================================
  console.log('--- Part 1: Pure Diff Engine Unit Tests ---');

  await assert('Unit: First visit with no previous last_seen_at establishes baseline with no changes', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-123',
      lastSeenAt: null,
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['RELIANCE', 'TCS'],
      currentQuotes: {
        RELIANCE: { price: 2900, change: 10, changePercent: 0.35, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
        TCS: { price: 4100, change: 50, changePercent: 1.2, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {},
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (diff.hasMeaningfulChanges !== false) throw new Error('Expected hasMeaningfulChanges to be false on first visit');
    if (diff.changes.length !== 0) throw new Error('Expected 0 changes on first visit');
    if (diff.lastSeenAt !== null) throw new Error('Expected lastSeenAt to be null');
    if (!diff.message.includes('Baseline prices recorded')) throw new Error('Expected baseline record message');
  });

  await assert('Unit: Empty watchlist returns no meaningful changes', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-empty',
      lastSeenAt: '2026-09-03T12:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: [],
      currentQuotes: {},
      historicalBaselineQuotes: {},
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (diff.hasMeaningfulChanges !== false) throw new Error('Expected hasMeaningfulChanges to be false for empty watchlist');
    if (diff.changes.length !== 0) throw new Error('Expected 0 changes');
  });

  await assert('Unit: Detects significant upward price movement (>= +2.0%)', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-123',
      lastSeenAt: '2026-09-03T12:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['INFY'],
      currentQuotes: {
        INFY: { price: 1650, change: 150, changePercent: 10.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        INFY: { price: 1500, timestamp: '2026-09-03T12:00:00.000Z' },
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
    if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);

    const change = diff.changes[0];
    if (change.symbol !== 'INFY') throw new Error(`Expected INFY, got ${change.symbol}`);
    if (change.direction !== 'UP') throw new Error(`Expected UP, got ${change.direction}`);
    if (change.previousPrice !== 1500) throw new Error(`Expected previousPrice 1500, got ${change.previousPrice}`);
    if (change.currentPrice !== 1650) throw new Error(`Expected currentPrice 1650, got ${change.currentPrice}`);
    if (Math.abs(change.percentChangeSinceLastSeen - 10.0) > 0.001) throw new Error(`Expected +10.0%, got ${change.percentChangeSinceLastSeen}`);
    if (change.absoluteChangeSinceLastSeen !== 150) throw new Error(`Expected +150, got ${change.absoluteChangeSinceLastSeen}`);
  });

  await assert('Unit: Detects significant downward price movement (<= -2.0%)', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-123',
      lastSeenAt: '2026-09-03T12:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['HDFCBANK'],
      currentQuotes: {
        HDFCBANK: { price: 1400, change: -100, changePercent: -6.67, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        HDFCBANK: { price: 1500, timestamp: '2026-09-03T12:00:00.000Z' },
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
    if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);

    const change = diff.changes[0];
    if (change.symbol !== 'HDFCBANK') throw new Error(`Expected HDFCBANK, got ${change.symbol}`);
    if (change.direction !== 'DOWN') throw new Error(`Expected DOWN, got ${change.direction}`);
    if (change.previousPrice !== 1500) throw new Error(`Expected previousPrice 1500, got ${change.previousPrice}`);
    if (change.currentPrice !== 1400) throw new Error(`Expected currentPrice 1400, got ${change.currentPrice}`);
    if (Math.abs(change.percentChangeSinceLastSeen - (-6.67)) > 0.01) throw new Error(`Expected -6.67%, got ${change.percentChangeSinceLastSeen}`);
    if (change.absoluteChangeSinceLastSeen !== -100) throw new Error(`Expected -100, got ${change.absoluteChangeSinceLastSeen}`);
  });

  await assert('Unit: Ignores insignificant price movement below threshold (< 2.0%)', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-123',
      lastSeenAt: '2026-09-03T12:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['TCS'],
      currentQuotes: {
        TCS: { price: 4020, change: 20, changePercent: 0.5, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        TCS: { price: 4000, timestamp: '2026-09-03T12:00:00.000Z' },
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (diff.hasMeaningfulChanges !== false) throw new Error('Expected hasMeaningfulChanges to be false for 0.5% move');
    if (diff.changes.length !== 0) throw new Error('Expected 0 changes returned');
    if (!diff.message.includes('Nothing significant changed')) throw new Error('Expected calm message');
  });

  await assert('Unit: Supports custom configurable threshold (e.g. 0.5%)', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-123',
      lastSeenAt: '2026-09-03T12:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['TCS'],
      currentQuotes: {
        TCS: { price: 4040, change: 40, changePercent: 1.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        TCS: { price: 4000, timestamp: '2026-09-03T12:00:00.000Z' },
      },
      thresholdPercent: 0.5, // Lower custom threshold
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true with 0.5% threshold for 1.0% change');
    if (diff.changes.length !== 1) throw new Error('Expected 1 change');
  });

  await assert('Unit: Sorts multiple changes deterministically by magnitude of % change descending', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-multi',
      lastSeenAt: '2026-09-03T12:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['STOCK_A', 'STOCK_B', 'STOCK_C', 'STOCK_D'],
      currentQuotes: {
        STOCK_A: { price: 103, change: 3, changePercent: 3.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' }, // +3%
        STOCK_B: { price: 101, change: 1, changePercent: 1.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' }, // +1% (below)
        STOCK_C: { price: 90, change: -10, changePercent: -10.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' }, // -10% (magnitude 10%)
        STOCK_D: { price: 115, change: 15, changePercent: 15.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' }, // +15% (magnitude 15%)
      },
      historicalBaselineQuotes: {
        STOCK_A: { price: 100, timestamp: '2026-09-03T12:00:00.000Z' },
        STOCK_B: { price: 100, timestamp: '2026-09-03T12:00:00.000Z' },
        STOCK_C: { price: 100, timestamp: '2026-09-03T12:00:00.000Z' },
        STOCK_D: { price: 100, timestamp: '2026-09-03T12:00:00.000Z' },
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
    if (diff.changes.length !== 3) throw new Error(`Expected 3 changes, got ${diff.changes.length}`);

    // Order should be STOCK_D (15%), STOCK_C (10%), STOCK_A (3%)
    if (diff.changes[0].symbol !== 'STOCK_D') throw new Error(`Expected 1st STOCK_D, got ${diff.changes[0].symbol}`);
    if (diff.changes[1].symbol !== 'STOCK_C') throw new Error(`Expected 2nd STOCK_C, got ${diff.changes[1].symbol}`);
    if (diff.changes[2].symbol !== 'STOCK_A') throw new Error(`Expected 3rd STOCK_A, got ${diff.changes[2].symbol}`);
  });

  // =========================================================================
  // PART 2: INTEGRATION & HTTP API TESTS
  // =========================================================================
  console.log('\n--- Part 2: Integration & HTTP API Tests ---');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const userEmail = `diffuser_${Date.now()}@example.com`;
    const regRes = await request('POST', '/api/auth/register', { email: userEmail, password: 'Password123!' });
    const token = regRes.body.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Create a watchlist
    const createWlRes = await request('POST', '/api/watchlists', { name: 'Tech Movers' }, authHeaders);
    const watchlistId = createWlRes.body.watchlist.id;

    // Ensure instruments exist
    await pool.query(
      `INSERT INTO instruments (symbol, name, sector)
       VALUES 
         ('DIFFINFY', 'Diff Infosys Ltd', 'IT'),
         ('DIFFTCS', 'Diff TCS Ltd', 'IT')
       ON CONFLICT (symbol) DO NOTHING`
    );

    // Add symbols
    const addSym1 = await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'DIFFINFY' }, authHeaders);
    if (addSym1.status !== 201) throw new Error(`Failed to add DIFFINFY: ${JSON.stringify(addSym1.body)}`);
    const addSym2 = await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'DIFFTCS' }, authHeaders);
    if (addSym2.status !== 201) throw new Error(`Failed to add DIFFTCS: ${JSON.stringify(addSym2.body)}`);

    // Insert historical snapshot (1 hour ago, baseline: DIFFINFY = 1000, DIFFTCS = 3000)
    const baselineTime = new Date(Date.now() - 3600000);
    await pool.query(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
       VALUES 
         ('DIFFINFY', 1000, 0, 0, $1, 'FRESH'),
         ('DIFFTCS', 3000, 0, 0, $1, 'FRESH')`,
      [baselineTime]
    );

    // Set watchlist last_seen_at to baselineTime
    await pool.query('UPDATE watchlists SET last_seen_at = $1 WHERE id = $2', [baselineTime, watchlistId]);

    // Insert current snapshot (DIFFINFY moved to 1100 (+10%), DIFFTCS moved to 3010 (+0.33%))
    const currentTime = new Date();
    await pool.query(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
       VALUES 
         ('DIFFINFY', 1100, 100, 10.0, $1, 'FRESH'),
         ('DIFFTCS', 3010, 10, 0.33, $1, 'FRESH')`,
      [currentTime]
    );

    await assert('API: GET /api/watchlists/:id/diff with peek=true calculates diff without updating last_seen_at', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/diff?peek=true`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

      const diff = res.body.diff;
      if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
      if (diff.changes.length !== 1) throw new Error(`Expected 1 change (DIFFINFY), got ${diff.changes.length}`);
      if (diff.changes[0].symbol !== 'DIFFINFY') throw new Error(`Expected DIFFINFY, got ${diff.changes[0].symbol}`);
      if (diff.changes[0].direction !== 'UP') throw new Error(`Expected UP, got ${diff.changes[0].direction}`);
      if (diff.changes[0].previousPrice !== 1000) throw new Error(`Expected previousPrice 1000, got ${diff.changes[0].previousPrice}`);
      if (diff.changes[0].currentPrice !== 1100) throw new Error(`Expected currentPrice 1100, got ${diff.changes[0].currentPrice}`);

      // Verify last_seen_at in DB was NOT updated (remains near baselineTime)
      const wlCheck = await pool.query('SELECT last_seen_at FROM watchlists WHERE id = $1', [watchlistId]);
      const storedLastSeen = new Date(wlCheck.rows[0].last_seen_at).getTime();
      if (Math.abs(storedLastSeen - baselineTime.getTime()) > 1000) {
        throw new Error('Expected last_seen_at not to be updated with peek=true');
      }
    });

    await assert('API: GET /api/watchlists/:id/diff updates last_seen_at ONLY AFTER calculating diff against previous state', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/diff`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);

      const diff = res.body.diff;
      // Should still have detected the 10% move from baseline 1000 -> 1100
      if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
      if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);

      // Now verify last_seen_at in DB WAS updated to recent timestamp
      const wlCheck = await pool.query('SELECT last_seen_at FROM watchlists WHERE id = $1', [watchlistId]);
      const updatedLastSeen = new Date(wlCheck.rows[0].last_seen_at).getTime();
      if (Date.now() - updatedLastSeen > 5000) {
        throw new Error('Expected last_seen_at to be updated to recent time');
      }
    });

    await assert('API: Subsequent GET /api/watchlists/:id/diff reflects updated last_seen_at (returns calm state)', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/diff`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);

      const diff = res.body.diff;
      // Since last_seen_at was updated in the previous call, the current price is same as baseline
      if (diff.hasMeaningfulChanges !== false) throw new Error('Expected calm state on immediate subsequent call');
      if (diff.changes.length !== 0) throw new Error('Expected 0 changes');
    });

    await assert('API: Another user cannot access diff of this watchlist (404 Unauthorized/Not Found)', async () => {
      const otherReg = await request('POST', '/api/auth/register', { email: `other_${Date.now()}@example.com`, password: 'Password123!' });
      const otherAuthHeaders = { Authorization: `Bearer ${otherReg.body.token}` };

      const res = await request('GET', `/api/watchlists/${watchlistId}/diff`, undefined, otherAuthHeaders);
      if (res.status !== 404) throw new Error(`Expected 404 for unowned watchlist, got ${res.status}`);
    });

  } finally {
    server.close();
  }

  // Summary
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log('\n----------------------------------------');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed of ${results.length} tests`);
  console.log('----------------------------------------\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
