import http from 'http';
import { WebSocket } from 'ws';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { wsServer } from '../src/websocket/websocket.server.js';
import { marketService } from '../src/modules/market/market.service.js';
import { signalService } from '../src/modules/signal/signal.service.js';
import { marketRepository } from '../src/modules/market/market.repository.js';
import { watchlistRepository } from '../src/modules/watchlist/watchlist.repository.js';
import { Quote, ServerWebSocketMessage, MarketSignalEvent } from '@watchlist/shared';

const PORT = 5018;

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

function waitForMessage(
  ws: WebSocket,
  filter?: (msg: ServerWebSocketMessage) => boolean,
  timeoutMs = 3000
): Promise<ServerWebSocketMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timed out waiting for WebSocket message after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMsg = (data: any) => {
      try {
        const parsed = JSON.parse(data.toString()) as ServerWebSocketMessage;
        if (!filter || filter(parsed)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(parsed);
        }
      } catch (err) {
        // Ignore unparseable
      }
    };

    ws.on('message', onMsg);
  });
}

async function runWebSocketTests() {
  console.log('=== Starting WebSocket Real-Time Push & Channel Tests ===\n');

  let server: http.Server;
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, () => {
      wsServer.init(server);
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
      await wsServer.close();
      await pool.end();
      process.exit(1);
    }
  }

  try {
    // -------------------------------------------------------------
    // Setup Test User and Watchlist
    // -------------------------------------------------------------
    const testEmail = `ws_test_${Date.now()}@example.com`;
    const regRes = await request('POST', '/api/auth/register', {
      name: 'WebSocket User',
      email: testEmail,
      password: 'Password123!',
    });
    const token = regRes.body.token;
    const userId = regRes.body.user.id;
    const authHeaders = { Authorization: `Bearer ${token}` };

    const wlRes = await request('POST', '/api/watchlists', { name: 'WS Live Watchlist' }, authHeaders);
    const wlId = wlRes.body.watchlist.id;

    await marketRepository.upsertInstrument('INFY', 'Infosys Ltd', 'Technology');
    await marketRepository.upsertInstrument('TCS', 'Tata Consultancy Services', 'Technology');
    await request('POST', `/api/watchlists/${wlId}/symbols`, { symbol: 'INFY' }, authHeaders);
    await request('POST', `/api/watchlists/${wlId}/symbols`, { symbol: 'TCS' }, authHeaders);

    let clientWs: WebSocket;

    // -------------------------------------------------------------
    // Part 1: Connection & Authentication
    // -------------------------------------------------------------
    console.log('--- Part 1: Connection & Authentication ---');

    await assert('WebSocket: Connects and handles ping/pong protocol', async () => {
      clientWs = new WebSocket(`ws://localhost:${PORT}/ws`);
      await new Promise<void>((resolve) => clientWs.on('open', resolve));

      clientWs.send(JSON.stringify({ type: 'PING' }));
      const response = await waitForMessage(clientWs, (m) => m.type === 'PONG');
      if (response.type !== 'PONG') {
        throw new Error(`Expected PONG, got ${JSON.stringify(response)}`);
      }
    });

    await assert('WebSocket: Authenticates connection via JWT token', async () => {
      clientWs.send(JSON.stringify({ type: 'AUTH', token }));
      const response = await waitForMessage(clientWs, (m) => m.type === 'AUTH_OK');
      if (response.type !== 'AUTH_OK' || (response as any).userId !== userId) {
        throw new Error(`Expected AUTH_OK with userId ${userId}, got ${JSON.stringify(response)}`);
      }
    });

    // -------------------------------------------------------------
    // Part 2: Real-Time Quote Updates Broadcast
    // -------------------------------------------------------------
    console.log('\n--- Part 2: Real-Time Quote Updates Broadcast ---');

    await assert('WebSocket: Subscribes to symbols and receives live QUOTE_UPDATE on ingestion', async () => {
      clientWs.send(JSON.stringify({ type: 'SUBSCRIBE_SYMBOLS', symbols: ['INFY', 'TCS'] }));

      // Trigger quote broadcast
      const testQuotes: Quote[] = [
        {
          symbol: 'INFY',
          name: 'Infosys Ltd',
          sector: 'Technology',
          price: 1545.2,
          change: 25.2,
          changePercent: 1.66,
          freshnessState: 'FRESH',
          timestamp: new Date().toISOString(),
        },
      ];

      // Give subscription a tick to register
      await new Promise((r) => setTimeout(r, 50));

      const msgPromise = waitForMessage(clientWs, (m) => m.type === 'QUOTE_UPDATE');
      wsServer.broadcastQuoteUpdates(testQuotes);

      const msg = await msgPromise;
      if (msg.type !== 'QUOTE_UPDATE') {
        throw new Error(`Expected QUOTE_UPDATE, got ${JSON.stringify(msg)}`);
      }
      if (msg.quotes.length !== 1 || msg.quotes[0].symbol !== 'INFY' || msg.quotes[0].price !== 1545.2) {
        throw new Error(`Unexpected quote payload: ${JSON.stringify(msg.quotes)}`);
      }
    });

    await assert('WebSocket: Unsubscribes from symbol and ignores future broadcasts for that symbol', async () => {
      clientWs.send(JSON.stringify({ type: 'UNSUBSCRIBE_SYMBOLS', symbols: ['INFY'] }));
      await new Promise((r) => setTimeout(r, 50));

      let receivedUnsubscribed = false;
      const onMsg = (data: any) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'QUOTE_UPDATE' && parsed.quotes.some((q: any) => q.symbol === 'INFY')) {
          receivedUnsubscribed = true;
        }
      };
      clientWs.on('message', onMsg);

      // Broadcast update for unsubscribed INFY
      wsServer.broadcastQuoteUpdates([
        {
          symbol: 'INFY',
          name: 'Infosys Ltd',
          sector: 'Technology',
          price: 1550.0,
          change: 30.0,
          changePercent: 1.97,
          freshnessState: 'FRESH',
          timestamp: new Date().toISOString(),
        },
      ]);

      // Wait 300ms to confirm no message was delivered for INFY
      await new Promise((r) => setTimeout(r, 300));
      clientWs.off('message', onMsg);

      if (receivedUnsubscribed) {
        throw new Error('Received quote update for unsubscribed symbol INFY');
      }
    });

    // -------------------------------------------------------------
    // Part 3: Real-Time Market Signals Broadcast
    // -------------------------------------------------------------
    console.log('\n--- Part 3: Real-Time Market Signals Broadcast ---');

    await assert('WebSocket: Receives live SIGNAL_DETECTED broadcast when Diff Engine detects change', async () => {
      clientWs.send(JSON.stringify({ type: 'SUBSCRIBE_WATCHLIST', watchlistId: wlId }));
      await new Promise((r) => setTimeout(r, 50));

      const signalPromise = waitForMessage(clientWs, (m) => m.type === 'SIGNAL_DETECTED');

      // Persist meaningful change from diff
      await signalService.persistSignalsFromDiff(userId, wlId, [
        {
          symbol: 'TCS',
          summary: 'TCS rallies 3.8% on major cloud contract win',
          type: 'PRICE_MOVEMENT',
          direction: 'UP',
          percentageChange: 3.8,
          previousPrice: 3200,
          currentPrice: 3321.6,
          likelyReason: 'Major multi-million dollar cloud deal announcement',
        },
      ]);

      const signalMsg = await signalPromise;
      if (signalMsg.type !== 'SIGNAL_DETECTED') {
        throw new Error(`Expected SIGNAL_DETECTED, got ${JSON.stringify(signalMsg)}`);
      }
      if (signalMsg.signal.stockSymbol !== 'TCS' || signalMsg.signal.percentageChange !== 3.8) {
        throw new Error(`Unexpected signal payload: ${JSON.stringify(signalMsg.signal)}`);
      }
    });

    // -------------------------------------------------------------
    // Part 4: Cleanup and Disconnect
    // -------------------------------------------------------------
    console.log('\n--- Part 4: Clean Teardown ---');

    await assert('WebSocket: Cleans up socket connections on disconnect', async () => {
      clientWs.close();
      await new Promise<void>((resolve) => clientWs.on('close', resolve));
    });

    console.log(`\n======================================================`);
    console.log(`All ${passed} WebSocket Real-Time Push Tests PASSED successfully!`);
    console.log(`======================================================\n`);
  } finally {
    if (server) server.close();
    await wsServer.close();
    await pool.end();
  }
}

runWebSocketTests().catch((err) => {
  console.error('WebSocket test runner error:', err);
  process.exit(1);
});
