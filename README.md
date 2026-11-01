# FX Tracker

Exchange rates for the free tier that users can trust: always something on screen, and always clear about how old it is.

- Live app: `https://YOUR-FRONTEND.onrender.com`
- API: `https://YOUR-BACKEND.onrender.com/api/rates?base=USD`

Read [MY_APPROACH.md](MY_APPROACH.md) for the plan I wrote before coding, and [decisions.md](decisions.md) for the decisions and trade-offs.

## Initial thought process

My first reaction to the brief was that this is a trust problem more than a data problem. Users are not leaving because a rate is three minutes old. They leave when they see "Unable to fetch rates", or when a number looks wrong next to Google and nothing tells them why.

So I worked backwards from the screen:

1. **The page should never be empty.** That means the backend cannot depend on an upstream API answering during a user's request. A poller fetches every source on a schedule and the endpoint only reads from memory. That also solves the rate limits: 10,000 users cost the same upstream calls as one.
2. **Every number needs an age and a source next to it.** A 10-hour-old rate labeled "10 h ago, ExchangeRate-API" is fine. The same number with no label looks like a bug.
3. **One fresh source and two reliable slow ones.** I checked five free APIs. Only Coinbase was fresher than daily, so it became the primary, with ExchangeRate-API and the ECB as fallback and as a cross-check against bad data.
4. **The premium budget is about trust, not freshness.** One premium call refreshes the shared cache for every user, so the budget is big. Spending it on real-time free data would undercut the $9 plan, so it is reserved for outages and conflicting data.
5. **Ship small.** One endpoint, one page with a converter (the main job for travelers and freelancers) and a rate table. No accounts, history or charts today.

It was a Sunday while I built this, and the forex market is closed at weekends, so the UI says that too. A rate that does not move on a Sunday is correct, not stale.

## API

`GET /api/rates?base=USD` returns every supported currency against `base` (default `USD`, 30 currencies supported):

```json
{
  "base": "USD",
  "status": "live",
  "marketClosed": false,
  "generatedAt": "2026-11-04T12:00:00.000Z",
  "rates": [
    { "currency": "EUR", "rate": 0.894544, "source": "coinbase", "asOf": "2026-11-04T11:59:40.000Z",
      "ageSeconds": 20, "freshness": "live", "agreement": "confirmed" }
  ],
  "sources": [
    { "id": "coinbase", "name": "Coinbase", "kind": "live", "status": "ok",
      "dataAsOf": "2026-11-04T11:59:40.000Z", "lastSuccessAt": "2026-11-04T11:59:40.000Z", "lastError": null }
  ],
  "premium": { "enabled": false, "dailyBudgetCalls": 5000, "callsToday": 0, "lastSpend": null }
}
```

- `status`: `live` (under 5 minutes), `delayed` (under an hour), `reference` (end-of-day rates only).
- `freshness` and `agreement` are per currency. `agreement` is `confirmed`, `single-source` or `disagreement`.
- An unsupported `base` returns `400`. Only when no source has answered since a restart does it return `503` with `Retry-After`.

## Run it locally

You need Node 22 or newer.

```bash
# backend on http://localhost:3001
cd backend
npm install
npm run dev

# frontend on http://localhost:5173 (in a second terminal)
cd frontend
npm install
npm run dev
```

Tests:

```bash
cd backend
npm test
```

To see the degraded states, make sources fail on purpose:

```bash
cd backend
SIMULATE_DOWN=coinbase npm run dev                          # live source down
SIMULATE_DOWN=coinbase,open-er-api,frankfurter npm run dev  # everything down
```

## Project layout

```
backend/
  src/sources/      one file per provider, normalised to "units per 1 USD"
  src/poller.ts     polls each source on its own schedule, backs off, keeps last good data
  src/aggregate.ts  picks one rate per currency, cross-checks sources, computes freshness
  src/premium.ts    premium budget and the rule for when to spend it (provider not included)
  src/app.ts        GET /api/rates
  test/             unit tests for the logic above
frontend/
  src/App.tsx       converter, rate table, status banners, source list
  src/api.ts        API client and the browser's saved copy
MY_APPROACH.md      the plan, written before the code
decisions.md        decisions and trade-offs
render.yaml         deployment: API as a web service, frontend as a static site
```

## Deploy

On Render choose **New, Blueprint** and pick this repository. `render.yaml` creates the API (free web service) and the frontend (static site), and passes the API address to the frontend build.
