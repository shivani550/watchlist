import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes.js';

export const app = express();

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  })
);
app.options('*', cors());
app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled application error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

