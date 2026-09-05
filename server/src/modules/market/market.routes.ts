import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { marketService } from './market.service.js';

export const marketRouter = Router();

const quotesQuerySchema = z.object({
  symbols: z.string().optional(),
  symbol: z.string().optional()
});

/**
 * GET /api/market/quotes?symbols=AAPL,MSFT,RELIANCE
 * Reads stored quotes directly from PostgreSQL. Does not trigger provider requests on client read.
 */
marketRouter.get('/quotes', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = quotesQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid query parameters' });
      return;
    }

    const { symbols, symbol } = parseResult.data;
    let symbolList: string[] = [];

    if (symbols) {
      symbolList = symbols.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (symbol) {
      symbolList = [symbol.trim()];
    }

    if (symbolList.length === 0) {
      res.status(400).json({ error: 'At least one symbol must be specified via ?symbols= or ?symbol=' });
      return;
    }

    const quotes = await marketService.getQuotesForSymbols(symbolList);
    res.status(200).json({ quotes });
  } catch (err) {
    console.error('Error fetching market quotes:', err);
    res.status(500).json({ error: 'Internal server error while fetching market quotes' });
  }
});

/**
 * GET /api/market/history/:symbol
 * Retrieves compact historical price series for chart rendering.
 */
marketRouter.get('/history/:symbol', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSymbol = req.params.symbol;
    const symbolStr = Array.isArray(rawSymbol) ? rawSymbol[0] : rawSymbol;
    const symbol = symbolStr?.trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
      res.status(400).json({ error: 'Invalid symbol parameter' });
      return;
    }

    const history = await marketService.getHistoricalData(symbol);
    res.status(200).json({
      symbol,
      history
    });
  } catch (err) {
    console.error(`Error fetching history for ${req.params.symbol}:`, err);
    res.status(500).json({ error: 'Internal server error while fetching historical data' });
  }
});

/**
 * POST /api/market/ingest
 * Trigger an on-demand ingestion run across distinct watched symbols.
 */
marketRouter.post('/ingest', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await marketService.ingestMarketData();
    res.status(200).json(result);
  } catch (err) {
    console.error('Error during market ingestion run:', err);
    res.status(500).json({ error: 'Market ingestion run failed' });
  }
});
