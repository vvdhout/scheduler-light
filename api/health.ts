import type { VercelRequest, VercelResponse } from '@vercel/node';
import { evKey, genId, kv, safe, storageInfo } from './_lib.js';

// Visit /api/health in the browser to diagnose storage. Reports which Redis
// env vars are present and whether a write/read round-trip actually works.
export default safe(async function handler(_req: VercelRequest, res: VercelResponse) {
  const info = storageInfo();

  let roundtrip: { ok: boolean; error?: string } = { ok: false };
  const probeKey = evKey(`__health_${genId(8)}`);
  try {
    await kv.setJson(probeKey, { t: Date.now() }, 60);
    const got = await kv.getJson<{ t: number }>(probeKey);
    await kv.del(probeKey);
    roundtrip = { ok: got != null };
  } catch (e) {
    roundtrip = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ...info,
    roundtrip,
    persistent: info.usingRedis && roundtrip.ok,
    note: info.usingRedis
      ? roundtrip.ok
        ? 'Redis is connected and working.'
        : 'Redis env vars are set but the read/write failed — check the token/URL or that the database is active.'
      : 'No Redis configured — using the in-memory fallback, which does NOT persist on Vercel. Link the Upstash integration with the default KV_ prefix.',
  });
});
