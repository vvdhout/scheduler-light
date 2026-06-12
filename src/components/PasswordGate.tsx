import { useState } from 'preact/hooks';

interface Props {
  label?: string;
  onUnlock: (password: string) => Promise<void>; // throws on wrong password
}

export function PasswordGate({ label = 'This page is password protected.', onUnlock }: Props) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError('');
    try {
      await onUnlock(pw);
    } catch {
      setError('That password didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card gate" onSubmit={submit}>
      <p>{label}</p>
      <input
        type="password"
        placeholder="Password"
        value={pw}
        onInput={(e) => setPw((e.target as HTMLInputElement).value)}
        autofocus
      />
      {error && <p class="error">{error}</p>}
      <button type="submit" class="primary" disabled={!pw || busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </form>
  );
}
