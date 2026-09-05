import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { marketService } from '../src/modules/market/market.service.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function assert(name: string, fn: () => Promise<void>) {
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

const PORT = 5003;

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

    if (jsonBody) {
      req.write(jsonBody);
    }
    req.end();
  });
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function runTests() {
  console.log('\n🧪 Running Batch 5 End-to-End Watchlist UI & Market Data Test Suite...\n');

  const server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));

  try {
    // 0. Clean database state
    await pool.query('DELETE FROM price_snapshots;');
    await pool.query('DELETE FROM watchlist_items;');
    await pool.query('DELETE FROM watchlists;');
    await pool.query('DELETE FROM users;');
    await pool.query('DELETE FROM instruments;');

    let token = '';
    let watchlistId = '';

    // Step 1: User Registration
    await assert('E2E Step 1: Register new user', async () => {
      const res = await request('POST', '/api/auth/register', {
        email: 'e2e_investor@example.com',
        password: 'SecurePassword123!',
      });
      if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
      if (!res.body.token || !res.body.user) throw new Error('Missing token or user object');
      token = res.body.token;
    });

    // Step 2: Login
    await assert('E2E Step 2: Authenticate user session', async () => {
      const res = await request('POST', '/api/auth/login', {
        email: 'e2e_investor@example.com',
        password: 'SecurePassword123!',
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      token = res.body.token;
    });

    // Step 3: Create Watchlist
    await assert('E2E Step 3: Create custom watchlist', async () => {
      const res = await request(
        'POST',
        '/api/watchlists',
        { name: 'Indian Tech & US Giants' },
        authHeader(token)
      );
      if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
      watchlistId = res.body.watchlist.id;
      if (res.body.watchlist.name !== 'Indian Tech & US Giants') {
        throw new Error(`Unexpected name: ${res.body.watchlist.name}`);
      }
    });

    // Step 4: Add stock symbols (testing normalization)
    await assert('E2E Step 4: Add stocks to watchlist (RELIANCE, TCS, AAPL)', async () => {
      const r1 = await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'reliance' }, authHeader(token));
      const r2 = await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'TCS' }, authHeader(token));
      const r3 = await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'aapl' }, authHeader(token));

      if (r1.status !== 201 || r2.status !== 201 || r3.status !== 201) {
        throw new Error(`Add symbol failed: r1=${r1.status}, r2=${r2.status}, r3=${r3.status}`);
      }
      if (r1.body.item.symbol !== 'RELIANCE' || r3.body.item.symbol !== 'AAPL') {
        throw new Error('Symbols were not properly uppercased/normalized');
      }
    });

    // Step 5: Reject duplicate symbol
    await assert('E2E Step 5: Duplicate symbol is rejected with 409', async () => {
      const res = await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'RELIANCE' }, authHeader(token));
      if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    });

    // Step 6: Ingest market data for watched symbols
    await assert('E2E Step 6: Trigger market data ingestion across distinct symbols', async () => {
      const ingestRes = await request('POST', '/api/market/ingest');
      if (ingestRes.status !== 200) throw new Error(`Expected 200, got ${ingestRes.status}`);
      if (ingestRes.body.distinctSymbolsCount !== 3 || ingestRes.body.persistedCount !== 3) {
        throw new Error(`Expected 3 distinct symbols ingested and persisted, got: ${JSON.stringify(ingestRes.body)}`);
      }
    });

    // Step 7: Retrieve quotes directly from PostgreSQL
    await assert('E2E Step 7: Stored quotes are retrieved with price, change, percent, and freshness state', async () => {
      const res = await request('GET', '/api/market/quotes?symbols=RELIANCE,TCS,AAPL');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!Array.isArray(res.body.quotes) || res.body.quotes.length !== 3) {
        throw new Error(`Expected 3 quotes, got: ${JSON.stringify(res.body)}`);
      }

      for (const quote of res.body.quotes) {
        if (!quote.symbol || typeof quote.price !== 'number' || quote.price <= 0) {
          throw new Error(`Invalid quote payload: ${JSON.stringify(quote)}`);
        }
        if (!['FRESH', 'DELAYED', 'STALE', 'UNAVAILABLE'].includes(quote.freshnessState)) {
          throw new Error(`Invalid freshness state: ${quote.freshnessState}`);
        }
        if (!quote.timestamp) {
          throw new Error('Missing quote timestamp');
        }
      }
    });

    // Step 8: Remove a stock
    await assert('E2E Step 8: Remove a stock (TCS) from watchlist', async () => {
      const res = await request('DELETE', `/api/watchlists/${watchlistId}/symbols/TCS`, undefined, authHeader(token));
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);

      // Verify watchlist item list
      const wlRes = await request('GET', `/api/watchlists/${watchlistId}`, undefined, authHeader(token));
      if (wlRes.body.watchlist.items.length !== 2) {
        throw new Error(`Expected 2 items remaining after removal, got ${wlRes.body.watchlist.items.length}`);
      }
      const symbols = wlRes.body.watchlist.items.map((i: any) => i.symbol);
      if (symbols.includes('TCS')) throw new Error('TCS should have been removed');
    });

    // Step 9: Rename watchlist
    await assert('E2E Step 9: Rename watchlist', async () => {
      const res = await request('PUT', `/api/watchlists/${watchlistId}`, { name: 'Core Holdings' }, authHeader(token));
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (res.body.watchlist.name !== 'Core Holdings') {
        throw new Error(`Expected renamed name 'Core Holdings', got ${res.body.watchlist.name}`);
      }
    });

    // Step 10: Delete watchlist
    await assert('E2E Step 10: Delete watchlist', async () => {
      const res = await request('DELETE', `/api/watchlists/${watchlistId}`, undefined, authHeader(token));
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);

      const checkRes = await request('GET', `/api/watchlists/${watchlistId}`, undefined, authHeader(token));
      if (checkRes.status !== 404) throw new Error(`Expected 404 for deleted watchlist, got ${checkRes.status}`);
    });

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // --- Print Summary ---
  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    console.error('❌ Some E2E tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 All Batch 5 End-to-End tests passed successfully!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal E2E test error:', err);
  process.exit(1);
});
