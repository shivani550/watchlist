import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { signalService } from './signal.service.js';
import { WatchlistError } from '../watchlist/watchlist.service.js';

export const signalRouter = Router();

// All signal endpoints require authentication
signalRouter.use(requireAuth);

const symbolParamSchema = z
  .string()
  .trim()
  .min(1, 'Symbol cannot be empty')
  .max(20, 'Symbol cannot exceed 20 characters')
  .regex(/^[A-Z0-9_.-]+$/i, 'Invalid symbol format');

const uuidParamSchema = z.string().uuid('Invalid ID format');

/**
 * GET /api/signals/active — Retrieve all currently active signals across user's watchlists
 */
signalRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const signals = await signalService.getActiveSignalsForUser(userId);
    res.status(200).json({
      signals,
      activeCount: signals.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error('Error retrieving active market signals:', err);
    res.status(500).json({ error: 'Failed to retrieve active market signals' });
  }
});

/**
 * GET /api/signals/active/watchlist/:watchlistId — Retrieve active signals for a specific watchlist
 */
signalRouter.get('/active/watchlist/:watchlistId', async (req: Request, res: Response) => {
  const parseResult = uuidParamSchema.safeParse(req.params.watchlistId);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  try {
    const userId = req.user!.id;
    const watchlistId = parseResult.data;
    const signals = await signalService.getActiveSignalsForWatchlist(userId, watchlistId);
    res.status(200).json({
      watchlistId,
      signals,
      activeCount: signals.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    if (err instanceof WatchlistError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Error retrieving watchlist active signals:', err);
    res.status(500).json({ error: 'Failed to retrieve watchlist market signals' });
  }
});

/**
 * GET /api/signals/history/:symbol — Retrieve 30-day change history for a stock symbol
 */
signalRouter.get('/history/:symbol', async (req: Request, res: Response) => {
  const parseResult = symbolParamSchema.safeParse(req.params.symbol);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid stock symbol format' });
    return;
  }

  try {
    const userId = req.user!.id;
    const symbol = parseResult.data.toUpperCase();
    const history = await signalService.get30DayHistoryForSymbol(userId, symbol);
    res.status(200).json({
      symbol,
      history,
      totalEvents: history.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error(`Error retrieving 30-day history for ${req.params.symbol}:`, err);
    res.status(500).json({ error: 'Failed to retrieve stock change history' });
  }
});

/**
 * GET /api/signals/:id — Retrieve detail of a single signal event
 */
signalRouter.get('/:id', async (req: Request, res: Response) => {
  const parseResult = uuidParamSchema.safeParse(req.params.id);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid signal ID format' });
    return;
  }

  try {
    const userId = req.user!.id;
    const signalId = parseResult.data;
    const signal = await signalService.getSignalById(userId, signalId);
    res.status(200).json({ signal });
  } catch (err: unknown) {
    if (err instanceof WatchlistError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Error retrieving signal detail:', err);
    res.status(500).json({ error: 'Failed to retrieve signal detail' });
  }
});
