import { pool } from '../src/db/pool.js';
import { signalRepository } from '../src/modules/signal/signal.repository.js';
import { signalService } from '../src/modules/signal/signal.service.js';
import { MeaningfulChange } from '@watchlist/shared';

async function runSignalsTest() {
  console.log('--- Starting Market Signals Tests ---');

  try {
    // 1. Setup mock user and watchlist
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ('signals_test_user@example.com', 'hashed_pw')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id;`
    );
    const userId = userResult.rows[0].id;

    const otherUserResult = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ('other_signals_user@example.com', 'hashed_pw')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id;`
    );
    const otherUserId = otherUserResult.rows[0].id;

    // Clean any previous test artifacts
    await pool.query(`DELETE FROM market_signal_events WHERE user_id IN ($1, $2);`, [userId, otherUserId]);
    await pool.query(`DELETE FROM watchlists WHERE user_id IN ($1, $2);`, [userId, otherUserId]);

    const wlResult = await pool.query(
      `INSERT INTO watchlists (user_id, name)
       VALUES ($1, 'Signals Test Watchlist')
       RETURNING id;`,
      [userId]
    );
    const watchlistId = wlResult.rows[0].id;

    console.log(`[PASS] Setup test user (${userId}) and watchlist (${watchlistId})`);

    // 2. Test Event Signature Generation
    const mockChange1: MeaningfulChange = {
      symbol: 'RELIANCE',
      type: 'PRICE_MOVEMENT',
      direction: 'UP',
      summary: 'RELIANCE gained 4.00% since last visit',
      previousPrice: 2500.0,
      currentPrice: 2600.0,
      percentageChange: 4.0,
      percentChangeSinceLastSeen: 4.0,
      absoluteChangeSinceLastSeen: 100.0,
      likelyReason: 'Significant price movement detected.',
    };

    const sig1 = signalService.generateEventSignature('RELIANCE', mockChange1);
    const sig1Duplicate = signalService.generateEventSignature('RELIANCE', mockChange1);
    if (sig1 !== sig1Duplicate) {
      throw new Error('Event signatures for identical changes did not match');
    }
    console.log(`[PASS] Event signature generation: ${sig1}`);

    // 3. Test Persistence from Diff Engine
    const mockChanges: MeaningfulChange[] = [
      mockChange1,
      {
        symbol: 'TCS',
        type: 'NEW_NEWS',
        direction: 'FLAT',
        summary: 'New news reported for TCS',
        previousPrice: 3800.0,
        currentPrice: 3800.0,
        percentageChange: 0,
        percentChangeSinceLastSeen: 0,
        absoluteChangeSinceLastSeen: 0,
        newsItems: [
          {
            providerId: 'news-tcs-123',
            headline: 'TCS wins $1B deal',
            url: 'https://example.com/tcs-deal',
            publishedAt: new Date().toISOString(),
            source: 'ALPHA_VANTAGE',
          },
        ],
        likelyReason: 'New breaking news reported for TCS.',
      },
      {
        symbol: 'INFY',
        type: 'NO_CHANGE',
        direction: 'FLAT',
        summary: 'No significant changes detected.',
        previousPrice: 1500.0,
        currentPrice: 1500.0,
        percentageChange: 0,
        percentChangeSinceLastSeen: 0,
        absoluteChangeSinceLastSeen: 0,
        likelyReason: null,
      },
    ];

    const activeAfterFirstRun = await signalService.persistSignalsFromDiff(userId, watchlistId, mockChanges);
    if (activeAfterFirstRun.length !== 2) {
      throw new Error(`Expected 2 active events to be returned, but got ${activeAfterFirstRun.length}`);
    }
    console.log(`[PASS] Persisted 2 significant events from Diff Engine`);

    // Verify 24-hour active window and 30-day history window
    const firstEvent = activeAfterFirstRun[0];
    const detectedAt = new Date(firstEvent.detectedAt).getTime();
    const activeUntil = new Date(firstEvent.activeUntil).getTime();
    const historyUntil = new Date(firstEvent.historyUntil).getTime();

    const activeDiffHours = (activeUntil - detectedAt) / (1000 * 60 * 60);
    const historyDiffDays = (historyUntil - detectedAt) / (1000 * 60 * 60 * 24);

    if (Math.round(activeDiffHours) !== 24) {
      throw new Error(`Expected active_until to be +24h, got +${activeDiffHours}h`);
    }
    if (Math.round(historyDiffDays) !== 30) {
      throw new Error(`Expected history_until to be +30d, got +${historyDiffDays}d`);
    }
    console.log(`[PASS] Verified active_until (+24h) and history_until (+30d) time windows`);

    // 4. Test Deduplication & Check Again preservation
    // Running diff again with same events should NOT create duplicates
    const activeAfterSecondRun = await signalService.persistSignalsFromDiff(userId, watchlistId, mockChanges);
    if (activeAfterSecondRun.length !== 2) {
      throw new Error(`Expected 2 active events on identical re-run due to deduplication, got ${activeAfterSecondRun.length}`);
    }
    console.log(`[PASS] Deduplication preserved active signals without duplicating on Check Again`);

    // 5. Test 30-Day History Query
    const relianceHistory = await signalService.get30DayHistoryForSymbol(userId, 'RELIANCE');
    if (relianceHistory.length !== 1 || relianceHistory[0].stockSymbol !== 'RELIANCE') {
      throw new Error(`Expected 1 history event for RELIANCE, got ${relianceHistory.length}`);
    }
    console.log(`[PASS] 30-day history query for RELIANCE returned 1 event`);

    // 6. Test Expiration Behavior
    // Manually backdate an event past 24 hours but within 30 days
    const oldSig = 'RELIANCE:EXPIRED_TEST';
    await pool.query(
      `INSERT INTO market_signal_events (
        user_id, watchlist_id, stock_symbol, change_type, change_summary, reason,
        detected_at, active_until, history_until, is_active, event_signature
      ) VALUES (
        $1, $2, 'RELIANCE', 'PRICE_MOVEMENT', 'Expired Signal Summary', 'Backdated event',
        NOW() - INTERVAL '25 hours',
        NOW() - INTERVAL '1 hour',
        NOW() + INTERVAL '29 days',
        true,
        $3
      );`,
      [userId, watchlistId, oldSig]
    );

    // Query active signals - the backdated event should NOT be in active signals
    const activeAfterOld = await signalService.getActiveSignalsForWatchlist(userId, watchlistId);
    if (activeAfterOld.some((s) => s.eventSignature === oldSig)) {
      throw new Error('Expired event (>24h) should not be returned in active signals');
    }
    console.log(`[PASS] Expired signal (>24h) excluded from active signals`);

    // But it SHOULD appear in 30-day history
    const historyAfterOld = await signalService.get30DayHistoryForSymbol(userId, 'RELIANCE');
    if (!historyAfterOld.some((s) => s.eventSignature === oldSig)) {
      throw new Error('Expired event (still within 30d) should be present in 30-day history');
    }
    console.log(`[PASS] Expired signal (>24h, <30d) correctly retained in 30-day history`);

    // 7. Test User Isolation / Security
    const otherUserActive = await signalService.getActiveSignalsForUser(otherUserId);
    if (otherUserActive.length !== 0) {
      throw new Error(`Expected other user to see 0 active signals, got ${otherUserActive.length}`);
    }

    const otherUserHistory = await signalService.get30DayHistoryForSymbol(otherUserId, 'RELIANCE');
    if (otherUserHistory.length !== 0) {
      throw new Error(`Expected other user to see 0 history signals for RELIANCE, got ${otherUserHistory.length}`);
    }

    let unauthorizedThrown = false;
    try {
      await signalService.getSignalById(otherUserId, firstEvent.id);
    } catch {
      unauthorizedThrown = true;
    }
    if (!unauthorizedThrown) {
      throw new Error('Other user should not be able to retrieve another user\'s signal detail');
    }
    console.log(`[PASS] Security & user isolation verified`);

    // Clean up test data
    await pool.query(`DELETE FROM market_signal_events WHERE user_id IN ($1, $2);`, [userId, otherUserId]);
    await pool.query(`DELETE FROM watchlists WHERE user_id IN ($1, $2);`, [userId, otherUserId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2);`, [userId, otherUserId]);

    console.log('--- All Market Signals Tests Passed Successfully! ---');
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSignalsTest();
