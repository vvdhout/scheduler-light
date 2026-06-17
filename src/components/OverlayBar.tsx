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
        <>
          <span class="muted small-text">Overlay your calendar to compare:</span>
          {providers.map((p) => (
            <button key={p} type="button" class="ghost small" disabled={loading !== null} onClick={() => setConfirm(p)}>
              {loading === p ? 'Loading…' : LABEL[p]}
            </button>
          ))}
        </>
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
