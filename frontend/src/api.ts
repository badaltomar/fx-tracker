export type Freshness = 'live' | 'delayed' | 'reference';
export type ServiceStatus = 'live' | 'delayed' | 'reference' | 'unavailable';

export interface Rate {
  currency: string;
  rate: number;
  source: string;
  asOf: string;
  ageSeconds: number;
  freshness: Freshness;
  agreement: 'confirmed' | 'single-source' | 'disagreement';
}

export interface SourceHealth {
  id: string;
  name: string;
  kind: 'live' | 'daily';
  status: 'ok' | 'failing' | 'starting';
  dataAsOf: string | null;
  lastError: string | null;
}

export interface RatesResponse {
  base: string;
  status: ServiceStatus;
  marketClosed: boolean;
  generatedAt: string;
  rates: Rate[];
  sources: SourceHealth[];
}

/** Render hands us the backend host without a scheme; local development uses the Vite proxy. */
const API_ORIGIN = (() => {
  const value = import.meta.env.VITE_API_URL as string | undefined;
  if (!value) return '';
  return value.startsWith('http') ? value : `https://${value}`;
})();

const cacheKey = (base: string) => `fx-rates:${base}`;

export async function fetchRates(base: string): Promise<RatesResponse> {
  const res = await fetch(`${API_ORIGIN}/api/rates?base=${encodeURIComponent(base)}`, {
    signal: AbortSignal.timeout(75_000), // a sleeping free server can take about a minute to wake up
  });
  const body = (await res.json().catch(() => null)) as RatesResponse | null;
  if (!res.ok || !body || body.status === 'unavailable') throw new Error(`rates unavailable (${res.status})`);
  try {
    localStorage.setItem(cacheKey(base), JSON.stringify(body));
  } catch {
    // Storage can be full or blocked; the page still works without it.
  }
  return body;
}

/** The last answer this browser received, used while the server is unreachable. */
export function cachedRates(base: string): RatesResponse | null {
  try {
    const raw = localStorage.getItem(cacheKey(base));
    return raw ? (JSON.parse(raw) as RatesResponse) : null;
  } catch {
    return null;
  }
}

/** Age of a rate right now, counting the time since the server reported it. */
export function ageNow(rate: Rate, generatedAt: string, now: number): number {
  return rate.ageSeconds + Math.max(0, (now - Date.parse(generatedAt)) / 1000);
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const SOURCE_NAMES: Record<string, string> = {
  coinbase: 'Coinbase',
  'open-er-api': 'ExchangeRate-API',
  frankfurter: 'European Central Bank',
  premium: 'Premium feed',
};

export function formatRate(value: number): string {
  const digits = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) });
}
