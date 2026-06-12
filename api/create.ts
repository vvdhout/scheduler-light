import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  evKey, genId, isB64, isHex64, kv, MAX_RECORD_BYTES, methodIs, rateLimit, safe, validateCore,
  type EventRecord,
} from './_lib';

export default safe(async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, 'create', 20))) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isHex64(body.adminHash)) return res.status(400).json({ error: 'Invalid request' });

  const now = Date.now();
  const record: EventRecord = {
    v: 2,
    enc: body.enc === true,
    adminHash: body.adminHash,
    bookings: [],
    createdAt: now,
    updatedAt: now,
  };

  if (record.enc) {
    const blob = body.blob as Record<string, unknown> | undefined;
    if (!blob || !isB64(blob.salt, 64) || !isB64(blob.iv, 64) || !isB64(blob.data, 12000) || !isHex64(body.gateHash)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    Object.assign(record, { salt: blob.salt, iv: blob.iv, data: blob.data, gateHash: body.gateHash });
  } else {
    const core = validateCore(body.core);
    if (!core) return res.status(400).json({ error: 'Invalid event data' });
    Object.assign(record, core);
  }

  if (JSON.stringify(record).length > MAX_RECORD_BYTES) {
    return res.status(413).json({ error: 'Event too large' });
  }

  const id = genId();
  await kv.setJson(evKey(id), record, 30 * 24 * 3600);
  return res.status(200).json({ id });
});
