import { useEffect, useState } from 'preact/hooks';
import { loadBusy, type OverlayProvider, overlayProviders } from '../lib/busy';
import { overlayPref, setOverlayPref } from '../lib/store';
import type { Win } from '../lib/model';

interface Props {
  fromMin: number;
  toMin: number;
  onBusy: (ranges: Win[]) => void;
}

const LABEL: Record<OverlayProvider, string> = { google: 'Google', microsoft: 'Outlook' };

/** The Google "G" mark. */
const GoogleG = () => (
  <svg class="gicon" width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.614z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.182l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.467.891 11.43 0 9 0A9 9 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
  </svg>
);

/** "Overlay my calendar to compare" control. Once a provider is approved it's
 *  remembered (store.overlayPref) and re-applied silently on every later page —
 *  creating or viewing — so the user only approves once. No event data or
 *  tokens are persisted by us (see lib/busy). Renders nothing if no provider
 *  is configured at build time. */
export function OverlayBar({ fromMin, toMin, onBusy }: Props) {
  const providers = overlayProviders();
  const [active, setActive] = useState<OverlayProvider | null>(null);
  const [loading, setLoading] = useState<OverlayProvider | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<OverlayProvider | null>(null); // pre-consent dialog

  // Auto-overlay silently if the user has approved a provider before.
  useEffect(() => {
    const pref = overlayPref();
    if (!pref || !providers.includes(pref)) return;
    let live = true;
    loadBusy(pref, fromMin, toMin, { silent: true })
      .then((r) => { if (live) { onBusy(r); setActive(pref); } })
      .catch(() => { /* needs interaction — leave the button for a manual tap */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMin, toMin]);

  if (providers.length === 0) return null;

  const connect = async (p: OverlayProvider) => {
    setLoading(p);
    setError('');
    try {
      const ranges = await loadBusy(p, fromMin, toMin);
      onBusy(ranges);
      setActive(p);
      setOverlayPref(p); // remember for every future page
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load calendar');
    } finally {
      setLoading(null);
    }
  };

  const disconnect = () => {
    setActive(null);
    setOverlayPref(null);
    onBusy([]);
  };

  return (
    <div class="overlay-bar">
      {active ? (
        <span class="muted small-text">
          Overlaying {LABEL[active]} busy times ·{' '}
          <button type="button" class="linkish" onClick={disconnect}>remove</button>
        </span>
      ) : (
        providers.map((p) => (
          <button key={p} type="button" class="overlay-btn" disabled={loading !== null} onClick={() => setConfirm(p)}>
            {p === 'google' && <GoogleG />}
            {loading === p ? 'Loading…' : `Overlay ${LABEL[p]} Calendar`}
          </button>
        ))
      )}
      {error && <span class="error small-text">{error}</span>}

      {confirm && (
        <div class="modal-backdrop" onClick={() => setConfirm(null)}>
          <div class="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Connect {LABEL[confirm]} Calendar?</h3>
            <p>
              We’ll read only your <strong>busy times</strong> to shade this calendar so you can compare — they’re never
              stored or sent to our server. Only connect if you trust this app; it works fine without it, you just won’t
              see your own busy times.
            </p>
            <p class="muted small-text">{LABEL[confirm]} will then show its own sign-in/permission screen.</p>
            <div class="row">
              <button type="button" class="primary" onClick={() => { const p = confirm; setConfirm(null); connect(p); }}>
                Connect {LABEL[confirm]}
              </button>
              <button type="button" class="ghost" onClick={() => setConfirm(null)}>Not now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
