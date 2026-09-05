# 📈 WatchlistPulse — Intelligent Market Monitoring Workspace

WatchlistPulse is an end-to-end, production-grade stock monitoring workspace built to solve a fundamental flaw in conventional financial dashboards: **passive dashboards only show what a stock is worth *right now*, leaving investors clueless about what meaningfully changed while they were away.**

WatchlistPulse introduces an active **"What Changed Since Your Last Visit?"** intelligence layer that bridges the temporal gap between user sessions using deterministic diff calculations, micro-sparklines with "Ghost Pins", 20-day range breakout indicators, financial news correlations, and sub-millisecond WebSocket streaming.

---

## 📑 Table of Contents
- [1. Problem Statement](#-1-problem-statement)
- [2. The Solution & Core Product Idea](#-2-the-solution--core-product-idea)
- [3. Key Engineering & Product Decisions](#-3-key-engineering--product-decisions)
  - [What Counts as a Meaningful Change](#1-what-counts-as-a-meaningful-change)
  - [What Information to Surface](#2-what-information-to-surface)
  - [State Persistence Across Sessions & Devices](#3-how-state-persists-across-sessions--devices)
  - [Handling Stale, Delayed, or Conflicting Data](#4-handling-stale-delayed-or-conflicting-data)
  - [Scaling Strategy for Millions of Users & Large Watchlists](#5-scaling-strategy-for-millions-of-users--large-watchlists)
  - [Where We Kept It Simple vs. Added Complexity](#6-where-we-kept-it-simple-vs-added-complexity)
- [4. End-to-End System Architecture](#-4-end-to-end-system-architecture)
- [5. Feature Walkthrough](#-5-feature-walkthrough)
- [6. Tech Stack](#-6-tech-stack)
- [7. Getting Started & Local Setup](#-7-getting-started--local-setup)
- [8. Automated Test Suite (188 Tests)](#-8-automated-test-suite-188-tests)
- [9. Demo Walkthrough Script](#-9-demo-walkthrough-script)

---

## 🎯 1. Problem Statement

Retail and institutional investors typically track dozens of stocks across multiple watchlists. However:
1. **Static Noise Overload**: Traditional watchlists display hundreds of blinking green/red numbers without context. Users cannot tell which movements actually matter.
2. **Session Amnesia**: When a user closes the tab and returns hours or days later, the UI resets. There is no memory of where prices stood during their previous visit.
3. **Unexplained Volatility**: When a stock moves $\pm 5\%$, users are forced to open multiple external news tabs to guess *why* it moved.
4. **Naive Scaling Bottlenecks**: Naive implementations poll market providers per-user or per-watchlist, quickly exhausting API quotas and overwhelming database connections.

---

## 💡 2. The Solution & Core Product Idea

WatchlistPulse is built on a central paradigm: **Temporal Differential Awareness**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  "WHILE YOU WERE AWAY" EXECUTIVE BRIEF                                      │
│  2 meaningful changes detected across your 5 watched stocks since 3:45 PM   │
│  • RELIANCE surged +3.2% following quarterly earnings filing (20D Breakout) │
│  • INFY slipped -2.1% within normal 20-day band                             │
│  [ Mark as Caught Up ]                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Deterministic Temporal Diff Engine**: Every time a user opens a watchlist, the system compares the current state against their exact historical checkpoint (`last_seen_at`), isolating true signal from noise.
2. **Ghost Pin Sparklines**: 7-day SVG sparklines render a distinct "Ghost Pin" dot at the exact index and price where the stock was during the user's prior visit.
3. **20-Day Range Breach Badges**: Automatically classifies whether current price action is a breakout (`20D High` / `20D Low`) or ordinary fluctuation (`Within Range`).
4. **Contextual Reason Engine**: Correlates price swings with timestamped financial headlines using strict non-causal attribution (e.g., *"News item cited: 'Q3 profit jumps 15%'"*).
5. **Real-Time WebSocket Feed**: Live price updates pushed instantly to clients with micro-flash animations.

---

## 🧠 3. Key Engineering & Product Decisions

### 1. What Counts as a Meaningful Change?
We filter out sub-percent intraday market jitter using a strict, multi-factor rule engine:
- **Price Delta Threshold**: A movement $\ge \pm 2.0\%$ between the current price and the baseline snapshot at `last_seen_at`.
- **20-Day Range Breakout**: Price crossing above the 20-day trailing high or below the 20-day trailing low.
- **Volume Anomaly**: Volume exceeding $2.5\times$ the 20-day moving average volume.
- **News-to-Price Reaction**: A significant price swing occurring within a 120-minute window of a published news headline.

### 2. What Information to Surface?
We designed a 3-tier visual hierarchy to prevent cognitive overload:
- **Tier 1: Executive Catch-Up Banner**: High-level summary of aggregate events since last visit with a 1-click **"Mark as Caught Up"** action.
- **Tier 2: Interactive Watchlist Table**: Real-time quotes, 24h change %, **"Since Last Visit %"**, 7-day sparklines with **Ghost Pins**, and 20-day range breach chips.
- **Tier 3: Contextual Intelligence Drawer**: Clicking any stock reveals a deep-dive drawer with key fundamentals, 20-day high/low boundaries, active 24h signals, and a 30-day signal audit trail.

### 3. How State Persists Across Sessions & Devices
- **Database-Backed Checkpoints**: Each watchlist stores a dedicated `last_seen_at` timestamp in PostgreSQL.
- **Non-Destructive Reads**: Merely viewing or refreshing the page computes diffs against `last_seen_at` without erasing them.
- **Explicit Acknowledgment**: Clicking **"Mark as Caught Up"** updates `last_seen_at = NOW()`, smoothly collapsing the brief into a calm state.
- **Cross-Device Parity**: Because checkpoints live in PostgreSQL (tied to the authenticated user ID via JWT), a user checking on desktop and later opening on mobile gets an accurate delta.

### 4. Handling Stale, Delayed, or Conflicting Data
Market data pipelines must be resilient to third-party provider downtime and network latency:
- **4-State Freshness Machine**: Every symbol displays its exact data health:
  - 🟢 `FRESH` (Updated $< 15$ seconds ago)
  - 🟡 `DELAYED` ($15\text{s} - 60\text{s}$ old)
  - 🟠 `STALE` ($> 60\text{s}$ old, fallback to last known good snapshot)
  - ⚪ `UNAVAILABLE` (Provider unreachable or market closed)
- **Circuit Breaker & Fallback**: Provider outages never crash the application; cached PostgreSQL snapshots are served with a stale indicator.
- **Deduplication Signature**: Background ingestion computes SHA-256 event signatures (`SYMBOL:TYPE:DIRECTION:MAGNITUDE:PRICE`) to prevent duplicate alerts.

### 5. Scaling Strategy for Millions of Users & Large Watchlists
- **$O(\text{distinct symbols})$ Ingestion**: 100,000 users watching `AAPL` results in **exactly 1** provider API call, stored in a single shared time-series table.
- **Dual-Tier Cache-Aside (Redis + In-Memory)**: High-frequency read endpoints (`/api/market/quotes`, `/api/watchlists/:id/sparklines`) are cached with 15s–60s TTLs.
- **Tag-Based Invalidation**: Mutations (adding a stock, renaming a watchlist) instantly purge matching cache keys via pattern deletion (`delPattern`).
- **Single-Query Partitioning**: Sparkline generation uses SQL `ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC)` to fetch historical series for all watchlist stocks in a single database roundtrip, eliminating N+1 bottlenecks.
- **WebSocket Channel Multiplexing**: Clients subscribe only to symbols in their active viewport, minimizing socket bandwidth.

### 6. Where We Kept It Simple vs. Added Complexity
- **Kept Simple (Rule-Based Reason Engine)**: We deliberately chose deterministic, mathematical rules over generative AI / LLM APIs for movement attribution. This guarantees zero hallucination risk, sub-millisecond execution, and regulatory compliance with financial non-causality standards.
- **Kept Simple (Native SVG Sparklines)**: Built zero-dependency, ultra-lightweight SVG sparklines rather than bundling heavy charting libraries (e.g., Chart.js, Highcharts), keeping initial page load under 150KB.
- **Added Complexity (Temporal Ghost Pin Math)**: Implemented exact timestamp-to-observation interpolation to accurately place the ghost pin on the 7-day timeline even when market data intervals vary.

---

## 🏗️ 4. End-to-End System Architecture

```mermaid
flowchart TD
    subgraph Client["Next.js 14 Frontend (Port 3000)"]
        UI["Watchlist Dashboard"]
        WSClient["WebSocket Client (/ws)"]
        Sparkline["SVG Sparkline + Ghost Pin"]
        Drawer["Contextual Signal Drawer"]
    end

    subgraph Backend["Express & TypeScript API (Port 5000)"]
        Auth["JWT Auth Middleware"]
        WLService["Watchlist Service"]
        DiffEngine["Temporal Diff Engine"]
        ReasonEngine["Rule-Based Reason Engine"]
        WSServer["WebSocket Broadcast Server"]
        Poller["Distinct Symbol Ingestion Poller"]
    end

    subgraph CacheLayer["Dual-Tier Caching Layer"]
        Redis[("Redis / In-Memory Fallback")]
    end

    subgraph Database["PostgreSQL 14+ (Port 5432/5433)"]
        Users[("users")]
        Watchlists[("watchlists & items")]
        Snapshots[("price_snapshots")]
        Signals[("market_signals")]
        News[("news_articles")]
    end

    UI <-->|REST API + JWT| Auth
    WSClient <-->|Live Stream| WSServer
    Auth --> WLService
    WLService --> DiffEngine
    WLService --> CacheLayer
    DiffEngine --> ReasonEngine
    Poller -->|Fetch Distinct Symbols| Database
    Poller -->|Broadcast Ticks| WSServer
    CacheLayer <--> Database
```

---

## 🌟 5. Feature Walkthrough

| Feature | Description |
| :--- | :--- |
| **Multi-Watchlist Management** | Create, switch, rename, and delete custom watchlists with uppercase symbol validation. |
| **While You Were Away Brief** | Highlights price jumps, dips, and range breakouts since your previous session timestamp. |
| **Ghost Pin on Sparklines** | Visual pin on 7-day SVG sparkline showing exactly where the price was on your last visit. |
| **20-Day Range Breaches** | Real-time classification: `20D High Breakout`, `20D Low Breakout`, or `Within Range`. |
| **Live WebSocket Streaming** | Instant price tick streaming with visual flash animations (green on uptick, red on downtick). |
| **Contextual News & Signals** | Rule-based attribution linking news timestamps to price reactions with non-causal phrasing. |
| **30-Day Signal History** | Searchable audit trail of past volatility events and breakouts for every stock. |
| **Dark & Light Mode** | Fully custom, Groww-inspired theme switchable with 1 click. |

---

## 💻 6. Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, Lucide React, Custom CSS Design System (Zero Tailwind/Bootstrap).
- **Backend**: Node.js, Express, TypeScript, `ws` (WebSockets).
- **Database**: PostgreSQL with parameterized queries (`pg` pool) and indexing.
- **Cache**: Redis (`ioredis`) with automatic transparent in-memory TTL fallback.
- **Validation**: Zod schema validation for all incoming DTOs and API requests.

---

## 🚀 7. Getting Started & Local Setup

### 1. Prerequisites
- **Node.js**: `v18.0+` or `v20.0+`
- **npm** or **pnpm**
- **PostgreSQL**: `v14+` running locally or via Docker

### 2. Clone & Install
```bash
# Clone the repository
git clone https://github.com/<your-username>/watchlist_grow.git
cd watchlist_grow

# Install dependencies across all monorepo packages
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory (or use `.env.example`):
```env
PORT=5000
NODE_ENV=development

# PostgreSQL Connection
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/watchlist_db
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=watchlist_db

# Security
JWT_SECRET=production_grade_jwt_secret_key_minimum_length_required_32_chars!

# Optional Caching (Automatically uses high-speed in-memory fallback if Redis is not running)
REDIS_URL=redis://127.0.0.1:6379
```

### 4. Database Migration & Seed
```bash
# 1. Run migrations to create relational tables and time-series indexes
npm --workspace=server run db:migrate

# 2. Seed demo user, default watchlists, and initial market snapshots
npm --workspace=server run db:seed
```

### 5. Start Development Servers
```bash
# Terminal 1: Start Express Backend API (Port 5000)
npm --workspace=server run dev

# Terminal 2: Start Next.js Frontend (Port 3000)
npm --workspace=client run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔑 Demo Credentials

Click **"Fill Demo Credentials"** in the login modal or enter:
- **Email:** `trader@example.com`
- **Password:** `Password123!`

*(You can also register any new account using the Register tab).*

---

## 🧪 8. Automated Test Suite (188 Tests)

WatchlistPulse features comprehensive automated test coverage across 16 test batches:

```bash
# Run all 188 automated unit, integration, and security tests
npm --workspace=server run test:all

# Typecheck all TypeScript packages
npm run typecheck
```

### Test Suite Breakdown:
- **Batch 1–3**: JWT Authentication, Watchlist CRUD, Multi-User Isolation, SQL Injection Defense
- **Batch 4–7**: Market Data Ingestion, Freshness Transitions (`FRESH`, `DELAYED`, `STALE`), Poller Guards
- **Batch 8–11**: Deterministic Temporal Diff Engine, Edge Case Math, Partitioned Queries
- **Batch 12–14**: Financial News Ingestion, Idempotency Signatures, Non-Causal Reason Engine
- **Batch 15**: "While You Were Away" Executive Brief, Timestamp Checkpoints, Acknowledge Lifecycle
- **Batch 16**: Micro-Sparkline SVG Generator, Ghost Pin Interpolation, 20-Day Range Breach Detection
- **Performance & Cache**: Redis Caching, TTL Eviction, Pattern-Based Cache Invalidation
- **Real-Time Feed**: WebSocket Connection Lifecycle, Auth Handshake, Symbol Pub/Sub Broadcasts

---

## 🎙️ 9. Demo Walkthrough Script

When presenting or reviewing the application, follow this 4-step walkthrough:

1. **The Core Problem & Catch-Up Banner (Action: Log in as Demo User)**
   > *"Notice the top banner: 'While You Were Away — 2 meaningful changes detected'. Instead of forcing the user to remember past prices, the system computes the exact delta since their last session."*

2. **Micro-Sparklines & Ghost Pins (Action: Hover over the Sparkline column)**
   > *"Look at the 7-day sparkline. The distinct Ghost Pin marks the exact candle where this stock was when you last visited. The 'Since Last Visit' chip shows the direct delta from that baseline."*

3. **Range Breaches & Real-Time Ticks (Action: Observe the table updates)**
   > *"The 20-Day Range badge flags breakout highs in green and breakout lows in red. Live WebSocket ticks stream in without page reloads, flashing green on upticks and red on downticks."*

4. **Contextual Intelligence & Acknowledgement (Action: Click a stock, then click 'Mark as Caught Up')**
   > *"Clicking any stock opens a side panel with news-to-price attribution and historical signal logs. Clicking 'Mark as Caught Up' saves the current timestamp to the database, cleanly transitioning the workspace into a calm state."*

---

## 📄 License
MIT License. Built for enterprise evaluation.
