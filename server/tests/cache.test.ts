import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { cacheService, CacheService } from '../src/cache/cache.service.js';
import { marketService } from '../src/modules/market/market.service.js';
import { sparklineService } from '../src/modules/sparkline/sparkline.service.js';
import { signalService } from '../src/modules/signal/signal.service.js';
import { watchlistService } from '../src/modules/watchlist/watchlist.service.js';
import { marketRepository } from '../src/modules/market/market.repository.js';

const PORT = 5017;

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const jsonBody = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = { ...headers };
    if (jsonBody) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(jsonBody).toString();
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsedBody = null;
          try {
            parsedBody = rawData ? JSON.parse(rawData) : null;
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

async function runCacheTests() {
  console.log('=== Starting Redis / In-Memory Cache Resilience & Invalidation Tests ===\n');

  let server: http.Server;
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, () => {
      resolve();
    });
  });

  let passed = 0;
  async function assert(desc: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`[PASS] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${desc}:`, err);
      if (server) server.close();
      await cacheService.disconnect();
      await pool.end();
      process.exit(1);
    }
  }

  try {
    // -------------------------------------------------------------
    // Part 1: CacheService Unit Operations
    // -------------------------------------------------------------
    console.log('--- Part 1: CacheService Core Operations & Fallback ---');

    await assert('CacheService: Basic get/set/del lifecycle works correctly', async () => {
      await cacheService.set('test:key1', { hello: 'world', count: 42 });
      const val = await cacheService.get<{ hello: string; count: number }>('test:key1');
      if (!val || val.hello !== 'world' || val.count !== 42) {
        throw new Error(`Expected { hello: 'world', count: 42 }, got ${JSON.stringify(val)}`);
      }

      await cacheService.del('test:key1');
      const afterDel = await cacheService.get('test:key1');
      if (afterDel !== null) {
        throw new Error(`Expected null after deletion, got ${JSON.stringify(afterDel)}`);
      }
    });

    await assert('CacheService: TTL expiration evicts keys correctly', async () => {
      await cacheService.set('test:ttl:key', { temporary: true }, 1); // 1 second TTL
      const immediate = await cacheService.get<{ temporary: boolean }>('test:ttl:key');
      if (!immediate || !immediate.temporary) {
        throw new Error('Key should exist immediately after setting');
      }

      // Wait 1.1 seconds
      await new Promise((r) => setTimeout(r, 1100));
      const expired = await cacheService.get('test:ttl:key');
      if (expired !== null) {
        throw new Error(`Expected key to expire after 1.1s, but got ${JSON.stringify(expired)}`);
      }
    });

    await assert('CacheService: delPattern removes all keys matching wildcard pattern', async () => {
      await cacheService.set('sparklines:wl:123', { data: 1 });
      await cacheService.set('sparklines:wl:456', { data: 2 });
      await cacheService.set('quote:TCS', { price: 3500 });

      await cacheService.delPattern('sparklines:wl:*');

      const wl123 = await cacheService.get('sparklines:wl:123');
      const wl456 = await cacheService.get('sparklines:wl:456');
      const quoteTCS = await cacheService.get('quote:TCS');

      if (wl123 !== null || wl456 !== null) {
        throw new Error('delPattern failed to delete sparklines:wl:* keys');
      }
      if (!quoteTCS) {
        throw new Error('delPattern inadvertently deleted unrelated quote:TCS key');
      }
      await cacheService.del('quote:TCS');
    });

    // -------------------------------------------------------------
    // Part 2: Market Quotes Cache-Aside & Ingestion
    // -------------------------------------------------------------
    console.log('\n--- Part 2: Market Quotes Caching & Ingestion ---');

    await assert('Market Quotes: Caches quotes upon retrieval from DB', async () => {
      const sym = `C_${Date.now().toString().slice(-6)}`;
      await marketRepository.upsertInstrument(sym, `${sym} Inc`, 'Tech');
      await marketRepository.insertPriceSnapshot(sym, 250, 5, 2.0, 'FRESH', new Date());

      // Flush any leftover key
      await cacheService.del(CacheService.keys.quote(sym));

      // 1. First fetch - cache miss, loads from DB and writes to cache
      const quotes1 = await marketService.getQuotesForSymbols([sym]);
      if (quotes1.length === 0 || quotes1[0].price !== 250) {
        throw new Error(`Expected quote price 250, got ${quotes1[0]?.price}`);
      }

      // Verify it was saved to cache
      const cached = await cacheService.get<any>(CacheService.keys.quote(sym));
      if (!cached || cached.symbol !== sym || cached.price !== 250) {
        throw new Error(`Expected cached quote to exist in cache, got ${JSON.stringify(cached)}`);
      }

      // 2. Second fetch - should serve directly from cache
      const quotes2 = await marketService.getQuotesForSymbols([sym]);
      if (quotes2.length === 0 || quotes2[0].price !== 250) {
        throw new Error(`Expected quote price 250 on second fetch`);
      }
    });

    // -------------------------------------------------------------
    // Part 3: Sparklines Cache & Invalidation
    // -------------------------------------------------------------
    console.log('\n--- Part 3: Sparklines Caching & Mutation Invalidation ---');

    const testEmail = `cache_user_${Date.now()}@example.com`;
    const regRes = await request('POST', '/api/auth/register', {
      name: 'Cache User',
      email: testEmail,
      password: 'Password123!',
    });
    const token = regRes.body.token;
    const userId = regRes.body.user.id;
    const authHeaders = { Authorization: `Bearer ${token}` };

    const wlRes = await request('POST', '/api/watchlists', { name: 'Cache Watchlist' }, authHeaders);
    const wlId = wlRes.body.watchlist.id;

    await marketRepository.upsertInstrument('INFY', 'Infosys Ltd', 'Technology');
    await marketRepository.insertPriceSnapshot('INFY', 1500, 0, 0, 'FRESH', new Date());
    await request('POST', `/api/watchlists/${wlId}/symbols`, { symbol: 'INFY' }, authHeaders);

    await assert('Sparklines: Caches computed response and invalidates on symbol addition', async () => {
      const sparklineKey = CacheService.keys.sparklinesWatchlist(wlId);

      // Clean cache
      await cacheService.del(sparklineKey);

      // Compute & cache
      const sparklines1 = await sparklineService.getWatchlistSparklines(userId, wlId);
      if (!sparklines1.sparklines.INFY) throw new Error('Missing INFY sparkline');

      // Verify cached
      const cached = await cacheService.get<any>(sparklineKey);
      if (!cached || !cached.sparklines.INFY) {
        throw new Error('Sparklines should be present in cache');
      }

      // Add another symbol to watchlist -> this must invalidate the sparklines cache
      await marketRepository.upsertInstrument('WIPRO', 'Wipro Ltd', 'Technology');
      await marketRepository.insertPriceSnapshot('WIPRO', 500, 0, 0, 'FRESH', new Date());
      await watchlistService.addSymbol(wlId, userId, 'WIPRO');

      const afterAddCache = await cacheService.get<any>(sparklineKey);
      if (afterAddCache !== null) {
        throw new Error('Sparklines cache should be invalidated after adding a symbol');
      }

      // Re-fetching should now return both INFY and WIPRO
      const sparklines2 = await sparklineService.getWatchlistSparklines(userId, wlId);
      if (!sparklines2.sparklines.INFY || !sparklines2.sparklines.WIPRO) {
        throw new Error('Sparklines should now include both INFY and WIPRO');
      }
    });

    // -------------------------------------------------------------
    // Part 4: Active Signals Caching & Invalidation
    // -------------------------------------------------------------
    console.log('\n--- Part 4: Active Signals Caching & Invalidation ---');

    await assert('Active Signals: Caches active signals and invalidates on new detected signal', async () => {
      const signalsKey = CacheService.keys.activeSignalsWatchlist(wlId);
      await cacheService.del(signalsKey);

      // 1. Initial fetch
      const sigs1 = await signalService.getActiveSignalsForWatchlist(userId, wlId);

      // 2. Check cached
      const cached = await cacheService.get<any>(signalsKey);
      if (!cached) {
        throw new Error('Active signals should be cached after fetch');
      }

      // 3. Persist new meaningful change
      await signalService.persistSignalsFromDiff(userId, wlId, [
        {
          symbol: 'INFY',
          summary: 'Infosys surges 4.5% on strong earnings',
          type: 'PRICE_MOVEMENT',
          direction: 'UP',
          percentageChange: 4.5,
          previousPrice: 1500,
          currentPrice: 1567.5,
          likelyReason: 'Strong Q3 earnings beat estimates',
        },
      ]);

      // 4. Fetch updated active signals
      const sigs2 = await signalService.getActiveSignalsForWatchlist(userId, wlId);
      if (sigs2.length === 0 || sigs2[0].stockSymbol !== 'INFY') {
        throw new Error('Expected updated active signals with INFY signal');
      }
    });

    // -------------------------------------------------------------
    // Part 5: User Watchlists Caching & Mutation Invalidation
    // -------------------------------------------------------------
    console.log('\n--- Part 5: User Watchlists Caching & Mutation Invalidation ---');

    await assert('User Watchlists: Caches list and invalidates on create, rename, delete', async () => {
      const userWlKey = CacheService.keys.userWatchlists(userId);
      await cacheService.del(userWlKey);

      // 1. Get watchlists
      const lists1 = await watchlistService.getUserWatchlists(userId);
      if (lists1.length === 0) throw new Error('Expected at least 1 watchlist');

      // 2. Check cached
      const cached = await cacheService.get<any[]>(userWlKey);
      if (!cached || cached.length !== lists1.length) {
        throw new Error('User watchlists should be cached');
      }

      // 3. Create another watchlist -> cache invalidated
      const newWl = await watchlistService.createWatchlist(userId, 'Second Watchlist');
      const afterCreate = await cacheService.get<any[]>(userWlKey);
      if (afterCreate !== null) {
        throw new Error('User watchlists cache should be null after creating new watchlist');
      }

      // 4. Rename watchlist -> cache invalidated
      await watchlistService.getUserWatchlists(userId); // repopulate
      await watchlistService.renameWatchlist(newWl.id, userId, 'Renamed Watchlist');
      const afterRename = await cacheService.get<any[]>(userWlKey);
      if (afterRename !== null) {
        throw new Error('User watchlists cache should be null after renaming watchlist');
      }

      // 5. Delete watchlist -> cache invalidated
      await watchlistService.getUserWatchlists(userId); // repopulate
      await watchlistService.deleteWatchlist(newWl.id, userId);
      const afterDelete = await cacheService.get<any[]>(userWlKey);
      if (afterDelete !== null) {
        throw new Error('User watchlists cache should be null after deleting watchlist');
      }
    });

    console.log(`\n======================================================`);
    console.log(`All ${passed} Redis / In-Memory Cache Tests PASSED successfully!`);
    console.log(`======================================================\n`);
  } finally {
    if (server) server.close();
    await cacheService.disconnect();
    await pool.end();
  }
}

runCacheTests().catch((err) => {
  console.error('Cache test runner error:', err);
  process.exit(1);
});
