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
import { fmtFull, fmtFullEn, fmtTime, fmtTimeEn, localDayStarts } from '../lib/time';

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
  const [name, setName] = useState('');
  const [eventName, setEventName] = useState('');
  const [prompting, setPrompting] = useState(false); // name/event dialog before booking
  const [copiedWhen, setCopiedWhen] = useState(false);
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
        <DayCalendar days={days} mode="paint" cells={cells} onChange={setCells} busy={busy} booked={upcoming.map((b): Win => [b.start, b.end])} hint="Hold to paint your availability." />

        {upcoming.length > 0 && (
          <div class="grabbed">
            {upcoming.map((b) => {
              const title = b.event?.trim()
                ? `${b.event.trim()} with ${b.by || 'someone'}`
                : (b.by ? `Booked by ${b.by}` : 'Booked');
              return (
                <div key={`${b.start}:${b.at}`} class="grabbed-item">
                  <div class="grabbed-meta">
                    <strong class="small-text">{title}</strong>
                    <span class="muted small-text">{fmtFull(b.start)} – {fmtTime(b.end)}</span>
                  </div>
                  <div class="row">
                    <CalButtons title={title} start={b.start} end={b.end} />
                    <button type="button" class="ghost small danger" onClick={() => release(b)}>release</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {err && <p class="error">{err}</p>}
        <OverlayBar fromMin={weekFrom} toMin={weekTo} onBusy={setBusy} />
        <button type="button" class="fab" disabled={saving} onClick={save}>
          {saving ? '…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </main>
    );
  }

  // ---- visitor --------------------------------------------------------------
  if (claimed) {
    const claimedTitle = eventName.trim() || 'Meeting';
    const when = `${fmtFullEn(claimed[0])} – ${fmtTimeEn(claimed[1])}`;
    const copyWhen = async () => {
      try { await navigator.clipboard.writeText(`${claimedTitle} — ${when}`); setCopiedWhen(true); setTimeout(() => setCopiedWhen(false), 1500); } catch { /* ignore */ }
    };
    return (
      <main class="page">
        <div class="card booked-card">
          <h2>Grabbed ✓</h2>
          <p class="attn"><strong>Important:</strong> let the other person know the slot you booked — they aren’t notified of it.</p>
          <p class="bk-title"><strong>{claimedTitle}</strong></p>
          <button type="button" class="bk-when" onClick={copyWhen} title="Tap to copy">
            <span>{when}</span>
            <svg class="copy-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            {copiedWhen && <span class="bk-copied">Copied!</span>}
          </button>
          <p class="muted bk-callabel">Add it to your preferred calendar:</p>
          <CalButtons title={claimedTitle} start={claimed[0]} end={claimed[1]} />
          <button type="button" class="ghost" onClick={() => { setClaimed(null); setSel(null); setName(''); setEventName(''); }}>Back to calendar</button>
        </div>
        <a class="cta-banner" href="/">
          Need to find a time with someone else too?
          <strong>Create your own availability link →</strong>
        </a>
      </main>
    );
  }

  const grab = async () => {
    if (!sel) return;
    setErr('');
    try {
      await bookSlot(id, sel, name.trim(), eventName.trim() || 'Meeting');
      setBlocked((b) => [...b, sel]);
      setClaimed(sel);
      setPrompting(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const fresh = await getEvent(id);
        if (!fresh.enc) setBlocked(fresh.blocked);
        setSel(null);
        setPrompting(false);
        setErr('That time was just taken — pick another.');
      } else {
        setErr(e instanceof Error ? e.message : 'Could not grab that time');
      }
    }
  };

  return (
    <main class="page app">
      <DayCalendar days={days} mode="select" windows={segments} booked={blocked} busy={busy} onSelect={setSel} hint="Hold to mark a time that works for you. No sign-up." />

      {err && !prompting && <p class="error">{err}</p>}
      <OverlayBar fromMin={weekFrom} toMin={weekTo} onBusy={setBusy} />
      <button type="button" class="fab" disabled={!sel} onClick={() => { setErr(''); setPrompting(true); }}>
        {sel ? `Grab ${fmtTime(sel[0])}–${fmtTime(sel[1])}` : 'Mark a time'}
      </button>

      {prompting && sel && (
        <div class="modal-backdrop" onClick={() => setPrompting(false)}>
          <div class="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Grab {fmtTime(sel[0])}–{fmtTime(sel[1])}</h3>
            <input placeholder="Your name" value={name} maxLength={80} autofocus onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <input placeholder="What’s it for? (e.g. Lunch)" value={eventName} maxLength={120} onInput={(e) => setEventName((e.target as HTMLInputElement).value)} />
            {err && <p class="error">{err}</p>}
            <div class="row">
              <button type="button" class="primary" disabled={!name.trim()} onClick={grab}>Grab it</button>
              <button type="button" class="ghost" onClick={() => setPrompting(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
