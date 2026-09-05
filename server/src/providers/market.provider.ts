import { Quote, HistoricalDataPoint, FreshnessState } from '@watchlist/shared';
import { env } from '../config/env.js';

export interface MarketDataProvider {
  getLatestQuotes(symbols: string[]): Promise<Quote[]>;
  getHistoricalData(symbol: string, range?: string): Promise<HistoricalDataPoint[]>;
}

interface MockStockProfile {
  name: string;
  sector: string;
  basePrice: number;
  volatility: number;
}

const KNOWN_PROFILES: Record<string, MockStockProfile> = {
  RELIANCE: { name: 'Reliance Industries Ltd.', sector: 'Energy & Petrochemicals', basePrice: 2950.5, volatility: 1.5 },
  TCS: { name: 'Tata Consultancy Services Ltd.', sector: 'Information Technology', basePrice: 4180.0, volatility: 1.2 },
  INFY: { name: 'Infosys Ltd.', sector: 'Information Technology', basePrice: 1870.25, volatility: 1.8 },
  HDFCBANK: { name: 'HDFC Bank Ltd.', sector: 'Banking & Financial Services', basePrice: 1640.0, volatility: 1.1 },
  ICICIBANK: { name: 'ICICI Bank Ltd.', sector: 'Banking & Financial Services', basePrice: 1220.75, volatility: 1.3 },
  AAPL: { name: 'Apple Inc.', sector: 'Technology', basePrice: 228.5, volatility: 1.4 },
  MSFT: { name: 'Microsoft Corporation', sector: 'Technology', basePrice: 425.2, volatility: 1.3 },
  GOOG: { name: 'Alphabet Inc.', sector: 'Technology', basePrice: 175.8, volatility: 1.6 },
  NVDA: { name: 'NVIDIA Corporation', sector: 'Semiconductors', basePrice: 124.0, volatility: 2.5 },
  TSLA: { name: 'Tesla Inc.', sector: 'Automotive & Energy', basePrice: 215.4, volatility: 3.0 },
};

export class MockMarketDataProvider implements MarketDataProvider {
  private callCount = 0;
  private fetchedSymbolsLog: string[][] = [];
  private simulatedFailures: Map<string, Error> = new Map();
  private globalFailure: Error | null = null;
  private customFreshness: Map<string, FreshnessState> = new Map();

  async getLatestQuotes(symbols: string[]): Promise<Quote[]> {
    this.callCount++;
    this.fetchedSymbolsLog.push([...symbols]);

    if (this.globalFailure) {
      throw this.globalFailure;
    }

    const quotes: Quote[] = [];

    for (const rawSymbol of symbols) {
      const symbol = rawSymbol.toUpperCase().trim();

      if (this.simulatedFailures.has(symbol)) {
        throw this.simulatedFailures.get(symbol)!;
      }

      quotes.push(this.generateQuote(symbol));
    }

    return quotes;
  }

  async getHistoricalData(symbol: string, _range = '30d'): Promise<HistoricalDataPoint[]> {
    const sym = symbol.toUpperCase().trim();
    if (this.globalFailure) {
      throw this.globalFailure;
    }
    if (this.simulatedFailures.has(sym)) {
      throw this.simulatedFailures.get(sym)!;
    }

    const profile = this.getProfile(sym);
    const points: HistoricalDataPoint[] = [];
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const days = 30;

    let runningPrice = profile.basePrice * 0.95;

    for (let i = days; i >= 0; i--) {
      const time = new Date(now - i * oneDayMs);
      // Deterministic pseudo-random variation based on symbol + day offset
      const seed = this.hashString(`${sym}_day_${i}`);
      const deltaPercent = ((seed % 400) - 195) / 10000; // -1.95% to +2.05%
      runningPrice = Math.max(1, runningPrice * (1 + deltaPercent));

      points.push({
        timestamp: time.toISOString(),
        price: parseFloat(runningPrice.toFixed(2))
      });
    }

    return points;
  }

  // --- Testing & Configuration Helpers ---

  setSymbolFailure(symbol: string, fail: boolean): void {
    const sym = symbol.toUpperCase().trim();
    if (fail) {
      this.simulatedFailures.set(sym, new Error(`Simulated market provider failure for ${sym}`));
    } else {
      this.simulatedFailures.delete(sym);
    }
  }

  setSimulateRateLimit(rateLimit: boolean): void {
    if (rateLimit) {
      this.globalFailure = new Error('Simulated rate limit exceeded (HTTP 429)');
    } else {
      this.globalFailure = null;
    }
  }

  setSimulatedFailure(symbol: string, error: Error | null): void {
    const sym = symbol.toUpperCase().trim();
    if (error) {
      this.simulatedFailures.set(sym, error);
    } else {
      this.simulatedFailures.delete(sym);
    }
  }

  setGlobalFailure(error: Error | null): void {
    this.globalFailure = error;
  }

  setCustomFreshness(symbol: string, state: FreshnessState | null): void {
    const sym = symbol.toUpperCase().trim();
    if (state) {
      this.customFreshness.set(sym, state);
    } else {
      this.customFreshness.delete(sym);
    }
  }

  getCallCount(): number {
    return this.callCount;
  }

  getFetchedSymbolsLog(): string[][] {
    return this.fetchedSymbolsLog;
  }

  resetMetrics(): void {
    this.callCount = 0;
    this.fetchedSymbolsLog = [];
    this.simulatedFailures.clear();
    this.globalFailure = null;
    this.customFreshness.clear();
  }

  // --- Internal Utilities ---

  private getProfile(symbol: string): MockStockProfile {
    if (KNOWN_PROFILES[symbol]) {
      return KNOWN_PROFILES[symbol];
    }
    // Deterministic fallback profile for arbitrary unknown symbols
    const hash = this.hashString(symbol);
    const basePrice = 50 + (hash % 2000);
    return {
      name: `${symbol} Corporation`,
      sector: 'General Equities',
      basePrice,
      volatility: 1.5
    };
  }

  private generateQuote(symbol: string): Quote {
    const profile = this.getProfile(symbol);
    const hash = this.hashString(`${symbol}_${new Date().toISOString().slice(0, 13)}`); // changes hourly
    const changePercent = ((hash % 800) - 380) / 100; // -3.8% to +4.2%
    const change = parseFloat(((profile.basePrice * changePercent) / 100).toFixed(2));
    const price = parseFloat((profile.basePrice + change).toFixed(2));
    const freshnessState = this.customFreshness.get(symbol) ?? 'FRESH';

    return {
      symbol,
      name: profile.name,
      sector: profile.sector,
      price,
      change,
      changePercent: parseFloat(changePercent.toFixed(2)),
      freshnessState,
      timestamp: new Date().toISOString()
    };
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}

export const mockMarketDataProvider = new MockMarketDataProvider();
let activeMarketDataProvider: MarketDataProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (activeMarketDataProvider) {
    return activeMarketDataProvider;
  }
  // If credentials are provided for a real provider in future batches, instantiate it here.
  // When unavailable, default strictly to MockMarketDataProvider.
  if (env.MARKET_DATA_API_KEY && env.MARKET_DATA_API_KEY.trim().length > 0) {
    // Live provider adapter placeholder
    return mockMarketDataProvider;
  }
  return mockMarketDataProvider;
}

export function setMarketDataProvider(provider: MarketDataProvider): void {
  activeMarketDataProvider = provider;
}
