// Ephemeral, client-side calendar busy overlays. Tokens live only in this
// tab's memory (Google) or the auth library's own cache (Microsoft); we never
// send calendar data to or store events on our server. Buttons/overlays are
// inert unless the matching VITE_*_CLIENT_ID env var is set at build time.
//
// `silent: true` skips the consent popup — used to re-overlay automatically on
// later visits once the user has approved once (see store.overlayPref).

import type { Win } from './model';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const MS_CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;

export type OverlayProvider = 'google' | 'microsoft';

/** Which overlay providers are configured in this build. */
export function overlayProviders(): OverlayProvider[] {
  const out: OverlayProvider[] = [];
  if (GOOGLE_CLIENT_ID) out.push('google');
  if (MS_CLIENT_ID) out.push('microsoft');
  return out;
}

interface GoogleTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
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

// Google access tokens last ~1h and GIS won't persist them, and silent
// re-auth (prompt:'none') is unreliable with third-party cookies blocked. So
// cache the token (with its expiry) in this browser and reuse it across
// reloads and new pages until it expires — only then do we re-prompt. Scope is
// read-only free/busy; nothing is sent to our server.
const GTOKEN_KEY = 'slots.gtoken';
function cachedGoogleToken(): string | null {
  try {
    const r = JSON.parse(localStorage.getItem(GTOKEN_KEY) || 'null') as { token: string; exp: number } | null;
    return r && r.exp > Date.now() ? r.token : null;
  } catch { return null; }
}
function storeGoogleToken(token: string, expiresInSec: number): void {
  try { localStorage.setItem(GTOKEN_KEY, JSON.stringify({ token, exp: Date.now() + (expiresInSec - 60) * 1000 })); } catch { /* ignore */ }
}
function clearGoogleToken(): void {
  try { localStorage.removeItem(GTOKEN_KEY); } catch { /* ignore */ }
}

/** Forget any cached overlay token (called when the user disconnects). */
export function forgetOverlayTokens(): void {
  clearGoogleToken();
}

async function googleAccessToken(silent: boolean): Promise<string> {
  const cached = cachedGoogleToken();
  if (cached) return cached;
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID!,
      scope: 'https://www.googleapis.com/auth/calendar.freebusy',
      callback: (resp) => {
        if (!resp.access_token) return reject(new Error(resp.error ?? 'No token'));
        storeGoogleToken(resp.access_token, Number(resp.expires_in) || 3600);
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err.message ?? 'Google sign-in cancelled')),
    });
    // 'none' = no UI; only works after the user has consented once.
    client.requestAccessToken({ prompt: silent ? 'none' : '' });
  });
}

function fetchFreeBusy(token: string, fromMin: number, toMin: number) {
  return fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(fromMin * 60000).toISOString(),
      timeMax: new Date(toMin * 60000).toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
}

/** Returns busy ranges, reusing a cached token when possible. */
export async function googleBusy(fromMin: number, toMin: number, opts: { silent?: boolean } = {}): Promise<Win[]> {
  let token = await googleAccessToken(!!opts.silent);
  let res = await fetchFreeBusy(token, fromMin, toMin);
  if (res.status === 401) {
    // Cached token was revoked/expired early — drop it and get a fresh one.
    clearGoogleToken();
    token = await googleAccessToken(!!opts.silent);
    res = await fetchFreeBusy(token, fromMin, toMin);
  }
  if (!res.ok) throw new Error(`Google Calendar error (${res.status})`);
  const json = (await res.json()) as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } };
  return (json.calendars?.primary?.busy ?? []).map((b) => toWin(b.start, b.end));
}

/** Reads Microsoft calendarView for [fromMin, toMin); silent uses the cached account. */
export async function microsoftBusy(fromMin: number, toMin: number, opts: { silent?: boolean } = {}): Promise<Win[]> {
  const { PublicClientApplication } = await import('@azure/msal-browser');
  const pca = new PublicClientApplication({
    auth: { clientId: MS_CLIENT_ID!, authority: 'https://login.microsoftonline.com/common', redirectUri: location.origin },
  });
  await pca.initialize();
  const scopes = ['Calendars.Read'];
  let token: string;
  const account = pca.getAllAccounts()[0];
  if (account) {
    token = (await pca.acquireTokenSilent({ scopes, account })).accessToken;
  } else if (opts.silent) {
    throw new Error('No cached Microsoft session');
  } else {
    const login = await pca.loginPopup({ scopes });
    token = login.accessToken || (await pca.acquireTokenSilent({ scopes, account: login.account })).accessToken;
  }
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

/** Fetch busy ranges for a provider; `silent` avoids any popup. */
export function loadBusy(provider: OverlayProvider, fromMin: number, toMin: number, opts: { silent?: boolean } = {}) {
  return provider === 'google' ? googleBusy(fromMin, toMin, opts) : microsoftBusy(fromMin, toMin, opts);
}
