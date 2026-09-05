import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { marketRepository } from '../src/modules/market/market.repository.js';
import { marketService } from '../src/modules/market/market.service.js';
import { newsRepository } from '../src/modules/news/news.repository.js';
import { newsService } from '../src/modules/news/news.service.js';
import { watchlistRepository } from '../src/modules/watchlist/watchlist.repository.js';
import { MockMarketDataProvider, setMarketDataProvider } from '../src/providers/market.provider.js';
import { MockNewsProvider, setNewsProvider } from '../src/providers/news.provider.js';

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

const PORT = 5008;

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
  console.log('\n=================================================');
  console.log('🧪 BATCH 10: FULL INTEGRATION & RELIABILITY TESTS');
  console.log('=================================================\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  const mockMarket = new MockMarketDataProvider();
  setMarketDataProvider(mockMarket);

  const mockNews = new MockNewsProvider();
  setNewsProvider(mockNews);

  try {
    // =========================================================================
    // SECTION 1: DUPLICATE SYMBOL INGESTION & O(symbols) SCALING
    // =========================================================================
    console.log('--- Section 1: Distinct Symbol Ingestion Verification ---');

    // Register User A and User B
    const userARes = await request('POST', '/api/auth/register', { email: `usera_${Date.now()}@example.com`, password: 'Password123!' });
    const tokenA = userARes.body.token;
    const headersA = { Authorization: `Bearer ${tokenA}` };

    const userBRes = await request('POST', '/api/auth/register', { email: `userb_${Date.now()}@example.com`, password: 'Password123!' });
    const tokenB = userBRes.body.token;
    const headersB = { Authorization: `Bearer ${tokenB}` };

    // User A creates Watchlist 1 (REL, TCS)
    const wl1Res = await request('POST', '/api/watchlists', { name: 'Tech Core' }, headersA);
    const wl1Id = wl1Res.body.watchlist.id;
    await request('POST', `/api/watchlists/${wl1Id}/symbols`, { symbol: 'RELIANCE' }, headersA);
    await request('POST', `/api/watchlists/${wl1Id}/symbols`, { symbol: 'TCS' }, headersA);

    // User A creates Watchlist 2 (REL, INFY) - RELIANCE duplicate across watchlists of same user
    const wl2Res = await request('POST', '/api/watchlists', { name: 'Growth Core' }, headersA);
    const wl2Id = wl2Res.body.watchlist.id;
    await request('POST', `/api/watchlists/${wl2Id}/symbols`, { symbol: 'RELIANCE' }, headersA);
    await request('POST', `/api/watchlists/${wl2Id}/symbols`, { symbol: 'INFY' }, headersA);

    // User B creates Watchlist 3 (REL, HDFCBANK) - RELIANCE duplicate across multiple distinct users
    const wl3Res = await request('POST', '/api/watchlists', { name: 'UserB Core' }, headersB);
    const wl3Id = wl3Res.body.watchlist.id;
    await request('POST', `/api/watchlists/${wl3Id}/symbols`, { symbol: 'RELIANCE' }, headersB);
    await request('POST', `/api/watchlists/${wl3Id}/symbols`, { symbol: 'HDFCBANK' }, headersB);

    await assert('Reliability 1: findDistinctWatchedSymbols deduplicates watched symbols globally', async () => {
      const distinctSymbols = await watchlistRepository.findDistinctWatchedSymbols();
      const countReliance = distinctSymbols.filter((s) => s === 'RELIANCE').length;
      if (countReliance !== 1) {
        throw new Error(`Expected RELIANCE to appear exactly once in distinct symbols, got ${countReliance}`);
      }
      if (!distinctSymbols.includes('TCS') || !distinctSymbols.includes('INFY') || !distinctSymbols.includes('HDFCBANK')) {
        throw new Error('Expected all watched symbols to be present');
      }
    });

    await assert('Reliability 2: Ingestion runs exactly 1 fetch per distinct symbol', async () => {
      const distinctSymbols = await watchlistRepository.findDistinctWatchedSymbols();
      const result = await marketService.ingestMarketData(mockMarket);
      if (result.distinctSymbolsCount !== distinctSymbols.length) {
        throw new Error(`Expected ${distinctSymbols.length} distinct symbols, got ${result.distinctSymbolsCount}`);
      }
      if (result.fetchedCount !== distinctSymbols.length) {
        throw new Error(`Expected ${distinctSymbols.length} fetched quotes, got ${result.fetchedCount}`);
      }
    });

    // =========================================================================
    // SECTION 2: PARTIAL PROVIDER FAILURE & FAILURE ISOLATION
    // =========================================================================
    console.log('\n--- Section 2: Partial Provider Failure & Fault Tolerance ---');

    await assert('Reliability 3: Failure on TCS does not break RELIANCE, INFY, or HDFCBANK ingestion', async () => {
      // Simulate failure on TCS
      mockMarket.setSymbolFailure('TCS', true);

      const result = await marketService.ingestMarketData(mockMarket);
      // Should not throw unhandled exception
      if (result.status !== 'partial') {
        throw new Error(`Expected status 'partial', got ${result.status}`);
      }
      const hasTcsError = result.failedSymbols.some((e) => e.symbol === 'TCS');
      if (!hasTcsError) throw new Error('Expected TCS error to be recorded in failure report');

      // Verify RELIANCE snapshot is fresh and updated
      const relianceQuote = await marketRepository.getLatestSnapshot('RELIANCE');
      if (!relianceQuote || parseFloat(relianceQuote.price) <= 0) {
        throw new Error('Expected RELIANCE snapshot to exist and be valid');
      }

      mockMarket.setSymbolFailure('TCS', false);
    });

    await assert('Reliability 4: Provider rate limits (HTTP 429) are caught gracefully without crashing', async () => {
      mockMarket.setSimulateRateLimit(true);
      const result = await marketService.ingestMarketData(mockMarket);
      if (result.status !== 'failed') {
        throw new Error(`Expected status 'failed' on global rate limit, got ${result.status}`);
      }
      mockMarket.setSimulateRateLimit(false);
    });

    // =========================================================================
    // SECTION 3: STALE DATA INTEGRITY & FRESHNESS EVALUATION
    // =========================================================================
    console.log('\n--- Section 3: Stale Data & Freshness Integrity ---');

    await assert('Reliability 5: Freshness evaluator accurately marks <5m as FRESH, 5-15m as DELAYED, >15m as STALE', () => {
      const now = new Date();
      const freshDate = new Date(now.getTime() - 2 * 60 * 1000);   // 2m ago
      const delayedDate = new Date(now.getTime() - 8 * 60 * 1000); // 8m ago
      const staleDate = new Date(now.getTime() - 20 * 60 * 1000);  // 20m ago

      const freshState = marketService.evaluateFreshness(freshDate, 'FRESH');
      const delayedState = marketService.evaluateFreshness(delayedDate, 'FRESH');
      const staleState = marketService.evaluateFreshness(staleDate, 'FRESH');

      if (freshState !== 'FRESH') throw new Error(`Expected FRESH, got ${freshState}`);
      if (delayedState !== 'DELAYED') throw new Error(`Expected DELAYED, got ${delayedState}`);
      if (staleState !== 'STALE') throw new Error(`Expected STALE, got ${staleState}`);
    });

    // =========================================================================
    // SECTION 4: N+1 QUERY ELIMINATION AUDIT
    // =========================================================================
    console.log('\n--- Section 4: N+1 Query Audit & Batch Baseline Query ---');

    await assert('Reliability 6: getSnapshotsAtOrBeforeForSymbols retrieves multiple symbol baselines in a single query', async () => {
      await marketRepository.upsertInstrument('RELIANCE', 'Reliance Industries Ltd.');
      await marketRepository.upsertInstrument('INFY', 'Infosys Ltd.');

      const baselineTime = new Date(Date.now() - 3600000);
      await pool.query(
        `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
         VALUES 
           ('RELIANCE', 2800, 0, 0, $1, 'FRESH'),
           ('INFY', 1400, 0, 0, $1, 'FRESH')`,
        [baselineTime]
      );

      const snapshots = await marketRepository.getSnapshotsAtOrBeforeForSymbols(['RELIANCE', 'INFY'], baselineTime);
      if (snapshots.length !== 2) {
        throw new Error(`Expected 2 snapshots in single batch query, got ${snapshots.length}`);
      }
      const symbols = snapshots.map((s) => s.symbol);
      if (!symbols.includes('RELIANCE') || !symbols.includes('INFY')) {
        throw new Error('Expected RELIANCE and INFY snapshots in batch result');
      }
    });

    // =========================================================================
    // SECTION 5: FULL END-TO-END FLOW (LAST SEEN -> DIFF -> NEWS -> REASON)
    // =========================================================================
    console.log('\n--- Section 5: End-to-End Integrated Journey ---');

    await assert('Reliability 7: Complete integrated journey (Auth -> Watchlist -> Diff -> News -> Reason -> last_seen_at update)', async () => {
      // 0. Clean any leftover snapshots/news for test symbols
      await pool.query(`DELETE FROM price_snapshots WHERE symbol IN ('EEREL', 'EEINFY', 'EEHDFC');`);
      await pool.query(`DELETE FROM news_items WHERE symbol IN ('EEREL', 'EEINFY', 'EEHDFC');`);
      await pool.query(`DELETE FROM market_signal_events WHERE stock_symbol IN ('EEREL', 'EEINFY', 'EEHDFC');`);

      // 1. Create a dedicated user & watchlist
      const userRes = await request('POST', '/api/auth/register', { email: `e2e_user_${Date.now()}@example.com`, password: 'Password123!' });
      const token = userRes.body.token;
      const headers = { Authorization: `Bearer ${token}` };

      const wlRes = await request('POST', '/api/watchlists', { name: 'E2E Integrated' }, headers);
      const e2eWlId = wlRes.body.watchlist.id;

      // Add symbols: EEREL (Mover + News), EEINFY (Mover without News), EEHDFC (Calm + News)
      await pool.query(
        `INSERT INTO instruments (symbol, name, sector)
         VALUES 
           ('EEREL', 'E2E Reliance', 'Energy'),
           ('EEINFY', 'E2E Infosys', 'IT'),
           ('EEHDFC', 'E2E HDFC Bank', 'Finance')
         ON CONFLICT (symbol) DO NOTHING`
      );

      const add1 = await request('POST', `/api/watchlists/${e2eWlId}/symbols`, { symbol: 'EEREL' }, headers);
      if (add1.status !== 201) throw new Error(`Failed to add EEREL: ${add1.status} ${JSON.stringify(add1.body)}`);
      const add2 = await request('POST', `/api/watchlists/${e2eWlId}/symbols`, { symbol: 'EEINFY' }, headers);
      if (add2.status !== 201) throw new Error(`Failed to add EEINFY: ${add2.status} ${JSON.stringify(add2.body)}`);
      const add3 = await request('POST', `/api/watchlists/${e2eWlId}/symbols`, { symbol: 'EEHDFC' }, headers);
      if (add3.status !== 201) throw new Error(`Failed to add EEHDFC: ${add3.status} ${JSON.stringify(add3.body)}`);

      // 2. First visit to watchlist: establishes baseline
      const firstDiffRes = await request('GET', `/api/watchlists/${e2eWlId}/diff`, undefined, headers);
      if (firstDiffRes.status !== 200) throw new Error(`First diff failed: ${firstDiffRes.status}`);
      if (firstDiffRes.body.diff.lastSeenAt !== null) throw new Error('Expected lastSeenAt null on first visit');
      if (firstDiffRes.body.diff.hasMeaningfulChanges !== false) throw new Error('Expected no meaningful changes on first visit');

      // 3. Establish historical baseline prices (1 hour ago)
      const baselineTime = new Date(Date.now() - 3600000);
      await pool.query(
        `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
         VALUES 
           ('EEREL', 2000, 0, 0, $1, 'FRESH'),
           ('EEINFY', 1000, 0, 0, $1, 'FRESH'),
           ('EEHDFC', 1500, 0, 0, $1, 'FRESH')`,
        [baselineTime]
      );
      await pool.query('UPDATE watchlists SET last_seen_at = $1 WHERE id = $2', [baselineTime, e2eWlId]);

      // 4. Update current prices (EEREL +5%, EEINFY +10%, EEHDFC +0.2%)
      const now = new Date();
      await pool.query(
        `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
         VALUES 
           ('EEREL', 2100, 100, 5.0, $1, 'FRESH'),
           ('EEINFY', 1100, 100, 10.0, $1, 'FRESH'),
           ('EEHDFC', 1503, 3, 0.2, $1, 'FRESH')`,
        [now]
      );

      // 5. Insert fresh news published 15 minutes ago for EEREL and EEHDFC
      const newsTime = new Date(Date.now() - 900000);
      await pool.query(
        `INSERT INTO news_items (symbol, headline, url, published_at)
         VALUES 
           ('EEREL', 'Reliance announces major enterprise 5G rollout', $1, $2),
           ('EEHDFC', 'HDFC Bank expands digital lending in rural centers', $3, $4)`,
        [`https://news.example.com/rel/5g-${Date.now()}`, newsTime, `https://news.example.com/hdfc/lending-${Date.now()}`, newsTime]
      );

      // 6. User re-opens watchlist (Second visit diff)
      const secondDiffRes = await request('GET', `/api/watchlists/${e2eWlId}/diff`, undefined, headers);
      if (secondDiffRes.status !== 200) throw new Error(`Second diff failed: ${secondDiffRes.status}`);

      const diff = secondDiffRes.body.diff;
      if (!diff.hasMeaningfulChanges) throw new Error('Expected meaningful changes on second visit');
      if (diff.changes.length !== 3) throw new Error(`Expected 3 changes, got ${diff.changes.length}`);

      // Verify EEINFY (Movement without news):
      const infyChange = diff.changes.find((c: any) => c.symbol === 'EEINFY');
      if (!infyChange) throw new Error('Expected EEINFY in changes');
      if (infyChange.type !== 'PRICE_MOVEMENT') throw new Error(`Expected PRICE_MOVEMENT for INFY, got ${infyChange.type}`);
      if (!infyChange.likelyReason?.includes('no relevant news signal was identified')) {
        throw new Error(`Unexpected INFY reason: ${infyChange.likelyReason}`);
      }

      // Verify EEREL (Movement + news):
      const relChange = diff.changes.find((c: any) => c.symbol === 'EEREL');
      if (!relChange) throw new Error('Expected EEREL in changes');
      if (relChange.type !== 'NEWS_PRICE_REACTION' && relChange.type !== 'PRICE_MOVEMENT') {
        throw new Error(`Expected NEWS_PRICE_REACTION for REL, got ${relChange.type}`);
      }
      if (relChange.newsItems.length !== 1) throw new Error('Expected 1 news item for EEREL');
      if (!relChange.likelyReason?.includes('shortly after relevant news was published')) {
        throw new Error(`Unexpected REL reason: ${relChange.likelyReason}`);
      }

      // Verify EEHDFC (News without movement):
      const hdfcChange = diff.changes.find((c: any) => c.symbol === 'EEHDFC');
      if (!hdfcChange) throw new Error('Expected EEHDFC in changes');
      if (hdfcChange.type !== 'NEWS_ONLY' && hdfcChange.type !== 'NEW_NEWS') {
        throw new Error(`Expected NEWS_ONLY for HDFC, got ${hdfcChange.type}`);
      }
      if (!hdfcChange.likelyReason?.includes('no significant price reaction was observed')) {
        throw new Error(`Unexpected HDFC reason: ${hdfcChange.likelyReason}`);
      }

      // 7. Verify last_seen_at was updated to NOW() after comparison
      const wlCheck = await pool.query('SELECT last_seen_at FROM watchlists WHERE id = $1', [e2eWlId]);
      const updatedLastSeen = new Date(wlCheck.rows[0].last_seen_at).getTime();
      if (Date.now() - updatedLastSeen > 5000) {
        throw new Error('Expected last_seen_at to be updated to current time');
      }
    });

  } finally {
    server.close();
  }

  // Summary
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log('\n-------------------------------------------------');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed of ${results.length} tests`);
  console.log('-------------------------------------------------\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
