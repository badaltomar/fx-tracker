import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { CURRENCIES, isCurrency } from './config.js';
import { buildView } from './aggregate.js';
import type { Poller } from './poller.js';
import type { PremiumBudget } from './premium.js';

export async function buildApp({
  poller,
  premium,
  logger = true,
}: {
  poller: Poller;
  premium: PremiumBudget;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  // Public, read-only data: any site may read it.
  await app.register(cors, { origin: '*', methods: ['GET'] });

  /**
   * The one endpoint. It never calls an upstream API itself; it reads what the poller already has,
   * so it answers instantly and keeps working while sources are down.
   */
  app.get<{ Querystring: { base?: string } }>('/api/rates', async (request, reply) => {
    const base = (request.query.base ?? 'USD').toUpperCase();
    if (!isCurrency(base)) {
      return reply.status(400).send({ error: `Unsupported base currency. Use one of: ${CURRENCIES.join(', ')}` });
    }

    const view = buildView(poller.states, base, Date.now());
    const body = { ...view, premium: premium.status() };

    if (view.status === 'unavailable') {
      // Only possible right after a restart while every source is down.
      return reply
        .status(503)
        .header('retry-after', '30')
        .send({ ...body, message: 'Rates are not available yet. Retrying automatically.' });
    }

    // Let browsers and CDNs reuse a response briefly, and fall back to it if we are unreachable.
    reply.header('cache-control', 'public, max-age=15, stale-while-revalidate=60, stale-if-error=86400');
    return body;
  });

  return app;
}
