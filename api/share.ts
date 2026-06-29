import type { VercelRequest, VercelResponse } from '@vercel/node';
import { evKey, isId, kv, type EventRecord } from './_lib.js';

// Serves /s/:id with event-specific <title> and Open Graph / Twitter tags so
// Discord and social embeds show the event name and details. Social crawlers
// don't run JavaScript, so the SPA's client-side title can't drive embeds —
// the tags must be in the HTML we return here. The SPA still boots normally;
// this only swaps the <!--META-->…<!--/META--> block in the shell.

interface Meta {
  title: string;
  description: string;
}

const SITE = 'Light Scheduler';
const DEFAULT_META: Meta = {
  title: `${SITE} — share when you’re free`,
  description: "Paint when you’re free, share one link, and let people grab a time that works — no accounts, shown in their own timezone.",
};

// Ultra-light pages are anonymous (no host/event name), so the shared link
// gets a generic, inviting preview rather than "{event} with {host}".
function metaFor(record: EventRecord | null): Meta {
  if (!record) return { title: `Expired link — ${SITE}`, description: 'This scheduling link is no longer available.' };
  if (record.enc)
    return {
      title: `Private page — ${SITE}`,
      description: 'Password-protected. Open the link to enter the password.',
    };
  return {
    title: `Find a time to meet — ${SITE}`,
    description: "Someone shared when they’re free — open the link to grab a time that works for you. No sign-up, shown in your timezone.",
  };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function injectMeta(shell: string, meta: Meta, url: string): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const u = escapeHtml(url);
  const block = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].join('\n    ');
  return shell.replace(/<!--META-->[\s\S]*?<!--\/META-->/, block);
}

// The built shell (with hashed asset URLs) is constant per deployment; cache it
// across warm invocations. A new deploy gets a fresh module scope, so this
// never serves stale asset references.
let shellCache: string | null = null;
async function getShell(host: string): Promise<string> {
  if (shellCache) return shellCache;
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const r = await fetch(`${proto}://${host}/index.html`);
  if (!r.ok) throw new Error(`shell fetch ${r.status}`);
  shellCache = await r.text();
  return shellCache;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const host = (req.headers.host as string | undefined) ?? '';

  let meta = DEFAULT_META;
  try {
    if (isId(id)) meta = metaFor(await kv.getJson<EventRecord>(evKey(id)));
  } catch (e) {
    console.error('share: lookup failed, using default meta:', e);
  }

  try {
    const shell = await getShell(host);
    const html = injectMeta(shell, meta, `https://${host}/s/${id}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(200).send(html);
  } catch (e) {
    // Couldn't fetch the shell (deployment-level issue) — bounce to the app so
    // the visitor still gets a working page rather than an error.
    console.error('share: shell unavailable, redirecting:', e);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(307, `/index.html`);
  }
}
