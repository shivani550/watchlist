import {
  User,
  AuthResponse,
  Watchlist,
  WatchlistSummary,
  WatchlistWithItems,
  Quote,
  IngestionResult,
  DiffResult,
  NewsItem,
  NewsIngestionResult,
  MarketSignalEvent,
  ActiveSignalsResponse,
  SignalHistoryResponse,
  CatchUpResponse,
  WatchlistSparklinesResponse,
} from '@watchlist/shared';

function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
  const clean = raw.trim().replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean : `${clean}/api`;
}

const API_BASE_URL = getApiBaseUrl();

class ApiClient {
  private token: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('watchlist_token');
    }
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('watchlist_token', token);
      } else {
        localStorage.removeItem('watchlist_token');
      }
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
    }

    return data as T;
  }

  // --- Auth Endpoints ---

  async register(email: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/me');
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.setToken(null);
    }
  }

  // --- Watchlist Endpoints ---

  async getWatchlists(): Promise<{ watchlists: WatchlistSummary[] }> {
    return this.request<{ watchlists: WatchlistSummary[] }>('/watchlists');
  }

  async getWatchlist(id: string): Promise<{ watchlist: WatchlistWithItems }> {
    return this.request<{ watchlist: WatchlistWithItems }>(`/watchlists/${id}`);
  }

  async createWatchlist(name: string): Promise<{ watchlist: Watchlist }> {
    return this.request<{ watchlist: Watchlist }>('/watchlists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async renameWatchlist(id: string, name: string): Promise<{ watchlist: Watchlist }> {
    return this.request<{ watchlist: Watchlist }>(`/watchlists/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  }

  async deleteWatchlist(id: string): Promise<void> {
    return this.request<void>(`/watchlists/${id}`, {
      method: 'DELETE',
    });
  }

  async addSymbol(watchlistId: string, symbol: string): Promise<{ item: any }> {
    return this.request<{ item: any }>(`/watchlists/${watchlistId}/symbols`, {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    });
  }

  async removeSymbol(watchlistId: string, symbol: string): Promise<void> {
    return this.request<void>(`/watchlists/${watchlistId}/symbols/${symbol}`, {
      method: 'DELETE',
    });
  }

  // --- Market Data Endpoints ---

  async getQuotes(symbols: string[]): Promise<{ quotes: Quote[] }> {
    if (symbols.length === 0) return { quotes: [] };
    const query = encodeURIComponent(symbols.join(','));
    return this.request<{ quotes: Quote[] }>(`/market/quotes?symbols=${query}`);
  }

  async getHistory(symbol: string): Promise<{ symbol: string; history: Array<{ timestamp: string; price: number }> }> {
    return this.request<{ symbol: string; history: Array<{ timestamp: string; price: number }> }>(
      `/market/history/${encodeURIComponent(symbol)}`
    );
  }

  async triggerIngestion(): Promise<IngestionResult> {
    return this.request<IngestionResult>('/market/ingest', {
      method: 'POST',
    });
  }

  // --- Diff Engine Endpoints ---

  async getWatchlistDiff(watchlistId: string, peek = false): Promise<{ diff: DiffResult }> {
    const query = peek ? '?peek=true' : '';
    return this.request<{ diff: DiffResult }>(`/watchlists/${watchlistId}/diff${query}`);
  }

  // --- News Endpoints ---

  async getNews(symbol: string, since?: string): Promise<{ symbol: string; news: NewsItem[] }> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.request<{ symbol: string; news: NewsItem[] }>(`/news/${encodeURIComponent(symbol)}${query}`);
  }

  async triggerNewsIngestion(): Promise<NewsIngestionResult> {
    return this.request<NewsIngestionResult>('/news/ingest', {
      method: 'POST',
    });
  }

  // --- Market Signals Endpoints (Batch 13) ---

  async getActiveSignals(): Promise<ActiveSignalsResponse> {
    return this.request<ActiveSignalsResponse>('/signals/active');
  }

  async getActiveSignalsForWatchlist(watchlistId: string): Promise<ActiveSignalsResponse & { watchlistId: string }> {
    return this.request<ActiveSignalsResponse & { watchlistId: string }>(`/signals/active/watchlist/${watchlistId}`);
  }

  async getSignalHistory(symbol: string): Promise<SignalHistoryResponse> {
    return this.request<SignalHistoryResponse>(`/signals/history/${encodeURIComponent(symbol)}`);
  }

  async getSignalDetail(id: string): Promise<{ signal: MarketSignalEvent }> {
    return this.request<{ signal: MarketSignalEvent }>(`/signals/${id}`);
  }

  // --- While You Were Away / Catch-Up Endpoints (Batch 15) ---

  async getCatchUpBrief(watchlistId: string): Promise<CatchUpResponse> {
    return this.request<CatchUpResponse>(`/watchlists/${watchlistId}/catch-up`);
  }

  async acknowledgeCatchUp(watchlistId: string): Promise<{ success: boolean; lastSeenAt: string }> {
    return this.request<{ success: boolean; lastSeenAt: string }>(`/watchlists/${watchlistId}/catch-up/acknowledge`, {
      method: 'POST',
    });
  }

  // --- Sparklines & Ghost Pins (Batch 16) ---

  async getWatchlistSparklines(watchlistId: string): Promise<WatchlistSparklinesResponse> {
    return this.request<WatchlistSparklinesResponse>(`/watchlists/${watchlistId}/sparklines`);
  }
}

export const api = new ApiClient();

