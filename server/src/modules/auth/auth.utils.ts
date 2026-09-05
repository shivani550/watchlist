import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthTokenPayload } from '@watchlist/shared';
import { env } from '../../config/env.js';

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

export function verifyToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as any;
  if (!decoded || typeof decoded !== 'object' || !decoded.userId || !decoded.email) {
    throw new Error('Invalid token payload');
  }
  return {
    userId: decoded.userId,
    email: decoded.email,
  };
}

