# Decisions

## Which APIs, and why

I tested five free, keyless APIs before choosing. All three I kept need no signup, which also means no key to leak or rotate.

| Source | Freshness | Why it is here |
|---|---|---|
| **Coinbase** public exchange rates | About 1 minute | The only free, keyless source I found that is fresher than daily. It is the primary. No timestamp in the payload, so I use the fetch time. |
| **ExchangeRate-API** (open.er-api.com) | Once a day, with a timestamp | Covers every currency we show and says exactly when it updated. Main fallback. |
| **European Central Bank** via Frankfurter | Once per working day (around 14:00 UTC) | Official reference rates. A trustworthy check for the majors. |

Cut: **fawazahmed0 currency-api** (daily, adds nothing the other two do not), **FloatRates** (daily and took 1.9 s to answer). Ruled out: any API that needs a key, including open exchange rates and Fixer, because "free tier" in this product should not depend on someone's personal API key.

We serve 30 currencies: the main travel, freelancing and small business corridors (USD, EUR, GBP, INR, JPY, AED, SGD and so on). Every source is normalised to "units per 1 USD", and any base is computed from that.

## Fallback strategy

1. **Requests never call an upstream API.** A poller fetches Coinbase every minute and the daily sources every hour, and keeps the results in memory. The endpoint reads from memory, so it answers in milliseconds, does not multiply calls by users (10,000 users cost one Coinbase call a minute), and keeps working while every upstream is down.
2. **A failing source keeps its last good data.** Each fetch has a 5 second timeout. After a failure the source is retried after 30 s, then 1, 2, 4 minutes and so on up to 15 minutes, and a `Retry-After` header is respected. Responses that do not parse, or that suddenly have fewer than 10 usable rates, count as failures, so a broken payload never replaces good data.
3. **Per currency, the freshest value wins.** If Coinbase is down, its last value keeps being used while it is fresh; once the daily sources are newer they take over automatically.
4. **The only hard failure** is right after a restart while all three sources are down. Then the endpoint returns `503` with `Retry-After`, and the frontend shows the browser's last saved copy.
5. **On startup** the server waits for the first round of fetches (each capped at 5 s) before taking requests, so the first answer after a deploy is complete.

## Conflicting data

For each currency:

- Take the freshest value and compare it with the median of the other sources.
- Within **2%**: show it, marked as confirmed.
- More than 2% off, and the other two agree with each other within 1%: **trust the two**. One fresh outlier against two agreeing sources is more likely a bad tick than a real move.
- More than 2% off with nothing to settle it: show the freshest, and the UI warns "Our sources disagree on this rate right now. Treat it as approximate before a large transfer."

2% is above normal daily movement for major currencies (usually well under 1%), so it catches broken data without flagging ordinary moves. Live and daily sources differ slightly all the time, and that is expected; the age shown next to each rate explains it.

## What the user sees

The page never shows a bare error. It always says how far to trust what is on screen:

| Situation | What the user sees |
|---|---|
| Normal | Green: "Live rates, updated just now." Each rate shows "just now · Coinbase". |
| Live source slow (data 5 to 60 minutes old) | Amber: "Our live source is slow right now. Showing rates from 14 min ago. Pro members get real-time rates." |
| Live source down | Amber: "Our live source is down. Showing official end-of-day reference rates until it is back." Every row says e.g. "10 h ago · ExchangeRate-API". |
| Our server unreachable | Amber: "We cannot reach the server right now. Showing the rates you last loaded at 3:52 PM." (from the browser's saved copy) |
| First visit, server asleep | Blue: "Loading rates. On our free hosting the first load can take up to a minute." |
| Weekend | Blue: "Forex markets are closed for the weekend, so rates barely move until Monday." |
| Sources disagree on a pair | Amber note under the converter result. |

Each rate has a coloured dot (green under 5 minutes, amber under an hour, grey older) plus its source, and hovering shows the exact time. A "Where these rates come from" section lists each source and whether it is working.

The Pro prompt only appears in the delayed state, at the moment the user feels the limit, and as one quiet line in the footer. It never blocks anything.

## Improving staleness

- Polling instead of fetching on demand: data is at most one poll interval old (about a minute), no matter how few users are online.
- A 1-minute live source, used first, with daily sources only as fallback.
- The frontend refreshes every 60 s, and the "updated X ago" labels keep ticking, so an open tab never shows an old age.
- Short HTTP caching (`max-age=15, stale-while-revalidate=60, stale-if-error=86400`), so browsers or a CDN can serve the last answer if the API is briefly unreachable.

## The premium budget ($5/day, about 5,000 calls)

Because the cache is shared, one premium call refreshes the data for every free user at once, so the budget is large. Spending it to keep free rates real-time all day would cost about $1.44/day and would remove the main reason to upgrade. So I spend it only when trust is at risk:

- **Outage:** every free rate is older than 30 minutes while the market is open.
- **Disagreement:** sources disagree by more than 2% on a currency.

Each reason is limited to one call per 5 minutes, so the worst case is about 576 calls ($0.58) a day. Nothing is spent at weekends, because rates do not move. The premium API is assumed and not implemented: `backend/src/premium.ts` has the budget, the rule and its tests, and is switched off until a provider is plugged into `createPremiumProvider`. The response reports `premium.enabled` and calls used today.

I did not spend budget on "high intent" users (for example someone converting a large amount). Per-user premium calls do not share well, and without accounts we cannot tell users apart. That is the first thing I would add with login.

## What I cut to ship today

- Accounts, the paid tier and any upgrade flow (the Pro prompt is text only).
- Historical data and charts.
- A persistent store. The cache lives in memory, so a restart starts from scratch (the 5 s startup fetch covers that).
- Rate alerts and notifications.
- A real premium integration.
- More than one backend instance. Polling state is per instance, which is fine at this traffic.
- End-to-end and frontend tests. The tests cover the logic that decides what users see: picking and cross-checking rates, freshness, fallback, backoff and the premium rule.

## What I would add with more time

1. Store snapshots (Postgres or Redis) so restarts and multiple instances share one cache, and use the same data for a 30-day history teaser on the free tier.
2. Track how often users see each state (live, delayed, reference, offline) and the Pro prompt click rate, to check the PM's hypothesis against conversion.
3. Spend premium calls on high-intent moments once we have accounts: large conversions, repeat visitors, the pricing page.
4. Alert the team when the live source has been failing for more than 10 minutes.
5. Use the 24-hour trend from the daily sources to show "up 0.4% since yesterday".

## Other thoughts

- Today is a Sunday, which is a good reminder that "stale" is not always a bug. Forex markets are closed at weekends, so the UI says so instead of making a flat rate look broken.
- The free Render backend sleeps after 15 minutes without traffic. I put the frontend on a separate static site, which never sleeps, so the page appears instantly, shows the last saved rates and says it is waking the server. A paid instance or a keep-alive ping would remove the wait. I did not add a ping, because it would use the free hours other projects on the same account share.
- `SIMULATE_DOWN=coinbase npm run dev` makes chosen sources fail, to show the degraded states locally.
