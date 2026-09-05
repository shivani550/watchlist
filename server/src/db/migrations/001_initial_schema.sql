-- 001_initial_schema.sql
-- Stock Watchlist MVP Initial Schema

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Watchlists table
CREATE TABLE IF NOT EXISTS watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists(user_id);

-- 3. Instruments table
CREATE TABLE IF NOT EXISTS instruments (
    symbol VARCHAR(20) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sector VARCHAR(100)
);

-- 4. Watchlist Items table
CREATE TABLE IF NOT EXISTS watchlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_watchlist_symbol UNIQUE (watchlist_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist_id ON watchlist_items(watchlist_id);
-- Supports efficient SELECT DISTINCT symbol FROM watchlist_items for ingestion
CREATE INDEX IF NOT EXISTS idx_watchlist_items_symbol ON watchlist_items(symbol);

-- 5. Price Snapshots table (supports both latest quotes and historical/intraday last-seen comparisons)
CREATE TABLE IF NOT EXISTS price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) NOT NULL REFERENCES instruments(symbol) ON DELETE CASCADE,
    price NUMERIC(14, 4) NOT NULL,
    change NUMERIC(14, 4) NOT NULL DEFAULT 0,
    change_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
    freshness_state VARCHAR(20) NOT NULL DEFAULT 'FRESH',
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimized index for retrieving the latest price and the price at/near last_seen_at
CREATE INDEX IF NOT EXISTS idx_price_snapshots_symbol_timestamp ON price_snapshots(symbol, timestamp DESC);

-- 6. News Items table (deduplicated by symbol and url)
CREATE TABLE IF NOT EXISTS news_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) NOT NULL REFERENCES instruments(symbol) ON DELETE CASCADE,
    headline TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    provider_id VARCHAR(100),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_news_symbol_url UNIQUE (symbol, url)
);

CREATE INDEX IF NOT EXISTS idx_news_items_symbol_published ON news_items(symbol, published_at DESC);

