import { CONSENSUS_SPREAD, CURRENCIES, DISAGREEMENT_THRESHOLD, FRESHNESS, type Currency } from './config.js';
import type { SourceState } from './poller.js';

export type Freshness = 'live' | 'delayed' | 'reference';
export type Agreement = 'confirmed' | 'single-source' | 'disagreement';
export type ServiceStatus = 'live' | 'delayed' | 'reference' | 'unavailable';

export interface Rate {
  currency: Currency;
  /** Units of `currency` per 1 unit of the base currency. */
  rate: number;
  source: string;
  asOf: string;
  ageSeconds: number;
  freshness: Freshness;
  /** confirmed: another source agrees within 2%. disagreement: sources differ; see decisions.md. */
  agreement: Agreement;
}

export interface SourceHealth {
  id: string;
  name: string;
  kind: 'live' | 'daily';
  status: 'ok' | 'failing' | 'starting';
  dataAsOf: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface RatesView {
  base: Currency;
  status: ServiceStatus;
  marketClosed: boolean;
  generatedAt: string;
  rates: Rate[];
  sources: SourceHealth[];
}

interface Candidate {
  value: number;
  asOf: number;
  source: string;
}

export function freshnessOf(ageMs: number): Freshness {
  if (ageMs <= FRESHNESS.liveMs) return 'live';
  if (ageMs <= FRESHNESS.delayedMs) return 'delayed';
  return 'reference';
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const relativeDiff = (a: number, b: number) => Math.abs(a - b) / b;

/**
 * Picks one rate per currency:
 * 1. Prefer the freshest source.
 * 2. Check it against the others. Within 2%: confirmed.
 * 3. More than 2% off while two or more other sources agree with each other: trust that consensus.
 * 4. More than 2% off with nothing to settle it: keep the freshest and mark it as disputed.
 */
export function pickRate(candidates: Candidate[]): { pick: Candidate; agreement: Agreement } | null {
  if (candidates.length === 0) return null;
  const [freshest, ...others] = [...candidates].sort((a, b) => b.asOf - a.asOf);
  if (others.length === 0) return { pick: freshest!, agreement: 'single-source' };

  const otherValues = others.map((c) => c.value);
  const reference = median(otherValues);
  if (relativeDiff(freshest!.value, reference) <= DISAGREEMENT_THRESHOLD) {
    return { pick: freshest!, agreement: 'confirmed' };
  }

  const othersAgree =
    others.length >= 2 && relativeDiff(Math.max(...otherValues), Math.min(...otherValues)) <= CONSENSUS_SPREAD;
  if (othersAgree) {
    const closest = others.reduce((best, c) =>
      relativeDiff(c.value, reference) < relativeDiff(best.value, reference) ? c : best,
    );
    return { pick: { ...closest, value: reference }, agreement: 'confirmed' };
  }
  return { pick: freshest!, agreement: 'disagreement' };
}

/** The forex market closes Friday evening New York time and reopens Sunday evening. */
export function isForexWeekend(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return (day === 5 && hour >= 21) || day === 6 || (day === 0 && hour < 21);
}

export function buildView(states: SourceState[], base: Currency, now: number): RatesView {
  const rates: Rate[] = [];

  for (const currency of CURRENCIES) {
    if (currency === base) continue;
    const candidates: Candidate[] = [];
    for (const { source, lastGood } of states) {
      const quote = lastGood?.rates[currency];
      const basePerUsd = lastGood?.rates[base];
      if (lastGood && quote && basePerUsd) {
        candidates.push({ value: quote / basePerUsd, asOf: lastGood.asOf, source: source.id });
      }
    }
    const result = pickRate(candidates);
    if (!result) continue;

    const ageMs = Math.max(0, now - result.pick.asOf);
    rates.push({
      currency,
      rate: Number(result.pick.value.toPrecision(6)),
      source: result.pick.source,
      asOf: new Date(result.pick.asOf).toISOString(),
      ageSeconds: Math.round(ageMs / 1000),
      freshness: freshnessOf(ageMs),
      agreement: result.agreement,
    });
  }

  return {
    base,
    status: overallStatus(rates),
    marketClosed: isForexWeekend(new Date(now)),
    generatedAt: new Date(now).toISOString(),
    rates,
    sources: states.map(health),
  };
}

/** The page shows one status, taken from the freshest data most currencies have. */
function overallStatus(rates: Rate[]): ServiceStatus {
  if (rates.length === 0) return 'unavailable';
  const share = (f: Freshness) => rates.filter((r) => r.freshness === f).length / rates.length;
  if (share('live') >= 0.8) return 'live';
  if (share('live') + share('delayed') >= 0.8) return 'delayed';
  return 'reference';
}

function health(state: SourceState): SourceHealth {
  const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null);
  return {
    id: state.source.id,
    name: state.source.name,
    kind: state.source.kind,
    status: state.lastAttemptAt === undefined ? 'starting' : state.consecutiveFailures > 0 ? 'failing' : 'ok',
    dataAsOf: iso(state.lastGood?.asOf),
    lastSuccessAt: iso(state.lastSuccessAt),
    lastError: state.lastError ?? null,
  };
}
