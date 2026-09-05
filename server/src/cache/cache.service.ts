import { Redis } from 'ioredis';

interface MemoryCacheEntry {
  value: string;
  expiresAt: number | null;
}

export class CacheService {
  private redis: Redis | null = null;
  private isConnected = false;
  private memoryCache = new Map<string, MemoryCacheEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initRedis();
    this.initMemoryCleanup();
  }

  private initRedis(): void {
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

    try {
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null, // Do not spam reconnects if Redis server is absent
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        console.log('[CacheService] Connected to Redis cluster at', redisUrl);
      });

      this.redis.on('ready', () => {
        this.isConnected = true;
      });

      this.redis.on('error', (err) => {
        if (this.isConnected) {
          console.warn('[CacheService] Redis connection error, falling back to in-memory cache:', err.message);
        }
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        this.isConnected = false;
      });

      // Attempt initial connection asynchronously
      this.redis.connect().catch(() => {
        // Silently fall back to in-memory cache if Redis is not running locally
        this.isConnected = false;
      });
    } catch {
      this.isConnected = false;
    }
  }

  private initMemoryCleanup(): void {
    // Periodically sweep expired keys from in-memory cache every 60s
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.memoryCache.entries()) {
        if (entry.expiresAt !== null && entry.expiresAt <= now) {
          this.memoryCache.delete(key);
        }
      }
    }, 60000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Returns true if active Redis connection is established, false if using in-memory fallback.
   */
  isRedisConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Retrieve parsed JSON value from cache.
   */
  async get<T>(key: string): Promise<T | null> {
    if (this.isConnected && this.redis) {
      try {
        const data = await this.redis.get(key);
        if (!data) return null;
        return JSON.parse(data) as T;
      } catch {
        // Fallback to memory on read failure
      }
    }

    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }

    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set JSON-serializable value in cache with optional TTL in seconds.
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);

    if (this.isConnected && this.redis) {
      try {
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redis.set(key, serialized, 'EX', ttlSeconds);
        } else {
          await this.redis.set(key, serialized);
        }
        return;
      } catch {
        // Fallback to memory on write failure
      }
    }

    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.memoryCache.set(key, { value: serialized, expiresAt });
  }

  /**
   * Delete one or multiple keys from cache.
   */
  async del(keyOrKeys: string | string[]): Promise<void> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    if (keys.length === 0) return;

    if (this.isConnected && this.redis) {
      try {
        await this.redis.del(...keys);
      } catch {
        // Ignore and delete from memory
      }
    }

    for (const k of keys) {
      this.memoryCache.delete(k);
    }
  }

  /**
   * Invalidate all keys matching a prefix/wildcard pattern (e.g., 'sparklines:*' or 'quote:*').
   */
  async delPattern(pattern: string): Promise<void> {
    if (this.isConnected && this.redis) {
      try {
        const stream = this.redis.scanStream({ match: pattern, count: 100 });
        stream.on('data', (keys: string[]) => {
          if (keys.length > 0 && this.redis) {
            this.redis.del(...keys).catch(() => {});
          }
        });
      } catch {
        // Fallback
      }
    }

    // Convert Redis glob pattern (e.g., 'sparklines:wl:*') to regex
    const regexPattern = new RegExp('^' + pattern.replace(/[*]/g, '.*') + '$');
    for (const key of this.memoryCache.keys()) {
      if (regexPattern.test(key)) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Flush all entries (useful for testing).
   */
  async flushAll(): Promise<void> {
    if (this.isConnected && this.redis) {
      try {
        await this.redis.flushall();
      } catch {
        // Ignore
      }
    }
    this.memoryCache.clear();
  }

  /**
   * Graceful cleanup.
   */
  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // Ignore
      }
    }
  }

  // --- Standardized Cache Key Generators ---

  static keys = {
    quote: (symbol: string) => `quote:${symbol.toUpperCase()}`,
    sparklinesWatchlist: (watchlistId: string) => `sparklines:wl:${watchlistId}`,
    activeSignalsGlobal: () => `signals:active:global`,
    activeSignalsWatchlist: (watchlistId: string) => `signals:active:wl:${watchlistId}`,
    userWatchlists: (userId: string) => `user:watchlists:${userId}`,
    watchlistDetail: (watchlistId: string) => `watchlist:${watchlistId}`,
  };
}

export const cacheService = new CacheService();
