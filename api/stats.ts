import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv, methodIs, safe } from './_lib.js';

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

interface DayRow { date: string; uv: number; home: number; shared: number; linkopen: number; booked: number }

// Protected metrics dashboard data. Guarded by ?key= === STATS_KEY (404 otherwise).
// ?range=all|30|7 — 'all' uses lifetime counters; 7/30 sum the daily buckets and
// merge the daily HyperLogLogs (PFCOUNT union) for a true deduped visitor count.
export default safe(async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return;
  const key = process.env.STATS_KEY?.trim();
  if (!key || req.query.key !== key) return res.status(404).json({ error: 'Not found' });

  const range: 'all' | 7 | 30 = req.query.range === '7' ? 7 : req.query.range === '30' ? 30 : 'all';
  const trendDays = range === 'all' ? 30 : range; // rolling window we return per-day

  const dates: string[] = [];
  for (let i = 0; i < trendDays; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const daily: DayRow[] = await Promise.all(dates.map(async (date) => ({
    date,
    uv: await kv.pfcount(`m:uv:${date}`),
    home: await kv.getNum(`m:home:${date}`),
    shared: await kv.getNum(`m:shared:${date}`),
    linkopen: await kv.getNum(`m:linkopen:${date}`),
    booked: await kv.getNum(`m:booked:${date}`),
  })));

  let totals: { uniqueVisitors: number; home: number; shared: number; linkopen: number; booked: number };
  if (range === 'all') {
    const [home, shared, linkopen, booked, uv] = await Promise.all([
      kv.getNum('m:home'), kv.getNum('m:shared'), kv.getNum('m:linkopen'), kv.getNum('m:booked'), kv.pfcount('m:uv'),
    ]);
    totals = { uniqueVisitors: uv, home, shared, linkopen, booked };
  } else {
    const sum = (f: (d: DayRow) => number) => daily.reduce((n, d) => n + f(d), 0);
    totals = {
      uniqueVisitors: await kv.pfcount(...daily.map((d) => `m:uv:${d.date}`)),
      home: sum((d) => d.home),
      shared: sum((d) => d.shared),
      linkopen: sum((d) => d.linkopen),
      booked: sum((d) => d.booked),
    };
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    range: range === 'all' ? 'all' : String(range),
    totals,
    conversions: {
      homeToShared: pct(totals.shared, totals.home),
      linkToBooked: pct(totals.booked, totals.linkopen),
    },
    daily,
  });
});
