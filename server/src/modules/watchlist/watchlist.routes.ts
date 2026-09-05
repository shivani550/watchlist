import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { watchlistService, WatchlistError } from './watchlist.service.js';
import { diffService } from '../diff/diff.service.js';
import { catchUpService } from '../catchup/catchup.service.js';
import { sparklineService } from '../sparkline/sparkline.service.js';

export const watchlistRouter = Router();

// All watchlist routes require authentication
watchlistRouter.use(requireAuth);

// --- Validation Schemas ---

const createWatchlistSchema = z.object({
  name: z
    .string({ required_error: 'Watchlist name is required' })
    .trim()
    .min(1, 'Watchlist name cannot be empty')
    .max(100, 'Watchlist name cannot exceed 100 characters'),
});

const renameWatchlistSchema = z.object({
  name: z
    .string({ required_error: 'Watchlist name is required' })
    .trim()
    .min(1, 'Watchlist name cannot be empty')
    .max(100, 'Watchlist name cannot exceed 100 characters'),
});

const addSymbolSchema = z.object({
  symbol: z
    .string({ required_error: 'Symbol is required' })
    .min(1, 'Symbol cannot be empty')
    .max(20, 'Symbol cannot exceed 20 characters'),
});

const uuidParamSchema = z.string().uuid('Invalid watchlist ID format');

// --- Helper ---

function handleError(err: unknown, res: Response): void {
  if (err instanceof WatchlistError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('Unexpected watchlist error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// --- Routes ---

// POST /api/watchlists — Create a watchlist
watchlistRouter.post('/', async (req: Request, res: Response) => {
  const parseResult = createWatchlistSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const watchlist = await watchlistService.createWatchlist(req.user!.id, parseResult.data.name);
    res.status(201).json({ watchlist });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/watchlists — List user's watchlists
watchlistRouter.get('/', async (req: Request, res: Response) => {
  try {
    const watchlists = await watchlistService.getUserWatchlists(req.user!.id);
    res.status(200).json({ watchlists });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/watchlists/:id — Get one watchlist with items
watchlistRouter.get('/:id', async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  try {
    const watchlist = await watchlistService.getWatchlist(idParse.data, req.user!.id);
    res.status(200).json({ watchlist });
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH / PUT /api/watchlists/:id — Rename a watchlist
const handleRename = async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  const parseResult = renameWatchlistSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const watchlist = await watchlistService.renameWatchlist(idParse.data, req.user!.id, parseResult.data.name);
    res.status(200).json({ watchlist });
  } catch (err) {
    handleError(err, res);
  }
};

watchlistRouter.patch('/:id', handleRename);
watchlistRouter.put('/:id', handleRename);

// DELETE /api/watchlists/:id — Delete a watchlist
watchlistRouter.delete('/:id', async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  try {
    await watchlistService.deleteWatchlist(idParse.data, req.user!.id);
    res.status(200).json({ message: 'Watchlist deleted successfully' });
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/watchlists/:id/symbols — Add a symbol
watchlistRouter.post('/:id/symbols', async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  const parseResult = addSymbolSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const item = await watchlistService.addSymbol(idParse.data, req.user!.id, parseResult.data.symbol);
    res.status(201).json({ item });
  } catch (err) {
    handleError(err, res);
  }
});

// DELETE /api/watchlists/:id/symbols/:symbol — Remove a symbol
watchlistRouter.delete('/:id/symbols/:symbol', async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  const symbol: string = req.params.symbol as string;
  if (!symbol || symbol.trim().length === 0) {
    res.status(400).json({ error: 'Symbol is required' });
    return;
  }

  try {
    await watchlistService.removeSymbol(idParse.data, req.user!.id, symbol);
    res.status(200).json({ message: 'Symbol removed successfully' });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/watchlists/:id/diff — What changed since your last visit?
watchlistRouter.get('/:id/diff', async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  const peek = req.query.peek === 'true';
  const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : undefined;

  try {
    const diff = await diffService.getWatchlistDiff(req.user!.id, idParse.data, {
      updateLastSeen: !peek,
      thresholdPercent: threshold,
    });
    res.status(200).json({ diff });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/watchlists/:id/catch-up — While You Were Away Executive Brief
watchlistRouter.get('/:id/catch-up', async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  try {
    const catchUp = await catchUpService.getCatchUpBrief(req.user!.id, idParse.data);
    res.status(200).json(catchUp);
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/watchlists/:id/catch-up/acknowledge — Mark as Caught Up (persists last_seen_at = now)
const handleAcknowledgeCatchUp = async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  try {
    const result = await catchUpService.acknowledgeCatchUp(req.user!.id, idParse.data);
    res.status(200).json(result);
  } catch (err) {
    handleError(err, res);
  }
};

watchlistRouter.post('/:id/catch-up/acknowledge', handleAcknowledgeCatchUp);
watchlistRouter.post('/:id/catch-up/mark-caught-up', handleAcknowledgeCatchUp);

// GET /api/watchlists/:id/sparklines — Micro-Sparklines with Ghost Pins & Range Status
watchlistRouter.get('/:id/sparklines', async (req: Request, res: Response) => {
  const idParse = uuidParamSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid watchlist ID format' });
    return;
  }

  try {
    const result = await sparklineService.getWatchlistSparklines(req.user!.id, idParse.data);
    res.status(200).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

