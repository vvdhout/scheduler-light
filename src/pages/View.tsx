import { useEffect, useMemo, useState } from 'preact/hooks';
import { PasswordGate } from '../components/PasswordGate';
import { SlotList } from '../components/SlotList';
import { ApiError, bookSlot, getEvent } from '../lib/api';
import { decryptCore } from '../lib/crypto';
import { deriveSlots, type EventCore, type PublicEvent, type Win } from '../lib/model';
import { fmtDuration, localTz } from '../lib/time';

export function View({ id }: { id: string }) {
  const [state, setState] = useState<'loading' | 'gone' | 'error' | 'ready'>('loading');
  const [pub, setPub] = useState<PublicEvent | null>(null);
  const [core, setCore] = useState<EventCore | null>(null);
  const [gate, setGate] = useState<string | undefined>();
  const [blocked, setBlocked] = useState<Win[]>([]);

  const load = async () => {
    try {
      const ev = await getEvent(id);
      setPub(ev);
      setBlocked(ev.blocked);
      if (!ev.enc) setCore(ev);
      setState('ready');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'gone' : 'error');
    }
  };
  useEffect(() => {
    load();
  }, [id]);

  const slots = useMemo(() => (core ? deriveSlots(core, blocked) : []), [core, blocked]);

  if (state === 'loading') return <main class="page center muted">Loading…</main>;
  if (state === 'gone')
    return (
      <main class="page center">
        <h1>This link has expired</h1>
        <p class="muted">The page you’re looking for is gone — ask for a fresh link.</p>
      </main>
    );
  if (state === 'error')
    return (
      <main class="page center">
        <h1>Something went wrong</h1>
        <p class="muted">Couldn’t load this page. Try again in a moment.</p>
      </main>
    );

  if (pub!.enc && !core) {
    return (
      <main class="page">
        <PasswordGate
          onUnlock={async (pw) => {
            const { core, gate } = await decryptCore(pub as Extract<PublicEvent, { enc: true }>, pw);
            setCore(core);
            setGate(gate);
          }}
        />
      </main>
    );
  }

  const onBook = async (slot: Win, by: string, note: string) => {
    try {
      await bookSlot(id, slot, by, note, gate);
      setBlocked((b) => [...b, slot]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone beat them to it — refresh blocked ranges so the list updates.
        const fresh = await getEvent(id);
        setBlocked(fresh.blocked);
        throw new ApiError(409, 'That slot was just taken — pick another.');
      }
      throw e;
    }
  };

  return (
    <main class="page">
      <header class="view-head">
        <h1>{core!.event}</h1>
        <p class="muted">
          with <strong>{core!.name}</strong> · {fmtDuration(core!.durationMin)} · times shown in {localTz()}
        </p>
      </header>
      <SlotList slots={slots} eventTitle={core!.event} hostName={core!.name} onBook={onBook} />
    </main>
  );
}
