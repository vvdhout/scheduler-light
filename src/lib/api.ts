import type { AdminEvent, Booking, EventCore, PublicEvent, Win } from './model';
import type { EncBlob } from './crypto';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export type CreateBody =
  | { adminHash: string; enc: false; core: EventCore }
  | { adminHash: string; enc: true; blob: EncBlob; gateHash: string };

export const createEvent = (body: CreateBody) => call<{ id: string }>('POST', '/api/create', body);

export const getEvent = (id: string) => call<PublicEvent>('GET', `/api/event?id=${encodeURIComponent(id)}`);

export const bookSlot = (id: string, slot: Win, by: string, note: string, gate?: string) =>
  call<{ ok: true }>('POST', '/api/book', { id, start: slot[0], end: slot[1], by, note, gate });

export const adminGet = (id: string, token: string) =>
  call<AdminEvent>('POST', '/api/admin', { id, token, action: 'get' });

export const adminUpdate = (
  id: string,
  token: string,
  patch: { enc: false; core: EventCore } | { enc: true; blob: EncBlob; gateHash: string },
) => call<{ ok: true }>('POST', '/api/admin', { id, token, action: 'update', ...patch });

export const adminUnbook = (id: string, token: string, booking: Pick<Booking, 'start' | 'at'>) =>
  call<{ ok: true }>('POST', '/api/admin', { id, token, action: 'unbook', start: booking.start, at: booking.at });
