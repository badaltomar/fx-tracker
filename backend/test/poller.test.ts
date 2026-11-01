import { describe, expect, it } from 'vitest';
import { Poller, retryDelay } from '../src/poller.js';
import { PremiumBudget } from '../src/premium.js';
import { SourceError, type RateSource } from '../src/sources/types.js';
import { buildView } from '../src/aggregate.js';

const silent = { info: () => undefined, warn: () => undefined };

describe('Poller', () => {
  it('keeps serving the last good data while a source is down', async () => {
    let up = true;
    const source: RateSource = {
      id: 'flaky',
      name: 'Flaky',
      kind: 'live',
      intervalMs: 60_000,
      fetch: async () => {
        if (!up) throw new SourceError('HTTP 503');
        return { rates: { USD: 1, EUR: 0.9 }, asOf: 1_000 };
      },
    };
    const poller = new Poller([source], silent);
    const state = poller.states[0]!;

    await poller.poll(state);
    up = false;
    await poller.poll(state);
    await poller.poll(state);

    expect(state.lastGood?.rates.EUR).toBe(0.9);
    expect(state.consecutiveFailures).toBe(2);
    expect(state.lastError).toBe('HTTP 503');
  });

  it('backs off on repeated failures and respects Retry-After', () => {
    const source = { intervalMs: 60_000 } as RateSource;
    expect(retryDelay({ source, consecutiveFailures: 1 }, new Error('x'))).toBe(30_000);
    expect(retryDelay({ source, consecutiveFailures: 3 }, new Error('x'))).toBe(120_000);
    expect(retryDelay({ source, consecutiveFailures: 10 }, new Error('x'))).toBe(15 * 60_000);
    expect(retryDelay({ source, consecutiveFailures: 1 }, new SourceError('HTTP 429', 600))).toBe(600_000);
  });
});

describe('PremiumBudget', () => {
  const NOW = Date.parse('2026-11-04T12:00:00Z');

  function viewWithAge(ageMinutes: number) {
    return buildView(
      [
        {
          source: { id: 'live', name: 'live', kind: 'live', intervalMs: 60_000, fetch: async () => ({ rates: {}, asOf: 0 }) },
          lastGood: { rates: { USD: 1, EUR: 0.9 }, asOf: NOW - ageMinutes * 60_000 },
          lastAttemptAt: NOW,
          consecutiveFailures: 0,
          nextAttemptAt: NOW,
        },
      ],
      'USD',
      NOW,
    );
  }

  it('spends only when free data is too old, and not twice in five minutes', async () => {
    const provider = { fetch: async () => ({ rates: { USD: 1, EUR: 0.91 }, asOf: NOW }) };
    const budget = new PremiumBudget(provider);

    expect(await budget.maybeRefresh(viewWithAge(2), NOW)).toBeNull();
    expect(await budget.maybeRefresh(viewWithAge(45), NOW)).not.toBeNull();
    expect(await budget.maybeRefresh(viewWithAge(45), NOW + 60_000)).toBeNull();
    expect(await budget.maybeRefresh(viewWithAge(45), NOW + 6 * 60_000)).not.toBeNull();
    expect(budget.status()).toMatchObject({ enabled: true, callsToday: 2, lastSpend: { reason: 'outage' } });
  });

  it('does not spend on a weekend outage, because rates do not move', () => {
    const sunday = Date.parse('2026-11-01T10:00:00Z');
    const view = { ...viewWithAge(45), marketClosed: true };
    expect(new PremiumBudget(null).reasonToSpend(view, sunday)).toBeNull();
  });
});
