// Client-side encryption for password-protected pages.
// PBKDF2-SHA256 (310k iters) derives 48 bytes: 32 for the AES-GCM key,
// 16 for a "gate" token whose hash the server stores so that booking on an
// encrypted page requires knowing the password. The server only ever sees
// ciphertext and hashes.

import type { EventCore } from './model';

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function deriveBits(password: string, salt: Uint8Array): Promise<{ key: CryptoKey; gate: string }> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 310000 }, material, 48 * 8),
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, gate: toHex(bits.slice(32)) };
}

export interface EncBlob { salt: string; iv: string; data: string }

export async function encryptCore(core: EventCore, password: string): Promise<EncBlob & { gateHash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const { key, gate } = await deriveBits(password, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(core)));
  return { salt: b64(salt), iv: b64(iv), data: b64(data), gateHash: await sha256Hex(gate) };
}

/** Throws on wrong password (AES-GCM auth failure). Returns the core plus the gate token for booking. */
export async function decryptCore(blob: EncBlob, password: string): Promise<{ core: EventCore; gate: string }> {
  const { key, gate } = await deriveBits(password, unb64(blob.salt));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource }, key, unb64(blob.data) as BufferSource);
  return { core: JSON.parse(dec.decode(plain)), gate };
}

/** URL-safe random token (client-generated admin secret). */
export function randomToken(len = 22): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
