import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { MockMarketDataProvider } from '../src/providers/market.provider.js';
import { marketService, MarketService, MarketIngestionPoller } from '../src/modules/market/market.service.js';
import { marketRepository } from '../src/modules/market/market.repository.js';
import { watchlistRepository } from '../src/modules/watchlist/watchlist.repository.js';
import { cacheService } from '../src/cache/cache.service.js';

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

const PORT = 5002;

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
  console.log('\n🧪 Running Batch 4 Market Data Ingestion Test Suite...\n');

  const server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));

  try {
    // 0. Clean DB state for testing
    await pool.query('DELETE FROM price_snapshots;');
    await pool.query('DELETE FROM watchlist_items;');
    await pool.query('DELETE FROM watchlists;');
    await pool.query('DELETE FROM users;');
    await pool.query('DELETE FROM instruments;');

    // Helper: create test users & watchlists directly in DB
    const createUser = async (email: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, 'hashed_test_password') RETURNING id;`,
        [email]
      );
      return rows[0].id;
    };

    const createWatchlist = async (userId: string, name: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id;`,
        [userId, name]
      );
      return rows[0].id;
    };

    const addWatchlistItem = async (watchlistId: string, symbol: string) => {
      await pool.query(
        `INSERT INTO watchlist_items (watchlist_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
        [watchlistId, symbol]
      );
    };

    const userA = await createUser('userA@markettest.com');
    const userB = await createUser('userB@markettest.com');
    const userC = await createUser('userC@markettest.com');

    // =========================================================================
    // SECTION 1: Core Distinct-Symbol Discovery and Ingestion Tests
    // =========================================================================

    await assert('Requirement 1: 1 watched symbol -> exactly 1 provider fetch', async () => {
      // Clear items
      await pool.query('DELETE FROM watchlist_items;');
      await pool.query('DELETE FROM price_snapshots;');

      const wlA = await createWatchlist(userA, 'Tech Watchlist');
      await addWatchlistItem(wlA, 'AAPL');

      const mockProvider = new MockMarketDataProvider();
      const result = await marketService.ingestMarketData(mockProvider);

      if (result.status !== 'success') {
        throw new Error(`Expected success status, got: ${result.status}`);
      }
      if (result.distinctSymbolsCount !== 1) {
        throw new Error(`Expected distinctSymbolsCount 1, got ${result.distinctSymbolsCount}`);
      }
      if (result.persistedCount !== 1) {
        throw new Error(`Expected persistedCount 1, got ${result.persistedCount}`);
      }
      if (mockProvider.getCallCount() !== 1) {
        throw new Error(`Expected 1 provider call, got ${mockProvider.getCallCount()}`);
      }

      const fetchedLog = mockProvider.getFetchedSymbolsLog();
      if (fetchedLog.length !== 1 || fetchedLog[0][0] !== 'AAPL') {
        throw new Error(`Expected fetch log for ['AAPL'], got: ${JSON.stringify(fetchedLog)}`);
      }
    });

    await assert('Requirement 2: Same symbol in multiple watchlists of same user -> exactly 1 logical provider fetch', async () => {
      await pool.query('DELETE FROM watchlist_items;');
      await pool.query('DELETE FROM price_snapshots;');

      const wlA1 = await createWatchlist(userA, 'Watchlist 1');
      const wlA2 = await createWatchlist(userA, 'Watchlist 2');
      const wlA3 = await createWatchlist(userA, 'Watchlist 3');

      // Add RELIANCE to all 3 watchlists belonging to User A
      await addWatchlistItem(wlA1, 'RELIANCE');
      await addWatchlistItem(wlA2, 'RELIANCE');
      await addWatchlistItem(wlA3, 'RELIANCE');

      const mockProvider = new MockMarketDataProvider();
      const result = await marketService.ingestMarketData(mockProvider);

      if (result.distinctSymbolsCount !== 1) {
        throw new Error(`Expected 1 distinct symbol across 3 watchlists, got ${result.distinctSymbolsCount}`);
      }
      if (mockProvider.getCallCount() !== 1) {
        throw new Error(`Expected exactly 1 provider call, got ${mockProvider.getCallCount()}`);
      }
      const fetchedSymbols = mockProvider.getFetchedSymbolsLog()[0];
      if (fetchedSymbols.length !== 1 || fetchedSymbols[0] !== 'RELIANCE') {
        throw new Error(`Expected ['RELIANCE'], got: ${JSON.stringify(fetchedSymbols)}`);
      }
    });

    await assert('Requirement 3: Same symbol watched by multiple distinct users -> exactly 1 logical provider fetch', async () => {
      await pool.query('DELETE FROM watchlist_items;');
      await pool.query('DELETE FROM price_snapshots;');

      const wlA = await createWatchlist(userA, 'User A Main');
      const wlB = await createWatchlist(userB, 'User B Main');
      const wlC = await createWatchlist(userC, 'User C Main');

      // 3 different users all watching 'INFY'
      await addWatchlistItem(wlA, 'INFY');
      await addWatchlistItem(wlB, 'INFY');
      await addWatchlistItem(wlC, 'INFY');

      const mockProvider = new MockMarketDataProvider();
      const result = await marketService.ingestMarketData(mockProvider);

      if (result.distinctSymbolsCount !== 1) {
        throw new Error(`Expected 1 distinct symbol across 3 users, got ${result.distinctSymbolsCount}`);
      }
      if (mockProvider.getCallCount() !== 1) {
        throw new Error(`Expected exactly 1 provider call, got ${mockProvider.getCallCount()}`);
      }
      if (mockProvider.getFetchedSymbolsLog()[0][0] !== 'INFY') {
        throw new Error(`Expected fetched symbol 'INFY'`);
      }
    });

    await assert('Requirement 4: Multiple unique symbols across multiple users -> 1 fetch per distinct symbol', async () => {
      await pool.query('DELETE FROM watchlist_items;');
      await pool.query('DELETE FROM price_snapshots;');

      const wlA = await createWatchlist(userA, 'User A Multi');
      const wlB = await createWatchlist(userB, 'User B Multi');
      const wlC = await createWatchlist(userC, 'User C Multi');

      // Overlapping sets: User A: [TCS, MSFT], User B: [MSFT, GOOG], User C: [TCS, NVDA, TSLA]
      // Unique distinct set = [GOOG, MSFT, NVDA, TCS, TSLA] (5 distinct symbols)
      await addWatchlistItem(wlA, 'TCS');
      await addWatchlistItem(wlA, 'MSFT');
      await addWatchlistItem(wlB, 'MSFT');
      await addWatchlistItem(wlB, 'GOOG');
      await addWatchlistItem(wlC, 'TCS');
      await addWatchlistItem(wlC, 'NVDA');
      await addWatchlistItem(wlC, 'TSLA');

      const mockProvider = new MockMarketDataProvider();
      const result = await marketService.ingestMarketData(mockProvider);

      if (result.distinctSymbolsCount !== 5) {
        throw new Error(`Expected 5 distinct symbols, got ${result.distinctSymbolsCount}`);
      }
      if (result.persistedCount !== 5) {
        throw new Error(`Expected 5 persisted snapshots, got ${result.persistedCount}`);
      }

      // Check all 5 symbols were fetched
      const fetchedFlat = mockProvider.getFetchedSymbolsLog().flat();
      const expectedSymbols = ['GOOG', 'MSFT', 'NVDA', 'TCS', 'TSLA'];
      for (const sym of expectedSymbols) {
        if (!fetchedFlat.includes(sym)) {
          throw new Error(`Expected symbol ${sym} to be fetched`);
        }
      }
    });

    await assert('Requirement 5: One failed symbol does NOT stop the remaining symbols (failure isolation)', async () => {
      await pool.query('DELETE FROM watchlist_items;');
      await pool.query('DELETE FROM price_snapshots;');

      const wlA = await createWatchlist(userA, 'Fault Tolerance Test');
      await addWatchlistItem(wlA, 'AAPL');
      await addWatchlistItem(wlA, 'BROKEN_STOCK');
      await addWatchlistItem(wlA, 'MSFT');

      const mockProvider = new MockMarketDataProvider();
      // Configure BROKEN_STOCK to throw an error
      mockProvider.setSimulatedFailure('BROKEN_STOCK', new Error('Provider 404: Symbol not found'));

      const result = await marketService.ingestMarketData(mockProvider);

      if (result.status !== 'partial') {
        throw new Error(`Expected 'partial' status, got '${result.status}'`);
      }
      if (result.distinctSymbolsCount !== 3) {
        throw new Error(`Expected 3 distinct symbols, got ${result.distinctSymbolsCount}`);
      }
      if (result.persistedCount !== 2) {
        throw new Error(`Expected 2 successfully persisted symbols, got ${result.persistedCount}`);
      }
      if (result.failedSymbols.length !== 1 || result.failedSymbols[0].symbol !== 'BROKEN_STOCK') {
        throw new Error(`Expected failure recorded for BROKEN_STOCK, got: ${JSON.stringify(result.failedSymbols)}`);
      }

      // Verify AAPL and MSFT snapshots exist in DB
      const snapAAPL = await marketRepository.getLatestSnapshot('AAPL');
      const snapMSFT = await marketRepository.getLatestSnapshot('MSFT');
      const snapBroken = await marketRepository.getLatestSnapshot('BROKEN_STOCK');

      if (!snapAAPL || !snapMSFT) {
        throw new Error('Expected snapshots for AAPL and MSFT to be persisted in DB');
      }
      if (snapBroken) {
        throw new Error('Did not expect snapshot for BROKEN_STOCK');
      }
    });

    await assert('Requirement 6: Global provider failure / rate limit is handled gracefully without crashing', async () => {
      await pool.query('DELETE FROM watchlist_items;');
      const wlA = await createWatchlist(userA, 'Rate Limit Test');
      await addWatchlistItem(wlA, 'AAPL');

      const mockProvider = new MockMarketDataProvider();
      mockProvider.setGlobalFailure(new Error('429 Too Many Requests: Rate limit exceeded'));

      const result = await marketService.ingestMarketData(mockProvider);

      if (result.status !== 'failed') {
        throw new Error(`Expected 'failed' status on global provider error, got '${result.status}'`);
      }
      if (result.persistedCount !== 0) {
        throw new Error(`Expected 0 persisted items on rate limit, got ${result.persistedCount}`);
      }
      if (result.failedSymbols.length === 0) {
        throw new Error('Expected failedSymbols list to document rate limit error');
      }
    });

    // =========================================================================
    // SECTION 2: Database Persistence & Freshness State Verification
    // =========================================================================

    await assert('Verify DB persistence of instruments and price_snapshots', async () => {
      await pool.query('DELETE FROM watchlist_items;');
      await pool.query('DELETE FROM price_snapshots;');
      await pool.query('DELETE FROM instruments;');

      const wlA = await createWatchlist(userA, 'Persistence Test');
      await addWatchlistItem(wlA, 'HDFCBANK');

      const mockProvider = new MockMarketDataProvider();
      await marketService.ingestMarketData(mockProvider);

      // Verify instrument row
      const { rows: instRows } = await pool.query<{ symbol: string; name: string; sector: string }>(
        `SELECT symbol, name, sector FROM instruments WHERE symbol = 'HDFCBANK';`
      );
      if (instRows.length !== 1 || instRows[0].name !== 'HDFC Bank Ltd.') {
        throw new Error(`Instrument not persisted correctly: ${JSON.stringify(instRows)}`);
      }

      // Verify price snapshot row
      const { rows: snapRows } = await pool.query<{ symbol: string; price: string; freshness_state: string }>(
        `SELECT symbol, price, freshness_state FROM price_snapshots WHERE symbol = 'HDFCBANK';`
      );
      if (snapRows.length !== 1 || parseFloat(snapRows[0].price) <= 0) {
        throw new Error(`Price snapshot not persisted correctly: ${JSON.stringify(snapRows)}`);
      }
    });

    await assert('Verify Freshness State transitions: FRESH, DELAYED, STALE, UNAVAILABLE', async () => {
      const now = Date.now();

      // FRESH: under 5 minutes old
      const freshDate = new Date(now - 2 * 60 * 1000);
      const stateFresh = marketService.evaluateFreshness(freshDate);
      if (stateFresh !== 'FRESH') {
        throw new Error(`Expected 'FRESH' for 2m old snapshot, got '${stateFresh}'`);
      }

      // DELAYED: between 5 and 15 minutes old
      const delayedDate = new Date(now - 10 * 60 * 1000);
      const stateDelayed = marketService.evaluateFreshness(delayedDate);
      if (stateDelayed !== 'DELAYED') {
        throw new Error(`Expected 'DELAYED' for 10m old snapshot, got '${stateDelayed}'`);
      }

      // STALE: older than 15 minutes
      const staleDate = new Date(now - 20 * 60 * 1000);
      const stateStale = marketService.evaluateFreshness(staleDate);
      if (stateStale !== 'STALE') {
        throw new Error(`Expected 'STALE' for 20m old snapshot, got '${stateStale}'`);
      }

      // UNAVAILABLE: explicit declared state
      const stateUnavailable = marketService.evaluateFreshness(new Date(), 'UNAVAILABLE');
      if (stateUnavailable !== 'UNAVAILABLE') {
        throw new Error(`Expected 'UNAVAILABLE', got '${stateUnavailable}'`);
      }
    });

    await assert('Verify getSnapshotAtOrBefore retrieves correct historical baseline snapshot', async () => {
      await pool.query('DELETE FROM price_snapshots;');
      await marketRepository.upsertInstrument('RELIANCE', 'Reliance Industries Ltd.');

      const t1 = new Date('2026-09-01T10:00:00Z');
      const t2 = new Date('2026-09-02T10:00:00Z');
      const t3 = new Date('2026-09-03T10:00:00Z');

      await marketRepository.insertPriceSnapshot('RELIANCE', 2800, 0, 0, 'FRESH', t1);
      await marketRepository.insertPriceSnapshot('RELIANCE', 2900, 100, 3.57, 'FRESH', t2);
      await marketRepository.insertPriceSnapshot('RELIANCE', 2950, 50, 1.72, 'FRESH', t3);

      // Query for snapshot at user's last_seen_at (between t2 and t3)
      const userLastSeen = new Date('2026-09-02T18:00:00Z');
      const baseline = await marketRepository.getSnapshotAtOrBefore('RELIANCE', userLastSeen);

      if (!baseline) {
        throw new Error('Expected baseline snapshot at or before last seen');
      }
      if (parseFloat(baseline.price) !== 2900) {
        throw new Error(`Expected baseline price 2900 at t2, got ${baseline.price}`);
      }
    });

    // =========================================================================
    // SECTION 3: Background Poller Lifecycle & Overlap Guard
    // =========================================================================

    await assert('Verify MarketIngestionPoller start, stop, and overlap guard', async () => {
      const poller = new MarketIngestionPoller(marketService, 100000);

      if (poller.isActive()) {
        throw new Error('Poller should not be active initially');
      }

      poller.start();
      if (!poller.isActive()) {
        throw new Error('Poller should be active after start()');
      }

      // Calling pollOnce while another might be running handles overlap safely
      const runResult = await poller.pollOnce();
      if (!runResult || typeof runResult.status !== 'string') {
        throw new Error('pollOnce should return an IngestionResult');
      }

      poller.stop();
      if (poller.isActive()) {
        throw new Error('Poller should not be active after stop()');
      }
    });

    // =========================================================================
    // SECTION 4: REST API Endpoints Verification
    // =========================================================================

    await assert('GET /api/market/quotes returns latest quotes from PostgreSQL', async () => {
      // Seed AAPL quote in DB
      await cacheService.del('quote:AAPL');
      await marketRepository.upsertInstrument('AAPL', 'Apple Inc.', 'Technology');
      await marketRepository.insertPriceSnapshot('AAPL', 230.5, 2.5, 1.1, 'FRESH', new Date());

      const res = await request('GET', '/api/market/quotes?symbols=AAPL');
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status}`);
      }
      if (!Array.isArray(res.body.quotes) || res.body.quotes.length !== 1) {
        throw new Error(`Expected quotes array with 1 item, got: ${JSON.stringify(res.body)}`);
      }
      const quote = res.body.quotes[0];
      if (quote.symbol !== 'AAPL' || quote.price !== 230.5 || quote.name !== 'Apple Inc.') {
        throw new Error(`Unexpected quote data: ${JSON.stringify(quote)}`);
      }
    });

    await assert('GET /api/market/quotes rejects missing symbols with 400', async () => {
      const res = await request('GET', '/api/market/quotes');
      if (res.status !== 400) {
        throw new Error(`Expected 400, got ${res.status}`);
      }
    });

    await assert('GET /api/market/history/:symbol returns historical price series', async () => {
      const res = await request('GET', '/api/market/history/MSFT');
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status}`);
      }
      if (res.body.symbol !== 'MSFT') {
        throw new Error(`Expected symbol MSFT, got ${res.body.symbol}`);
      }
      if (!Array.isArray(res.body.history) || res.body.history.length === 0) {
        throw new Error(`Expected history array with points, got: ${JSON.stringify(res.body)}`);
      }
      const firstPoint = res.body.history[0];
      if (typeof firstPoint.price !== 'number' || !firstPoint.timestamp) {
        throw new Error(`Invalid historical data point format: ${JSON.stringify(firstPoint)}`);
      }
    });

    await assert('GET /api/market/history/:symbol rejects invalid symbol with 400', async () => {
      const res = await request('GET', '/api/market/history/INVALID!SYMBOL@');
      if (res.status !== 400) {
        throw new Error(`Expected 400 for invalid symbol format, got ${res.status}`);
      }
    });

    await assert('POST /api/market/ingest triggers on-demand ingestion run (200)', async () => {
      const res = await request('POST', '/api/market/ingest');
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status}`);
      }
      if (!res.body.status || typeof res.body.distinctSymbolsCount !== 'number') {
        throw new Error(`Unexpected ingestion response: ${JSON.stringify(res.body)}`);
      }
    });

  } finally {
    await cacheService.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // --- Print Summary ---
  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    console.error('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 All Batch 4 market data ingestion tests passed successfully!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
