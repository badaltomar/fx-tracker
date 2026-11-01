import { buildApp } from './app.js';
import { buildView } from './aggregate.js';
import { Poller } from './poller.js';
import { PremiumBudget, createPremiumProvider } from './premium.js';
import { SOURCES } from './sources/index.js';
import { SourceError, type RateSource } from './sources/types.js';

const premium = new PremiumBudget(createPremiumProvider());

// SIMULATE_DOWN=coinbase,frankfurter makes those sources fail, to see the degraded states locally.
const simulatedDown = new Set((process.env.SIMULATE_DOWN ?? '').split(',').filter(Boolean));
const sources: RateSource[] = SOURCES.map((source) =>
  simulatedDown.has(source.id)
    ? { ...source, fetch: async () => Promise.reject(new SourceError('simulated outage (SIMULATE_DOWN)')) }
    : source,
);

const log = {
  info: (obj: object, msg: string) => app.log.info(obj, msg),
  warn: (obj: object, msg: string) => app.log.warn(obj, msg),
};

const poller = new Poller(sources, log, () => {
  // After each poll, check whether this is a moment worth a premium call. Nothing is spent unless
  // a premium provider is configured.
  const now = Date.now();
  premium
    .maybeRefresh(buildView(poller.states, 'USD', now), now)
    .then((snapshot) => snapshot && poller.acceptPremium(snapshot))
    .catch((err: unknown) => log.warn({ err }, 'premium refresh failed'));
});

const app = await buildApp({ poller, premium });
// Wait for the first round of fetches (each has a 5 s timeout) so the first answer after a restart is complete.
await poller.start();
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });

async function shutdown() {
  poller.stop();
  await app.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
