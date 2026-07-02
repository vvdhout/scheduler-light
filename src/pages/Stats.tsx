import { useEffect, useState } from 'preact/hooks';

interface Totals { uniqueVisitors: number; home: number; shared: number; linkopen: number; booked: number }
interface Day { date: string; uv: number; home: number; shared: number; linkopen: number; booked: number }
interface Data {
  totals: Totals;
  conversions: { homeToShared: number; linkToBooked: number };
  daily: Day[];
}

export function Stats() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const key = location.hash.slice(1);
    if (!key) { setErr('Open this as /stats#YOUR-KEY'); return; }
    fetch(`/api/stats?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Not authorized (wrong or missing key).' : `Error ${r.status}`))))
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (err) return <main class="page center"><h1>Stats</h1><p class="muted">{err}</p></main>;
  if (!data) return <main class="page center muted">Loading…</main>;

  const t = data.totals, c = data.conversions;
  const rows: [string, string | number][] = [
    ['Unique visitors', t.uniqueVisitors],
    ['Homepage opens', t.home],
    ['Links shared', t.shared],
    ['Links opened (bookers)', t.linkopen],
    ['Slots booked', t.booked],
  ];

  return (
    <main class="page">
      <h1>Stats</h1>
      <div class="card">
        {rows.map(([label, val]) => (
          <div key={label} class="row spread"><span class="muted">{label}</span><strong>{val}</strong></div>
        ))}
      </div>
      <div class="card">
        <h3>Conversions</h3>
        <div class="row spread"><span class="muted">Homepage → link shared</span><strong>{c.homeToShared}%</strong></div>
        <div class="row spread"><span class="muted">Link opened → slot booked</span><strong>{c.linkToBooked}%</strong></div>
      </div>
      <div class="card">
        <h3>Last 14 days</h3>
        {data.daily.map((d) => (
          <div key={d.date} class="row spread small-text">
            <span class="muted">{d.date}</span>
            <span>{d.uv} uv · {d.home} home · {d.shared} shared · {d.linkopen} open · {d.booked} booked</span>
          </div>
        ))}
      </div>
    </main>
  );
}
