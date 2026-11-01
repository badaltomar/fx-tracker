import { CURRENCIES } from '../config.js';

/** Units of each currency per 1 USD, as published by one provider at one point in time. */
export interface RateSnapshot {
  rates: Partial<Record<string, number>>;
  /** When the provider says the data is from. Falls back to fetch time if it does not say. */
  asOf: number;
}

export interface RateSource {
  id: string;
  name: string;
  /** live: updates within minutes. daily: one update per business day. */
  kind: 'live' | 'daily';
  /** How often to poll after a successful fetch. */
  intervalMs: number;
  fetch(signal: AbortSignal): Promise<RateSnapshot>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    /** Seconds the provider asked us to wait (from Retry-After), if any. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new SourceError(`HTTP ${res.status}`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
  return res.json();
}

/**
 * Keeps only the currencies we serve, and only values that make sense. A provider that suddenly
 * returns too few usable rates is treated as failing, so we keep its last good data instead.
 */
export function cleanRates(raw: Record<string, unknown>, minimum = 10): Partial<Record<string, number>> {
  const rates: Partial<Record<string, number>> = { USD: 1 };
  for (const currency of CURRENCIES) {
    const value = Number(raw[currency] ?? raw[currency.toLowerCase()]);
    if (Number.isFinite(value) && value > 0) rates[currency] = value;
  }
  if (Object.keys(rates).length < minimum) {
    throw new SourceError(`only ${Object.keys(rates).length} usable rates in the response`);
  }
  return rates;
}
