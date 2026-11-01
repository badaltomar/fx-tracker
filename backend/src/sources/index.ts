import { SourceError, cleanRates, getJson, type RateSource } from './types.js';

const MINUTE = 60_000;

/**
 * Coinbase public exchange rates. No key, refreshed about every minute, includes fiat currencies.
 * The payload has no timestamp, so the fetch time is used as the data time.
 */
export const coinbase: RateSource = {
  id: 'coinbase',
  name: 'Coinbase',
  kind: 'live',
  intervalMs: MINUTE,
  async fetch(signal) {
    const body = (await getJson('https://api.coinbase.com/v2/exchange-rates?currency=USD', signal)) as {
      data?: { currency?: string; rates?: Record<string, unknown> };
    };
    if (body.data?.currency !== 'USD' || !body.data.rates) throw new SourceError('unexpected response shape');
    return { rates: cleanRates(body.data.rates), asOf: Date.now() };
  },
};

/** ExchangeRate-API open access. No key, about 160 currencies, updated once a day with a timestamp. */
export const openErApi: RateSource = {
  id: 'open-er-api',
  name: 'ExchangeRate-API',
  kind: 'daily',
  intervalMs: 60 * MINUTE,
  async fetch(signal) {
    const body = (await getJson('https://open.er-api.com/v6/latest/USD', signal)) as {
      result?: string;
      time_last_update_unix?: number;
      rates?: Record<string, unknown>;
    };
    if (body.result !== 'success' || !body.rates || !body.time_last_update_unix) {
      throw new SourceError('unexpected response shape');
    }
    return { rates: cleanRates(body.rates), asOf: body.time_last_update_unix * 1000 };
  },
};

/**
 * European Central Bank reference rates through Frankfurter. No key, about 30 currencies,
 * published once per working day around 16:00 CET (14:00 UTC).
 */
export const frankfurter: RateSource = {
  id: 'frankfurter',
  name: 'European Central Bank',
  kind: 'daily',
  intervalMs: 60 * MINUTE,
  async fetch(signal) {
    const body = (await getJson('https://api.frankfurter.dev/v1/latest?base=USD', signal)) as {
      base?: string;
      date?: string;
      rates?: Record<string, unknown>;
    };
    if (body.base !== 'USD' || !body.rates || !body.date) throw new SourceError('unexpected response shape');
    return { rates: cleanRates(body.rates), asOf: Date.parse(`${body.date}T14:00:00Z`) };
  },
};

export const SOURCES: RateSource[] = [coinbase, openErApi, frankfurter];
