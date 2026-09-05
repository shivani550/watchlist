-- 002_market_signals.sql
-- Batch 13: Persistent Market Signals & 30-Day Change History

CREATE TABLE IF NOT EXISTS market_signal_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    stock_symbol VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    change_type VARCHAR(50) NOT NULL, -- e.g. 'PRICE_MOVEMENT', 'NEW_NEWS'
    change_summary TEXT NOT NULL,
    direction VARCHAR(10),            -- 'UP', 'DOWN', 'FLAT'
    percentage_change NUMERIC(8, 4),
    previous_price NUMERIC(15, 4),
    current_price NUMERIC(15, 4),
    reason TEXT,
    news_headline TEXT,
    news_url TEXT,
    news_source VARCHAR(100),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active_until TIMESTAMPTZ NOT NULL,   -- detected_at + INTERVAL '24 hours'
    history_until TIMESTAMPTZ NOT NULL,  -- detected_at + INTERVAL '30 days'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    event_signature VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_signal_event_signature UNIQUE (user_id, watchlist_id, event_signature)
);

-- Index for retrieving currently active signals for a user across watchlists
CREATE INDEX IF NOT EXISTS idx_signal_events_user_active 
    ON market_signal_events(user_id, active_until DESC);

-- Index for retrieving active signals for a specific watchlist
CREATE INDEX IF NOT EXISTS idx_signal_events_watchlist_active 
    ON market_signal_events(watchlist_id, active_until DESC);

-- Index for 30-day stock change history
CREATE INDEX IF NOT EXISTS idx_signal_events_symbol_history 
    ON market_signal_events(user_id, stock_symbol, history_until DESC, detected_at DESC);

-- Index for signature lookups
CREATE INDEX IF NOT EXISTS idx_signal_events_signature 
    ON market_signal_events(event_signature);
