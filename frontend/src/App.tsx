import { useCallback, useEffect, useState } from 'react';
import {
  SOURCE_NAMES,
  ageNow,
  cachedRates,
  fetchRates,
  formatAge,
  formatRate,
  type Rate,
  type RatesResponse,
} from './api';

const REFRESH_MS = 60_000;
const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SGD',
  'AED', 'HKD', 'NZD', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL', 'ZAR', 'THB',
  'KRW', 'TRY', 'PLN', 'IDR', 'MYR', 'PHP', 'SAR', 'ILS', 'CZK', 'HUF',
];

/** Where the data on screen came from: the server just now, or this browser's last copy. */
type Origin = 'server' | 'browser-cache';

export function App() {
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('INR');
  const [amount, setAmount] = useState('100');
  const [data, setData] = useState<RatesResponse | null>(() => cachedRates('USD'));
  const [origin, setOrigin] = useState<Origin>('browser-cache');
  const [unreachable, setUnreachable] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (base: string) => {
    try {
      const fresh = await fetchRates(base);
      setData(fresh);
      setOrigin('server');
      setUnreachable(false);
    } catch {
      // Keep whatever is on screen, or the browser's copy for this base, and say so.
      setData((current) => (current?.base === base ? current : (cachedRates(base) ?? current)));
      setOrigin('browser-cache');
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    setData((current) => (current?.base === from ? current : (cachedRates(from) ?? current)));
    void load(from);
    const timer = setInterval(() => void load(from), REFRESH_MS);
    return () => clearInterval(timer);
  }, [from, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const usable = data?.base === from ? data : null;
  const pair = usable?.rates.find((r) => r.currency === to);
  const value = Number(amount);

  return (
    <div className="page">
      <header className="masthead">
        <h1>FX Tracker</h1>
        <p>Exchange rates with the age of every number shown</p>
      </header>

      <StatusBanner data={usable} origin={origin} unreachable={unreachable} now={now} />

      <section className="card converter" aria-labelledby="converter-title">
        <h2 id="converter-title">Convert</h2>
        <div className="converter-row">
          <label className="field amount">
            <span>Amount</span>
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            />
          </label>
          <CurrencySelect id="from" label="From" value={from} onChange={setFrom} />
          <button
            type="button"
            className="swap"
            aria-label="Swap currencies"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            ⇄
          </button>
          <CurrencySelect id="to" label="To" value={to} onChange={setTo} />
        </div>

        {from === to ? (
          <p className="result">Pick two different currencies.</p>
        ) : pair && Number.isFinite(value) ? (
          <div className="result">
            <p className="result-value">
              {value.toLocaleString()} {from} = <strong>{formatRate(value * pair.rate)} {to}</strong>
            </p>
            <p className="result-meta">
              1 {from} = {formatRate(pair.rate)} {to} · <RateAge rate={pair} data={usable!} now={now} />
            </p>
            {pair.agreement === 'disagreement' && (
              <p className="warning">
                Our sources disagree on this rate right now. Treat it as approximate before a large transfer.
              </p>
            )}
          </div>
        ) : (
          <p className="result muted">{usable ? `No rate for ${to} right now.` : 'Loading rates...'}</p>
        )}
      </section>

      {usable && (
        <section className="card" aria-labelledby="table-title">
          <h2 id="table-title">1 {from} in other currencies</h2>
          <table className="rates">
            <thead>
              <tr>
                <th>Currency</th>
                <th className="num">Rate</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {usable.rates.map((rate) => (
                <tr key={rate.currency}>
                  <td>{rate.currency}</td>
                  <td className="num">{formatRate(rate.rate)}</td>
                  <td>
                    <RateAge rate={rate} data={usable} now={now} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {usable && <SourceList data={usable} now={now} />}

      <footer className="footer">
        Free rates are delayed by up to a few minutes. <span className="pro">Pro ($9/month)</span> adds real-time
        rates, guaranteed uptime and history.
      </footer>
    </div>
  );
}

function CurrencySelect(props: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

function RateAge({ rate, data, now }: { rate: Rate; data: RatesResponse; now: number }) {
  const age = ageNow(rate, data.generatedAt, now);
  const level = age <= 300 ? 'live' : age <= 3600 ? 'delayed' : 'reference';
  return (
    <span className={`age age-${level}`} title={`${SOURCE_NAMES[rate.source] ?? rate.source}, data from ${new Date(rate.asOf).toLocaleString()}`}>
      <span className="dot" aria-hidden="true" />
      {formatAge(age)} · {SOURCE_NAMES[rate.source] ?? rate.source}
    </span>
  );
}

/** One plain sentence about how much to trust what is on screen. Never a bare error. */
function StatusBanner(props: { data: RatesResponse | null; origin: Origin; unreachable: boolean; now: number }) {
  const { data, origin, unreachable, now } = props;

  if (!data) {
    return (
      <div className="banner info" role="status">
        {unreachable
          ? 'We are reconnecting to the rate service. Your rates will appear here as soon as it answers.'
          : 'Loading rates. On our free hosting the first load can take up to a minute.'}
      </div>
    );
  }

  const ages = data.rates.map((r) => ageNow(r, data.generatedAt, now));
  const newest = ages.length ? Math.min(...ages) : 0;
  const parts: { tone: string; text: string }[] = [];

  if (unreachable && origin === 'browser-cache') {
    const loadedAt = new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    parts.push({
      tone: 'warn',
      text: `We cannot reach the server right now. Showing the rates you last loaded at ${loadedAt}. Each rate shows how old it is.`,
    });
  } else if (data.status === 'live') {
    parts.push({ tone: 'ok', text: `Live rates, updated ${formatAge(newest)}.` });
  } else if (data.status === 'delayed') {
    parts.push({ tone: 'warn', text: `Our live source is slow right now. Showing rates from ${formatAge(newest)}. Pro members get real-time rates.` });
  } else {
    parts.push({ tone: 'warn', text: 'Our live source is down. Showing official end-of-day reference rates until it is back.' });
  }
  if (data.marketClosed) {
    parts.push({ tone: 'info', text: 'Forex markets are closed for the weekend, so rates barely move until Monday.' });
  }

  return (
    <div className="banners" role="status">
      {parts.map((p) => (
        <div key={p.text} className={`banner ${p.tone}`}>
          {p.text}
        </div>
      ))}
    </div>
  );
}

function SourceList({ data, now }: { data: RatesResponse; now: number }) {
  return (
    <details className="sources">
      <summary>Where these rates come from</summary>
      <ul>
        {data.sources.map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong> ({s.kind === 'live' ? 'updates every minute' : 'updates once a day'}):{' '}
            {s.status === 'failing'
              ? `not answering right now${s.dataAsOf ? `, using its data from ${formatAge((now - Date.parse(s.dataAsOf)) / 1000)}` : ''}`
              : s.dataAsOf
                ? `working, data from ${formatAge((now - Date.parse(s.dataAsOf)) / 1000)}`
                : 'starting up'}
          </li>
        ))}
      </ul>
      <p>
        We show the freshest rate and check it against the other sources. If one source is far off while the
        others agree, we use the others.
      </p>
    </details>
  );
}
