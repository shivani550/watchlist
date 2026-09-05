import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { newsService } from './news.service.js';

export const newsRouter = Router();

const symbolParamSchema = z
  .string()
  .trim()
  .min(1, 'Symbol cannot be empty')
  .max(20, 'Symbol cannot exceed 20 characters')
  .regex(/^[A-Z0-9_.-]+$/i, 'Invalid symbol format');

// GET /api/news/:symbol — Retrieve recent or since-timestamp news for a symbol
newsRouter.get('/:symbol', async (req: Request, res: Response) => {
  const symbolParse = symbolParamSchema.safeParse(req.params.symbol);
  if (!symbolParse.success) {
    res.status(400).json({ error: 'Invalid symbol format' });
    return;
  }

  const symbol = symbolParse.data.toUpperCase();
  let since: Date | undefined;

  if (req.query.since) {
    const parsedDate = new Date(req.query.since as string);
    if (!isNaN(parsedDate.getTime())) {
      since = parsedDate;
    }
  }

  try {
    const news = await newsService.getNewsForSymbol(symbol, since);
    res.status(200).json({ symbol, news });
  } catch (err: unknown) {
    console.error(`Error retrieving news for ${symbol}:`, err);
    res.status(500).json({ error: 'Failed to retrieve news' });
  }
});

// POST /api/news/ingest — Trigger an on-demand news ingestion run for all distinct watched symbols
newsRouter.post('/ingest', async (_req: Request, res: Response) => {
  try {
    const result = await newsService.ingestNewsForDistinctWatchedSymbols();
    res.status(200).json(result);
  } catch (err: unknown) {
    console.error('Manual news ingestion trigger failed:', err);
    res.status(500).json({ error: 'News ingestion run failed' });
  }
});
