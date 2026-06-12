// Ephemeral, client-side calendar busy overlays. Tokens live only in this
// tab's memory; nothing is sent to or stored on our server. Buttons are
// hidden entirely unless the matching VITE_*_CLIENT_ID env var is set.

import type { Win } from './model';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;

interface GoogleTokenClient {
  requestAccessToken(): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
            error_callback?: (err: { message?: string }) => void;
          }): GoogleTokenClient;
        };
      };
    };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const toWin = (startIso: string, endIso: string): Win => [
  Math.floor(Date.parse(startIso) / 60000),
  Math.ceil(Date.parse(endIso) / 60000),
];

/** Pops Google consent, queries FreeBusy for [fromMin, toMin), returns busy ranges. */
export async function googleBusy(fromMin: number, toMin: number): Promise<Win[]> {
  await loadScript('https://accounts.google.com/gsi/client');
  const token = await new Promise<string>((resolve, reject) => {
    window.google!.accounts.oauth2
      .initTokenClient({
        client_id: GOOGLE_CLIENT_ID!,
        scope: 'https://www.googleapis.com/auth/calendar.freebusy',
        callback: (resp) => (resp.access_token ? resolve(resp.access_token) : reject(new Error(resp.error ?? 'No token'))),
        error_callback: (err) => reject(new Error(err.message ?? 'Google sign-in cancelled')),
      })
      .requestAccessToken();
  });
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(fromMin * 60000).toISOString(),
      timeMax: new Date(toMin * 60000).toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar error (${res.status})`);
  const json = (await res.json()) as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } };
  return (json.calendars?.primary?.busy ?? []).map((b) => toWin(b.start, b.end));
}

/** Pops Microsoft consent, reads calendarView for [fromMin, toMin), returns non-free ranges. */
export async function microsoftBusy(fromMin: number, toMin: number): Promise<Win[]> {
  const { PublicClientApplication } = await import('@azure/msal-browser');
  const pca = new PublicClientApplication({
    auth: { clientId: MS_CLIENT_ID!, authority: 'https://login.microsoftonline.com/common', redirectUri: location.origin },
  });
  await pca.initialize();
  const login = await pca.loginPopup({ scopes: ['Calendars.Read'] });
  const token =
    login.accessToken ||
    (await pca.acquireTokenSilent({ scopes: ['Calendars.Read'], account: login.account })).accessToken;
  const params = new URLSearchParams({
    startDateTime: new Date(fromMin * 60000).toISOString(),
    endDateTime: new Date(toMin * 60000).toISOString(),
    $select: 'start,end,showAs',
    $top: '250',
  });
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) throw new Error(`Microsoft Graph error (${res.status})`);
  const json = (await res.json()) as {
    value?: { start: { dateTime: string }; end: { dateTime: string }; showAs?: string }[];
  };
  return (json.value ?? [])
    .filter((e) => e.showAs !== 'free')
    .map((e) => toWin(e.start.dateTime + 'Z', e.end.dateTime + 'Z'));
}
