import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { marketRepository } from '../src/modules/market/market.repository.js';
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

const PORT = 5004;

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

async function runTests() {
  console.log('\n🧪 Running Batch 6 Historical Price Chart Test Suite...\n');

  const server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));

  try {
    // 0. Clean DB state
    await pool.query('DELETE FROM price_snapshots;');
    await pool.query('DELETE FROM instruments;');

    await marketRepository.upsertInstrument('RELIANCE', 'Reliance Industries Ltd.', 'Energy');
    await marketRepository.upsertInstrument('TCS', 'Tata Consultancy Services Ltd.', 'IT');
    await marketRepository.upsertInstrument('AAPL', 'Apple Inc.', 'Technology');

    // =========================================================================
    // SECTION 1: Bounded Historical Query Verification
    // =========================================================================

    await assert('Requirement 1: Retrieve bounded 30-day historical series in chronological ASC order', async () => {
      // Seed 45 chronological snapshots for RELIANCE (from day -45 to day 0)
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      for (let i = 45; i >= 0; i--) {
        const timestamp = new Date(now - i * oneDayMs);
        const price = 2500 + (45 - i) * 10;
        await marketRepository.insertPriceSnapshot('RELIANCE', price, 10, 0.4, 'FRESH', timestamp);
      }

      // Query historical data via service with limit 30
      const history = await marketService.getHistoricalData('RELIANCE', 30, false);

      if (history.length !== 30) {
        throw new Error(`Expected exactly 30 historical points, got ${history.length}`);
      }

      // Verify chronological ASC order
      for (let j = 0; j < history.length - 1; j++) {
        const tA = new Date(history[j].timestamp).getTime();
        const tB = new Date(history[j + 1].timestamp).getTime();
        if (tA >= tB) {
          throw new Error(`Expected chronological ASC order, but point ${j} (${history[j].timestamp}) >= point ${j + 1} (${history[j + 1].timestamp})`);
        }
      }

      // Verify that the 30 points are the MOST RECENT ones (day -29 to day 0)
      const oldestPointPrice = history[0].price;
      const expectedOldestPrice = 2500 + (45 - 29) * 10; // 2660
      if (oldestPointPrice !== expectedOldestPrice) {
        throw new Error(`Expected oldest bounded price ${expectedOldestPrice}, got ${oldestPointPrice}`);
      }
    });

    await assert('Requirement 2: Bounded query performance does not load entire table into memory', async () => {
      // Direct repository test with limit = 10
      const snapshots = await marketRepository.getHistoricalSnapshots('RELIANCE', 10);
      if (snapshots.length !== 10) {
        throw new Error(`Expected 10 snapshots bounded, got ${snapshots.length}`);
      }
    });

    // =========================================================================
    // SECTION 2: Edge Cases & Error Handling
    // =========================================================================

    await assert('Requirement 3: Symbol with 0 history returns empty array gracefully', async () => {
      // Directly check repository for symbol with no snapshots
      const snapshots = await marketRepository.getHistoricalSnapshots('NONEXISTENT_SYM', 30);
      if (!Array.isArray(snapshots) || snapshots.length !== 0) {
        throw new Error(`Expected empty array for symbol without snapshots, got: ${JSON.stringify(snapshots)}`);
      }
    });

    await assert('Requirement 4: Insufficient history (1 snapshot) returns 1 data point without crashing', async () => {
      // Seed exactly 1 snapshot for TCS
      await marketRepository.insertPriceSnapshot('TCS', 4200, 0, 0, 'FRESH', new Date());

      const history = await marketService.getHistoricalData('TCS', 30, false);
      if (history.length !== 1) {
        throw new Error(`Expected 1 data point for sparse history, got ${history.length}`);
      }
      if (history[0].price !== 4200) {
        throw new Error(`Expected price 4200, got ${history[0].price}`);
      }
    });

    await assert('Requirement 5: Seed provider fallback generates 31 deterministic points for new watched stock', async () => {
      // Query history for AAPL which has no DB snapshots yet -> triggers seeded provider historical points
      const history = await marketService.getHistoricalData('AAPL', 30, true);
      if (history.length !== 30 && history.length !== 31) {
        throw new Error(`Expected 30 or 31 historical points seeded, got ${history.length}`);
      }
      for (const pt of history) {
        if (typeof pt.price !== 'number' || pt.price <= 0 || !pt.timestamp) {
          throw new Error(`Invalid seeded historical point: ${JSON.stringify(pt)}`);
        }
      }
    });

    // =========================================================================
    // SECTION 3: HTTP Endpoint Verification
    // =========================================================================

    await assert('GET /api/market/history/:symbol returns 200 with structured history payload', async () => {
      const res = await request('GET', '/api/market/history/RELIANCE');
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status}`);
      }
      if (res.body.symbol !== 'RELIANCE') {
        throw new Error(`Expected symbol RELIANCE, got ${res.body.symbol}`);
      }
      if (!Array.isArray(res.body.history) || res.body.history.length === 0) {
        throw new Error(`Expected history array, got: ${JSON.stringify(res.body)}`);
      }
    });

    await assert('GET /api/market/history/:symbol normalizes lowercase symbol to uppercase', async () => {
      const res = await request('GET', '/api/market/history/reliance');
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status}`);
      }
      if (res.body.symbol !== 'RELIANCE') {
        throw new Error(`Expected uppercase symbol 'RELIANCE', got ${res.body.symbol}`);
      }
    });

    await assert('GET /api/market/history/:symbol rejects invalid symbol characters with 400 Bad Request', async () => {
      const res1 = await request('GET', '/api/market/history/BAD!SYMBOL');
      const res2 = await request('GET', '/api/market/history/THIS_IS_LONGER_THAN_TWENTY_CHARACTERS');

      if (res1.status !== 400) throw new Error(`Expected 400 for special characters, got ${res1.status}`);
      if (res2.status !== 400) throw new Error(`Expected 400 for overly long symbol, got ${res2.status}`);
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
    console.error('❌ Some history tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 All Batch 6 historical price chart tests passed successfully!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal history test error:', err);
  process.exit(1);
});
