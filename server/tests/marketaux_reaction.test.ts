import { pool } from '../src/db/pool.js';
import { MarketauxNewsProvider, MockNewsProvider, getNewsProvider, setNewsProvider } from '../src/providers/news.provider.js';
import { newsRepository } from '../src/modules/news/news.repository.js';
import { calculateChanges } from '../src/modules/diff/diff.engine.js';
import { determineLikelyReason } from '../src/modules/reason/reason.engine.js';
import { signalService } from '../src/modules/signal/signal.service.js';
import { DiffCalculationInput, MeaningfulChange } from '@watchlist/shared';

async function runBatch14Tests() {
  console.log('=== Starting Batch 14 — Marketaux Provider & News-to-Price Reaction Tests ===\n');

  let passedCount = 0;
  async function assert(desc: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`[PASS] ${desc}`);
      passedCount++;
    } catch (err) {
      console.error(`[FAIL] ${desc}:`, err);
      throw err;
    }
  }

  // -------------------------------------------------------------
  // Part 1: Marketaux News Provider
  // -------------------------------------------------------------
  console.log('\n--- Part 1: Marketaux News Provider & Error Handling ---');

  await assert('Provider: Throws clear error when MARKETAUX_API_TOKEN is missing', async () => {
    const unconfiguredProvider = new MarketauxNewsProvider('');
    let threw = false;
    try {
      await unconfiguredProvider.fetchNewsForSymbol('AAPL');
    } catch (err: unknown) {
      threw = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Marketaux API token is not configured')) {
        throw new Error(`Unexpected error message: ${msg}`);
      }
    }
    if (!threw) throw new Error('Expected provider to throw missing token error');
  });

  await assert('Provider: Maps Marketaux response into NewsItemInput format accurately', async () => {
    const originalFetch = globalThis.fetch;
    const sampleUuid = '8e310065-ff13-4886-81aa-1a938c5bbbc5';
    const samplePubDate = '2026-09-04T12:30:00.000Z';

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes('symbols=AAPL')) {
        return new Response(
          JSON.stringify({
            meta: { found: 1, returned: 1, limit: 5, page: 1 },
            data: [
              {
                uuid: sampleUuid,
                title: 'Apple introduces next-generation silicon chipset',
                snippet: 'Apple unveiled its latest chip lineup for workstations...',
                url: 'https://news.example.com/apple-chipset-launch',
                published_at: samplePubDate,
                source: 'reuters.com',
                entities: [{ symbol: 'AAPL', name: 'Apple Inc', match_score: 18.2 }],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    try {
      const provider = new MarketauxNewsProvider('test_valid_token');
      const news = await provider.fetchNewsForSymbol('AAPL');
      if (news.length !== 1) throw new Error(`Expected 1 item, got ${news.length}`);
      if (news[0].symbol !== 'AAPL') throw new Error(`Expected AAPL, got ${news[0].symbol}`);
      if (news[0].providerId !== sampleUuid) throw new Error(`Expected providerId ${sampleUuid}, got ${news[0].providerId}`);
      if (news[0].headline !== 'Apple introduces next-generation silicon chipset') {
        throw new Error(`Unexpected headline: ${news[0].headline}`);
      }
      if (news[0].url !== 'https://news.example.com/apple-chipset-launch') {
        throw new Error(`Unexpected url: ${news[0].url}`);
      }
      if (news[0].publishedAt.toISOString() !== new Date(samplePubDate).toISOString()) {
        throw new Error(`Unexpected publishedAt: ${news[0].publishedAt}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await assert('Provider: Handles rate limit (HTTP 429) gracefully with descriptive error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('Too Many Requests', { status: 429 });

    try {
      const provider = new MarketauxNewsProvider('test_token');
      let threw429 = false;
      try {
        await provider.fetchNewsForSymbol('MSFT');
      } catch (err: unknown) {
        threw429 = true;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('429')) throw new Error(`Expected 429 error, got: ${msg}`);
      }
      if (!threw429) throw new Error('Expected 429 throw');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await assert('Provider: fetchNewsForSymbols isolates per-symbol failure without breaking batch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes('symbols=FAILSYM')) {
        return new Response('Internal error', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              uuid: 'id-ok',
              title: 'Success News Headline',
              url: 'https://news.example.com/ok',
              published_at: new Date().toISOString(),
            },
          ],
        }),
        { status: 200 }
      );
    };

    try {
      const provider = new MarketauxNewsProvider('test_token');
      const results = await provider.fetchNewsForSymbols(['GOODSYM', 'FAILSYM']);
      if (results.length !== 1) throw new Error(`Expected 1 successful item, got ${results.length}`);
      if (results[0].symbol !== 'GOODSYM') throw new Error(`Expected GOODSYM, got ${results[0].symbol}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------
  // Part 2: Central News Deduplication
  // -------------------------------------------------------------
  console.log('\n--- Part 2: Database News Deduplication ---');

  await assert('Deduplication: Prevents duplicate rows when same article is ingested repeatedly', async () => {
    await pool.query(
      `INSERT INTO instruments (symbol, name) VALUES ('TESTDEDUP', 'Test Dedup Corp') ON CONFLICT (symbol) DO NOTHING;`
    );

    const testArticle = {
      symbol: 'TESTDEDUP',
      headline: 'Quarterly Earnings Beat Expectations',
      url: 'https://news.example.com/dedup-test-article-1',
      publishedAt: new Date('2026-09-04T10:00:00Z'),
      providerId: 'marketaux-dedup-uuid-1',
    };

    await newsRepository.insertNewsItem(
      testArticle.symbol,
      testArticle.headline,
      testArticle.url,
      testArticle.publishedAt,
      testArticle.providerId
    );

    await newsRepository.insertNewsItem(
      testArticle.symbol,
      testArticle.headline,
      testArticle.url,
      testArticle.publishedAt,
      testArticle.providerId
    );

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int as count FROM news_items WHERE symbol = 'TESTDEDUP' AND url = $1;`,
      [testArticle.url]
    );

    if (rows[0].count !== 1) {
      throw new Error(`Expected exactly 1 news row for url, found ${rows[0].count}`);
    }
  });

  // -------------------------------------------------------------
  // Part 3: Timestamp-Aware News-to-Price Reaction Detection
  // -------------------------------------------------------------
  console.log('\n--- Part 3: News-to-Price Reaction Detection ---');

  const nowMs = Date.now();
  const tBaseline = new Date(nowMs - 6 * 3600 * 1000).toISOString(); // 6 hours ago
  const tNews = new Date(nowMs - 3 * 3600 * 1000).toISOString();     // 3 hours ago
  const tReaction = new Date(nowMs - 2 * 3600 * 1000).toISOString(); // 2 hours ago (within 2h reaction window)

  await assert('Reaction: News followed by +4.0% price increase in reaction window -> NEWS_PRICE_REACTION', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-reaction-1',
      lastSeenAt: tBaseline,
      currentTimestamp: new Date().toISOString(),
      symbols: ['NVDA'],
      currentQuotes: {
        NVDA: { price: 104.0, change: 4.0, changePercent: 4.0, timestamp: tReaction, freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        NVDA: { price: 100.0, timestamp: tBaseline },
      },
      recentNewsBySymbol: {
        NVDA: [
          {
            id: 'n-1',
            symbol: 'NVDA',
            headline: 'Nvidia reveals breakthrough AI server architecture',
            url: 'https://news.example.com/nvda-ai',
            publishedAt: tNews,
            providerId: 'marketaux-nvda-1',
          },
        ],
      },
      priceObservationsBySymbol: {
        NVDA: [
          { price: 100.0, timestamp: tBaseline },
          { price: 100.0, timestamp: new Date(new Date(tNews).getTime() - 60000).toISOString() },
          { price: 104.0, timestamp: tReaction },
        ],
      },
      thresholdPercent: 2.0,
      reactionWindowMinutes: 120,
    };

    const diff = calculateChanges(input);
    if (diff.changes.length !== 1) throw new Error(`Expected 1 change, got ${diff.changes.length}`);
    const change = diff.changes[0];

    if (change.type !== 'NEWS_PRICE_REACTION') {
      throw new Error(`Expected NEWS_PRICE_REACTION, got ${change.type}`);
    }
    if (change.direction !== 'UP') throw new Error(`Expected direction UP, got ${change.direction}`);
    if (change.percentageChange !== 4.0) throw new Error(`Expected 4.0%, got ${change.percentageChange}`);
    if (!change.summary.includes('shortly after relevant news was published')) {
      throw new Error(`Unexpected summary: ${change.summary}`);
    }
    if (!change.likelyReason?.includes('NVDA moved +4.00% shortly after relevant news was published.')) {
      throw new Error(`Unexpected likelyReason: ${change.likelyReason}`);
    }
  });

  await assert('Reaction: News followed by -3.5% price decrease in reaction window -> NEWS_PRICE_REACTION', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-reaction-2',
      lastSeenAt: tBaseline,
      currentTimestamp: new Date().toISOString(),
      symbols: ['TSLA'],
      currentQuotes: {
        TSLA: { price: 193.0, change: -7.0, changePercent: -3.5, timestamp: tReaction, freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        TSLA: { price: 200.0, timestamp: tBaseline },
      },
      recentNewsBySymbol: {
        TSLA: [
          {
            id: 'n-2',
            symbol: 'TSLA',
            headline: 'Tesla delivers fewer vehicles than anticipated in Q3',
            url: 'https://news.example.com/tsla-deliveries',
            publishedAt: tNews,
            providerId: 'marketaux-tsla-1',
          },
        ],
      },
      priceObservationsBySymbol: {
        TSLA: [
          { price: 200.0, timestamp: tBaseline },
          { price: 193.0, timestamp: tReaction },
        ],
      },
      thresholdPercent: 2.0,
      reactionWindowMinutes: 120,
    };

    const diff = calculateChanges(input);
    const change = diff.changes[0];
    if (change.type !== 'NEWS_PRICE_REACTION') throw new Error(`Expected NEWS_PRICE_REACTION, got ${change.type}`);
    if (change.direction !== 'DOWN') throw new Error(`Expected direction DOWN, got ${change.direction}`);
    if (change.percentageChange !== -3.5) throw new Error(`Expected -3.5%, got ${change.percentageChange}`);
    if (!change.likelyReason?.includes('TSLA moved -3.50% shortly after relevant news was published.')) {
      throw new Error(`Unexpected likelyReason: ${change.likelyReason}`);
    }
  });

  await assert('Reaction: News followed by flat price (+0.3%) -> NEWS_ONLY', () => {
    const input: DiffCalculationInput = {
      watchlistId: 'wl-reaction-3',
      lastSeenAt: tBaseline,
      currentTimestamp: new Date().toISOString(),
      symbols: ['INFY'],
      currentQuotes: {
        INFY: { price: 1504.5, change: 4.5, changePercent: 0.3, timestamp: tReaction, freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        INFY: { price: 1500.0, timestamp: tBaseline },
      },
      recentNewsBySymbol: {
        INFY: [
          {
            id: 'n-3',
            symbol: 'INFY',
            headline: 'Infosys expands partnership with regional bank',
            url: 'https://news.example.com/infy-bank',
            publishedAt: tNews,
            providerId: 'marketaux-infy-1',
          },
        ],
      },
      priceObservationsBySymbol: {
        INFY: [
          { price: 1500.0, timestamp: tBaseline },
          { price: 1504.5, timestamp: tReaction },
        ],
      },
      thresholdPercent: 2.0,
      reactionWindowMinutes: 120,
    };

    const diff = calculateChanges(input);
    const change = diff.changes[0];
    if (change.type !== 'NEWS_ONLY') throw new Error(`Expected NEWS_ONLY, got ${change.type}`);
    if (change.direction !== 'FLAT') throw new Error(`Expected FLAT, got ${change.direction}`);
    if (!change.likelyReason?.includes('Relevant INFY news was detected, but no significant price reaction was observed.')) {
      throw new Error(`Unexpected likelyReason: ${change.likelyReason}`);
    }
  });

  await assert('Reaction: Significant price movement happens BEFORE news -> Not a reaction (PRICE_MOVEMENT)', () => {
    const tJumpBeforeNews = new Date(new Date(tNews).getTime() - 2 * 3600 * 1000).toISOString();
    const input: DiffCalculationInput = {
      watchlistId: 'wl-reaction-4',
      lastSeenAt: tBaseline,
      currentTimestamp: new Date().toISOString(),
      symbols: ['GOOGL'],
      currentQuotes: {
        GOOGL: { price: 105.0, change: 5.0, changePercent: 5.0, timestamp: new Date().toISOString(), freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        GOOGL: { price: 100.0, timestamp: tBaseline },
      },
      recentNewsBySymbol: {
        GOOGL: [
          {
            id: 'n-4',
            symbol: 'GOOGL',
            headline: 'Alphabet announces routine quarterly filings',
            url: 'https://news.example.com/googl-filing',
            publishedAt: tNews,
            providerId: 'marketaux-googl-1',
          },
        ],
      },
      priceObservationsBySymbol: {
        GOOGL: [
          { price: 100.0, timestamp: tBaseline },
          { price: 105.0, timestamp: tJumpBeforeNews },
          { price: 105.1, timestamp: new Date(new Date(tNews).getTime() + 10 * 60 * 1000).toISOString() },
        ],
      },
      thresholdPercent: 2.0,
      reactionWindowMinutes: 120,
    };

    const diff = calculateChanges(input);
    const change = diff.changes[0];
    if (change.type !== 'PRICE_MOVEMENT') {
      throw new Error(`Expected PRICE_MOVEMENT, got ${change.type}`);
    }
    if (!change.likelyReason?.includes('no relevant news signal was identified')) {
      throw new Error(`Unexpected likelyReason: ${change.likelyReason}`);
    }
  });

  await assert('Reaction: Price movement happens outside reaction window -> PRICE_MOVEMENT', () => {
    const tOldNews = new Date(nowMs - 5 * 3600 * 1000).toISOString();
    const input: DiffCalculationInput = {
      watchlistId: 'wl-reaction-5',
      lastSeenAt: tBaseline,
      currentTimestamp: new Date().toISOString(),
      symbols: ['MSFT'],
      currentQuotes: {
        MSFT: { price: 103.0, change: 3.0, changePercent: 3.0, timestamp: new Date().toISOString(), freshnessState: 'FRESH' },
      },
      historicalBaselineQuotes: {
        MSFT: { price: 100.0, timestamp: tBaseline },
      },
      recentNewsBySymbol: {
        MSFT: [
          {
            id: 'n-5',
            symbol: 'MSFT',
            headline: 'Microsoft developer conference highlights',
            url: 'https://news.example.com/msft-conf',
            publishedAt: tOldNews,
            providerId: 'marketaux-msft-1',
          },
        ],
      },
      priceObservationsBySymbol: {
        MSFT: [
          { price: 100.0, timestamp: tBaseline },
          { price: 100.1, timestamp: new Date(new Date(tOldNews).getTime() + 30 * 60 * 1000).toISOString() },
          { price: 103.0, timestamp: new Date().toISOString() },
        ],
      },
      thresholdPercent: 2.0,
      reactionWindowMinutes: 120,
    };

    const diff = calculateChanges(input);
    const change = diff.changes[0];
    if (change.type !== 'PRICE_MOVEMENT') {
      throw new Error(`Expected PRICE_MOVEMENT, got ${change.type}`);
    }
  });

  // -------------------------------------------------------------
  // Part 4: Reason Engine Strict Non-Causality
  // -------------------------------------------------------------
  console.log('\n--- Part 4: Reason Engine Non-Causality Checks ---');

  await assert('Reason Engine: Strict verification of non-causal wording', () => {
    const forbiddenWords = ['caused', 'because of', 'due to', 'the reason the stock', 'responsible for'];

    const testInputs = [
      {
        symbol: 'NVDA',
        percentageChange: 4.2,
        direction: 'UP' as const,
        type: 'NEWS_PRICE_REACTION' as const,
        newsItems: [{ id: '1', symbol: 'NVDA', headline: 'AI launch', url: 'https://...', publishedAt: new Date().toISOString(), fetchedAt: new Date().toISOString() }],
      },
      {
        symbol: 'AAPL',
        percentageChange: -3.1,
        direction: 'DOWN' as const,
        type: 'PRICE_MOVEMENT' as const,
      },
      {
        symbol: 'RELIANCE',
        percentageChange: 0.1,
        direction: 'FLAT' as const,
        type: 'NEWS_ONLY' as const,
        newsItems: [{ id: '2', symbol: 'RELIANCE', headline: 'Retail news', url: 'https://...', publishedAt: new Date().toISOString(), fetchedAt: new Date().toISOString() }],
      },
    ];

    for (const ti of testInputs) {
      const reason = determineLikelyReason(ti);
      if (!reason) throw new Error(`Expected reason for ${ti.symbol}`);

      for (const word of forbiddenWords) {
        if (reason.toLowerCase().includes(word)) {
          throw new Error(`Forbidden causal word "${word}" found in reason: "${reason}"`);
        }
      }
    }
  });

  // -------------------------------------------------------------
  // Part 5: Signal Persistence & Check Again Idempotency
  // -------------------------------------------------------------
  console.log('\n--- Part 5: Signal Persistence & Idempotency ---');

  await assert('Persistence: Deduplication signature prevents duplicate signals and retains 24h timer', async () => {
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ('batch14_user@example.com', 'hashed_pw')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id;`
    );
    const userId = userRes.rows[0].id;

    const wlRes = await pool.query(
      `INSERT INTO watchlists (user_id, name)
       VALUES ($1, 'Batch 14 Watchlist')
       RETURNING id;`,
      [userId]
    );
    const watchlistId = wlRes.rows[0].id;

    await pool.query(
      `INSERT INTO instruments (symbol, name) VALUES ('TATAMOTORS', 'Tata Motors Ltd') ON CONFLICT (symbol) DO NOTHING;`
    );

    const reactionChange: MeaningfulChange = {
      symbol: 'TATAMOTORS',
      type: 'NEWS_PRICE_REACTION',
      direction: 'UP',
      summary: 'TATAMOTORS is up +3.20% shortly after relevant news was published.',
      previousPrice: 1000.0,
      currentPrice: 1032.0,
      percentageChange: 3.2,
      percentChangeSinceLastSeen: 3.2,
      absoluteChangeSinceLastSeen: 32.0,
      newsItems: [
        {
          id: 'tm-news-1',
          symbol: 'TATAMOTORS',
          headline: 'Tata Motors EV sales surge across European market',
          url: 'https://news.example.com/tm-ev',
          publishedAt: new Date().toISOString(),
          providerId: 'marketaux-tm-uuid-1',
        },
      ],
      likelyReason: 'TATAMOTORS moved +3.20% shortly after relevant news was published.',
    };

    // First Check Again trigger: inserts signal
    const signals1 = await signalService.persistSignalsFromDiff(userId, watchlistId, [reactionChange]);
    if (signals1.length !== 1) throw new Error(`Expected 1 active signal, got ${signals1.length}`);
    const originalActiveUntil = signals1[0].activeUntil;

    // Second Check Again trigger: repeated check
    const signals2 = await signalService.persistSignalsFromDiff(userId, watchlistId, [reactionChange]);
    if (signals2.length !== 1) throw new Error(`Expected still 1 active signal, got ${signals2.length}`);
    if (signals2[0].activeUntil !== originalActiveUntil) {
      throw new Error(`Expected activeUntil to be preserved, was ${signals2[0].activeUntil} vs ${originalActiveUntil}`);
    }
  });

  console.log(`\n=== All ${passedCount} Batch 14 tests completed successfully! ===\n`);
}

runBatch14Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
