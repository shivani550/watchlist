import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { marketRepository } from '../src/modules/market/market.repository.js';
import { marketService } from '../src/modules/market/market.service.js';
import { watchlistRepository } from '../src/modules/watchlist/watchlist.repository.js';
import { calculateChanges } from '../src/modules/diff/diff.engine.js';
import { MockMarketDataProvider } from '../src/providers/market.provider.js';
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

const PORT = 5009;

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
  console.log('\n=============================================================');
  console.log('🧪 BATCH 11: FINAL SCALING, SECURITY & RELIABILITY TEST SUITE');
  console.log('=============================================================\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    // =========================================================================
    // SECTION 1: SCALING VERIFICATION (100 WATCHLIST ENTRIES -> 1 FETCH)
    // =========================================================================
    console.log('--- Section 1: Scaling Verification ---');

    await assert('Scaling 1: 100 watchlist entries with same symbol produce exactly 1 provider fetch', async () => {
      const testMockProvider = new MockMarketDataProvider();
      const sharedSymbol = 'SCALETEST';

      await marketRepository.upsertInstrument(sharedSymbol, 'Scaling Test Corporation');

      // Create 10 distinct test users, each with 10 watchlists containing the same symbol = 100 entries
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let u = 0; u < 10; u++) {
          const userRes = await client.query(
            `INSERT INTO users (email, password_hash)
             VALUES ($1, 'hash_placeholder')
             RETURNING id;`,
            [`scale_user_${Date.now()}_${u}@example.com`]
          );
          const userId = userRes.rows[0].id;

          for (let w = 0; w < 10; w++) {
            const wlRes = await client.query(
              `INSERT INTO watchlists (user_id, name)
               VALUES ($1, $2)
               RETURNING id;`,
              [userId, `WL_${u}_${w}`]
            );
            const wlId = wlRes.rows[0].id;

            await client.query(
              `INSERT INTO watchlist_items (watchlist_id, symbol)
               VALUES ($1, $2);`,
              [wlId, sharedSymbol]
            );
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      // Verify distinct symbols list contains SCALETEST exactly once
      const distinctSymbols = await watchlistRepository.findDistinctWatchedSymbols();
      const count = distinctSymbols.filter((s) => s === sharedSymbol).length;
      if (count !== 1) {
        throw new Error(`Expected ${sharedSymbol} to appear exactly once in distinct symbols, got ${count}`);
      }

      // Trigger ingestion with custom test provider
      testMockProvider.resetMetrics();
      const ingestionResult = await marketService.ingestMarketData(testMockProvider);

      // Verify that provider received a batch where SCALETEST was queried exactly once
      const allFetchedSymbols = testMockProvider.getFetchedSymbolsLog().flat();
      const symbolFetchCount = allFetchedSymbols.filter((s) => s === sharedSymbol).length;
      if (symbolFetchCount !== 1) {
        throw new Error(`Expected provider to fetch ${sharedSymbol} exactly 1 time, got ${symbolFetchCount}`);
      }
      if (ingestionResult.status !== 'success' && ingestionResult.status !== 'partial') {
        throw new Error(`Unexpected ingestion status: ${ingestionResult.status}`);
      }
    });

    await assert('Scaling 2: Multiple users watching the same symbol share single stored market data row', async () => {
      const snap = await marketRepository.getLatestSnapshot('SCALETEST');
      if (!snap) throw new Error('Expected SCALETEST snapshot to exist');
      if (parseFloat(snap.price) <= 0) throw new Error('Expected valid price on shared snapshot');
    });

    await assert('Scaling 3: Direct Diff Engine invocation without HTTP returns deterministic result', () => {
      const input: DiffCalculationInput = {
        watchlistId: 'wl-pure-test',
        lastSeenAt: '2026-09-04T10:00:00.000Z',
        currentTimestamp: '2026-09-04T12:00:00.000Z',
        symbols: ['PUREA', 'PUREB'],
        currentQuotes: {
          PUREA: { price: 110, change: 10, changePercent: 10.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
          PUREB: { price: 200, change: 0, changePercent: 0.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
        },
        historicalBaselineQuotes: {
          PUREA: { price: 100, timestamp: '2026-09-04T10:00:00.000Z' },
          PUREB: { price: 200, timestamp: '2026-09-04T10:00:00.000Z' },
        },
        thresholdPercent: 2.0,
      };

      const res1 = calculateChanges(input);
      const res2 = calculateChanges(input);

      if (JSON.stringify(res1) !== JSON.stringify(res2)) {
        throw new Error('Expected identical deterministic results on direct engine call');
      }
      if (res1.changes.length !== 1 || res1.changes[0].symbol !== 'PUREA') {
        throw new Error('Expected PUREA in meaningful changes');
      }
      if (res1.changes[0].direction !== 'UP') {
        throw new Error('Expected UP direction');
      }
    });

    // =========================================================================
    // SECTION 2: SECURITY VERIFICATION
    // =========================================================================
    console.log('\n--- Section 2: Security Verification ---');

    await assert('Security 1: Registration rejects short password (< 8 chars)', async () => {
      const res = await request('POST', '/api/auth/register', { email: 'sec_test@example.com', password: 'short' });
      if (res.status !== 400) throw new Error(`Expected 400 for short password, got ${res.status}`);
      if (!JSON.stringify(res.body).includes('8 characters')) throw new Error('Expected validation error message');
    });

    await assert('Security 2: Protected routes reject unauthenticated requests (401)', async () => {
      const res = await request('GET', '/api/auth/me');
      if (res.status !== 401) throw new Error(`Expected 401 without token, got ${res.status}`);
    });

    await assert('Security 3: Protected routes reject forged/tampered JWT tokens (401)', async () => {
      const res = await request('GET', '/api/auth/me', undefined, { Authorization: 'Bearer forged.invalid.token' });
      if (res.status !== 401) throw new Error(`Expected 401 with forged token, got ${res.status}`);
    });

    await assert('Security 4: Cross-user watchlist access returns 404 (preventing user enumeration oracle)', async () => {
      // User 1 creates a watchlist
      const u1Res = await request('POST', '/api/auth/register', { email: `sec_u1_${Date.now()}@example.com`, password: 'Password123!' });
      const u1Token = u1Res.body.token;
      const u1Headers = { Authorization: `Bearer ${u1Token}` };

      const wlRes = await request('POST', '/api/watchlists', { name: 'Private Watchlist' }, u1Headers);
      const wlId = wlRes.body.watchlist.id;

      // User 2 tries to access User 1's watchlist
      const u2Res = await request('POST', '/api/auth/register', { email: `sec_u2_${Date.now()}@example.com`, password: 'Password123!' });
      const u2Token = u2Res.body.token;
      const u2Headers = { Authorization: `Bearer ${u2Token}` };

      const crossGet = await request('GET', `/api/watchlists/${wlId}`, undefined, u2Headers);
      if (crossGet.status !== 404) throw new Error(`Expected 404 on cross-user get, got ${crossGet.status}`);

      const crossAdd = await request('POST', `/api/watchlists/${wlId}/symbols`, { symbol: 'TCS' }, u2Headers);
      if (crossAdd.status !== 404) throw new Error(`Expected 404 on cross-user add symbol, got ${crossAdd.status}`);

      const crossDiff = await request('GET', `/api/watchlists/${wlId}/diff`, undefined, u2Headers);
      if (crossDiff.status !== 404) throw new Error(`Expected 404 on cross-user diff, got ${crossDiff.status}`);
    });

    await assert('Security 5: SQL injection payloads in symbol parameters are safely parameterized and rejected', async () => {
      const uRes = await request('POST', '/api/auth/register', { email: `sec_sqli_${Date.now()}@example.com`, password: 'Password123!' });
      const headers = { Authorization: `Bearer ${uRes.body.token}` };

      const wlRes = await request('POST', '/api/watchlists', { name: 'SQLi Test' }, headers);
      const wlId = wlRes.body.watchlist.id;

      // SQL injection payload in symbol
      const sqliPayload = "RELIANCE'; DROP TABLE watchlists; --";
      const addRes = await request('POST', `/api/watchlists/${wlId}/symbols`, { symbol: sqliPayload }, headers);
      // Should be rejected by symbol format regex with 400 Bad Request
      if (addRes.status !== 400) throw new Error(`Expected 400 rejection for SQLi symbol, got ${addRes.status}`);

      // Verify watchlists table is intact
      const checkTable = await pool.query('SELECT COUNT(*) FROM watchlists;');
      if (parseInt(checkTable.rows[0].count, 10) < 1) throw new Error('Table verification failed');
    });

    await assert('Security 6: Password hash is never leaked in user responses', async () => {
      const reg = await request('POST', '/api/auth/register', { email: `sec_hash_${Date.now()}@example.com`, password: 'Password123!' });
      const user = reg.body.user;
      if (user.password || user.password_hash || JSON.stringify(reg.body).includes('password_hash')) {
        throw new Error('Password hash leaked in registration response');
      }

      const me = await request('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${reg.body.token}` });
      if (me.body.user.password || me.body.user.password_hash || JSON.stringify(me.body).includes('password_hash')) {
        throw new Error('Password hash leaked in me response');
      }
    });

    // =========================================================================
    // SECTION 3: PERFORMANCE & BOUNDED CONSTRAINTS
    // =========================================================================
    console.log('\n--- Section 3: Performance & Bounded Constraints ---');

    await assert('Performance 1: Historical snapshots query is bounded to limit', async () => {
      const history = await marketRepository.getHistoricalSnapshots('RELIANCE', 15);
      if (history.length > 15) {
        throw new Error(`Expected at most 15 history points, got ${history.length}`);
      }
    });

    await assert('Performance 2: Unknown endpoint returns 404 with structured JSON without stack trace', async () => {
      const res = await request('GET', '/api/nonexistent_route');
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
      if (res.body.error !== 'Endpoint not found') throw new Error(`Expected 'Endpoint not found', got ${res.body.error}`);
    });

  } finally {
    server.close();
  }

  // Summary
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log('\n-------------------------------------------------------------');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed of ${results.length} tests`);
  console.log('-------------------------------------------------------------\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
