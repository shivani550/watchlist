import { pool } from '../../db/pool.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

export class AuthRepository {
  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>(
      'SELECT id, email, password_hash, created_at FROM users WHERE LOWER(email) = LOWER($1);',
      [email.trim()]
    );
    return rows[0] || null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>(
      'SELECT id, email, password_hash, created_at FROM users WHERE id = $1;',
      [id]
    );
    return rows[0] || null;
  }

  async create(email: string, passwordHash: string): Promise<UserRow> {
    const { rows } = await pool.query<UserRow>(
      'INSERT INTO users (email, password_hash) VALUES (LOWER($1), $2) RETURNING id, email, password_hash, created_at;',
      [email.trim(), passwordHash]
    );
    return rows[0];
  }
}

export const authRepository = new AuthRepository();
