import { useState } from 'preact/hooks';
import { DayCalendar } from '../components/DayCalendar';
import { OverlayBar } from '../components/OverlayBar';
import { createEvent } from '../lib/api';
import { randomToken, sha256Hex } from '../lib/crypto';
import { cellsToWindows, DEFAULTS, HORIZON_DAYS, type Win } from '../lib/model';
import { rememberPage } from '../lib/store';
import { localDayStarts } from '../lib/time';

export function Create() {
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
    setWorking(true);
    try {
      // No fixed duration: visitors pick their own length by painting a range.
      const core = { name: '', event: '', durationMin: 30, stepMin: DEFAULTS.stepMin, windows };
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
    return (
      <main class="page">
        <h1>Shared ✓</h1>
        <p class="muted">Send this link. People mark a time that works — no sign-up.</p>
        <code class="url">{url}</code>
        <div class="row">
          {'share' in navigator && (
            <button type="button" class="primary" onClick={() => navigator.share({ url })}>Share…</button>
          )}
          <button
            type="button"
            class="ghost"
            onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
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
      <DayCalendar days={days} mode="paint" cells={cells} onChange={setCells} busy={busy} title="My availability" hint="Hold to paint when you’re free, then share." />

      {error && <p class="error">{error}</p>}
      <OverlayBar fromMin={weekFrom} toMin={weekTo} onBusy={setBusy} />
      <button type="button" class="fab fab-br" disabled={working} onClick={share}>
        {working ? '…' : 'Share'}
      </button>
    </main>
  );
}
