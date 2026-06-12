import { createHash, randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Booking, EventCore, Win } from '../src/lib/model';
import { HORIZON_DAYS } from '../src/lib/model';

export const TTL_SEC = 30 * 24 * 3600; // pages evaporate after 30 days of inactivity
export const MAX_RECORD_BYTES = 16384;

export interface EventRecord {
  v: 2;
  enc: boolean;
  adminHash: string;
  bookings: Booking[];
  createdAt: number;
  updatedAt: number;
  // plaintext
  name?: string;
  event?: string;
  durationMin?: number;
  stepMin?: number;
  windows?: Win[];
  // encrypted
  salt?: string;
  iv?: string;
  data?: string;
  gateHash?: string;
}

// ---------------------------------------------------------------------------
// Storage: Upstash Redis when configured, in-memory fallback for local dev.
// ---------------------------------------------------------------------------

interface KV {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, exSec: number): Promise<void>;
  del(key: string): Promise<void>;
  setNx(key: string, exSec: number): Promise<boolean>;
  incrWithTtl(key: string, exSec: number): Promise<number>;
}

function redisKv(): KV | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)?.trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return null;
  let redis: Redis;
  try {
    redis = new Redis({ url, token });
  } catch (e) {
    console.error('Redis init failed, falling back to memory store:', e);
    return null;
  }
  return {
    getJson: async <T>(key: string) => (await redis.get<T>(key)) ?? null,
    setJson: async (key, value, exSec) => {
      await redis.set(key, JSON.stringify(value), { ex: exSec });
    },
    del: async (key) => {
      await redis.del(key);
    },
    setNx: async (key, exSec) => (await redis.set(key, '1', { nx: true, ex: exSec })) === 'OK',
    incrWithTtl: async (key, exSec) => {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, exSec);
      return n;
    },
  };
}

function memoryKv(): KV {
  const g = globalThis as { __memKv?: Map<string, { v: string; exp: number }> };
  const map = (g.__memKv ??= new Map());
  const live = (key: string) => {
    const e = map.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) {
      map.delete(key);
      return null;
    }
    return e;
  };
  return {
    getJson: async <T>(key: string) => {
      const e = live(key);
      return e ? (JSON.parse(e.v) as T) : null;
    },
    setJson: async (key, value, exSec) => {
      map.set(key, { v: JSON.stringify(value), exp: Date.now() + exSec * 1000 });
    },
    del: async (key) => {
      map.delete(key);
    },
    setNx: async (key, exSec) => {
      if (live(key)) return false;
      map.set(key, { v: '1', exp: Date.now() + exSec * 1000 });
      return true;
    },
    incrWithTtl: async (key, exSec) => {
      const e = live(key);
      const n = e ? Number(e.v) + 1 : 1;
      map.set(key, { v: String(n), exp: e ? e.exp : Date.now() + exSec * 1000 });
      return n;
    },
  };
}

export const kv: KV = redisKv() ?? memoryKv();

export const evKey = (id: string) => `ev:${id}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function genId(len = 22): string {
  return [...randomBytes(len)].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{10,40}$/.test(v);
export const isHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export const isB64 = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max && /^[A-Za-z0-9+/=]+$/.test(v);
export const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function validateCore(core: unknown): EventCore | null {
  if (typeof core !== 'object' || core === null) return null;
  const c = core as Record<string, unknown>;
  const nowMin = Math.floor(Date.now() / 60000);
  if (!isStr(c.name, 1, 80) || !isStr(c.event, 1, 120)) return null;
  if (!isInt(c.durationMin) || c.durationMin < 15 || c.durationMin > 480) return null;
  if (!isInt(c.stepMin) || ![15, 30, 60].includes(c.stepMin)) return null;
  if (!Array.isArray(c.windows) || c.windows.length > 200) return null;
  for (const w of c.windows) {
    if (!Array.isArray(w) || w.length !== 2 || !isInt(w[0]) || !isInt(w[1])) return null;
    const [s, e] = w as [number, number];
    if (s >= e || e - s > 1440) return null;
    if (e < nowMin - 60 || s > nowMin + (HORIZON_DAYS + 2) * 1440) return null;
  }
  return { name: c.name, event: c.event, durationMin: c.durationMin, stepMin: c.stepMin, windows: c.windows as Win[] };
}

export async function rateLimit(req: VercelRequest, res: VercelResponse, scope: string, max: number): Promise<boolean> {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? 'local';
  const bucket = Math.floor(Date.now() / 3600_000);
  const n = await kv.incrWithTtl(`rl:${scope}:${ip}:${bucket}`, 3600);
  if (n > max) {
    res.status(429).json({ error: 'Too many requests — try again later.' });
    return false;
  }
  return true;
}

export function methodIs(req: VercelRequest, res: VercelResponse, method: string): boolean {
  if (req.method !== method) {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  return true;
}

/** Wraps a handler so unexpected errors return a JSON message instead of an opaque 500. */
export function safe(h: (req: VercelRequest, res: VercelResponse) => Promise<unknown>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    try {
      await h(req, res);
    } catch (e) {
      console.error(`${req.method} ${req.url} failed:`, e);
      res.status(500).json({ error: `Server error: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
}

/** Per-event mutation lock (Upstash REST has no transactions). */
export async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T | null> {
  const key = `lock:${id}`;
  for (let i = 0; i < 8; i++) {
    if (await kv.setNx(key, 10)) {
      try {
        return await fn();
      } finally {
        await kv.del(key);
      }
    }
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 80));
  }
  return null;
}
