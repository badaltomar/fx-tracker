import { describe, expect, it } from 'vitest';
import { buildView, isForexWeekend, pickRate } from '../src/aggregate.js';
import type { SourceState } from '../src/poller.js';
import type { RateSource } from '../src/sources/types.js';

const MINUTE = 60_000;
const NOW = Date.parse('2026-11-04T12:00:00Z'); // a Wednesday

function state(id: string, kind: 'live' | 'daily', rates: Record<string, number>, ageMs: number): SourceState {
  const source: RateSource = { id, name: id, kind, intervalMs: MINUTE, fetch: async () => ({ rates, asOf: 0 }) };
  return {
    source,
    lastGood: { rates: { USD: 1, ...rates }, asOf: NOW - ageMs },
    lastAttemptAt: NOW,
    lastSuccessAt: NOW,
    consecutiveFailures: 0,
    nextAttemptAt: NOW,
  };
}

describe('pickRate', () => {
  it('prefers the freshest source and marks it confirmed when others agree', () => {
    const result = pickRate([
      { value: 0.9, asOf: NOW - 60 * MINUTE, source: 'daily' },
      { value: 0.905, asOf: NOW, source: 'live' },
    ]);
    expect(result).toMatchObject({ pick: { source: 'live', value: 0.905 }, agreement: 'confirmed' });
  });

  it('trusts two agreeing sources over one fresh outlier', () => {
    const result = pickRate([
      { value: 1.2, asOf: NOW, source: 'live' },
      { value: 0.9, asOf: NOW - 60 * MINUTE, source: 'a' },
      { value: 0.902, asOf: NOW - 60 * MINUTE, source: 'b' },
    ]);
    expect(result?.agreement).toBe('confirmed');
    expect(result?.pick.value).toBeCloseTo(0.901, 3);
  });

  it('keeps the freshest value but flags it when nothing can settle a disagreement', () => {
    const result = pickRate([
      { value: 1.2, asOf: NOW, source: 'live' },
      { value: 0.9, asOf: NOW - 60 * MINUTE, source: 'daily' },
    ]);
    expect(result).toMatchObject({ pick: { source: 'live' }, agreement: 'disagreement' });
  });
});

describe('buildView', () => {
  it('converts every rate to the requested base', () => {
    const view = buildView([state('live', 'live', { EUR: 0.9, INR: 90 }, 0)], 'EUR', NOW);
    const usd = view.rates.find((r) => r.currency === 'USD');
    const inr = view.rates.find((r) => r.currency === 'INR');
    expect(usd?.rate).toBeCloseTo(1.11111, 4);
    expect(inr?.rate).toBe(100);
  });

  it('falls back to daily data when the live source has nothing, and says so', () => {
    const live = state('live', 'live', {}, 0);
    live.lastGood = undefined;
    live.consecutiveFailures = 3;
    live.lastError = 'HTTP 503';
    const view = buildView([live, state('daily', 'daily', { EUR: 0.9, GBP: 0.75 }, 20 * 60 * MINUTE)], 'USD', NOW);

    expect(view.status).toBe('reference');
    expect(view.rates.map((r) => r.source)).toEqual(['daily', 'daily']);
    expect(view.sources[0]).toMatchObject({ status: 'failing', lastError: 'HTTP 503' });
  });

  it('reports delayed when the best data is between 5 and 60 minutes old', () => {
    const view = buildView([state('live', 'live', { EUR: 0.9, GBP: 0.75 }, 12 * MINUTE)], 'USD', NOW);
    expect(view.status).toBe('delayed');
    expect(view.rates[0]?.ageSeconds).toBe(720);
  });

  it('is unavailable only when no source has ever answered', () => {
    const empty = state('live', 'live', {}, 0);
    empty.lastGood = undefined;
    expect(buildView([empty], 'USD', NOW).status).toBe('unavailable');
  });
});

describe('isForexWeekend', () => {
  it('knows when the market is closed', () => {
    expect(isForexWeekend(new Date('2026-11-01T10:00:00Z'))).toBe(true); // Sunday morning
    expect(isForexWeekend(new Date('2026-11-01T22:00:00Z'))).toBe(false); // Sunday night, Asia open
    expect(isForexWeekend(new Date('2026-11-04T12:00:00Z'))).toBe(false); // Wednesday
  });
});
