/** Currencies our users ask about most: travel, freelancing and small business corridors. */
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SGD',
  'AED', 'HKD', 'NZD', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL', 'ZAR', 'THB',
  'KRW', 'TRY', 'PLN', 'IDR', 'MYR', 'PHP', 'SAR', 'ILS', 'CZK', 'HUF',
] as const;

export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (value: string): value is Currency => (CURRENCIES as readonly string[]).includes(value);

const MINUTE = 60_000;

export const FRESHNESS = {
  /** A rate younger than this is shown as live. */
  liveMs: 5 * MINUTE,
  /** Up to this age it is "delayed"; older is shown as an end-of-day reference rate. */
  delayedMs: 60 * MINUTE,
};

/** Above this difference between sources we stop trusting a single source for that currency. */
export const DISAGREEMENT_THRESHOLD = 0.02;

/** Two or more other sources within this range of each other count as a consensus. */
export const CONSENSUS_SPREAD = 0.01;

export const FETCH_TIMEOUT_MS = 5_000;

export const RETRY = {
  firstMs: 30_000,
  maxMs: 15 * MINUTE,
};

export const PREMIUM = {
  /** $5/day at $0.001 per call. */
  dailyCalls: 5_000,
  /** Spend on an outage only when every free rate is older than this. */
  outageAfterMs: 30 * MINUTE,
  /** At most one premium call per reason in this window, however many users are online. */
  cooldownMs: 5 * MINUTE,
};
