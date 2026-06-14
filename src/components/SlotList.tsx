import { useMemo, useState } from 'preact/hooks';
import type { Win } from '../lib/model';
import { fmtDay, fmtFull, fmtTime, localDayKey } from '../lib/time';
import { CalButtons } from './CalButtons';

interface Props {
  slots: Win[];
  eventTitle: string;
  hostName: string;
  onBook: (slot: Win, by: string, note: string) => Promise<void>; // throws ApiError on conflict
}

export function SlotList({ slots, eventTitle, hostName, onBook }: Props) {
  const [open, setOpen] = useState<number | null>(null); // slot start
  const [by, setBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookedSlot, setBookedSlot] = useState<Win | null>(null);
  const [copied, setCopied] = useState(false);

  const byDay = useMemo(() => {
    const map = new Map<string, Win[]>();
    for (const s of slots) {
      const key = localDayKey(s[0]);
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.values()];
  }, [slots]);

  if (bookedSlot) {
    const msg = `Let’s go ${fmtFull(bookedSlot[0])} – ${fmtTime(bookedSlot[1])}! (${eventTitle})`;
    return (
      <div class="card booked-card">
        <h2>Booked ✓</h2>
        <p>
          <strong>{fmtFull(bookedSlot[0])} – {fmtTime(bookedSlot[1])}</strong>
        </p>
        <p class="muted">Add it to your calendar:</p>
        <CalButtons title={`${eventTitle} with ${hostName}`} start={bookedSlot[0]} end={bookedSlot[1]} />
        <p class="notice">
          ⚠ Attention: make sure to contact <strong>{hostName}</strong> on Discord to confirm the slot!
        </p>
        <button
          type="button"
          class="primary"
          onClick={async () => {
            await navigator.clipboard.writeText(msg);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied!' : 'Copy message'}
        </button>
      </div>
    );
  }

  if (slots.length === 0) return <p class="card muted">No open slots right now. Check back later.</p>;

  const submit = async (slot: Win) => {
    if (!by.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onBook(slot, by.trim(), note.trim());
      setBookedSlot(slot);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="slot-list">
      {byDay.map((daySlots) => (
        <section key={daySlots[0]![0]}>
          <h3 class="day-head">{fmtDay(daySlots[0]![0])}</h3>
          {daySlots.map((slot) => (
            <div key={slot[0]} class={`slot ${open === slot[0] ? 'open' : ''}`}>
              <button
                type="button"
                class="slot-time"
                onClick={() => {
                  setOpen(open === slot[0] ? null : slot[0]);
                  setError('');
                }}
              >
                <span>
                  {fmtTime(slot[0])} – {fmtTime(slot[1])}
                </span>
                <span class="muted">{open === slot[0] ? 'cancel' : 'book'}</span>
              </button>
              {open === slot[0] && (
                <form
                  class="book-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(slot);
                  }}
                >
                  <input
                    placeholder="Your (Discord) name"
                    value={by}
                    onInput={(e) => setBy((e.target as HTMLInputElement).value)}
                    maxLength={80}
                    autofocus
                  />
                  <input
                    placeholder="Note (optional)"
                    value={note}
                    onInput={(e) => setNote((e.target as HTMLInputElement).value)}
                    maxLength={280}
                  />
                  {error && <p class="error">{error}</p>}
                  <button type="submit" class="primary" disabled={!by.trim() || busy}>
                    {busy ? 'Booking…' : `Book ${fmtTime(slot[0])} – ${fmtTime(slot[1])}`}
                  </button>
                </form>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
