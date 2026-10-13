export interface TMDBConfig {
  apiKey?: string;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

// Simple in-memory LRU-like TTL cache capped at 500 entries
class SimpleTTLCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxEntries = 500;
  private readonly defaultTtlMs = 10 * 60 * 1000; // 10 minutes

  get(key: string): unknown | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: unknown, ttlMs = this.defaultTtlMs): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }
}

const cache = new SimpleTTLCache();

export async function fetchTMDB(endpoint: string, queryParams: Record<string, string | number | undefined> = {}) {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error('TMDB API key is not configured on the server');
    (err as unknown as { status: number }).status = 503;
    throw err;
  }

  const isV4 = apiKey.startsWith('eyJ');
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);

  if (!isV4) {
    url.searchParams.set('api_key', apiKey);
  }

  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== undefined && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (isV4) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const errorText = await res.text();
    const err = new Error(`TMDB error: ${res.status} ${errorText}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }

  const data = await res.json();
  cache.set(cacheKey, data);
  return data;
}

export function extractTrailerKey(videos?: { results?: Array<{ site: string; type: string; key: string }> }): string | undefined {
  if (!videos?.results?.length) return undefined;
  const officialTrailer = videos.results.find(
    (v) => v.site === 'YouTube' && v.type === 'Trailer'
  );
  if (officialTrailer) return officialTrailer.key;
  const anyTrailer = videos.results.find((v) => v.site === 'YouTube');
  return anyTrailer?.key;
}
