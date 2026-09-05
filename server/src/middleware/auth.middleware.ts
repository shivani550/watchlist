import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../modules/auth/auth.utils.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Authentication required: missing authorization header' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ error: 'Authentication required: format must be Bearer <token>' });
    return;
  }

  const token = parts[1];

  try {
    const payload = verifyToken(token);
    req.user = {
      id: payload.userId,
      email: payload.email,
    };
    next();
  } catch (err: any) {
    res.status(401).json({ error: 'Authentication failed: invalid or expired token' });
  }
}

