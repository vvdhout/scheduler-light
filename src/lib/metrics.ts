// Anonymous, self-hosted metrics. A stable random per-device id (no PII) lets
// the server count unique visitors via HyperLogLog. Fire-and-forget; never
// blocks or breaks the UI.
import { randomToken } from './crypto';

const CID_KEY = 'ls.cid';

function clientId(): string {
  try {
    let id = localStorage.getItem(CID_KEY);
    if (!id) { id = randomToken(16); localStorage.setItem(CID_KEY, id); }
    return id;
  } catch {
    return 'anon';
  }
}

let sent = false;

/** Beacon one page-open event (once per load). */
export function track(ev: 'home' | 'link', owner = false): void {
  if (sent) return;
  sent = true;
  try {
    const body = JSON.stringify({ ev, cid: clientId(), owner });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch { /* best-effort */ }
}
