import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  evKey, isB64, isHex64, kv, MAX_RECORD_BYTES, methodIs, rateLimit, sha256Hex, TTL_SEC, validateCore, withLock,
  type EventRecord,
} from './_lib';
import { isId } from './_lib';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, 'admin', 120))) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { id, token, action } = body;
  if (!isId(id) || typeof token !== 'string' || token.length > 64) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const result = await withLock(id, async () => {
    const record = await kv.getJson<EventRecord>(evKey(id));
    if (!record) return { status: 404 as number, error: 'Not found' as string | undefined, data: undefined as unknown };
    if (sha256Hex(token) !== record.adminHash) return { status: 403, error: 'Not authorized', data: undefined };

    if (action === 'get') {
      const { adminHash: _omit, ...rest } = record;
      return { status: 200, error: undefined, data: rest };
    }

    if (action === 'update') {
      if (body.enc === true) {
        const blob = body.blob as Record<string, unknown> | undefined;
        if (!blob || !isB64(blob.salt, 64) || !isB64(blob.iv, 64) || !isB64(blob.data, 12000) || !isHex64(body.gateHash)) {
          return { status: 400, error: 'Invalid request', data: undefined };
        }
        delete record.name; delete record.event; delete record.durationMin; delete record.stepMin; delete record.windows;
        Object.assign(record, { enc: true, salt: blob.salt, iv: blob.iv, data: blob.data, gateHash: body.gateHash });
      } else {
        const core = validateCore(body.core);
        if (!core) return { status: 400, error: 'Invalid event data', data: undefined };
        delete record.salt; delete record.iv; delete record.data; delete record.gateHash;
        Object.assign(record, core, { enc: false });
      }
      record.updatedAt = Date.now();
      if (JSON.stringify(record).length > MAX_RECORD_BYTES) return { status: 413, error: 'Event too large', data: undefined };
      await kv.setJson(evKey(id), record, TTL_SEC);
      return { status: 200, error: undefined, data: { ok: true } };
    }

    if (action === 'unbook') {
      const before = record.bookings.length;
      record.bookings = record.bookings.filter((b) => !(b.start === body.start && b.at === body.at));
      if (record.bookings.length === before) return { status: 404, error: 'Booking not found', data: undefined };
      record.updatedAt = Date.now();
      await kv.setJson(evKey(id), record, TTL_SEC);
      return { status: 200, error: undefined, data: { ok: true } };
    }

    return { status: 400, error: 'Unknown action', data: undefined };
  });

  if (!result) return res.status(503).json({ error: 'Busy — try again.' });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  return res.status(200).json(result.data);
}
