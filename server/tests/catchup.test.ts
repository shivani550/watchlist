import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { catchUpService } from '../src/modules/catchup/catchup.service.js';
import { watchlistRepository } from '../src/modules/watchlist/watchlist.repository.js';
import { marketRepository } from '../src/modules/market/market.repository.js';
import { CatchUpEvent } from '@watchlist/shared';

const PORT = 5015;

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

async function runCatchUpTests() {
  console.log('=== Starting Batch 15 — While You Were Away Executive Brief & Catch-Up Tests ===\n');

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
      await pool.end();
      process.exit(1);
    }
  }

  try {
    // -------------------------------------------------------------
    // Part 1: Pure Unit Tests — Elapsed Time & Narrative Generation
    // -------------------------------------------------------------
    console.log('--- Part 1: Elapsed Time & Deterministic Narrative Generation ---');

    await assert('Elapsed: Formats minutes, hours, and days correctly', () => {
      if (catchUpService.formatAwayTime(0) !== 'less than a minute') throw new Error('0 mins failed');
      if (catchUpService.formatAwayTime(1) !== '1 minute') throw new Error('1 min failed');
      if (catchUpService.formatAwayTime(45) !== '45 minutes') throw new Error('45 mins failed');
      if (catchUpService.formatAwayTime(60) !== '1 hour') throw new Error('60 mins failed');
      if (catchUpService.formatAwayTime(1080) !== '18 hours') throw new Error('18 hours failed');
      if (catchUpService.formatAwayTime(1440) !== '1 day') throw new Error('1 day failed');
      if (catchUpService.formatAwayTime(2880) !== '2 days') throw new Error('2 days failed');
    });

    await assert('Narrative: Empty state generates deterministic calm phrasing', () => {
      const narrative = catchUpService.generateNarrative('18 hours', []);
      if (!narrative.includes('You were away for 18 hours. Nothing significant changed')) {
        throw new Error(`Unexpected empty narrative: ${narrative}`);
      }
    });

    await assert('Narrative: Single price movement event', () => {
      const events: CatchUpEvent[] = [
        {
          symbol: 'TCS',
          companyName: 'Tata Consultancy Services',
          eventType: 'PRICE_MOVEMENT',
          summary: 'TCS moved +3.10%',
          detectedAt: new Date().toISOString(),
          percentageChange: 3.1
        }
      ];
      const narrative = catchUpService.generateNarrative('4 hours', events);
      if (!narrative.includes('1 stock crossed significant movement thresholds')) {
        throw new Error(`Unexpected single move narrative: ${narrative}`);
      }
    });

    await assert('Narrative: Mixed price movements and news events', () => {
      const events: CatchUpEvent[] = [
        {
          symbol: 'NVDA',
          companyName: 'NVIDIA',
          eventType: 'NEWS_PRICE_REACTION',
          summary: 'NVDA moved -4.20% shortly after news',
          detectedAt: new Date().toISOString(),
          percentageChange: -4.2
        },
        {
          symbol: 'TCS',
          companyName: 'Tata Consultancy Services',
          eventType: 'PRICE_MOVEMENT',
          summary: 'TCS moved +3.10%',
          detectedAt: new Date().toISOString(),
          percentageChange: 3.1
        },
        {
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          eventType: 'MATERIAL_NEWS',
          summary: 'Relevant news was detected',
          detectedAt: new Date().toISOString()
        }
      ];
      const narrative = catchUpService.generateNarrative('18 hours', events);
      if (!narrative.includes('2 stocks crossed significant movement thresholds, and 1 had notable news event')) {
        throw new Error(`Unexpected mixed narrative: ${narrative}`);
      }
    });

    // -------------------------------------------------------------
    // Part 2: DB & Service Integration
    // -------------------------------------------------------------
    console.log('\n--- Part 2: Database Setup & Service Integration ---');

    const testEmail = `catchup_user_${Date.now()}@example.com`;
    const regRes = await request('POST', '/api/auth/register', {
      email: testEmail,
      password: 'Password123!'
    });
    const token = regRes.body.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Create test instruments
    await marketRepository.upsertInstrument('CUNVDA', 'NVIDIA Corporation', 'Semiconductors');
    await marketRepository.upsertInstrument('CUTCS', 'Tata Consultancy Services', 'IT');
    await marketRepository.upsertInstrument('CUAAPL', 'Apple Inc.', 'Electronics');

    // Create a watchlist with baseline last_seen_at set to 18 hours ago
    const wlRes = await request('POST', '/api/watchlists', { name: 'CatchUp Portfolio' }, authHeaders);
    const watchlistId = wlRes.body.watchlist.id;

    await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'CUNVDA' }, authHeaders);
    await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'CUTCS' }, authHeaders);
    await request('POST', `/api/watchlists/${watchlistId}/symbols`, { symbol: 'CUAAPL' }, authHeaders);

    const eighteenHoursAgo = new Date(Date.now() - 18 * 60 * 60 * 1000);
    const nineteenHoursAgo = new Date(Date.now() - 19 * 60 * 60 * 1000);
    await pool.query('UPDATE watchlists SET last_seen_at = $1 WHERE id = $2;', [
      eighteenHoursAgo,
      watchlistId
    ]);

    // Insert baseline price snapshots at 19 hours ago (strictly <= 18h ago last_seen_at)
    await marketRepository.insertPriceSnapshot('CUNVDA', 100.0, 0, 0, 'FRESH', nineteenHoursAgo);
    await marketRepository.insertPriceSnapshot('CUTCS', 3000.0, 0, 0, 'FRESH', nineteenHoursAgo);
    await marketRepository.insertPriceSnapshot('CUAAPL', 200.0, 0, 0, 'FRESH', nineteenHoursAgo);

    // Insert current price snapshots showing meaningful movements
    const now = new Date();
    await marketRepository.insertPriceSnapshot('CUNVDA', 95.8, -4.2, -4.2, 'FRESH', now); // -4.2%
    await marketRepository.insertPriceSnapshot('CUTCS', 3093.0, 93.0, 3.1, 'FRESH', now); // +3.1%
    await marketRepository.insertPriceSnapshot('CUAAPL', 200.2, 0.2, 0.1, 'FRESH', now); // +0.1% (flat)

    // Insert news for CUNVDA and CUAAPL
    const newsTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    await pool.query(
      `INSERT INTO news_items (symbol, headline, url, provider_id, published_at)
       VALUES 
        ('CUNVDA', 'NVIDIA Announces AI Chip Supply Update', 'https://example.com/nvda1', 'TechNews', $1),
        ('CUAAPL', 'Apple Schedules Autumn Keynote Event', 'https://example.com/aapl1', 'Bloomberg', $1)
       ON CONFLICT DO NOTHING;`,
      [newsTime]
    );

    // -------------------------------------------------------------
    // Part 3: HTTP API & last_seen_at Immutability on GET
    // -------------------------------------------------------------
    console.log('\n--- Part 3: HTTP Catch-Up Endpoint & Semantics ---');

    await assert('API: GET /api/watchlists/:id/catch-up returns structured executive brief', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/catch-up`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

      const brief = res.body;
      if (brief.watchlistId !== watchlistId) throw new Error('Mismatched watchlistId');
      if (brief.elapsedMinutes < 1000) throw new Error(`Expected ~1080 elapsed mins, got ${brief.elapsedMinutes}`);
      if (!brief.awayTimeFormatted.includes('18 hours')) throw new Error(`Expected '18 hours', got ${brief.awayTimeFormatted}`);
      if (!brief.hasChanges) throw new Error('Expected hasChanges = true');
      if (brief.significantEventsCount < 2) throw new Error(`Expected >=2 events, got ${brief.significantEventsCount}`);

      // Check chronological ordering: events[0] should have detectedAt >= events[1]
      for (let i = 0; i < brief.events.length - 1; i++) {
        const timeA = new Date(brief.events[i].detectedAt).getTime();
        const timeB = new Date(brief.events[i + 1].detectedAt).getTime();
        if (timeA < timeB) {
          throw new Error(`Events not sorted chronologically DESC: ${brief.events[i].detectedAt} < ${brief.events[i + 1].detectedAt}`);
        }
      }

      // Check event types
      const nvdaEvent = brief.events.find((e: any) => e.symbol === 'CUNVDA');
      if (!nvdaEvent || (nvdaEvent.eventType !== 'NEWS_PRICE_REACTION' && nvdaEvent.eventType !== 'PRICE_MOVEMENT')) {
        throw new Error(`NVDA event missing or wrong type: ${JSON.stringify(nvdaEvent)}`);
      }
      if (nvdaEvent.companyName !== 'NVIDIA Corporation') {
        throw new Error(`Expected company name 'NVIDIA Corporation', got '${nvdaEvent.companyName}'`);
      }
    });

    await assert('Semantics: GET /catch-up does NOT advance last_seen_at in DB', async () => {
      const wlBefore = await watchlistRepository.findById(watchlistId);
      const res = await request('GET', `/api/watchlists/${watchlistId}/catch-up`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`GET failed: ${res.status}`);

      const wlAfter = await watchlistRepository.findById(watchlistId);
      if (wlBefore?.last_seen_at?.getTime() !== wlAfter?.last_seen_at?.getTime()) {
        throw new Error('last_seen_at was improperly mutated on GET /catch-up!');
      }
    });

    // -------------------------------------------------------------
    // Part 4: "Mark as Caught Up" Mutation & Subsequent State
    // -------------------------------------------------------------
    console.log('\n--- Part 4: Mark as Caught Up & Collapse Lifecycle ---');

    await assert('API: POST /api/watchlists/:id/catch-up/acknowledge updates last_seen_at to NOW', async () => {
      const beforeAck = Date.now();
      const res = await request('POST', `/api/watchlists/${watchlistId}/catch-up/acknowledge`, {}, authHeaders);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      if (!res.body.success) throw new Error('Expected success = true');

      const updatedWl = await watchlistRepository.findById(watchlistId);
      if (!updatedWl || !updatedWl.last_seen_at) throw new Error('last_seen_at was not updated');

      const updatedTime = updatedWl.last_seen_at.getTime();
      if (updatedTime < beforeAck - 1000) {
        throw new Error(`last_seen_at (${updatedWl.last_seen_at.toISOString()}) was not set to current time`);
      }
    });

    await assert('Subsequent: GET /catch-up after acknowledge returns calm 0-event state', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/catch-up`, undefined, authHeaders);
      if (res.status !== 200) throw new Error(`GET failed: ${res.status}`);

      const brief = res.body;
      if (brief.significantEventsCount !== 0) {
        throw new Error(`Expected 0 events after catch-up acknowledgment, got ${brief.significantEventsCount}`);
      }
      if (brief.hasChanges !== false) {
        throw new Error('Expected hasChanges = false');
      }
      if (!brief.narrative.includes('Nothing significant changed')) {
        throw new Error(`Expected calm narrative, got: ${brief.narrative}`);
      }
    });

    // -------------------------------------------------------------
    // Part 5: Security & Isolation
    // -------------------------------------------------------------
    console.log('\n--- Part 5: Security & User Isolation ---');

    await assert('Security: Unauthenticated request to /catch-up returns 401', async () => {
      const res = await request('GET', `/api/watchlists/${watchlistId}/catch-up`);
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    });

    await assert('Security: Cross-user access to /catch-up returns 404', async () => {
      const otherUser = await request('POST', '/api/auth/register', {
        email: `other_${Date.now()}@example.com`,
        password: 'Password123!'
      });
      const otherHeaders = { Authorization: `Bearer ${otherUser.body.token}` };

      const res = await request('GET', `/api/watchlists/${watchlistId}/catch-up`, undefined, otherHeaders);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);

      const ackRes = await request('POST', `/api/watchlists/${watchlistId}/catch-up/acknowledge`, {}, otherHeaders);
      if (ackRes.status !== 404) throw new Error(`Expected 404, got ${ackRes.status}`);
    });

    console.log(`\n=== All ${passed} Batch 15 tests completed successfully! ===\n`);
  } finally {
    if (server) server.close();
    await pool.end();
  }
}

runCatchUpTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
