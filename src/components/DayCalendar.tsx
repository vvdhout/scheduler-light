import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Win } from '../lib/model';
import { cellsToWindows, deriveSlots, nowMin, overlaps } from '../lib/model';
import { fmtDuration, fmtTime } from '../lib/time';

const CELL_MIN = 30;
const PXH = 48; // px per hour (the hours scroll vertically)
const HOURS = 24;
const GRID_H = HOURS * PXH;
const LONGPRESS_MS = 320;
const JITTER = 8; // px of movement that turns a press into a scroll/swipe
const SWIPE = 45; // px horizontal to change day
const WD = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DNUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const DATE_FULL = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

type Mode = 'paint' | 'claim' | 'readonly';

interface Props {
  days: number[];
  durationMin: number;
  mode: Mode;
  cells?: Set<number>;
  onChange?: (c: Set<number>) => void;
  windows?: Win[];
  busy?: Win[];
  booked?: Win[];
  onClaim?: (slot: Win) => void;
}

export function DayCalendar({ days, durationMin, mode, cells, onChange, windows, busy = [], booked = [], onClaim }: Props) {
  const now = nowMin();

  const wins = useMemo(
    () => (mode === 'paint' ? cellsToWindows(cells ?? new Set(), CELL_MIN) : windows ?? []),
    [mode, cells, windows],
  );
  const slots = useMemo(
    () => deriveSlots({ durationMin, stepMin: CELL_MIN, windows: wins }, booked, now),
    [wins, durationMin, booked, now],
  );
  const slotsOnDay = (d: number) => slots.filter((s) => s[0] >= d && s[0] < d + 1440).length;
  const cellsOnDay = (d: number) => {
    let n = 0;
    for (const c of cells ?? []) if (c >= d && c < d + 1440) n++;
    return n;
  };
  const dayUsable = (i: number) => (mode === 'paint' ? true : slotsOnDay(days[i]!) > 0);

  const [dayIdx, setDayIdx] = useState(0);
  useEffect(() => {
    if (mode === 'paint') return;
    if (!dayUsable(dayIdx)) {
      const j = days.findIndex((_, i) => dayUsable(i));
      if (j >= 0) setDayIdx(j);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.length]);

  const dayStart = days[dayIdx] ?? days[0]!;
  const isToday = dayIdx === 0;
  const go = (dir: 1 | -1) => {
    let j = dayIdx + dir;
    while (j >= 0 && j < days.length && !dayUsable(j)) j += dir;
    if (j >= 0 && j < days.length) setDayIdx(j);
  };

  const body = useRef<HTMLDivElement>(null);
  const lastTouch = useRef(0);
  const mdown = useRef<{ start: number; add: boolean; base: Set<number> } | null>(null);

  // Latest props/state for the once-attached native touch listeners.
  const ctx = useRef<{
    mode: Mode; dayStart: number; durationMin: number; cells: Set<number>;
    onChange?: (c: Set<number>) => void; wins: Win[]; booked: Win[]; now: number;
    onClaim?: (s: Win) => void; go: (d: 1 | -1) => void;
  }>(null!);
  ctx.current = { mode, dayStart, durationMin, cells: cells ?? new Set(), onChange, wins, booked, now, onClaim, go };

  const timeToY = (mid: number) => (mid / 60) * PXH;
  const cellAtClientY = (clientY: number) => {
    const el = body.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    const snapped = Math.floor((y / PXH) * 60 / CELL_MIN) * CELL_MIN;
    return ctx.current.dayStart + Math.min(Math.max(snapped, 0), HOURS * 60 - CELL_MIN);
  };
  const paintRange = (cur: number, st: { start: number; add: boolean; base: Set<number> }) => {
    const lo = Math.min(st.start, cur), hi = Math.max(st.start, cur);
    const next = new Set(st.base);
    for (let c = lo; c <= hi; c += CELL_MIN) {
      if (c < ctx.current.now) continue;
      st.add ? next.add(c) : next.delete(c);
    }
    ctx.current.onChange?.(next);
  };
  const claimAt = (cell: number) => {
    const c = ctx.current;
    if (!c.onClaim) return;
    const win = c.wins.find(([s, e]) => cell >= s && cell < e);
    if (!win) return;
    let start = Math.min(cell, win[1] - c.durationMin);
    start = win[0] + Math.floor((start - win[0]) / CELL_MIN) * CELL_MIN;
    const end = start + c.durationMin;
    if (start < win[0] || end > win[1] || start < c.now) return;
    if (c.booked.some(([s, e]) => overlaps(start, end, s, e))) return;
    c.onClaim([start, end]);
  };

  // Open scrolled to roughly now (today) or the morning.
  useLayoutEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = (isToday ? Math.max(0, new Date().getHours() - 1) : 7) * PXH;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Touch gestures: vertical drag = native scroll, horizontal = day swipe,
  // press-and-hold = paint (Apple Calendar style). Listeners are non-passive
  // so paint can stop the scroll; attached once and read live state via ctx.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let g: { sx: number; sy: number; mode: 'idle' | 'scroll' | 'swipe' | 'paint'; dx: number; timer: number; paint: { start: number; add: boolean; base: Set<number> } } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { g = null; return; }
      const t = e.touches[0]!;
      g = { sx: t.clientX, sy: t.clientY, mode: 'idle', dx: 0, timer: 0, paint: { start: 0, add: false, base: new Set(ctx.current.cells) } };
      if (ctx.current.mode === 'paint') {
        const gg = g;
        gg.timer = window.setTimeout(() => {
          if (!g || g !== gg || g.mode !== 'idle') return;
          g.mode = 'paint';
          const c = cellAtClientY(g.sy);
          g.paint.start = c;
          g.paint.add = !ctx.current.cells.has(c);
          try { navigator.vibrate?.(10); } catch { /* unsupported */ }
          paintRange(c, g.paint);
        }, LONGPRESS_MS);
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - g.sx, dy = t.clientY - g.sy;
      g.dx = dx;
      if (g.mode === 'idle' && Math.max(Math.abs(dx), Math.abs(dy)) > JITTER) {
        clearTimeout(g.timer);
        g.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
      }
      if (g.mode === 'paint') { e.preventDefault(); paintRange(cellAtClientY(t.clientY), g.paint); }
      else if (g.mode === 'swipe') e.preventDefault();
      // 'scroll' → let the browser scroll natively
    };
    const onEnd = (e: TouchEvent) => {
      lastTouch.current = Date.now();
      if (!g) return;
      clearTimeout(g.timer);
      const cur = g;
      g = null;
      if (cur.mode === 'idle') {
        e.preventDefault(); // no ghost click
        const c = cellAtClientY(cur.sy);
        if (ctx.current.mode === 'paint') {
          if (c >= ctx.current.now) { const n = new Set(ctx.current.cells); n.has(c) ? n.delete(c) : n.add(c); ctx.current.onChange?.(n); }
        } else if (ctx.current.mode === 'claim') claimAt(c);
      } else if (cur.mode === 'swipe' && Math.abs(cur.dx) > SWIPE) {
        ctx.current.go(cur.dx < 0 ? 1 : -1);
      }
    };
    const onCancel = () => { if (g) clearTimeout(g.timer); g = null; };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onCancel);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  // Mouse (desktop): drag paints immediately, click toggles/claims. The guard
  // ignores the synthetic mouse events that follow a touch.
  const onMouseDown = (e: MouseEvent) => {
    if (Date.now() - lastTouch.current < 500 || ctx.current.mode !== 'paint') return;
    const c = cellAtClientY(e.clientY);
    const st = { start: c, add: !ctx.current.cells.has(c), base: new Set(ctx.current.cells) };
    mdown.current = st;
    if (c >= ctx.current.now) paintRange(c, st);
  };
  const onMouseMove = (e: MouseEvent) => { if (mdown.current) paintRange(cellAtClientY(e.clientY), mdown.current); };
  const onMouseUp = () => { mdown.current = null; };
  const onClick = (e: MouseEvent) => {
    if (Date.now() - lastTouch.current < 500) return;
    if (ctx.current.mode === 'claim') claimAt(cellAtClientY(e.clientY));
  };

  const block = (s: number, e: number) => {
    const a = Math.max(s - dayStart, 0), b = Math.min(e - dayStart, HOURS * 60);
    return { top: timeToY(a), height: Math.max(3, timeToY(b) - timeToY(a)), hidden: b <= a };
  };

  const date = new Date(dayStart * 60000);
  const nowOfDay = new Date().getHours() * 60 + new Date().getMinutes();

  return (
    <div class="daycal">
      <div class="daycal-head">
        <button type="button" class="daycal-nav" onClick={() => go(-1)} aria-label="Previous day" disabled={!days.some((_, i) => i < dayIdx && dayUsable(i))}>‹</button>
        <div class="daycal-date">{DATE_FULL.format(date)}{isToday ? ' · Today' : ''}</div>
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
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={onClick}
      >
        <div class="daycal-grid" style={{ height: `${GRID_H}px` }}>
          {Array.from({ length: HOURS + 1 }, (_, h) => (
            <div key={h} class="daycal-hr" style={{ top: `${h * PXH}px` }}>
              <span class="daycal-hrlabel">{h < HOURS ? fmtTime(dayStart + h * 60) : ''}</span>
            </div>
          ))}

          {busy.map(([s, e], i) => {
            const b = block(s, e);
            return b.hidden ? null : <div key={`b${i}`} class="daycal-busy" style={{ top: `${b.top}px`, height: `${b.height}px` }} />;
          })}
          {wins.map(([s, e], i) => {
            const b = block(s, e);
            return b.hidden ? null : <div key={`w${i}`} class={`daycal-free ${mode === 'claim' ? 'tappable' : ''}`} style={{ top: `${b.top}px`, height: `${b.height}px` }} />;
          })}
          {booked.map(([s, e], i) => {
            const b = block(s, e);
            return b.hidden ? null : <div key={`k${i}`} class="daycal-taken" style={{ top: `${b.top}px`, height: `${b.height}px` }}><span>taken</span></div>;
          })}
          {isToday && <div class="daycal-now" style={{ top: `${timeToY(nowOfDay)}px` }} />}
        </div>
      </div>

      <div class="daycal-foot">
        <span class="muted small-text">
          {mode === 'paint'
            ? `${slots.length} ${fmtDuration(durationMin)} slot${slots.length === 1 ? '' : 's'} · hold to paint, swipe for days`
            : mode === 'claim'
              ? 'Tap a green slot to grab it · swipe for days'
              : 'Swipe for days'}
        </span>
      </div>
    </div>
  );
}
