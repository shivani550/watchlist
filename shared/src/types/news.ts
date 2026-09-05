export interface NewsItem {
  id: string;
  symbol: string;
  headline: string;
  url: string;
  publishedAt: string; // ISO 8601
  providerId?: string | null;
  fetchedAt?: string;
}

export interface NewsIngestionResult {
  success: boolean;
  symbolsAttempted: number;
  newsItemsSaved: number;
  errors: Array<{ symbol: string; error: string }>;
  timestamp: string;
}

