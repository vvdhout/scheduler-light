import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isStr, methodIs, metric, rateLimit, safe, uniqueVisit } from './_lib.js';

// Anonymous event beacon from the SPA. Counts unique visitors (HLL) and home /
// link opens. Owner self-views of a link are excluded (client sends owner:true).
export default safe(async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, 'track', 240))) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const cid = body.cid;
  if (!isStr(cid, 6, 64)) return res.status(204).end();

  await uniqueVisit(cid);
  if (body.ev === 'home') await metric('m:home');
  else if (body.ev === 'link' && body.owner !== true) await metric('m:linkopen');

  return res.status(204).end();
});
