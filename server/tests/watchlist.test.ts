import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';

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
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message });
    console.error(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

async function request(
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const jsonBody = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5001,
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

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function runTests() {
  console.log('\n🧪 Running Batch 3 Watchlist CRUD Test Suite...\n');

  const randomSuffix = Math.floor(Math.random() * 1000000);
  const userAEmail = `wl_alice_${randomSuffix}@example.com`;
  const userAPassword = 'Password123!';
  const userBEmail = `wl_bob_${randomSuffix}@example.com`;
  const userBPassword = 'SecurePassword456!';

  let tokenA = '';
  let tokenB = '';
  let watchlistAId = '';
  let watchlistA2Id = '';

  // Clean test tables
  await pool.query('DELETE FROM watchlist_items;');
  await pool.query('DELETE FROM watchlists;');

  // --- Setup: Register two users ---
  await assert('Setup: Register User A', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: userAEmail,
      password: userAPassword,
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    tokenA = res.body.token;
  });

  await assert('Setup: Register User B', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: userBEmail,
      password: userBPassword,
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    tokenB = res.body.token;
  });

  // --- 1. Authentication required ---
  await assert('Reject unauthenticated watchlist creation (401)', async () => {
    const res = await request('POST', '/api/watchlists', { name: 'My Watchlist' });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await assert('Reject unauthenticated watchlist listing (401)', async () => {
    const res = await request('GET', '/api/watchlists');
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // --- 2. Validation errors ---
  await assert('Reject watchlist creation with empty name (400)', async () => {
    const res = await request('POST', '/api/watchlists', { name: '' }, authHeader(tokenA));
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  await assert('Reject watchlist creation with missing name (400)', async () => {
    const res = await request('POST', '/api/watchlists', {}, authHeader(tokenA));
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  // --- 3. Create watchlist ---
  await assert('Create watchlist A1 successfully (201)', async () => {
    const res = await request('POST', '/api/watchlists', { name: 'Tech Stocks' }, authHeader(tokenA));
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status} (${JSON.stringify(res.body)})`);
    if (!res.body.watchlist) throw new Error('Missing watchlist in response');
    if (!res.body.watchlist.id) throw new Error('Missing watchlist id');
    if (res.body.watchlist.name !== 'Tech Stocks') throw new Error('Name mismatch');
    watchlistAId = res.body.watchlist.id;
  });

  await assert('Create watchlist A2 (multiple watchlists per user) (201)', async () => {
    const res = await request('POST', '/api/watchlists', { name: 'Energy' }, authHeader(tokenA));
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    watchlistA2Id = res.body.watchlist.id;
  });

  // --- 4. List watchlists ---
  await assert('List User A watchlists returns 2 watchlists', async () => {
    const res = await request('GET', '/api/watchlists', undefined, authHeader(tokenA));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.body.watchlists)) throw new Error('Expected watchlists array');
    if (res.body.watchlists.length !== 2) throw new Error(`Expected 2 watchlists, got ${res.body.watchlists.length}`);
    // Verify itemCount is present
    if (typeof res.body.watchlists[0].itemCount !== 'number') throw new Error('Missing itemCount field');
  });

  await assert('List User B watchlists returns empty', async () => {
    const res = await request('GET', '/api/watchlists', undefined, authHeader(tokenB));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.watchlists.length !== 0) throw new Error(`Expected 0, got ${res.body.watchlists.length}`);
  });

  // --- 5. Get single watchlist ---
  await assert('Get watchlist A1 with items (200)', async () => {
    const res = await request('GET', `/api/watchlists/${watchlistAId}`, undefined, authHeader(tokenA));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.watchlist.id !== watchlistAId) throw new Error('ID mismatch');
    if (!Array.isArray(res.body.watchlist.items)) throw new Error('Missing items array');
  });

  await assert('Get nonexistent watchlist returns 404', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await request('GET', `/api/watchlists/${fakeUuid}`, undefined, authHeader(tokenA));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  await assert('Get watchlist with invalid UUID returns 400', async () => {
    const res = await request('GET', '/api/watchlists/not-a-uuid', undefined, authHeader(tokenA));
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  // --- 6. Unauthorized access ---
  await assert('User B cannot access User A watchlist (404)', async () => {
    const res = await request('GET', `/api/watchlists/${watchlistAId}`, undefined, authHeader(tokenB));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  // --- 7. Rename watchlist ---
  await assert('Rename watchlist A1 successfully (200)', async () => {
    const res = await request('PATCH', `/api/watchlists/${watchlistAId}`, { name: 'FAANG' }, authHeader(tokenA));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.watchlist.name !== 'FAANG') throw new Error('Name not updated');
  });

  await assert('User B cannot rename User A watchlist (404)', async () => {
    const res = await request('PATCH', `/api/watchlists/${watchlistAId}`, { name: 'Hacked' }, authHeader(tokenB));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  // --- 8. Add symbol ---
  await assert('Add symbol AAPL to watchlist (201)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'AAPL' }, authHeader(tokenA));
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status} (${JSON.stringify(res.body)})`);
    if (res.body.item.symbol !== 'AAPL') throw new Error('Symbol mismatch');
  });

  await assert('Add symbol GOOG to watchlist (201)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'GOOG' }, authHeader(tokenA));
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  });

  await assert('Add symbol with lowercase normalizes to uppercase (201)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'msft' }, authHeader(tokenA));
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    if (res.body.item.symbol !== 'MSFT') throw new Error(`Expected MSFT, got ${res.body.item.symbol}`);
  });

  // --- 9. Duplicate symbol ---
  await assert('Reject duplicate symbol AAPL (409)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'AAPL' }, authHeader(tokenA));
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
  });

  await assert('Reject case-insensitive duplicate aapl (409)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'aapl' }, authHeader(tokenA));
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
  });

  // --- 10. Invalid symbol format ---
  await assert('Reject symbol with numbers (400)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'A123' }, authHeader(tokenA));
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  await assert('Reject empty symbol (400)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: '' }, authHeader(tokenA));
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  await assert('Reject symbol with special characters (400)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'AA-BB' }, authHeader(tokenA));
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  // --- 11. User B cannot add symbol to User A watchlist ---
  await assert('User B cannot add symbol to User A watchlist (404)', async () => {
    const res = await request('POST', `/api/watchlists/${watchlistAId}/symbols`, { symbol: 'NFLX' }, authHeader(tokenB));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  // --- 12. Get watchlist with items ---
  await assert('Get watchlist A1 now contains 3 items', async () => {
    const res = await request('GET', `/api/watchlists/${watchlistAId}`, undefined, authHeader(tokenA));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.watchlist.items.length !== 3) throw new Error(`Expected 3 items, got ${res.body.watchlist.items.length}`);
  });

  await assert('List watchlists shows correct itemCount', async () => {
    const res = await request('GET', '/api/watchlists', undefined, authHeader(tokenA));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const wl = res.body.watchlists.find((w: any) => w.id === watchlistAId);
    if (!wl) throw new Error('Watchlist A1 not found in list');
    if (wl.itemCount !== 3) throw new Error(`Expected itemCount 3, got ${wl.itemCount}`);
  });

  // --- 13. Remove symbol ---
  await assert('Remove symbol GOOG from watchlist (200)', async () => {
    const res = await request('DELETE', `/api/watchlists/${watchlistAId}/symbols/GOOG`, undefined, authHeader(tokenA));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await assert('Remove nonexistent symbol returns 404', async () => {
    const res = await request('DELETE', `/api/watchlists/${watchlistAId}/symbols/GOOG`, undefined, authHeader(tokenA));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  await assert('User B cannot remove symbol from User A watchlist (404)', async () => {
    const res = await request('DELETE', `/api/watchlists/${watchlistAId}/symbols/AAPL`, undefined, authHeader(tokenB));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  await assert('After removal, watchlist A1 has 2 items', async () => {
    const res = await request('GET', `/api/watchlists/${watchlistAId}`, undefined, authHeader(tokenA));
    if (res.body.watchlist.items.length !== 2) throw new Error(`Expected 2, got ${res.body.watchlist.items.length}`);
  });

  // --- 14. Delete watchlist ---
  await assert('User B cannot delete User A watchlist (404)', async () => {
    const res = await request('DELETE', `/api/watchlists/${watchlistA2Id}`, undefined, authHeader(tokenB));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  await assert('Delete watchlist A2 successfully (200)', async () => {
    const res = await request('DELETE', `/api/watchlists/${watchlistA2Id}`, undefined, authHeader(tokenA));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await assert('Deleted watchlist A2 is no longer accessible (404)', async () => {
    const res = await request('GET', `/api/watchlists/${watchlistA2Id}`, undefined, authHeader(tokenA));
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  await assert('User A now has 1 watchlist after deletion', async () => {
    const res = await request('GET', '/api/watchlists', undefined, authHeader(tokenA));
    if (res.body.watchlists.length !== 1) throw new Error(`Expected 1, got ${res.body.watchlists.length}`);
  });

  // --- 15. Verify distinct symbols across all watchlists (DB check) ---
  await assert('Verify DISTINCT symbols query works correctly', async () => {
    // Add a symbol to a new User B watchlist to have cross-user symbols
    const createRes = await request('POST', '/api/watchlists', { name: 'B Watchlist' }, authHeader(tokenB));
    if (createRes.status !== 201) throw new Error(`Setup failed: ${createRes.status}`);
    const bWatchlistId = createRes.body.watchlist.id;

    await request('POST', `/api/watchlists/${bWatchlistId}/symbols`, { symbol: 'AAPL' }, authHeader(tokenB));
    await request('POST', `/api/watchlists/${bWatchlistId}/symbols`, { symbol: 'TSLA' }, authHeader(tokenB));

    // Query distinct symbols directly from DB
    const { rows } = await pool.query<{ symbol: string }>(
      'SELECT DISTINCT symbol FROM watchlist_items ORDER BY symbol ASC;'
    );
    const symbols = rows.map((r) => r.symbol);
    // User A has AAPL, MSFT; User B has AAPL, TSLA → distinct = AAPL, MSFT, TSLA
    if (symbols.length !== 3) throw new Error(`Expected 3 distinct symbols, got ${symbols.length}: ${JSON.stringify(symbols)}`);
    if (!symbols.includes('AAPL')) throw new Error('Missing AAPL');
    if (!symbols.includes('MSFT')) throw new Error('Missing MSFT');
    if (!symbols.includes('TSLA')) throw new Error('Missing TSLA');
  });

  // --- Summary ---
  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 All Batch 3 watchlist CRUD tests passed successfully!\n');
    process.exit(0);
  }
}

// Start server on port 5001 (avoid conflict with dev/auth tests on 5000) and run tests
const server = app.listen(5001, async () => {
  try {
    await runTests();
  } catch (err) {
    console.error('Test run failed:', err);
    process.exit(1);
  } finally {
    server.close();
    await pool.end();
  }
});
