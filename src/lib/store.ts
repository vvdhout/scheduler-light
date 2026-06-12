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
