import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authService, AuthError } from './auth.service.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

export const authRouter = Router();

// Validation Schemas
const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address format')
    .trim()
    .toLowerCase(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long'),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address format')
    .trim()
    .toLowerCase(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response) => {
  const parseResult = registerSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const result = await authService.register(email, password);
    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof AuthError || err?.name === 'AuthError' || (typeof err?.statusCode === 'number' && err.statusCode < 500)) {
      res.status(err.statusCode || 400).json({ error: err.message });
      return;
    }
    console.error('Unexpected error during registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const result = await authService.login(email, password);
    res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof AuthError || err?.name === 'AuthError' || (typeof err?.statusCode === 'number' && err.statusCode < 500)) {
      res.status(err.statusCode || 401).json({ error: err.message });
      return;
    }
    console.error('Unexpected error during login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
// The architecture is completely stateless; logout signals the client to discard its token.
authRouter.post('/logout', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Logged out successfully' });
});

// GET /api/auth/me (Protected route)
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const profile = await authService.getProfile(userId);
    res.status(200).json({ user: profile });
  } catch (err: any) {
    if (err instanceof AuthError || err?.name === 'AuthError' || (typeof err?.statusCode === 'number' && err.statusCode < 500)) {
      res.status(err.statusCode || 404).json({ error: err.message });
      return;
    }
    console.error('Unexpected error retrieving profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
