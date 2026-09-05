import { AuthResponse, User } from '@watchlist/shared';
import { authRepository } from './auth.repository.js';
import { comparePassword, generateToken, hashPassword } from './auth.utils.js';

export class AuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

export class AuthService {
  async register(email: string, password: string): Promise<AuthResponse> {
    const existing = await authRepository.findByEmail(email);
    if (existing) {
      throw new AuthError('Email is already registered', 409);
    }

    const passwordHash = await hashPassword(password);
    const created = await authRepository.create(email, passwordHash);

    const user: User = {
      id: created.id,
      email: created.email,
      createdAt: created.created_at.toISOString(),
    };

    const token = generateToken({
      userId: user.id,
      email: user.email,
    });

    return { user, token };
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const existing = await authRepository.findByEmail(email);
    if (!existing) {
      throw new AuthError('Invalid email or password', 401);
    }

    const isMatch = await comparePassword(password, existing.password_hash);
    if (!isMatch) {
      throw new AuthError('Invalid email or password', 401);
    }

    const user: User = {
      id: existing.id,
      email: existing.email,
      createdAt: existing.created_at.toISOString(),
    };

    const token = generateToken({
      userId: user.id,
      email: user.email,
    });

    return { user, token };
  }

  async getProfile(userId: string): Promise<User> {
    const user = await authRepository.findById(userId);
    if (!user) {
      throw new AuthError('User not found', 404);
    }

    return {
      id: user.id,
      email: user.email,
      createdAt: user.created_at.toISOString(),
    };
  }
}

export const authService = new AuthService();
