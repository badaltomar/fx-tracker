import { PREMIUM } from './config.js';
import type { RatesView } from './aggregate.js';
import type { RateSnapshot } from './sources/types.js';

/**
 * The paid tier's provider. The task says to assume it exists, so there is no implementation here:
 * set PREMIUM_API_URL and PREMIUM_API_KEY and plug a real client in `createPremiumProvider`.
 */
export interface PremiumProvider {
  fetch(signal: AbortSignal): Promise<RateSnapshot>;
}

export type SpendReason = 'outage' | 'disagreement';

export interface PremiumStatus {
  enabled: boolean;
  dailyBudgetCalls: number;
  callsToday: number;
  lastSpend: { reason: SpendReason; at: string } | null;
}

/**
 * Decides when free users get a premium refresh. Because the cache is shared, one call improves the
 * data for everyone, so the budget only needs to cover moments when trust is at risk:
 * - outage: every free rate is older than 30 minutes while the market is open
 * - disagreement: sources disagree by more than 2% on a currency
 * Each reason is limited to one call per 5 minutes, so the worst case is about 576 calls a day,
 * well inside the 5,000 call budget.
 */
export class PremiumBudget {
  private day = '';
  private calls = 0;
  private lastByReason = new Map<SpendReason, number>();
  private last: PremiumStatus['lastSpend'] = null;

  constructor(
    private readonly provider: PremiumProvider | null,
    private readonly dailyCalls = PREMIUM.dailyCalls,
  ) {}

  /** Returns why a premium call is justified right now, or null. Does not spend anything. */
  reasonToSpend(view: RatesView, now: number): SpendReason | null {
    this.rollDay(now);
    if (this.calls >= this.dailyCalls) return null;

    const freshestAgeMs = Math.min(...view.rates.map((r) => r.ageSeconds * 1000), Infinity);
    const reason: SpendReason | null =
      !view.marketClosed && freshestAgeMs > PREMIUM.outageAfterMs
        ? 'outage'
        : view.rates.some((r) => r.agreement === 'disagreement')
          ? 'disagreement'
          : null;
    if (!reason) return null;

    const lastAt = this.lastByReason.get(reason) ?? 0;
    return now - lastAt >= PREMIUM.cooldownMs ? reason : null;
  }

  /** Calls the premium provider if one is configured and the policy allows it. */
  async maybeRefresh(view: RatesView, now: number): Promise<RateSnapshot | null> {
    if (!this.provider) return null;
    const reason = this.reasonToSpend(view, now);
    if (!reason) return null;

    this.calls++;
    this.lastByReason.set(reason, now);
    this.last = { reason, at: new Date(now).toISOString() };
    return this.provider.fetch(AbortSignal.timeout(5_000));
  }

  status(): PremiumStatus {
    return {
      enabled: this.provider !== null,
      dailyBudgetCalls: this.dailyCalls,
      callsToday: this.calls,
      lastSpend: this.last,
    };
  }

  private rollDay(now: number) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.calls = 0;
    }
  }
}

export function createPremiumProvider(): PremiumProvider | null {
  // No premium provider ships with this project. Wire one here when credentials exist.
  return null;
}
