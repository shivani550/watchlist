import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { sparklineService } from '../src/modules/sparkline/sparkline.service.js';
import { marketRepository, PriceSnapshotRow } from '../src/modules/market/market.repository.js';


const PORT = 5016;

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

function createMockSnapshot(symbol: string, price: number, dateOffsetDays: number): PriceSnapshotRow {
  const d = new Date(Date.now() - dateOffsetDays * 86400000);
  return {
    id: `snap-${symbol}-${dateOffsetDays}`,
    symbol,
    price: price.toString(),
    change: '0.00',
    change_percent: '0.00',
    freshness_state: 'FRESH',
    timestamp: d,
    created_at: d,
  };
}

async function runSparklineTests() {
  console.log('=== Starting Batch 16 — Micro-Sparkline Ghost Pins & Range Breaches Tests ===\n');

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
    // Part 1: Pure Unit Tests — Sparkline, Ghost Pin, & Range Engine
    // -------------------------------------------------------------
    console.log('--- Part 1: Pure Calculation Engine Tests ---');

    await assert('7-Day Sparkline: Generates normalized SVG coordinates with bounded width & height', () => {
      const snapshots: PriceSnapshotRow[] = [
        createMockSnapshot('NVDA', 100, 6),
        createMockSnapshot('NVDA', 105, 5),
        createMockSnapshot('NVDA', 110, 4),
        createMockSnapshot('NVDA', 108, 3),
        createMockSnapshot('NVDA', 112, 2),
        createMockSnapshot('NVDA', 115, 1),
        createMockSnapshot('NVDA', 120, 0),
      ];

      const res = sparklineService.computeSparklineData({
        symbol: 'NVDA',
        historicalSnapshots: snapshots,
      });

      if (res.points.length !== 7) throw new Error(`Expected 7 points, got ${res.points.length}`);
      if (res.points[0].x !== 0) throw new Error(`First point X should be 0, got ${res.points[0].x}`);
      if (res.points[6].x !== 100) throw new Error(`Last point X should be 100, got ${res.points[6].x}`);
      // Lowest price (100) should have max Y (bottom of chart, e.g. 26)
      if (res.points[0].y < res.points[6].y) throw new Error(`Lower price should have higher Y in SVG`);
      if (res.currentPrice !== 120) throw new Error(`Expected currentPrice 120, got ${res.currentPrice}`);
    });

    await assert('Ghost Pin: Exact last_seen_at matches corresponding historical observation index', () => {
      const snap0 = createMockSnapshot('TCS', 3000, 6);
      const snap1 = createMockSnapshot('TCS', 3050, 5);
      const snap2 = createMockSnapshot('TCS', 3100, 4);
      const snap3 = createMockSnapshot('TCS', 3150, 3);
      const snap4 = createMockSnapshot('TCS', 3200, 2);
      const snap5 = createMockSnapshot('TCS', 3250, 1);
      const snap6 = createMockSnapshot('TCS', 3300, 0);

      const res = sparklineService.computeSparklineData({
        symbol: 'TCS',
        historicalSnapshots: [snap0, snap1, snap2, snap3, snap4, snap5, snap6],
        lastSeenAt: snap3.timestamp, // exact timestamp of 3 days ago (index 3)
      });

      if (res.lastSeenIndex !== 3) throw new Error(`Expected lastSeenIndex 3, got ${res.lastSeenIndex}`);
      if (res.lastSeenPrice !== 3150) throw new Error(`Expected lastSeenPrice 3150, got ${res.lastSeenPrice}`);
      // (3300 - 3150) / 3150 = +4.76%
      if (res.sinceLastVisitPercent !== 4.76) throw new Error(`Expected sinceLastVisitPercent +4.76, got ${res.sinceLastVisitPercent}`);
    });

    await assert('Ghost Pin: Nearest observation fallback when last_seen_at falls between dates', () => {
      const snap0 = createMockSnapshot('INFY', 1400, 4);
      const snap1 = createMockSnapshot('INFY', 1450, 2);
      const snap2 = createMockSnapshot('INFY', 1500, 0);

      // User visited 3 days ago (between snap0 at 4 days and snap1 at 2 days)
      const visitTime = new Date(Date.now() - 3 * 86400000);

      const res = sparklineService.computeSparklineData({
        symbol: 'INFY',
        historicalSnapshots: [snap0, snap1, snap2],
        lastSeenAt: visitTime,
      });

      // Closest at-or-before observation is snap0 (index 0)
      if (res.lastSeenIndex !== 0) throw new Error(`Expected lastSeenIndex 0, got ${res.lastSeenIndex}`);
      if (res.lastSeenPrice !== 1400) throw new Error(`Expected lastSeenPrice 1400, got ${res.lastSeenPrice}`);
      // (1500 - 1400) / 1400 = +7.14%
      if (res.sinceLastVisitPercent !== 7.14) throw new Error(`Expected sinceLastVisitPercent +7.14, got ${res.sinceLastVisitPercent}`);
    });

    await assert('Ghost Pin: Null last_seen_at produces null ghost pin metrics (first-time visitor)', () => {
      const snapshots = [
        createMockSnapshot('AAPL', 200, 2),
        createMockSnapshot('AAPL', 205, 1),
        createMockSnapshot('AAPL', 210, 0),
      ];

      const res = sparklineService.computeSparklineData({
        symbol: 'AAPL',
        historicalSnapshots: snapshots,
        lastSeenAt: null,
      });

      if (res.lastSeenIndex !== null) throw new Error(`Expected lastSeenIndex null, got ${res.lastSeenIndex}`);
      if (res.lastSeenPrice !== null) throw new Error(`Expected lastSeenPrice null, got ${res.lastSeenPrice}`);
      if (res.sinceLastVisitPercent !== null) throw new Error(`Expected sinceLastVisitPercent null, got ${res.sinceLastVisitPercent}`);
    });

    await assert('Movement: Correctly handles negative and zero percentage change', () => {
      const snapshotsDown = [
        createMockSnapshot('RELIANCE', 2500, 2),
        createMockSnapshot('RELIANCE', 2450, 1),
        createMockSnapshot('RELIANCE', 2400, 0),
      ];

      const resDown = sparklineService.computeSparklineData({
        symbol: 'RELIANCE',
        historicalSnapshots: snapshotsDown,
        lastSeenAt: snapshotsDown[0].timestamp,
      });

      // (2400 - 2500) / 2500 = -4.0%
      if (resDown.sinceLastVisitPercent !== -4.0) throw new Error(`Expected -4.0%, got ${resDown.sinceLastVisitPercent}`);

      const snapshotsFlat = [
        createMockSnapshot('HDFC', 1600, 2),
        createMockSnapshot('HDFC', 1600, 1),
        createMockSnapshot('HDFC', 1600, 0),
      ];

      const resFlat = sparklineService.computeSparklineData({
        symbol: 'HDFC',
        historicalSnapshots: snapshotsFlat,
        lastSeenAt: snapshotsFlat[0].timestamp,
      });

      if (resFlat.sinceLastVisitPercent !== 0) throw new Error(`Expected 0%, got ${resFlat.sinceLastVisitPercent}`);
    });

    await assert('Range Breach: Detects BREAKOUT_HIGH when current price exceeds prior 20-day high', () => {
      // Create 20 prior daily snapshots in range 100 - 120
      const snapshots: PriceSnapshotRow[] = [];
      for (let i = 20; i >= 1; i--) {
        snapshots.push(createMockSnapshot('NVDA', 100 + (i % 20), i));
      }
      // Current day snapshot at 135 (above max 119)
      snapshots.push(createMockSnapshot('NVDA', 135, 0));

      const res = sparklineService.computeSparklineData({
        symbol: 'NVDA',
        historicalSnapshots: snapshots,
      });

      if (res.rangeStatus !== 'BREAKOUT_HIGH') throw new Error(`Expected BREAKOUT_HIGH, got ${res.rangeStatus}`);
      if (res.prior20DayHigh !== 119) throw new Error(`Expected prior20DayHigh 119, got ${res.prior20DayHigh}`);
      if (res.prior20DayLow !== 100) throw new Error(`Expected prior20DayLow 100, got ${res.prior20DayLow}`);
    });

    await assert('Range Breach: Detects BREAKOUT_LOW when current price falls below prior 20-day low', () => {
      const snapshots: PriceSnapshotRow[] = [];
      for (let i = 20; i >= 1; i--) {
        snapshots.push(createMockSnapshot('NVDA', 100 + (i % 20), i));
      }
      // Current day snapshot at 85 (below min 100)
      snapshots.push(createMockSnapshot('NVDA', 85, 0));

      const res = sparklineService.computeSparklineData({
        symbol: 'NVDA',
        historicalSnapshots: snapshots,
      });

      if (res.rangeStatus !== 'BREAKOUT_LOW') throw new Error(`Expected BREAKOUT_LOW, got ${res.rangeStatus}`);
      if (res.prior20DayHigh !== 119) throw new Error(`Expected prior20DayHigh 119, got ${res.prior20DayHigh}`);
      if (res.prior20DayLow !== 100) throw new Error(`Expected prior20DayLow 100, got ${res.prior20DayLow}`);
    });

    await assert('Range Breach: Returns WITHIN_RANGE when current price stays within prior 20-day high/low', () => {
      const snapshots: PriceSnapshotRow[] = [];
      for (let i = 20; i >= 1; i--) {
        snapshots.push(createMockSnapshot('NVDA', 100 + (i % 20), i));
      }
      // Current day snapshot at 110 (between 100 and 119)
      snapshots.push(createMockSnapshot('NVDA', 110, 0));

      const res = sparklineService.computeSparklineData({
        symbol: 'NVDA',
        historicalSnapshots: snapshots,
      });

      if (res.rangeStatus !== 'WITHIN_RANGE') throw new Error(`Expected WITHIN_RANGE, got ${res.rangeStatus}`);
    });

    await assert('Range Breach: Returns UNKNOWN when prior history is insufficient (< 5 observations)', () => {
      const snapshots: PriceSnapshotRow[] = [
        createMockSnapshot('NEWCO', 50, 3),
        createMockSnapshot('NEWCO', 55, 2),
        createMockSnapshot('NEWCO', 60, 1),
        createMockSnapshot('NEWCO', 75, 0),
      ];

      const res = sparklineService.computeSparklineData({
        symbol: 'NEWCO',
        historicalSnapshots: snapshots,
      });

      if (res.rangeStatus !== 'UNKNOWN') throw new Error(`Expected UNKNOWN for < 5 prior points, got ${res.rangeStatus}`);
      if (res.prior20DayHigh !== null) throw new Error(`Expected null prior20DayHigh, got ${res.prior20DayHigh}`);
    });

    await assert('Range Boundary Isolation: Current observation does NOT include itself in calculating high/low baseline', () => {
      // Prior 10 days at 100 each. Current observation at 150.
      const snapshots: PriceSnapshotRow[] = [];
      for (let i = 10; i >= 1; i--) {
        snapshots.push(createMockSnapshot('TEST', 100, i));
      }
      snapshots.push(createMockSnapshot('TEST', 150, 0));

      const res = sparklineService.computeSparklineData({
        symbol: 'TEST',
        historicalSnapshots: snapshots,
      });

      // If it included itself in priorHigh, priorHigh would be 150 and status would falsely be WITHIN_RANGE.
      if (res.prior20DayHigh !== 100) throw new Error(`Expected prior20DayHigh to be 100, got ${res.prior20DayHigh}`);
      if (res.rangeStatus !== 'BREAKOUT_HIGH') throw new Error(`Expected BREAKOUT_HIGH, got ${res.rangeStatus}`);
    });

    // -------------------------------------------------------------
    // Part 2: Integration API Tests — GET /api/watchlists/:id/sparklines
    // -------------------------------------------------------------
    console.log('\n--- Part 2: Integration & REST API Tests ---');

    // Setup a user and watchlist with items
    const testEmail = `sparkline_test_${Date.now()}@example.com`;
    const regRes = await request('POST', '/api/auth/register', {
      name: 'Sparkline User',
      email: testEmail,
      password: 'Password123!',
    });
    const token = regRes.body.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    const wlRes = await request('POST', '/api/watchlists', { name: 'Tech Breakouts' }, authHeaders);
    const wlId = wlRes.body.watchlist.id;

    // Upsert instruments to satisfy foreign key constraints
    await marketRepository.upsertInstrument('NVDA', 'NVIDIA Corporation', 'Technology');
    await marketRepository.upsertInstrument('TCS', 'Tata Consultancy Services', 'Technology');

    // Add symbols
    await request('POST', `/api/watchlists/${wlId}/symbols`, { symbol: 'NVDA' }, authHeaders);
    await request('POST', `/api/watchlists/${wlId}/symbols`, { symbol: 'TCS' }, authHeaders);


    // Insert historical price snapshots into DB
    const now = Date.now();
    for (let d = 20; d >= 1; d--) {
      const ts = new Date(now - d * 86400000);
      await pool.query(
        `INSERT INTO price_snapshots (symbol, price, change, change_percent, freshness_state, timestamp)
         VALUES ($1, $2, 0, 0, 'FRESH', $3), ($4, $5, 0, 0, 'FRESH', $6)`,
        ['NVDA', 100 + (20 - d), ts, 'TCS', 3000 + (20 - d) * 10, ts]
      );
    }
    // Current snapshots
    await pool.query(
      `INSERT INTO price_snapshots (symbol, price, change, change_percent, freshness_state, timestamp)
       VALUES ($1, 140, 5, 3.7, 'FRESH', NOW()), ($2, 3250, 10, 0.3, 'FRESH', NOW())`,
      ['NVDA', 'TCS']
    );

    // Set last_seen_at to 3 days ago
    const threeDaysAgo = new Date(now - 3 * 86400000);
    await pool.query(`UPDATE watchlists SET last_seen_at = $1 WHERE id = $2`, [threeDaysAgo, wlId]);

    await assert('GET /api/watchlists/:id/sparklines returns multi-stock sparkline data and ghost pins', async () => {
      const res = await request('GET', `/api/watchlists/${wlId}/sparklines`, undefined, authHeaders);

      if (res.status !== 200) throw new Error(`Expected status 200, got ${res.status}`);
      if (!res.body.sparklines.NVDA) throw new Error('Missing NVDA sparkline data');
      if (!res.body.sparklines.TCS) throw new Error('Missing TCS sparkline data');

      const nvda = res.body.sparklines.NVDA;
      if (nvda.points.length < 2) throw new Error(`Expected at least 2 NVDA points, got ${nvda.points.length}`);
      if (nvda.lastSeenIndex === null) throw new Error('NVDA should have lastSeenIndex');
      if (nvda.rangeStatus !== 'BREAKOUT_HIGH') throw new Error(`NVDA should have BREAKOUT_HIGH, got ${nvda.rangeStatus}`);
      if (typeof nvda.sinceLastVisitPercent !== 'number') throw new Error('NVDA should have sinceLastVisitPercent');

      const tcs = res.body.sparklines.TCS;
      if (tcs.points.length < 2) throw new Error(`Expected at least 2 TCS points, got ${tcs.points.length}`);
      if (tcs.lastSeenIndex === null) throw new Error('TCS should have lastSeenIndex');
    });

    await assert('GET /api/watchlists/:id/sparklines enforces authentication and ownership', async () => {
      const unauth = await request('GET', `/api/watchlists/${wlId}/sparklines`);
      if (unauth.status !== 401) throw new Error(`Expected 401, got ${unauth.status}`);

      // Another user
      const otherReg = await request('POST', '/api/auth/register', {
        name: 'Other User',
        email: `other_${Date.now()}@example.com`,
        password: 'Password123!',
      });
      const otherHeaders = { Authorization: `Bearer ${otherReg.body.token}` };

      const forbidden = await request('GET', `/api/watchlists/${wlId}/sparklines`, undefined, otherHeaders);
      if (forbidden.status !== 403) throw new Error(`Expected 403, got ${forbidden.status}`);
    });

    console.log(`\n======================================================`);
    console.log(`All ${passed} Batch 16 Sparkline & Range Breach Tests PASSED successfully!`);
    console.log(`======================================================\n`);
  } finally {
    if (server) server.close();
    await pool.end();
  }
}

runSparklineTests().catch((err) => {
  console.error('Sparkline test runner error:', err);
  process.exit(1);
});
