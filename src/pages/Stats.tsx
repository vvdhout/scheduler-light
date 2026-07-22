import { useEffect, useState } from 'preact/hooks';

interface Totals { uniqueVisitors: number; home: number; shared: number; linkopen: number; booked: number }
interface Day { date: string; uv: number; home: number; shared: number; linkopen: number; booked: number }
interface Data {
  range: string;
  totals: Totals;
  conversions: { homeToShared: number; linkToBooked: number };
  daily: Day[];
}

type Range = 'all' | '30' | '7';
const RANGES: [Range, string][] = [['all', 'All time'], ['30', '30 days'], ['7', '7 days']];

export function Stats() {
  const [range, setRange] = useState<Range>('all');
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const key = location.hash.slice(1);
    if (!key) { setErr('Open this as /stats#YOUR-KEY'); return; }
    setErr('');
    fetch(`/api/stats?key=${encodeURIComponent(key)}&range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Not authorized (wrong or missing key).' : `Error ${r.status}`))))
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'));
  }, [range]);

  const filter = (
    <div class="chips filter">
      {RANGES.map(([v, label]) => (
        <button key={v} class={`chip${range === v ? ' on' : ''}`} onClick={() => setRange(v)}>{label}</button>
      ))}
    </div>
  );

  if (err) return <main class="page center"><h1>Stats</h1><p class="muted">{err}</p></main>;

  const t = data?.totals;
  const rows: [string, string | number][] = [
    ['Unique visitors', t?.uniqueVisitors ?? '—'],
    ['Homepage opens', t?.home ?? '—'],
    ['Links shared', t?.shared ?? '—'],
    ['Links opened (bookers)', t?.linkopen ?? '—'],
    ['Slots booked', t?.booked ?? '—'],
  ];

  return (
    <main class="page">
      <h1>Stats</h1>
      {filter}
      {!data ? (
        <p class="muted">Loading…</p>
      ) : (
        <>
          <div class="card">
            {rows.map(([label, val]) => (
              <div key={label} class="row spread"><span class="muted">{label}</span><strong>{val}</strong></div>
            ))}
          </div>
          <div class="card">
            <h3>Conversions</h3>
            <div class="row spread"><span class="muted">Homepage → link shared</span><strong>{data.conversions.homeToShared}%</strong></div>
            <div class="row spread"><span class="muted">Link opened → slot booked</span><strong>{data.conversions.linkToBooked}%</strong></div>
          </div>
          <div class="card">
            <h3>{range === 'all' ? 'Last 30 days' : `Last ${range} days`}</h3>
            {data.daily.map((d) => (
              <div key={d.date} class="row spread small-text">
                <span class="muted">{d.date}</span>
                <span>{d.uv} uv · {d.home} home · {d.shared} shared · {d.linkopen} open · {d.booked} booked</span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
