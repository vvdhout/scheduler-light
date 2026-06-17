// localStorage only — keeps your admin links findable on this device.
// Nothing here ever leaves the browser.

export interface MyPage {
  id: string;
  adminToken: string;
  event: string;
  at: number;
}

const KEY = 'slots.myPages';

export function myPages(): MyPage[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function rememberPage(page: MyPage): void {
  const pages = myPages().filter((p) => p.id !== page.id);
  pages.unshift(page);
  try {
    localStorage.setItem(KEY, JSON.stringify(pages.slice(0, 20)));
  } catch { /* storage full or disabled — non-essential */ }
}

export function forgetPage(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(myPages().filter((p) => p.id !== id)));
  } catch { /* ignore */ }
}

/** The admin token for a page created on THIS device, or null. This is what
 *  lets the creating browser (and only it) edit availability and see claims —
 *  no accounts, no separate admin link. */
export function ownerToken(id: string): string | null {
  return myPages().find((p) => p.id === id)?.adminToken ?? null;
}

// ---- calendar-overlay preference -----------------------------------------
// Remember which calendar the user overlays so they only approve once, ever,
// across every page (creating or viewing). Only this provider name is stored —
// never tokens or event data (Google tokens stay in memory; MSAL caches its
// own auth tokens). Cleared by setting null.

export type OverlayProvider = 'google' | 'microsoft';
const OVERLAY_KEY = 'slots.overlay';

export function overlayPref(): OverlayProvider | null {
  const v = (() => { try { return localStorage.getItem(OVERLAY_KEY); } catch { return null; } })();
  return v === 'google' || v === 'microsoft' ? v : null;
}

export function setOverlayPref(p: OverlayProvider | null): void {
  try {
    if (p) localStorage.setItem(OVERLAY_KEY, p);
    else localStorage.removeItem(OVERLAY_KEY);
  } catch { /* non-essential */ }
}
