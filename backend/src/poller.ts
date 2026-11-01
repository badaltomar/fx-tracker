import { FETCH_TIMEOUT_MS, RETRY } from './config.js';
import { SourceError, type RateSnapshot, type RateSource } from './sources/types.js';

export interface SourceState {
  source: RateSource;
  /** The last data that passed validation. Kept even while the source is failing. */
  lastGood?: RateSnapshot;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  consecutiveFailures: number;
  nextAttemptAt: number;
}

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * Polls every source on its own schedule, so user requests never wait on (or multiply calls to)
 * an upstream API. A failing source backs off and keeps serving its last good data.
 */
export class Poller {
  readonly states: SourceState[];
  private timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(
    sources: RateSource[],
    private readonly log: Logger,
    private readonly onUpdate: () => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.states = sources.map((source) => ({ source, consecutiveFailures: 0, nextAttemptAt: 0 }));
  }

  /** Starts polling. Resolves when every source has answered or failed once, so the first response is complete. */
  start(): Promise<void> {
    return Promise.all(this.states.map((state) => this.run(state))).then(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  /** Stores data bought from the premium provider so it competes with the free sources like any other. */
  acceptPremium(snapshot: RateSnapshot): void {
    let state = this.states.find((s) => s.source.id === 'premium');
    if (!state) {
      state = {
        source: { id: 'premium', name: 'Premium', kind: 'live', intervalMs: 0, fetch: () => Promise.reject() },
        consecutiveFailures: 0,
        nextAttemptAt: 0,
      };
      this.states.push(state);
    }
    state.lastGood = snapshot;
    state.lastSuccessAt = state.lastAttemptAt = this.now();
  }

  /** Runs one fetch for a source and schedules the next one. Exposed for tests. */
  async poll(state: SourceState): Promise<void> {
    state.lastAttemptAt = this.now();
    try {
      const snapshot = await state.source.fetch(AbortSignal.timeout(FETCH_TIMEOUT_MS));
      state.lastGood = snapshot;
      state.lastSuccessAt = this.now();
      state.lastError = undefined;
      state.consecutiveFailures = 0;
      state.nextAttemptAt = this.now() + state.source.intervalMs;
    } catch (err) {
      state.consecutiveFailures++;
      state.lastError = describe(err);
      state.nextAttemptAt = this.now() + retryDelay(state, err);
      this.log.warn(
        { source: state.source.id, failures: state.consecutiveFailures, error: state.lastError },
        'rate source failed, keeping last good data',
      );
    }
    this.onUpdate();
  }

  private async run(state: SourceState): Promise<void> {
    if (this.stopped) return;
    await this.poll(state);
    if (this.stopped) return;
    const delay = Math.max(0, state.nextAttemptAt - this.now());
    this.timers.set(state.source.id, setTimeout(() => void this.run(state), delay));
    // Resolves after the first poll; later polls run from the timer.
  }
}

/** Retries sooner than the normal interval at first, then backs off, and honours Retry-After. */
export function retryDelay(state: Pick<SourceState, 'consecutiveFailures' | 'source'>, err: unknown): number {
  const backoff = Math.min(RETRY.firstMs * 2 ** (state.consecutiveFailures - 1), RETRY.maxMs);
  const asked = err instanceof SourceError && err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : 0;
  return Math.max(backoff, asked);
}

function describe(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return `no answer within ${FETCH_TIMEOUT_MS / 1000}s`;
  return err instanceof Error ? err.message : String(err);
}
