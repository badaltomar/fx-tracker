# My approach

Written before writing any code.

## What problem are we actually solving?

Free users leave because they stop trusting the numbers, not because the numbers are a few minutes old. Two things break that trust today:

1. **"Unable to fetch rates."** An empty screen is the worst thing we can show. Someone checking a rate before paying a hotel bill does not care that an upstream API is rate limited.
2. **Silently old data.** A rate that is 45 minutes old, shown as if it were current, looks wrong next to Google. The user concludes the app is broken.

So the goal for the free tier is: **always show a rate, and always say honestly how old it is and where it came from.** Fresh enough for a traveler or freelancer means minutes, not seconds. Seconds-level data stays a paid feature.

## Who uses it and what they need

- **Traveler:** "How much is 5,000 THB in my money?" Needs a quick converter and a believable number.
- **Freelancer:** "How much will my $2,000 invoice be in INR?" Checks a few pairs, cares about accuracy at the moment of invoicing.
- **Small business:** checks a handful of currencies regularly. Most likely to pay for history and real-time data.

The converter is the main job. A full rate table is secondary.

## The plan

### 1. Never call upstream APIs on a user request

The current product (as described) fetches rates per request, which multiplies calls by users and turns every upstream hiccup into a user-facing error. Instead the backend polls each source on its own schedule and keeps the results in memory. Requests are answered from memory instantly. 10,000 users cost the same number of upstream calls as 1 user.

### 2. Use several free sources with different strengths

- A **live source** (Coinbase public rates, no key, about a minute fresh) polled every minute.
- Two **daily sources** (open.er-api.com and the ECB via Frankfurter) polled every hour. They are slower but very reliable, and they let us sanity-check the live source.

If the live source is down we keep serving its last good value, and when that gets too old we fall back to the daily sources. The user sees the age either way.

### 3. Be honest in the UI

Every rate carries its age and source. The page shows one clear status:

- **Live:** updated within the last 5 minutes.
- **Delayed:** live source is having trouble; showing data from N minutes ago.
- **Daily reference:** only end-of-day rates are available right now.

Old data is labeled, never hidden, and never shown as "error". On weekends the forex market is closed, so we say that instead of making users wonder why nothing moves.

### 4. Spend the premium budget where it buys trust

$5/day is about 5,000 premium calls. Because the cache is shared, one premium call improves the data for **every** free user at once, so the budget is large in practice. But spending it all on keeping free data real-time would remove the main reason to upgrade. I will spend it only at moments where trust is at risk:

- **Outage:** every free source is down or older than 30 minutes.
- **Disagreement:** the live source and the daily sources disagree by more than 2% for a currency.

The premium API is assumed to exist and is not implemented, so this is a budget tracker plus a decision rule, switched off unless a premium endpoint is configured.

### 5. Keep it small enough to ship today

One backend endpoint (`GET /api/rates?base=USD`), one React page with a converter and a rate table, deployed on Render. Cut: accounts, history, charts, persistence across restarts, alerts.

## How I will know it worked (if this were live)

- "Unable to fetch rates" errors drop to near zero (the page always has something to show).
- Support tickets about wrong or stale rates go down.
- Share of sessions that see "Live" status.
- Click-through on the "real-time with Pro" prompt shown next to delayed data.
- Free to paid conversion, compared with the 2% baseline.
