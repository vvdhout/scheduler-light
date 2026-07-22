# Light Scheduler — ultra-light

A zero-friction way to show when you're free and let people grab a time. No
accounts, no details, no booking-management overhead — just a tool to visualize
availability and pick a common slot. (This is the **ultra-light** branch; the
`main` branch has the fuller version with names, passwords, and an admin page.)

- **Create:** open the app and paint when you're free over the next month on an
  Apple-Calendar-style day view (swipe between days). Tap **Share** — that's it.
  No name, no event title, no password.
- **Visitor:** opens the link, sees your availability in **their own timezone**,
  and taps a green slot to grab it. No sign-up, no name. Grabbed slots grey out
  for everyone else. Empty days are greyed and auto-skipped.
- **Edit & see grabs:** whoever created the page (identified by *this browser* —
  no accounts, no admin link) can reopen the link to repaint availability and see
  what's been grabbed. Clearing browser data or switching devices loses edit access.
- Pages self-destruct after **30 days of inactivity** (Redis TTL — no cleanup jobs).
- Optional: overlay your Google / Microsoft calendar's busy times — on **both**
  painting and viewing — to compare. Ephemeral, client-side OAuth; approve once
  and it re-applies silently afterward. No tokens or event data ever reach the server.

## Stack

Vite + Preact + TypeScript static frontend, four Vercel serverless functions (`/api`), Upstash Redis for storage.

## Deploy

1. Push this repo to GitHub and import it into [Vercel](https://vercel.com/new) (framework preset: Vite). Every push to `main` auto-deploys.
2. In the Vercel project → **Storage** → add **Upstash for Redis** (free plan: 256MB / 500K commands per month — far more than this app needs). Linking it injects the `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars automatically (the code also accepts `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).

That's it. Without Redis env vars the API falls back to an in-memory store, which is fine for local development only.

## Calendar busy-overlay (optional)

The "show busy times" buttons appear only when the corresponding env var is set at build time.

**Google** (`VITE_GOOGLE_CLIENT_ID`):
1. [Google Cloud Console](https://console.cloud.google.com) → create a project → enable the **Google Calendar API**.
2. OAuth consent screen: External, add yourself as a test user (calendar scopes are "sensitive"; unverified apps show a warning — fine for personal use).
3. Credentials → OAuth client ID → Web application → add your production origin (and `http://localhost:5173`) to **Authorized JavaScript origins**.
4. Add the client ID as `VITE_GOOGLE_CLIENT_ID` in Vercel env vars.

**Microsoft** (`VITE_MS_CLIENT_ID`):
1. [Entra admin center](https://entra.microsoft.com) → App registrations → New registration → supported account types: personal + org accounts.
2. Authentication → Add platform → **Single-page application** → redirect URI = your production origin (and `http://localhost:5173`).
3. Add the application (client) ID as `VITE_MS_CLIENT_ID` in Vercel env vars.

## Local development

```sh
npm install
npx vercel dev   # runs frontend + /api functions together
```

(`npm run dev` runs the frontend alone; API calls will 404 without `vercel dev`.)

## Metrics (optional, self-hosted)

Anonymous, event-based counters kept in the same Upstash Redis — no third-party
script, no cookies, no PII. Tracked: unique visitors (HyperLogLog over a random
per-device id), homepage opens, links shared, links opened by potential bookers
(owner self-views excluded), slots booked, plus two conversions (homepage→shared,
link-open→booked).

- Set a `STATS_KEY` env var in Vercel to unlock the dashboard.
- View at **`/stats#YOUR-KEY`** (the key stays in the URL fragment and is passed to
  `/api/stats`; the endpoint 404s without the correct key). Daily buckets self-expire
  after ~100 days via Redis TTL.
- Filter totals & conversions by **All time / last 30 days / last 7 days**. Windowed
  visitor counts merge the daily HyperLogLogs (`PFCOUNT` union), so a returning
  visitor is still counted once across the range.

## Privacy model

- Stored per page: creator name, event name, duration, availability windows, bookings (name + optional note), all keyed by an unguessable 22-char ID. Nothing else; no IPs beyond transient rate-limit counters.
- Admin access = SHA-256 hash comparison of a client-generated token carried in the admin URL's `#fragment` (fragments are never sent to the server in page requests).
- Password-protected pages: event details are AES-GCM encrypted in the browser (PBKDF2, 310k iterations). Booking on such pages requires a password-derived gate token. Booked time ranges and booker names are stored in cleartext so the server can block double-booking.
