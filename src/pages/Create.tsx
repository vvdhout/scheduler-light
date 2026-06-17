import { useState } from 'preact/hooks';
import { DayCalendar } from '../components/DayCalendar';
import { OverlayBar } from '../components/OverlayBar';
import { createEvent } from '../lib/api';
import { randomToken, sha256Hex } from '../lib/crypto';
import { cellsToWindows, DEFAULTS, HORIZON_DAYS, type Win } from '../lib/model';
import { rememberPage } from '../lib/store';
import { localDayStarts } from '../lib/time';

const DURATIONS = [30, 60, 90, 120, 180];
const fmtDur = (d: number) => (d % 60 === 0 ? `${d / 60}h` : `${d}m`);

export function Create() {
  const [duration, setDuration] = useState(DEFAULTS.durationMin);
  const [cells, setCells] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Win[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const days = localDayStarts(HORIZON_DAYS);
  const weekFrom = days[0]!;
  const weekTo = weekFrom + HORIZON_DAYS * 1440;

  const share = async () => {
    setError('');
    const windows = cellsToWindows(cells, 30);
    if (windows.length === 0) return setError('Paint when you’re free first.');
    if (!windows.some(([s, e]) => e - s >= duration))
      return setError(`No window fits a ${fmtDur(duration)} slot yet — paint a longer block or shorten the slot.`);
    setWorking(true);
    try {
      const core = { name: '', event: '', durationMin: duration, stepMin: DEFAULTS.stepMin, windows };
      const adminToken = randomToken();
      const adminHash = await sha256Hex(adminToken);
      const { id } = await createEvent({ adminHash, enc: false, core });
      rememberPage({ id, adminToken, event: '', at: Date.now() });
      setResult(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setWorking(false);
    }
  };

  if (result) {
    const url = `${location.origin}/s/${result}`;
    const wa = `https://wa.me/?text=${encodeURIComponent(`When are you free? Grab a slot: ${url}`)}`;
    return (
      <main class="page">
        <h1>Shared ✓</h1>
        <p class="muted">Send this link. People tap a slot that works — no sign-up.</p>
        <code class="url">{url}</code>
        <div class="row">
          <button
            type="button"
            class="primary"
            onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          {'share' in navigator && (
            <button type="button" class="ghost" onClick={() => navigator.share({ url })}>Share…</button>
          )}
          <a class="wa button" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </div>
        <div class="row">
          <a class="ghost button" href={`/s/${result}`}>Open my page</a>
        </div>
        <p class="muted small-text">
          Open your page on this device anytime to adjust your availability and see what’s been grabbed. Only this device can edit it.
        </p>
      </main>
    );
  }

  return (
    <main class="page app">
      <header class="app-head">
        <h1>When are you free?</h1>
        <div class="chips dur">
          {DURATIONS.map((d) => (
            <button key={d} type="button" class={`chip ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)}>
              {fmtDur(d)}
            </button>
          ))}
        </div>
        <OverlayBar fromMin={weekFrom} toMin={weekTo} onBusy={setBusy} />
      </header>

      <DayCalendar days={days} durationMin={duration} mode="paint" cells={cells} onChange={setCells} busy={busy} />

      {error && <p class="error">{error}</p>}
      <button type="button" class="primary big" disabled={working} onClick={share}>
        {working ? 'Sharing…' : 'Share availability'}
      </button>
    </main>
  );
}
