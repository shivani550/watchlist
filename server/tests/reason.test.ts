import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { determineLikelyReason } from '../src/modules/reason/reason.engine.js';
import { calculateChanges } from '../src/modules/diff/diff.engine.js';
import { DiffCalculationInput, NewsItem } from '@watchlist/shared';

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

const PORT = 5007;

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
  console.log('🧪 BATCH 9: RULE-BASED REASON ENGINE TESTS');
  console.log('========================================\n');

  const sampleNews: NewsItem[] = [
    {
      id: 'news-sample-1',
      symbol: 'TCS',
      headline: 'TCS announces quarterly expansion and major enterprise cloud partnership',
      url: 'https://news.example.com/tcs/expansion',
      publishedAt: '2026-09-04T10:00:00.000Z',
    },
  ];

  // =========================================================================
  // PART 1: PURE RULE-BASED REASON ENGINE UNIT TESTS
  // =========================================================================
  console.log('--- Part 1: Pure Reason Engine Unit Tests ---');

  await assert('Unit: Significant upward movement + news -> "The stock moved +5.20% shortly after relevant news was published."', () => {
    const reason = determineLikelyReason({
      percentageChange: 5.2,
      direction: 'UP',
      newsItems: sampleNews,
      thresholdPercent: 2.0,
      type: 'NEWS_PRICE_REACTION',
    });
    if (reason !== 'The stock moved +5.20% shortly after relevant news was published.') {
      throw new Error(`Unexpected reason output: ${reason}`);
    }
  });

  await assert('Unit: Significant downward movement + news -> "The stock moved -3.80% shortly after relevant news was published."', () => {
    const reason = determineLikelyReason({
      percentageChange: -3.8,
      direction: 'DOWN',
      newsItems: sampleNews,
      thresholdPercent: 2.0,
      type: 'NEWS_PRICE_REACTION',
    });
    if (reason !== 'The stock moved -3.80% shortly after relevant news was published.') {
      throw new Error(`Unexpected reason output: ${reason}`);
    }
  });

  await assert('Unit: Significant movement without news -> "The stock moved +4.10%; no relevant news signal was identified."', () => {
    const reason = determineLikelyReason({
      percentageChange: 4.1,
      direction: 'UP',
      newsItems: [],
      thresholdPercent: 2.0,
      type: 'PRICE_MOVEMENT',
    });
    if (reason !== 'The stock moved +4.10%; no relevant news signal was identified.') {
      throw new Error(`Unexpected reason output: ${reason}`);
    }
  });

  await assert('Unit: News without significant movement -> "Relevant The stock news was detected, but no significant price reaction was observed."', () => {
    const reason = determineLikelyReason({
      percentageChange: 0.3,
      direction: 'FLAT',
      newsItems: sampleNews,
      thresholdPercent: 2.0,
      type: 'NEWS_ONLY',
    });
    if (reason !== 'Relevant The stock news was detected, but no significant price reaction was observed.') {
      throw new Error(`Unexpected reason output: ${reason}`);
    }
  });

  await assert('Unit: No meaningful movement (< 2%) and no news -> returns null (no reason needed)', () => {
    const reason = determineLikelyReason({
      percentageChange: 0.4,
      direction: 'FLAT',
      newsItems: [],
      thresholdPercent: 2.0,
      type: 'NO_CHANGE',
    });
    if (reason !== null) {
      throw new Error(`Expected null for calm signal, got: ${reason}`);
    }
  });

  await assert('Unit: Missing or NaN percentageChange with no news -> returns null', () => {
    const reason = determineLikelyReason({
      percentageChange: null,
      newsItems: [],
      thresholdPercent: 2.0,
    });
    if (reason !== null) {
      throw new Error(`Expected null for missing data, got: ${reason}`);
    }
  });

  await assert('Unit: Custom threshold support (0.5% threshold detects 0.8% move as significant)', () => {
    const reason = determineLikelyReason({
      percentageChange: 0.8,
      direction: 'UP',
      newsItems: [],
      thresholdPercent: 0.5,
      type: 'PRICE_MOVEMENT',
    });
    if (reason !== 'The stock moved +0.80%; no relevant news signal was identified.') {
      throw new Error(`Expected significant reason for custom threshold, got: ${reason}`);
    }
  });

  // =========================================================================
  // PART 2: DIFF ENGINE INTEGRATION TESTS
  // =========================================================================
  console.log('\n--- Part 2: Diff Engine Integration Tests ---');

  await assert('DiffEngine: Automatically populates likelyReason on NEWS_PRICE_REACTION with news', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-reason-diff',
      lastSeenAt: '2026-09-04T08:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['RELIANCE'],
      currentQuotes: {
        RELIANCE: { price: 3100, change: 100, changePercent: 3.33, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        RELIANCE: { price: 3000, timestamp: '2026-09-04T08:00:00.000Z' },
      },
      recentNewsBySymbol: {
        RELIANCE: sampleNews,
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
    if (diff.changes.length !== 1) throw new Error('Expected 1 change');
    if (!diff.changes[0].likelyReason?.includes('RELIANCE moved +3.33% shortly after relevant news was published.')) {
      throw new Error(`Unexpected likelyReason in change: ${diff.changes[0].likelyReason}`);
    }
  });

  await assert('DiffEngine: Automatically populates likelyReason on PRICE_MOVEMENT without news', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-reason-diff-2',
      lastSeenAt: '2026-09-04T08:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['HDFCBANK'],
      currentQuotes: {
        HDFCBANK: { price: 1550, change: 50, changePercent: 3.33, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        HDFCBANK: { price: 1500, timestamp: '2026-09-04T08:00:00.000Z' },
      },
      recentNewsBySymbol: {
        HDFCBANK: [],
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
    if (diff.changes[0].likelyReason !== 'HDFCBANK moved +3.33%; no relevant news signal was identified.') {
      throw new Error(`Unexpected likelyReason: ${diff.changes[0].likelyReason}`);
    }
  });

  // =========================================================================
  // PART 3: HTTP API & END-TO-END VERIFICATION
  // =========================================================================
  console.log('\n--- Part 3: HTTP API & End-to-End Tests ---');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const userEmail = `reasonuser_${Date.now()}@example.com`;
    const regRes = await request('POST', '/api/auth/register', { email: userEmail, password: 'Password123!' });
    const token = regRes.body.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Setup Watchlist
    const createWlRes = await request('POST', '/api/watchlists', { name: 'Reason Watchlist' }, authHeaders);
    const watchlistId = createWlRes.body.watchlist.id;

    await pool.query(`INSERT INTO instruments (symbol, name) VALUES ('REASONTCS', 'Reason TCS Corp') ON CONFLICT DO NOTHING`);
    await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'REASONTCS' }, authHeaders);

    // Baseline snapshot 1 hour ago (price: 4000)
    const baselineTime = new Date(Date.now() - 3600000);
    await pool.query(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
       VALUES ('REASONTCS', 4000, 0, 0, $1, 'FRESH')`,
      [baselineTime]
    );
    await pool.query('UPDATE watchlists SET last_seen_at = $1 WHERE id = $2', [baselineTime, watchlistId]);

    // Current price snapshot (4200 -> +5.0% price move)
    await pool.query(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
       VALUES ('REASONTCS', 4200, 200, 5.0, NOW(), 'FRESH')`
    );

    // Insert news published 15 minutes ago (after baselineTime)
    const recentNewsTime = new Date(Date.now() - 900000);
    await pool.query(
      `INSERT INTO news_items (symbol, headline, url, published_at)
       VALUES ('REASONTCS', 'TCS signs $1B multi-year cloud transformation contract', $1, $2)`,
      [`https://news.example.com/reasontcs/contract-${Date.now()}`, recentNewsTime]
    );

    await assert('API: GET /api/watchlists/:id/diff includes populated likelyReason in structured change', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/diff?peek=true`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);

      const diff = res.body.diff;
      if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
      if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);

      const change = diff.changes[0];
      if (change.symbol !== 'REASONTCS') throw new Error(`Expected REASONTCS, got ${change.symbol}`);
      if (!change.likelyReason?.includes('REASONTCS moved +5.00% shortly after relevant news was published.')) {
        throw new Error(`Unexpected likelyReason in API response: ${change.likelyReason}`);
      }
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
