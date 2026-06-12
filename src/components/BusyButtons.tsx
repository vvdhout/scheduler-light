import { useState } from 'preact/hooks';
import { GOOGLE_CLIENT_ID, MS_CLIENT_ID, googleBusy, microsoftBusy } from '../lib/busy';
import type { Win } from '../lib/model';

interface Props {
  fromMin: number;
  toMin: number;
  onBusy: (ranges: Win[]) => void;
}

/** "Overlay my calendar" buttons. Ephemeral client-side OAuth — see lib/busy.ts. */
export function BusyButtons({ fromMin, toMin, onBusy }: Props) {
  const [loading, setLoading] = useState<'g' | 'm' | null>(null);
  const [error, setError] = useState('');
  if (!GOOGLE_CLIENT_ID && !MS_CLIENT_ID) return null;

  const run = async (which: 'g' | 'm') => {
    setLoading(which);
    setError('');
    try {
      onBusy(await (which === 'g' ? googleBusy(fromMin, toMin) : microsoftBusy(fromMin, toMin)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load calendar');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div class="busy-row">
      <span class="muted small-text">Show busy times from:</span>
      {GOOGLE_CLIENT_ID && (
        <button type="button" class="ghost small" disabled={loading !== null} onClick={() => run('g')}>
          {loading === 'g' ? 'Loading…' : 'Google Calendar'}
        </button>
      )}
      {MS_CLIENT_ID && (
        <button type="button" class="ghost small" disabled={loading !== null} onClick={() => run('m')}>
          {loading === 'm' ? 'Loading…' : 'Microsoft Calendar'}
        </button>
      )}
      {error && <span class="error">{error}</span>}
    </div>
  );
}
