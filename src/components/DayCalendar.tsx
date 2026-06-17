import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Win } from '../lib/model';
import { cellsToWindows, deriveSlots, nowMin, overlaps } from '../lib/model';
import { fmtDuration, fmtTime } from '../lib/time';

const CELL_MIN = 30;
const MIN_PXH = 26; // below this, the day body scrolls instead of squashing
const WD = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DNUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const DATE_FULL = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

type Mode = 'paint' | 'claim' | 'readonly';

interface Props {
  days: number[]; // 7 local-midnight epoch minutes
  durationMin: number;
  mode: Mode;
  cells?: Set<number>; // paint mode source of truth
  onChange?: (c: Set<number>) => void;
  windows?: Win[]; // claim/readonly availability
  busy?: Win[]; // own-calendar overlay (shaded, never blocks)
  booked?: Win[]; // claimed/taken ranges
  onClaim?: (slot: Win) => void;
}

export function DayCalendar({ days, durationMin, mode, cells, onChange, windows, busy = [], booked = [], onClaim }: Props) {
  const now = nowMin();
  const [allHours, setAllHours] = useState(false);
  const fromMin = allHours ? 0 : 7 * 60;
  const toMin = allHours ? 24 * 60 : 23 * 60;
  const hours = (toMin - fromMin) / 60;

  // Availability windows: derived from painted cells, or given for claim/view.
  const wins = useMemo(
    () => (mode === 'paint' ? cellsToWindows(cells ?? new Set(), CELL_MIN) : windows ?? []),
    [mode, cells, windows],
  );
  const slots = useMemo(
    () => deriveSlots({ durationMin, stepMin: CELL_MIN, windows: wins }, booked, now),
    [wins, durationMin, booked, now],
  );

  const slotsOnDay = (dayStart: number) => slots.filter((s) => s[0] >= dayStart && s[0] < dayStart + 1440).length;
  const cellsOnDay = (dayStart: number) => {
    let n = 0;
    for (const c of cells ?? []) if (c >= dayStart && c < dayStart + 1440) n++;
    return n;
  };
  const dayUsable = (i: number) => (mode === 'paint' ? true : slotsOnDay(days[i]!) > 0);

  const [dayIdx, setDayIdx] = useState(0);
  // Claim/readonly: open on the first day that actually has options.
  useEffect(() => {
    if (mode === 'paint') return;
    if (!dayUsable(dayIdx)) {
      const j = days.findIndex((_, i) => dayUsable(i));
      if (j >= 0) setDayIdx(j);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.length]);

  const dayStart = days[dayIdx] ?? days[0]!;

  const go = (dir: 1 | -1) => {
    let j = dayIdx + dir;
    while (j >= 0 && j < days.length && !dayUsable(j)) j += dir;
    if (j >= 0 && j < days.length) setDayIdx(j);
  };

  // ---- measure body height so a day fills the screen (no vertical scroll) ---
  const body = useRef<HTMLDivElement>(null);
  const [pxh, setPxh] = useState(40);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setPxh(Math.max(MIN_PXH, el.clientHeight / hours));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hours]);

  const timeToY = (midMin: number) => ((midMin - fromMin) / 60) * pxh;
  const block = (s: number, e: number) => {
    const a = Math.max(s - dayStart, fromMin);
    const b = Math.min(e - dayStart, toMin);
    return { top: timeToY(a), height: Math.max(2, timeToY(b) - timeToY(a)), hidden: b <= a };
  };
  const cellAt = (clientY: number): number => {
    const rect = body.current!.getBoundingClientRect();
    const mid = fromMin + ((clientY - rect.top) / pxh) * 60;
    const snapped = fromMin + Math.floor((mid - fromMin) / CELL_MIN) * CELL_MIN;
    return dayStart + Math.min(Math.max(snapped, fromMin), toMin - CELL_MIN);
  };

  // ---- gestures: axis-locked. vertical = paint/select, horizontal = swipe ---
  const g = useRef<{ x: number; y: number; axis: null | 'x' | 'y'; add: boolean; start: number; base: Set<number> } | null>(null);

  const paintRange = (curCell: number) => {
    const s = g.current!;
    const lo = Math.min(s.start, curCell), hi = Math.max(s.start, curCell);
    const next = new Set(s.base);
    for (let c = lo; c <= hi; c += CELL_MIN) {
      if (c < now) continue;
      if (s.add) next.add(c); else next.delete(c);
    }
    onChange?.(next);
  };

  const claimAt = (cell: number) => {
    if (!onClaim) return;
    const win = wins.find(([s, e]) => cell >= s && cell < e);
    if (!win) return;
    // Latest valid start <= tapped cell that still fits the duration in the window.
    let start = Math.min(cell, win[1] - durationMin);
    start = win[0] + Math.floor((start - win[0]) / CELL_MIN) * CELL_MIN;
    const end = start + durationMin;
    if (start < win[0] || end > win[1] || start < now) return;
    if (booked.some(([s, e]) => overlaps(start, end, s, e))) return;
    onClaim([start, end]);
  };

  const onDown = (e: PointerEvent) => {
    g.current = { x: e.clientX, y: e.clientY, axis: null, add: false, start: 0, base: new Set(cells) };
  };
  const onMove = (e: PointerEvent) => {
    const s = g.current;
    if (!s) return;
    if (s.axis === null) {
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (s.axis === 'y' && mode === 'paint') {
        const c = cellAt(s.y);
        s.start = c;
        s.add = !(cells ?? new Set()).has(c);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        paintRange(c);
      }
    }
    if (s.axis === 'y' && mode === 'paint') {
      e.preventDefault();
      paintRange(cellAt(e.clientY));
    }
  };
  const onUp = (e: PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    if (s.axis === null) {
      // tap
      if (mode === 'paint') {
        const c = cellAt(e.clientY);
        if (c >= now) { const n = new Set(cells); n.has(c) ? n.delete(c) : n.add(c); onChange?.(n); }
      } else if (mode === 'claim') {
        claimAt(cellAt(e.clientY));
      }
    } else if (s.axis === 'x') {
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    }
  };

  const date = new Date(dayStart * 60000);
  const hourLines = Array.from({ length: hours + 1 }, (_, i) => fromMin + i * 60);
  const isToday = dayStart === days[0] && new Date().setHours(0, 0, 0, 0) / 60000 === days[0];

  return (
    <div class="daycal">
      <div class="daycal-head">
        <button type="button" class="daycal-nav" onClick={() => go(-1)} aria-label="Previous day" disabled={!days.some((_, i) => i < dayIdx && dayUsable(i))}>‹</button>
        <div class="daycal-date">{DATE_FULL.format(date)}{dayIdx === 0 && isToday ? ' · Today' : ''}</div>
        <button type="button" class="daycal-nav" onClick={() => go(1)} aria-label="Next day" disabled={!days.some((_, i) => i > dayIdx && dayUsable(i))}>›</button>
      </div>

      <div class="daycal-strip">
        {days.map((d, i) => {
          const dd = new Date(d * 60000);
          const usable = dayUsable(i);
          const has = mode === 'paint' ? cellsOnDay(d) > 0 : usable;
          return (
            <button
              key={d}
              type="button"
              class={`daycal-pip ${i === dayIdx ? 'on' : ''} ${!usable ? 'empty' : ''}`}
              disabled={!usable && mode !== 'paint'}
              onClick={() => setDayIdx(i)}
            >
              <span class="pip-wd">{WD.format(dd)}</span>
              <span class="pip-num">{DNUM.format(dd)}</span>
              {has && <span class="pip-dot" />}
            </button>
          );
        })}
      </div>

      <div
        class="daycal-body"
        ref={body}
        style={{ touchAction: mode === 'paint' ? 'none' : 'pan-y' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (g.current = null)}
      >
        <div class="daycal-grid" style={{ height: `${hours * pxh}px` }}>
          {hourLines.map((m) => (
            <div key={m} class="daycal-hr" style={{ top: `${timeToY(m)}px` }}>
              <span class="daycal-hrlabel">{m < 24 * 60 ? fmtTime(dayStart + m) : ''}</span>
            </div>
          ))}

          {/* own-calendar busy overlay — informational, never blocks */}
          {busy.map(([s, e], i) => {
            const b = block(s, e);
            return b.hidden ? null : <div key={`b${i}`} class="daycal-busy" style={{ top: `${b.top}px`, height: `${b.height}px` }} />;
          })}

          {/* availability */}
          {wins.map(([s, e], i) => {
            const b = block(s, e);
            return b.hidden ? null : (
              <div key={`w${i}`} class={`daycal-free ${mode === 'claim' ? 'tappable' : ''}`} style={{ top: `${b.top}px`, height: `${b.height}px` }} />
            );
          })}

          {/* taken / claimed */}
          {booked.map(([s, e], i) => {
            const b = block(s, e);
            return b.hidden ? null : (
              <div key={`k${i}`} class="daycal-taken" style={{ top: `${b.top}px`, height: `${b.height}px` }}>
                <span>taken</span>
              </div>
            );
          })}

          {isToday && timeToY(new Date().getHours() * 60 + new Date().getMinutes()) >= 0 && (
            <div class="daycal-now" style={{ top: `${timeToY(new Date().getHours() * 60 + new Date().getMinutes())}px` }} />
          )}
        </div>
      </div>

      <div class="daycal-foot">
        <span class="muted small-text">
          {mode === 'paint'
            ? `${slots.length} ${fmtDuration(durationMin)} slot${slots.length === 1 ? '' : 's'} · drag to paint, swipe for days`
            : mode === 'claim'
              ? 'Tap a green slot to grab it · swipe for days'
              : 'Swipe for days'}
        </span>
        <button type="button" class="ghost small" onClick={() => setAllHours(!allHours)}>
          {allHours ? '7–23' : 'All hours'}
        </button>
      </div>
    </div>
  );
}
