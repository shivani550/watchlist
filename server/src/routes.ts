import { Router } from 'express';
import { checkDbConnection } from './db/pool.js';
import { authRouter } from './modules/auth/index.js';
import { watchlistRouter } from './modules/watchlist/index.js';
import { marketRouter } from './modules/market/index.js';
import { newsRouter } from './modules/news/index.js';
import { signalRouter } from './modules/signal/index.js';

export const apiRouter = Router();

// Health check endpoint (checks database connectivity)
apiRouter.get('/health', async (_req, res) => {
  const dbHealth = await checkDbConnection();
  const statusCode = dbHealth.connected ? 200 : 503;

  res.status(statusCode).json({
    status: dbHealth.connected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: {
      connected: dbHealth.connected,
      version: dbHealth.version,
      error: dbHealth.error
    }
  });
});

// Module routers (stateless REST endpoints)
apiRouter.use('/auth', authRouter);
apiRouter.use('/watchlists', watchlistRouter);
apiRouter.use('/market', marketRouter);
apiRouter.use('/news', newsRouter);
apiRouter.use('/signals', signalRouter);


