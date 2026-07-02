import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv, methodIs, safe } from './_lib.js';

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// Protected metrics dashboard data. Guarded by ?key= === STATS_KEY (404 otherwise).
export default safe(async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return;
  const key = process.env.STATS_KEY?.trim();
  if (!key || req.query.key !== key) return res.status(404).json({ error: 'Not found' });

  const dates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const [home, shared, linkopen, booked, uv] = await Promise.all([
    kv.getNum('m:home'), kv.getNum('m:shared'), kv.getNum('m:linkopen'), kv.getNum('m:booked'), kv.pfcount('m:uv'),
  ]);
  const daily = await Promise.all(dates.map(async (date) => ({
    date,
    uv: await kv.pfcount(`m:uv:${date}`),
    home: await kv.getNum(`m:home:${date}`),
    shared: await kv.getNum(`m:shared:${date}`),
    linkopen: await kv.getNum(`m:linkopen:${date}`),
    booked: await kv.getNum(`m:booked:${date}`),
  })));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    totals: { uniqueVisitors: uv, home, shared, linkopen, booked },
    conversions: { homeToShared: pct(shared, home), linkToBooked: pct(booked, linkopen) },
    daily,
  });
});
