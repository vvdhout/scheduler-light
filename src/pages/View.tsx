import { useEffect, useMemo, useState } from 'preact/hooks';
import { CalButtons } from '../components/CalButtons';
import { DayCalendar } from '../components/DayCalendar';
import { OverlayBar } from '../components/OverlayBar';
import { adminGet, adminUnbook, adminUpdate, ApiError, bookSlot, getEvent } from '../lib/api';
import {
  cellsToWindows, DEFAULTS, freeSegments, HORIZON_DAYS, nowMin, windowsToCells,
  type Booking, type Win,
} from '../lib/model';
import { ownerToken } from '../lib/store';
import { fmtFull, fmtTime, localDayStarts } from '../lib/time';

export function View({ id }: { id: string }) {
  const token = ownerToken(id);
  const isOwner = token != null;
  const [state, setState] = useState<'loading' | 'gone' | 'error' | 'locked' | 'ready'>('loading');

  const [busy, setBusy] = useState<Win[]>([]);
  const days = localDayStarts(HORIZON_DAYS);
  const weekFrom = days[0]!;
  const weekTo = weekFrom + HORIZON_DAYS * 1440;

  // owner
  const [cells, setCells] = useState<Set<number>>(new Set());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // visitor
  const [windows, setWindows] = useState<Win[]>([]);
  const [blocked, setBlocked] = useState<Win[]>([]);
  const [sel, setSel] = useState<Win | null>(null);
  const [claimed, setClaimed] = useState<Win | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (token) {
          try {
            const rec = await adminGet(id, token);
            if (rec.enc) return setState('locked');
            const live = (rec.windows ?? []).map(([s, e]): Win => [Math.max(s, nowMin() - (nowMin() % 30)), e]).filter(([s, e]) => s < e);
            setCells(windowsToCells(live, 30));
            setBookings(rec.bookings ?? []);
            return setState('ready');
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) return setState('gone');
          }
        }
        const ev = await getEvent(id);
        if (ev.enc) return setState('locked');
        setWindows(ev.windows);
        setBlocked(ev.blocked);
        setState('ready');
      } catch (e) {
        setState(e instanceof ApiError && e.status === 404 ? 'gone' : 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const segments = useMemo(() => freeSegments(windows, blocked, nowMin()), [windows, blocked]);

  if (state === 'loading') return <main class="page center muted">Loading…</main>;
  if (state === 'gone')
    return <main class="page center"><h1>This link has expired</h1><p class="muted">Ask for a fresh one.</p></main>;
  if (state === 'locked')
    return <main class="page center"><h1>Password-protected</h1><p class="muted">This page was made with the full version and needs its password.</p></main>;
  if (state === 'error')
    return <main class="page center"><h1>Something went wrong</h1><p class="muted">Try again in a moment.</p></main>;

  // ---- owner ----------------------------------------------------------------
  if (isOwner) {
    const save = async () => {
      setErr('');
      setSaved(false);
      setSaving(true);
      try {
        const core = { name: '', event: '', durationMin: 30, stepMin: DEFAULTS.stepMin, windows: cellsToWindows(cells, 30) };
        await adminUpdate(id, token!, { enc: false, core });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    };
    const release = async (b: Booking) => {
      await adminUnbook(id, token!, b);
      setBookings((bs) => bs.filter((x) => !(x.start === b.start && x.at === b.at)));
    };
    const upcoming = bookings.filter((b) => b.end > nowMin()).sort((a, b) => a.start - b.start);

    return (
      <main class="page app">
        <header class="app-head">
          <p class="app-hint">Your availability — adjust it or see what’s grabbed.</p>
          <OverlayBar fromMin={weekFrom} toMin={weekTo} onBusy={setBusy} />
        </header>

        <DayCalendar days={days} mode="paint" cells={cells} onChange={setCells} busy={busy} booked={upcoming.map((b): Win => [b.start, b.end])} />

        {upcoming.length > 0 && (
          <div class="grabbed">
            {upcoming.map((b) => (
              <div key={`${b.start}:${b.at}`} class="row spread">
                <span class="small-text">{fmtFull(b.start)} – {fmtTime(b.end)}</span>
                <button type="button" class="ghost small danger" onClick={() => release(b)}>release</button>
              </div>
            ))}
          </div>
        )}

        {err && <p class="error">{err}</p>}
        <button type="button" class="fab" disabled={saving} onClick={save}>
          {saving ? '…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </main>
    );
  }

  // ---- visitor --------------------------------------------------------------
  if (claimed) {
    return (
      <main class="page">
        <div class="card booked-card">
          <h2>Grabbed ✓</h2>
          <p><strong>{fmtFull(claimed[0])} – {fmtTime(claimed[1])}</strong></p>
          <p class="muted">It’s now off the table for everyone else.</p>
          <CalButtons title="Meeting" start={claimed[0]} end={claimed[1]} />
          <button type="button" class="ghost" onClick={() => { setClaimed(null); setSel(null); }}>Back to calendar</button>
        </div>
      </main>
    );
  }

  const grab = async () => {
    if (!sel) return;
    setErr('');
    try {
      await bookSlot(id, sel, '', '');
      setBlocked((b) => [...b, sel]);
      setClaimed(sel);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const fresh = await getEvent(id);
        if (!fresh.enc) setBlocked(fresh.blocked);
        setSel(null);
        setErr('That time was just taken — pick another.');
      } else {
        setErr(e instanceof Error ? e.message : 'Could not grab that time');
      }
    }
  };

  return (
    <main class="page app">
      <header class="app-head">
        <p class="app-hint">Mark the time that works for you. No sign-up.</p>
        <OverlayBar fromMin={weekFrom} toMin={weekTo} onBusy={setBusy} />
      </header>

      <DayCalendar days={days} mode="select" windows={segments} booked={blocked} busy={busy} onSelect={setSel} />

      {err && <p class="error">{err}</p>}
      <button type="button" class="fab" disabled={!sel} onClick={grab}>
        {sel ? `Grab ${fmtTime(sel[0])}–${fmtTime(sel[1])}` : 'Mark a time'}
      </button>
    </main>
  );
}
