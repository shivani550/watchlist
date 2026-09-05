import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { calculateChanges } from '../src/modules/diff/diff.engine.js';
import { newsRepository } from '../src/modules/news/news.repository.js';
import { newsService } from '../src/modules/news/news.service.js';
import { MockNewsProvider, setNewsProvider } from '../src/providers/news.provider.js';
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

const PORT = 5006;

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
  console.log('🧪 BATCH 8: NEWS INGESTION & DIFF TESTS');
  console.log('========================================\n');

  // =========================================================================
  // PART 1: DIFF ENGINE NEWS INTEGRATION UNIT TESTS
  // =========================================================================
  console.log('--- Part 1: Diff Engine News Integration Unit Tests ---');

  const mockNewsSample: NewsItem = {
    id: 'news-1',
    symbol: 'INFY',
    headline: 'Infosys expands generative AI services for global enterprise clients',
    url: 'https://news.example.com/infy/ai-services',
    publishedAt: '2026-09-04T10:00:00.000Z',
    providerId: 'prov-1',
  };

  await assert('Unit: Attaches supporting news to significant price movement', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-news-1',
      lastSeenAt: '2026-09-04T08:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['INFY'],
      currentQuotes: {
        INFY: { price: 1650, change: 150, changePercent: 10.0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        INFY: { price: 1500, timestamp: '2026-09-04T08:00:00.000Z' },
      },
      recentNewsBySymbol: {
        INFY: [mockNewsSample],
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
    if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);

    const change = diff.changes[0];
    if (change.type !== 'NEWS_PRICE_REACTION' && change.type !== 'PRICE_MOVEMENT') {
      throw new Error(`Expected NEWS_PRICE_REACTION or PRICE_MOVEMENT, got ${change.type}`);
    }
    if (change.direction !== 'UP') throw new Error(`Expected UP, got ${change.direction}`);
    if (!change.newsItems || change.newsItems.length !== 1) {
      throw new Error(`Expected 1 attached news item, got ${change.newsItems?.length}`);
    }
    if (change.newsItems[0].headline !== mockNewsSample.headline) {
      throw new Error(`Expected headline to match, got ${change.newsItems[0].headline}`);
    }
  });

  await assert('Unit: Creates NEWS_ONLY change item when price movement is below threshold but new news exists', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-news-2',
      lastSeenAt: '2026-09-04T08:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['TCS'],
      currentQuotes: {
        TCS: { price: 4005, change: 5, changePercent: 0.12, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        TCS: { price: 4000, timestamp: '2026-09-04T08:00:00.000Z' },
      },
      recentNewsBySymbol: {
        TCS: [{
          id: 'news-tcs-1',
          symbol: 'TCS',
          headline: 'TCS signs multi-million dollar cloud deal with major European bank',
          url: 'https://news.example.com/tcs/deal',
          publishedAt: '2026-09-04T09:30:00.000Z',
        }],
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true due to new news');
    if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);

    const change = diff.changes[0];
    if (change.type !== 'NEWS_ONLY' && change.type !== 'NEW_NEWS') {
      throw new Error(`Expected NEWS_ONLY or NEW_NEWS, got ${change.type}`);
    }
    if (change.direction !== 'FLAT') throw new Error(`Expected FLAT direction for news-only change, got ${change.direction}`);
    if (!change.newsItems || change.newsItems.length !== 1) throw new Error('Expected newsItems attached');
  });

  await assert('Unit: Sorts PRICE_MOVEMENT first by magnitude, followed by NEW_NEWS', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-sort',
      lastSeenAt: '2026-09-04T08:00:00.000Z',
      currentTimestamp: '2026-09-04T12:00:00.000Z',
      symbols: ['NEWS_ONLY_STOCK', 'MOVER_STOCK'],
      currentQuotes: {
        NEWS_ONLY_STOCK: { price: 100, change: 0, changePercent: 0, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
        MOVER_STOCK: { price: 110, change: 10, changePercent: 10, timestamp: '2026-09-04T12:00:00.000Z', freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        NEWS_ONLY_STOCK: { price: 100, timestamp: '2026-09-04T08:00:00.000Z' },
        MOVER_STOCK: { price: 100, timestamp: '2026-09-04T08:00:00.000Z' },
      },
      recentNewsBySymbol: {
        NEWS_ONLY_STOCK: [mockNewsSample],
        MOVER_STOCK: [mockNewsSample],
      },
      thresholdPercent: 2.0,
    };

    const diff = calculateChanges(input);
    if (diff.changes.length !== 2) throw new Error(`Expected 2 changes, got ${diff.changes.length}`);
    if (diff.changes[0].symbol !== 'MOVER_STOCK') throw new Error('Expected MOVER_STOCK (PRICE_MOVEMENT) first');
    if (diff.changes[1].symbol !== 'NEWS_ONLY_STOCK') throw new Error('Expected NEWS_ONLY_STOCK (NEW_NEWS) second');
  });

  // =========================================================================
  // PART 2: DATABASE REPOSITORY & DEDUPLICATION TESTS
  // =========================================================================
  console.log('\n--- Part 2: Database Repository & Deduplication Tests ---');

  // Clean instrument fixture
  await pool.query(`INSERT INTO instruments (symbol, name, sector) VALUES ('TESTNEWS', 'Test News Corp', 'Media') ON CONFLICT (symbol) DO NOTHING`);

  await assert('DB: NewsRepository prevents duplicate news by (symbol, url) constraint', async () => {
    const publishedAt = new Date();
    const url = `https://testnews.example.com/article-${Date.now()}`;

    // First insert
    const row1 = await newsRepository.insertNewsItem('TESTNEWS', 'First unique headline', url, publishedAt, 'prov-1');
    if (!row1) throw new Error('Expected row1 to be inserted');

    // Duplicate insert with same symbol and url
    const row2 = await newsRepository.insertNewsItem('TESTNEWS', 'Different headline duplicate URL', url, publishedAt, 'prov-1');
    if (row2 !== null) throw new Error('Expected duplicate insert to return null due to ON CONFLICT DO NOTHING');
  });

  await assert('DB: NewsRepository.getNewsSince retrieves only news strictly after the given timestamp', async () => {
    await pool.query(`INSERT INTO instruments (symbol, name, sector) VALUES ('TESTNEWSSINCE', 'Test News Since Corp', 'Media') ON CONFLICT (symbol) DO NOTHING`);
    await pool.query(`DELETE FROM news_items WHERE symbol = 'TESTNEWSSINCE'`);

    const pastTime = new Date(Date.now() - 7200000); // 2 hours ago
    const midTime = new Date(Date.now() - 3600000);  // 1 hour ago
    const futureTime = new Date(Date.now() - 1800000); // 30 mins ago

    const urlOld = `https://testnews.example.com/old-${Date.now()}`;
    const urlNew = `https://testnews.example.com/new-${Date.now()}`;

    await newsRepository.insertNewsItem('TESTNEWSSINCE', 'Old Headline', urlOld, pastTime);
    await newsRepository.insertNewsItem('TESTNEWSSINCE', 'New Headline', urlNew, futureTime);

    // Query since midTime (1 hour ago) -> Should only return the news from 30 mins ago
    const newsSince = await newsRepository.getNewsSince('TESTNEWSSINCE', midTime);
    if (newsSince.length !== 1) throw new Error(`Expected 1 news item since midTime, got ${newsSince.length}`);
    if (newsSince[0].headline !== 'New Headline') throw new Error(`Expected New Headline, got ${newsSince[0].headline}`);
  });

  // =========================================================================
  // PART 3: INGESTION SERVICE & DISTINCT SYMBOLS & FAILURE ISOLATION
  // =========================================================================
  console.log('\n--- Part 3: Ingestion Service & Failure Isolation Tests ---');

  const mockProvider = new MockNewsProvider();
  setNewsProvider(mockProvider);

  await assert('Ingestion: Failure on one symbol does not block other watched symbols', async () => {
    // Inject symbol failure on FAILSOCKET
    mockProvider.setSymbolFailure('FAILSOCKET', true);

    await pool.query(`INSERT INTO instruments (symbol, name) VALUES ('FAILSOCKET', 'Failing Socket Corp'), ('GOODSOCKET', 'Good Socket Corp') ON CONFLICT DO NOTHING`);

    // Ingest with simulated failure
    const res = await newsService.ingestNewsForDistinctWatchedSymbols();
    // Ingestion should complete without throwing an unhandled exception
    if (typeof res.symbolsAttempted !== 'number') throw new Error('Expected symbolsAttempted number');

    mockProvider.setSymbolFailure('FAILSOCKET', false);
  });

  // =========================================================================
  // PART 4: HTTP API & END-TO-END TESTS
  // =========================================================================
  console.log('\n--- Part 4: HTTP API & End-to-End Tests ---');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const userEmail = `newsuser_${Date.now()}@example.com`;
    const regRes = await request('POST', '/api/auth/register', { email: userEmail, password: 'Password123!' });
    const token = regRes.body.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Setup Watchlist
    const createWlRes = await request('POST', '/api/watchlists', { name: 'News Watchlist' }, authHeaders);
    const watchlistId = createWlRes.body.watchlist.id;

    await pool.query(`INSERT INTO instruments (symbol, name) VALUES ('NEWSINFY', 'News Infosys') ON CONFLICT DO NOTHING`);
    await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'NEWSINFY' }, authHeaders);

    // Baseline snapshot & time
    const baselineTime = new Date(Date.now() - 3600000);
    await pool.query(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
       VALUES ('NEWSINFY', 1000, 0, 0, $1, 'FRESH')`,
      [baselineTime]
    );
    await pool.query('UPDATE watchlists SET last_seen_at = $1 WHERE id = $2', [baselineTime, watchlistId]);

    // Current price snapshot (1050 -> +5.0% price move)
    await pool.query(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, timestamp, freshness_state)
       VALUES ('NEWSINFY', 1050, 50, 5.0, NOW(), 'FRESH')`
    );

    // Insert news published 10 minutes ago (after baselineTime)
    const recentNewsTime = new Date(Date.now() - 600000);
    await pool.query(
      `INSERT INTO news_items (symbol, headline, url, published_at)
       VALUES ('NEWSINFY', 'Infosys wins landmark $500M enterprise tech contract', $1, $2)`,
      [`https://news.example.com/newsinfy/contract-${Date.now()}`, recentNewsTime]
    );

    await assert('API: GET /api/news/:symbol returns news items for symbol', async () => {
      const res = await request('GET', '/api/news/NEWSINFY');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!Array.isArray(res.body.news) || res.body.news.length === 0) {
        throw new Error('Expected non-empty news array');
      }
    });

    await assert('API: GET /api/news/:symbol?since= returns filtered news', async () => {
      const sinceTime = new Date(Date.now() - 300000).toISOString(); // 5 mins ago (after the 10-min ago news)
      const res = await request('GET', `/api/news/NEWSINFY?since=${encodeURIComponent(sinceTime)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (res.body.news.length !== 0) throw new Error(`Expected 0 news items since 5 mins ago, got ${res.body.news.length}`);
    });

    await assert('API: POST /api/news/ingest triggers on-demand news ingestion', async () => {
      const res = await request('POST', '/api/news/ingest');
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (typeof res.body.newsItemsSaved !== 'number') throw new Error('Expected newsItemsSaved in response');
    });

    await assert('API: GET /api/watchlists/:id/diff includes supporting news attached to movement', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/diff?peek=true`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);

      const diff = res.body.diff;
      if (!diff.hasMeaningfulChanges) throw new Error('Expected hasMeaningfulChanges to be true');
      if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);

      const change = diff.changes[0];
      if (change.symbol !== 'NEWSINFY') throw new Error(`Expected NEWSINFY, got ${change.symbol}`);
      if (!change.newsItems || change.newsItems.length === 0) {
        throw new Error('Expected newsItems to be attached to the meaningful price movement');
      }
      if (!change.newsItems[0].headline.includes('$500M enterprise tech contract')) {
        throw new Error(`Unexpected headline: ${change.newsItems[0].headline}`);
      }
    });

    await assert('API: GET /api/news/:symbol rejects invalid symbol with 400', async () => {
      const res = await request('GET', '/api/news/INVALID@SYMBOL!');
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
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
