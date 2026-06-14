import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Win } from '../src/lib/model.js';
import { evKey, isId, kv, methodIs, safe, type EventRecord } from './_lib.js';

export default safe(async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return;
  const id = req.query.id;
  if (!isId(id)) return res.status(400).json({ error: 'Invalid id' });

  const record = await kv.getJson<EventRecord>(evKey(id));
  if (!record) return res.status(404).json({ error: 'Not found' });

  // Booked ranges are public (so other visitors see slots disappear) but the
  // names and notes of who booked are not.
  const blocked: Win[] = record.bookings.map((b) => [b.start, b.end]);
  const base = { v: 2, enc: record.enc, blocked, updatedAt: record.updatedAt };
  const payload = record.enc
    ? { ...base, salt: record.salt, iv: record.iv, data: record.data }
    : {
        ...base,
        name: record.name,
        event: record.event,
        durationMin: record.durationMin,
        stepMin: record.stepMin,
        windows: record.windows,
      };

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(payload);
});
