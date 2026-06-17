// All times are UTC epoch minutes (Date.now() / 60000) unless noted.

export type Win = [start: number, end: number];

export interface EventCore {
  name: string;
  event: string;
  durationMin: number;
  stepMin: number;
  windows: Win[];
}

export interface Booking {
  start: number;
  end: number;
  by: string;
  note?: string;
  at: number; // epoch ms
}

/** Public payload returned by GET /api/event */
export type PublicEvent =
  | ({ v: 2; enc: false; blocked: Win[]; updatedAt: number } & EventCore)
  | { v: 2; enc: true; blocked: Win[]; updatedAt: number; salt: string; iv: string; data: string };

export interface AdminEvent {
  v: 2;
  enc: boolean;
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
}

export const DEFAULTS = { event: 'Meeting', durationMin: 120, stepMin: 30 };
export const HORIZON_DAYS = 7;

export const nowMin = () => Math.floor(Date.now() / 60000);

export function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

/** Merge a set of selected cell start-minutes (cellMin granularity) into windows. */
export function cellsToWindows(cells: Set<number>, cellMin: number): Win[] {
  const sorted = [...cells].sort((a, b) => a - b);
  const wins: Win[] = [];
  for (const c of sorted) {
    const last = wins[wins.length - 1];
    if (last && last[1] === c) last[1] = c + cellMin;
    else wins.push([c, c + cellMin]);
  }
  return wins;
}

export function windowsToCells(windows: Win[], cellMin: number): Set<number> {
  const cells = new Set<number>();
  for (const [s, e] of windows) {
    for (let t = s; t + cellMin <= e; t += cellMin) cells.add(t);
  }
  return cells;
}

/** Derive bookable start slots from windows, excluding past starts and blocked ranges. */
export function deriveSlots(core: Pick<EventCore, 'durationMin' | 'stepMin' | 'windows'>, blocked: Win[], from = nowMin()): Win[] {
  const slots: Win[] = [];
  for (const [s, e] of core.windows) {
    for (let t = s; t + core.durationMin <= e; t += core.stepMin) {
      if (t < from) continue;
      if (blocked.some(([bS, bE]) => overlaps(t, t + core.durationMin, bS, bE))) continue;
      slots.push([t, t + core.durationMin]);
    }
  }
  return slots.sort((a, b) => a[0] - b[0]);
}

/** A booking is valid for a plaintext event if its exact range fits a window on the step grid. */
export function isValidSlot(core: Pick<EventCore, 'durationMin' | 'stepMin' | 'windows'>, start: number, end: number): boolean {
  if (end - start !== core.durationMin) return false;
  return core.windows.some(([s, e]) => start >= s && end <= e && (start - s) % core.stepMin === 0);
}

/** Any step-aligned range that fits inside one window (used when visitors pick
 *  their own length by painting, rather than a fixed-duration slot). */
export function isValidRange(core: Pick<EventCore, 'stepMin' | 'windows'>, start: number, end: number): boolean {
  if (end <= start || (end - start) % core.stepMin !== 0) return false;
  return core.windows.some(([s, e]) => start >= s && end <= e && (start - s) % core.stepMin === 0);
}

/** Contiguous free ranges: windows minus past minus already-booked, on the grid. */
export function freeSegments(windows: Win[], blocked: Win[], from = nowMin(), step = 30): Win[] {
  const free = new Set<number>();
  for (const [s, e] of windows) for (let t = s; t + step <= e; t += step) free.add(t);
  for (const c of [...free]) {
    if (c < from || blocked.some(([bs, be]) => c < be && bs < c + step)) free.delete(c);
  }
  const out: Win[] = [];
  for (const c of [...free].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[1] === c) last[1] = c + step;
    else out.push([c, c + step]);
  }
  return out;
}
