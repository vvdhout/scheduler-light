import { useEffect, useState } from 'preact/hooks';
import { AvailabilityGrid } from '../components/AvailabilityGrid';
import { BusyButtons } from '../components/BusyButtons';
import { CalButtons } from '../components/CalButtons';
import { PasswordGate } from '../components/PasswordGate';
import { adminGet, adminUnbook, adminUpdate, ApiError } from '../lib/api';
import { decryptCore, encryptCore } from '../lib/crypto';
import {
  cellsToWindows, DEFAULTS, HORIZON_DAYS, nowMin, windowsToCells,
  type AdminEvent, type EventCore, type Win,
} from '../lib/model';
import { fmtDuration, fmtFull, fmtTime, localDayStarts, localTz } from '../lib/time';

const DURATIONS = [30, 60, 120, 180, 240];

export function Admin({ id }: { id: string }) {
  const token = location.hash.slice(1);
  const [state, setState] = useState<'loading' | 'denied' | 'gone' | 'error' | 'ready'>('loading');
  const [record, setRecord] = useState<AdminEvent | null>(null);
  const [core, setCore] = useState<EventCore | null>(null);
  const [password, setPassword] = useState(''); // kept in memory to re-encrypt on save
  const [cells, setCells] = useState<Set<number>>(new Set());
  const [busyRanges, setBusyRanges] = useState<Win[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const days = localDayStarts(HORIZON_DAYS);

  const initFromCore = (c: EventCore) => {
    setCore(c);
    setCells(windowsToCells(c.windows.map(([s, e]): Win => [Math.max(s, nowMin() - (nowMin() % 30)), e]).filter(([s, e]) => s < e), 30));
  };

  useEffect(() => {
    (async () => {
      try {
        const rec = await adminGet(id, token);
        setRecord(rec);
        if (!rec.enc) {
          initFromCore({
            name: rec.name!, event: rec.event!, durationMin: rec.durationMin!,
            stepMin: rec.stepMin ?? DEFAULTS.stepMin, windows: rec.windows ?? [],
          });
        }
        setState('ready');
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) setState('denied');
        else if (e instanceof ApiError && e.status === 404) setState('gone');
        else setState('error');
      }
    })();
  }, [id]);

  if (!token)
    return (
      <main class="page center">
        <h1>Missing admin key</h1>
        <p class="muted">Open this page via your full admin link (it ends with <code>#…</code>).</p>
      </main>
    );
  if (state === 'loading') return <main class="page center muted">Loading…</main>;
  if (state === 'denied')
    return (
      <main class="page center">
        <h1>Not your page</h1>
        <p class="muted">The admin key in this link doesn’t match.</p>
      </main>
    );
  if (state === 'gone')
    return (
      <main class="page center">
        <h1>This page has expired</h1>
        <p class="muted">It was removed after 30 days of inactivity.</p>
      </main>
    );
  if (state === 'error')
    return (
      <main class="page center">
        <h1>Something went wrong</h1>
        <p class="muted">Couldn’t load this page. Try again in a moment.</p>
      </main>
    );

  if (record!.enc && !core) {
    return (
      <main class="page">
        <PasswordGate
          label="Enter this page’s password to edit it."
          onUnlock={async (pw) => {
            const { core } = await decryptCore({ salt: record!.salt!, iv: record!.iv!, data: record!.data! }, pw);
            setPassword(pw);
            initFromCore(core);
          }}
        />
      </main>
    );
  }

  const shareUrl = `${location.origin}/s/${id}`;
  const bookings = (record!.bookings ?? []).filter((b) => b.end > nowMin()).sort((a, b) => a.start - b.start);

  const save = async () => {
    setError('');
    setSaved(false);
    const windows = cellsToWindows(cells, 30);
    if (!core!.name.trim()) return setError('Name can’t be empty.');
    setSaving(true);
    try {
      const next: EventCore = { ...core!, name: core!.name.trim(), event: core!.event.trim() || DEFAULTS.event, windows };
      const patch = password
        ? await encryptCore(next, password).then(({ gateHash, ...blob }) => ({ enc: true as const, blob, gateHash }))
        : { enc: false as const, core: next };
      await adminUpdate(id, token, patch);
      setCore(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const unbook = async (b: (typeof bookings)[number]) => {
    if (!confirm(`Remove ${b.by}’s booking on ${fmtFull(b.start)}? They will NOT be notified — tell them yourself.`)) return;
    await adminUnbook(id, token, b);
    setRecord({ ...record!, bookings: record!.bookings.filter((x) => !(x.start === b.start && x.at === b.at)) });
  };

  return (
    <main class="page">
      <h1>Manage: {core!.event}</h1>
      <div class="card">
        <div class="row spread">
          <code class="url">{shareUrl}</code>
        </div>
        <div class="row">
          <button
            type="button"
            class="primary"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied!' : 'Copy share link'}
          </button>
          {'share' in navigator && (
            <button type="button" class="ghost" onClick={() => navigator.share({ url: shareUrl, title: core!.event })}>
              Share…
            </button>
          )}
        </div>
      </div>

      <div class="card">
        <h3>Bookings</h3>
        {bookings.length === 0 && <p class="muted">Nothing booked yet.</p>}
        {bookings.map((b) => (
          <div key={`${b.start}:${b.at}`} class="booking">
            <div>
              <strong>{b.by}</strong> · {fmtFull(b.start)} – {fmtTime(b.end)}
              {b.note && <p class="muted">“{b.note}”</p>}
            </div>
            <div class="row">
              <CalButtons title={`${core!.event} with ${b.by}`} start={b.start} end={b.end} details={b.note ?? ''} />
              <button type="button" class="ghost small danger" onClick={() => unbook(b)}>
                remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div class="card">
        <label>
          Your name
          <input value={core!.name} onInput={(e) => setCore({ ...core!, name: (e.target as HTMLInputElement).value })} maxLength={80} />
        </label>
        <label>
          Event name
          <input value={core!.event} onInput={(e) => setCore({ ...core!, event: (e.target as HTMLInputElement).value })} maxLength={120} />
        </label>
        <label>Slot duration ({fmtDuration(core!.durationMin)})</label>
        <div class="chips">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              class={`chip ${core!.durationMin === d ? 'on' : ''}`}
              onClick={() => setCore({ ...core!, durationMin: d })}
            >
              {d < 60 ? `${d}m` : `${d / 60}h`}
            </button>
          ))}
        </div>
      </div>

      <div class="card">
        <div class="row spread">
          <h3>Availability (next 7 days)</h3>
          <span class="muted small-text">{localTz()}</span>
        </div>
        <BusyButtons fromMin={days[0]!} toMin={days[0]! + HORIZON_DAYS * 1440} onBusy={setBusyRanges} />
        <AvailabilityGrid
          days={days}
          cells={cells}
          onChange={setCells}
          durationMin={core!.durationMin}
          busy={busyRanges}
          booked={bookings.map((b): Win => [b.start, b.end])}
        />
      </div>

      {error && <p class="error">{error}</p>}
      <button type="button" class="primary big" disabled={saving} onClick={save}>
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
      </button>
    </main>
  );
}
