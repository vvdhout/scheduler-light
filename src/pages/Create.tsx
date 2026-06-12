import { useState } from 'preact/hooks';
import { AvailabilityGrid } from '../components/AvailabilityGrid';
import { BusyButtons } from '../components/BusyButtons';
import { createEvent } from '../lib/api';
import { encryptCore, randomToken, sha256Hex } from '../lib/crypto';
import { cellsToWindows, DEFAULTS, HORIZON_DAYS, type Win } from '../lib/model';
import { forgetPage, myPages, rememberPage } from '../lib/store';
import { localDayStarts, localTz } from '../lib/time';

const DURATIONS = [30, 60, 120, 180, 240];

export function Create() {
  const [name, setName] = useState('');
  const [event, setEvent] = useState(DEFAULTS.event);
  const [duration, setDuration] = useState(DEFAULTS.durationMin);
  const [password, setPassword] = useState('');
  const [cells, setCells] = useState<Set<number>>(new Set());
  const [busyRanges, setBusyRanges] = useState<Win[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ id: string; adminToken: string } | null>(null);
  const [copied, setCopied] = useState<'s' | 'a' | null>(null);
  const [pages, setPages] = useState(myPages());

  const days = localDayStarts(HORIZON_DAYS);

  const generate = async () => {
    setError('');
    const windows = cellsToWindows(cells, 30);
    if (!name.trim()) return setError('Set your name first.');
    if (windows.length === 0) return setError('Paint at least one available window.');
    if (!windows.some(([s, e]) => e - s >= duration))
      return setError(`None of your windows fit a ${duration}-minute slot. Paint longer windows or shorten the duration.`);
    setWorking(true);
    try {
      const core = { name: name.trim(), event: event.trim() || DEFAULTS.event, durationMin: duration, stepMin: DEFAULTS.stepMin, windows };
      const adminToken = randomToken();
      const adminHash = await sha256Hex(adminToken);
      const body = password
        ? { adminHash, enc: true as const, ...(({ gateHash, ...blob }) => ({ blob, gateHash }))(await encryptCore(core, password)) }
        : { adminHash, enc: false as const, core };
      const { id } = await createEvent(body);
      rememberPage({ id, adminToken, event: core.event, at: Date.now() });
      setPages(myPages());
      setResult({ id, adminToken });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setWorking(false);
    }
  };

  if (result) {
    const shareUrl = `${location.origin}/s/${result.id}`;
    const adminUrl = `${location.origin}/a/${result.id}#${result.adminToken}`;
    const copy = async (text: string, which: 's' | 'a') => {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    };
    return (
      <main class="page">
        <h1>Your page is live</h1>
        <div class="card">
          <h3>Share link</h3>
          <p class="muted">Send this to anyone who should pick a slot.</p>
          <code class="url">{shareUrl}</code>
          <div class="row">
            <button type="button" class="primary" onClick={() => copy(shareUrl, 's')}>
              {copied === 's' ? 'Copied!' : 'Copy'}
            </button>
            {'share' in navigator && (
              <button type="button" class="ghost" onClick={() => navigator.share({ url: shareUrl, title: event })}>
                Share…
              </button>
            )}
          </div>
        </div>
        <div class="card">
          <h3>Admin link — keep this private</h3>
          <p class="muted">
            Your only way to edit availability and see bookings. There is no account or recovery — bookmark it or pin it
            in a Discord DM to yourself. (It’s also remembered on this device.)
          </p>
          <code class="url">{adminUrl}</code>
          <div class="row">
            <button type="button" class="ghost" onClick={() => copy(adminUrl, 'a')}>
              {copied === 'a' ? 'Copied!' : 'Copy'}
            </button>
            <a class="primary button" href={`/a/${result.id}#${result.adminToken}`}>
              Open admin page
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main class="page">
      <h1>Slots</h1>
      <p class="muted">
        Paint when you’re free over the next 7 days, share one link, and people book a slot — shown in <em>their</em>{' '}
        timezone. No accounts. Pages evaporate after 30 days of inactivity.
      </p>

      <div class="card">
        <label>
          Your name
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} maxLength={80} placeholder="e.g. your Discord name" />
        </label>
        <label>
          Event name
          <input value={event} onInput={(e) => setEvent((e.target as HTMLInputElement).value)} maxLength={120} />
        </label>
        <label>Slot duration</label>
        <div class="chips">
          {DURATIONS.map((d) => (
            <button key={d} type="button" class={`chip ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)}>
              {d < 60 ? `${d}m` : `${d / 60}h`}
            </button>
          ))}
        </div>
        <label>
          Password <span class="muted">(optional — encrypts the page in your browser)</span>
          <input type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} autocomplete="new-password" />
        </label>
      </div>

      <div class="card">
        <div class="row spread">
          <h3>Availability</h3>
          <span class="muted small-text">{localTz()}</span>
        </div>
        <BusyButtons fromMin={days[0]!} toMin={days[0]! + HORIZON_DAYS * 1440} onBusy={setBusyRanges} />
        <AvailabilityGrid days={days} cells={cells} onChange={setCells} durationMin={duration} busy={busyRanges} />
      </div>

      {error && <p class="error">{error}</p>}
      <button type="button" class="primary big" disabled={working} onClick={generate}>
        {working ? 'Generating…' : 'Generate link'}
      </button>

      {pages.length > 0 && (
        <div class="card">
          <h3>Your pages on this device</h3>
          {pages.map((p) => (
            <div key={p.id} class="row spread">
              <a href={`/a/${p.id}#${p.adminToken}`}>{p.event}</a>
              <button
                type="button"
                class="ghost small"
                onClick={() => {
                  forgetPage(p.id);
                  setPages(myPages());
                }}
              >
                forget
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
