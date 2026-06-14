import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isValidSlot, overlaps } from '../src/lib/model.js';
import { evKey, isId, isStr, kv, MAX_RECORD_BYTES, methodIs, rateLimit, safe, sha256Hex, TTL_SEC, withLock, type EventRecord } from './_lib.js';

export default safe(async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, 'book', 30))) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { id, start, end } = body;
  if (!isId(id) || !Number.isInteger(start) || !Number.isInteger(end)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  const s = start as number, e = end as number;
  const nowMin = Math.floor(Date.now() / 60000);
  if (s >= e || e - s > 1440 || s < nowMin - 5) return res.status(400).json({ error: 'Invalid slot' });
  if (!isStr(body.by, 1, 80)) return res.status(400).json({ error: 'Name is required' });
  const note = isStr(body.note, 0, 280) ? body.note : '';

  const result = await withLock(id, async () => {
    const record = await kv.getJson<EventRecord>(evKey(id));
    if (!record) return { status: 404, error: 'Not found' };

    if (record.enc) {
      // Encrypted page: booking requires the password-derived gate token.
      if (typeof body.gate !== 'string' || sha256Hex(body.gate) !== record.gateHash) {
        return { status: 403, error: 'This page requires its password to book.' };
      }
    } else {
      const core = { durationMin: record.durationMin!, stepMin: record.stepMin!, windows: record.windows! };
      if (!isValidSlot(core, s, e)) return { status: 400, error: 'That slot is not offered.' };
    }

    if (record.bookings.some((b) => overlaps(s, e, b.start, b.end))) {
      return { status: 409, error: 'That slot was just taken.' };
    }
    if (record.bookings.length >= 100) return { status: 409, error: 'This page is fully booked.' };

    record.bookings.push({ start: s, end: e, by: body.by as string, note, at: Date.now() });
    if (JSON.stringify(record).length > MAX_RECORD_BYTES) return { status: 413, error: 'Booking too large' };
    await kv.setJson(evKey(id), record, TTL_SEC);
    return { status: 200 };
  });

  if (!result) return res.status(503).json({ error: 'Busy — try again.' });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });

  // Notification seam: plug Resend / a Discord webhook in here later.
  return res.status(200).json({ ok: true });
});
