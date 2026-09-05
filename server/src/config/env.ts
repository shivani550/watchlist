import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory, or fallback to root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().default('localhost'),
  PGPORT: z.string().default('5432').transform((val) => parseInt(val, 10)),
  PGUSER: z.string().default('postgres'),
  PGPASSWORD: z.string().default('postgres'),
  PGDATABASE: z.string().default('watchlist_db'),
  JWT_SECRET: z.string().min(16).default('development_secret_key_minimum_length_required'),
  MARKET_DATA_API_KEY: z.string().optional().default(''),
  NEWS_API_KEY: z.string().optional().default(''),
  MARKETAUX_API_TOKEN: z.string().optional().default(''),
  NEWS_REACTION_WINDOW_MINUTES: z.string().default('120').transform((val) => parseInt(val, 10))
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables configuration');
}

export const env = parsed.data;

