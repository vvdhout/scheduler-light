import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Win } from '../lib/model';
import { cellsToWindows, nowMin } from '../lib/model';
import { fmtTime } from '../lib/time';

const CELL_MIN = 30;
const PXH = 36; // px per hour (the hours scroll vertically)
const HOURS = 24;
const GRID_H = HOURS * PXH;
const LONGPRESS_MS = 320;
const JITTER = 8;
const SWIPE = 45;
const WD = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DNUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const DATE_FULL = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const RANGE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
// Desktop shows multiple days side by side; mobile (1) keeps the original view.
const colsFor = (w: number) => (w >= 1024 ? 7 : w >= 640 ? 3 : 1);

type Mode = 'paint' | 'select' | 'readonly';

interface Props {
  days: number[];
  mode: Mode;
  cells?: Set<number>; // paint mode availability
  onChange?: (c: Set<number>) => void;
  windows?: Win[]; // select/readonly: available (free) ranges to show & constrain to
  busy?: Win[]; // own-calendar overlay
  booked?: Win[]; // taken ranges
  onSelect?: (sel: Win | null) => void; // select mode: the visitor's painted range
  hint?: string; // shown centered over the grid until the user paints/selects
}

export function DayCalendar({ days, mode, cells, onChange, windows, busy = [], booked = [], onSelect, hint }: Props) {
  const now = nowMin();
  const wins = useMemo(
    () => (mode === 'paint' ? cellsToWindows(cells ?? new Set(), CELL_MIN) : windows ?? []),
    [mode, cells, windows],
  );
  const winsOnDay = (d: number) => wins.some(([s, e]) => s < d + 1440 && d < e);
  const cellsOnDay = (d: number) => {
    let n = 0;
    for (const c of cells ?? []) if (c >= d && c < d + 1440) n++;
    return n;
  };
  const dayUsable = (i: number) => (mode === 'paint' ? true : winsOnDay(days[i]!));

  const [dayIdx, setDayIdx] = useState(0);
  const [sel, setSel] = useState<Win | null>(null);
  // Responsive: 1 day (mobile, original), 3 or 7 (desktop).
  const [cols, setCols] = useState(() => (typeof window !== 'undefined' ? colsFor(window.innerWidth) : 1));
  const [viewStart, setViewStart] = useState(0); // desktop: first visible day index
  useEffect(() => {
    const onResize = () => setCols(colsFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (mode === 'paint') return;
    if (!dayUsable(dayIdx)) {
      const j = days.findIndex((_, i) => dayUsable(i));
      if (j >= 0) setDayIdx(j);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wins]);

  const dayStart = days[dayIdx] ?? days[0]!;
  const isToday = dayIdx === 0;
  const weekStart = Math.floor(dayIdx / 7) * 7; // 7-day window shown in the strip

  const [anim, setAnim] = useState(0); // bump to replay the slide animation
  const dir = useRef<'fwd' | 'back'>('fwd');
  const swipedAt = useRef(0); // suppress the tap that ends a strip swipe
  const stripTouch = useRef<{ x: number; y: number } | null>(null);

  const setDay = (j: number) => {
    if (j < 0 || j >= days.length || j === dayIdx) return;
    dir.current = j > dayIdx ? 'fwd' : 'back';
    setDayIdx(j);
    setSel(null);
    onSelect?.(null);
    setAnim((a) => a + 1);
  };
  // Swipe the calendar = move one day (skipping empty days in select mode).
  const go = (d: 1 | -1) => {
    let j = dayIdx + d;
    while (j >= 0 && j < days.length && !dayUsable(j)) j += d;
    setDay(j);
  };
  // Header ‹ › and swiping the date row = jump a week, keeping the weekday.
  const goWeek = (d: 1 | -1) => {
    const ns = weekStart + d * 7;
    if (ns < 0 || ns >= days.length) return;
    let target = Math.min(days.length - 1, ns + (dayIdx - weekStart));
    if (mode !== 'paint' && !dayUsable(target)) {
      const u = days.findIndex((_, i) => i >= ns && i < ns + 7 && dayUsable(i));
      if (u >= 0) target = u;
    }
    setDay(target);
  };

  const body = useRef<HTMLDivElement>(null);
  const deskBody = useRef<HTMLDivElement>(null);
  const colwrap = useRef<HTMLDivElement>(null);
  const lastTouch = useRef(0);
  const mdown = useRef<{ anchor: number; add: boolean; base: Set<number> } | null>(null);
  const mdesk = useRef<{ day: number; anchor: number; add: boolean; base: Set<number> } | null>(null);

  const ctx = useRef<{
    mode: Mode; dayStart: number; cells: Set<number>; onChange?: (c: Set<number>) => void;
    wins: Win[]; now: number; onSelect?: (s: Win | null) => void; setSel: (s: Win | null) => void; go: (d: 1 | -1) => void;
  }>(null!);
  ctx.current = { mode, dayStart, cells: cells ?? new Set(), onChange, wins, now, onSelect, setSel, go };

  const timeToY = (mid: number) => (mid / 60) * PXH;
  const cellAtClientY = (clientY: number) => {
    const el = body.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    const snapped = Math.floor((y / PXH) * 60 / CELL_MIN) * CELL_MIN;
    return ctx.current.dayStart + Math.min(Math.max(snapped, 0), HOURS * 60 - CELL_MIN);
  };
  const paintRange = (anchor: number, cur: number, add: boolean, base: Set<number>) => {
    const lo = Math.min(anchor, cur), hi = Math.max(anchor, cur);
    const next = new Set(base);
    for (let c = lo; c <= hi; c += CELL_MIN) {
      if (c < ctx.current.now) continue;
      add ? next.add(c) : next.delete(c);
    }
    ctx.current.onChange?.(next);
  };
  const selectRange = (anchor: number, cur: number) => {
    const seg = ctx.current.wins.find(([s, e]) => anchor >= s && anchor < e);
    if (!seg) return;
    const start = Math.max(seg[0], Math.min(anchor, cur));
    const end = Math.min(seg[1], Math.max(anchor, cur) + CELL_MIN);
    if (end <= start) return;
    ctx.current.setSel([start, end]);
    ctx.current.onSelect?.([start, end]);
  };

  // ----- desktop window + geometry -----
  const winStart = Math.min(viewStart, Math.max(0, days.length - cols));
  const visibleDays = days.slice(winStart, winStart + cols);
  const todayVisible = winStart === 0;
  const deskRef = useRef<{ cols: number; visibleDays: number[] }>({ cols, visibleDays });
  deskRef.current = { cols, visibleDays };
  const minutesAtY = (clientY: number) => {
    const el = deskBody.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    const snapped = Math.floor((y / PXH) * 60 / CELL_MIN) * CELL_MIN;
    return Math.min(Math.max(snapped, 0), HOURS * 60 - CELL_MIN);
  };
  const dayAtX = (clientX: number) => {
    const cw = colwrap.current;
    if (!cw) return visibleDays[0]!;
    const r = cw.getBoundingClientRect();
    let i = Math.floor(((clientX - r.left) / r.width) * cols);
    i = Math.min(Math.max(i, 0), cols - 1);
    return visibleDays[i] ?? visibleDays[0]!;
  };
  const blockFor = (cd: number, s: number, e: number) => {
    const a = Math.max(s - cd, 0), b = Math.min(e - cd, HOURS * 60);
    return { top: timeToY(a), height: Math.max(3, timeToY(b) - timeToY(a)), hidden: b <= a };
  };

  // Open scrolled so the current time is in view (whichever body is active).
  useLayoutEffect(() => {
    const el = cols === 1 ? body.current : deskBody.current;
    if (!el) return;
    const nowMid = new Date().getHours() * 60 + new Date().getMinutes();
    const atToday = cols === 1 ? isToday : todayVisible;
    const target = atToday ? Math.max(0, (nowMid / 60 - 1.5) * PXH) : 7 * PXH;
    el.scrollTop = target;
    const r = requestAnimationFrame(() => { el.scrollTop = target; });
    return () => cancelAnimationFrame(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols]);

  // Mobile touch: vertical drag scrolls, horizontal swipes days, press-and-hold draws.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let g: { sx: number; sy: number; mode: 'idle' | 'scroll' | 'swipe' | 'draw'; dx: number; timer: number; anchor: number; add: boolean; base: Set<number> } | null = null;

    const startDraw = () => {
      if (!g) return;
      g.mode = 'draw';
      g.anchor = cellAtClientY(g.sy);
      try { navigator.vibrate?.(10); } catch { /* unsupported */ }
      if (ctx.current.mode === 'paint') {
        g.add = !ctx.current.cells.has(g.anchor);
        g.base = new Set(ctx.current.cells);
        paintRange(g.anchor, g.anchor, g.add, g.base);
      } else {
        selectRange(g.anchor, g.anchor);
      }
    };
    const draw = (cur: number) => {
      if (!g) return;
      if (ctx.current.mode === 'paint') paintRange(g.anchor, cur, g.add, g.base);
      else selectRange(g.anchor, cur);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { g = null; return; }
      const t = e.touches[0]!;
      g = { sx: t.clientX, sy: t.clientY, mode: 'idle', dx: 0, timer: 0, anchor: 0, add: false, base: new Set() };
      if (ctx.current.mode !== 'readonly') {
        const gg = g;
        gg.timer = window.setTimeout(() => { if (g === gg && g.mode === 'idle') startDraw(); }, LONGPRESS_MS);
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
      if (g.mode === 'draw') { e.preventDefault(); draw(cellAtClientY(t.clientY)); }
      else if (g.mode === 'swipe') e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      lastTouch.current = Date.now();
      if (!g) return;
      clearTimeout(g.timer);
      const cur = g;
      g = null;
      if (cur.mode === 'idle') {
        e.preventDefault();
        const c = cellAtClientY(cur.sy);
        if (ctx.current.mode === 'paint') {
          if (c >= ctx.current.now) { const n = new Set(ctx.current.cells); n.has(c) ? n.delete(c) : n.add(c); ctx.current.onChange?.(n); }
        } else if (ctx.current.mode === 'select') selectRange(c, c);
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
  }, [cols]);

  // Desktop touch: press-and-hold to draw within a column; vertical drag scrolls.
  useEffect(() => {
    const el = deskBody.current;
    if (!el || cols === 1) return;
    let g: { sx: number; sy: number; mode: 'idle' | 'scroll' | 'draw'; timer: number; day: number; anchor: number; add: boolean; base: Set<number> } | null = null;
    const minAtY = (cy: number) => {
      const y = cy - el.getBoundingClientRect().top + el.scrollTop;
      const sn = Math.floor((y / PXH) * 60 / CELL_MIN) * CELL_MIN;
      return Math.min(Math.max(sn, 0), HOURS * 60 - CELL_MIN);
    };
    const dayAt = (cx: number) => {
      const cw = colwrap.current;
      const { cols: c, visibleDays: vd } = deskRef.current;
      if (!cw) return vd[0]!;
      const r = cw.getBoundingClientRect();
      let i = Math.floor(((cx - r.left) / r.width) * c);
      i = Math.min(Math.max(i, 0), c - 1);
      return vd[i] ?? vd[0]!;
    };
    const startDraw = () => {
      if (!g) return;
      g.mode = 'draw';
      g.day = dayAt(g.sx);
      g.anchor = g.day + minAtY(g.sy);
      try { navigator.vibrate?.(10); } catch { /* unsupported */ }
      if (ctx.current.mode === 'paint') {
        g.add = !ctx.current.cells.has(g.anchor);
        g.base = new Set(ctx.current.cells);
        paintRange(g.anchor, g.anchor, g.add, g.base);
      } else selectRange(g.anchor, g.anchor);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { g = null; return; }
      const t = e.touches[0]!;
      g = { sx: t.clientX, sy: t.clientY, mode: 'idle', timer: 0, day: 0, anchor: 0, add: false, base: new Set() };
      if (ctx.current.mode !== 'readonly') {
        const gg = g;
        gg.timer = window.setTimeout(() => { if (g === gg && g.mode === 'idle') startDraw(); }, LONGPRESS_MS);
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      if (!t) return;
      if (g.mode === 'idle' && Math.max(Math.abs(t.clientX - g.sx), Math.abs(t.clientY - g.sy)) > JITTER) {
        clearTimeout(g.timer);
        g.mode = 'scroll';
      }
      if (g.mode === 'draw') {
        e.preventDefault();
        const cur = g.day + minAtY(t.clientY);
        if (ctx.current.mode === 'paint') paintRange(g.anchor, cur, g.add, g.base);
        else selectRange(g.anchor, cur);
      }
    };
    const onEnd = (e: TouchEvent) => {
      lastTouch.current = Date.now();
      if (!g) return;
      clearTimeout(g.timer);
      const cur = g;
      g = null;
      if (cur.mode === 'idle') {
        e.preventDefault();
        const c = dayAt(cur.sx) + minAtY(cur.sy);
        if (ctx.current.mode === 'paint') {
          if (c >= ctx.current.now) { const n = new Set(ctx.current.cells); n.has(c) ? n.delete(c) : n.add(c); ctx.current.onChange?.(n); }
        } else if (ctx.current.mode === 'select') selectRange(c, c);
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
  }, [cols]);

  // Mobile mouse (desktop with 1 col): drag draws, click toggles/selects.
  const onMouseDown = (e: MouseEvent) => {
    if (Date.now() - lastTouch.current < 500 || ctx.current.mode === 'readonly') return;
    const c = cellAtClientY(e.clientY);
    if (ctx.current.mode === 'paint') {
      const st = { anchor: c, add: !ctx.current.cells.has(c), base: new Set(ctx.current.cells) };
      mdown.current = st;
      if (c >= ctx.current.now) paintRange(c, c, st.add, st.base);
    } else {
      mdown.current = { anchor: c, add: false, base: new Set() };
      selectRange(c, c);
    }
  };
  const onMouseMove = (e: MouseEvent) => {
    const st = mdown.current;
    if (!st) return;
    if (ctx.current.mode === 'paint') paintRange(st.anchor, cellAtClientY(e.clientY), st.add, st.base);
    else selectRange(st.anchor, cellAtClientY(e.clientY));
  };
  const onMouseUp = () => { mdown.current = null; };

  // Desktop mouse: drag draws within the column it started in.
  const onDeskDown = (e: MouseEvent) => {
    if (Date.now() - lastTouch.current < 500 || mode === 'readonly') return;
    const day = dayAtX(e.clientX);
    const anchor = day + minutesAtY(e.clientY);
    if (mode === 'paint') {
      const st = { day, anchor, add: !ctx.current.cells.has(anchor), base: new Set(ctx.current.cells) };
      mdesk.current = st;
      if (anchor >= now) paintRange(anchor, anchor, st.add, st.base);
    } else {
      mdesk.current = { day, anchor, add: false, base: new Set() };
      selectRange(anchor, anchor);
    }
  };
  const onDeskMove = (e: MouseEvent) => {
    const st = mdesk.current;
    if (!st) return;
    const cur = st.day + minutesAtY(e.clientY);
    if (mode === 'paint') paintRange(st.anchor, cur, st.add, st.base);
    else selectRange(st.anchor, cur);
  };
  const onDeskUp = () => { mdesk.current = null; };

  const block = (s: number, e: number) => {
    const a = Math.max(s - dayStart, 0), b = Math.min(e - dayStart, HOURS * 60);
    return { top: timeToY(a), height: Math.max(3, timeToY(b) - timeToY(a)), hidden: b <= a };
  };

  const date = new Date(dayStart * 60000);
  const nowOfDay = new Date().getHours() * 60 + new Date().getMinutes();
  const selOnDay = sel && sel[0] >= dayStart && sel[0] < dayStart + 1440 ? sel : null;
  // Centered overlay hint until they've painted (paint) or marked a range (select).
  const showHint = !!hint && (mode === 'paint' ? (cells?.size ?? 0) === 0 : mode === 'select' ? sel === null : false);

  // ============================ MOBILE (1 day) ============================
  if (cols === 1) return (
    <div class="daycal">
      <div class="daycal-head">
        <button type="button" class="daycal-nav" onClick={() => goWeek(-1)} aria-label="Previous week" disabled={weekStart === 0}>‹</button>
        <div class="daycal-date">{DATE_FULL.format(date)}{isToday ? ' · Today' : ''}</div>
        <button type="button" class="daycal-nav" onClick={() => goWeek(1)} aria-label="Next week" disabled={weekStart + 7 >= days.length}>›</button>
      </div>

      <div
        class={`daycal-strip slide-${dir.current}`}
        key={`wk${weekStart}`}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) stripTouch.current = { x: t.clientX, y: t.clientY }; }}
        onTouchEnd={(e) => {
          const s = stripTouch.current; stripTouch.current = null;
          if (!s) return;
          const t = e.changedTouches[0];
          if (!t) return;
          const dx = t.clientX - s.x, dy = t.clientY - s.y;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swipedAt.current = Date.now(); goWeek(dx < 0 ? 1 : -1); }
        }}
      >
        {days.slice(weekStart, weekStart + 7).map((d, j) => {
          const i = weekStart + j;
          const dd = new Date(d * 60000);
          const usable = dayUsable(i);
          const has = mode === 'paint' ? cellsOnDay(d) > 0 : usable;
          return (
            <button
              key={d}
              type="button"
              class={`daycal-pip ${i === dayIdx ? 'on' : ''} ${!usable ? 'empty' : ''}`}
              disabled={!usable && mode !== 'paint'}
              onClick={() => { if (Date.now() - swipedAt.current < 300) return; setDay(i); }}
            >
              <span class="pip-wd">{WD.format(dd)}</span>
              <span class="pip-num">{DNUM.format(dd)}</span>
              {has && <span class="pip-dot" />}
            </button>
          );
        })}
      </div>

      <div class="daycal-bodywrap">
        <div class="daycal-body" ref={body} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <div class={`daycal-grid slide-${dir.current}`} key={`d${anim}`} style={{ height: `${GRID_H}px` }}>
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
            return b.hidden ? null : <div key={`w${i}`} class={`daycal-free ${mode === 'select' ? 'tappable' : ''}`} style={{ top: `${b.top}px`, height: `${b.height}px` }} />;
          })}
          {booked.map(([s, e], i) => {
            const b = block(s, e);
            return b.hidden ? null : <div key={`k${i}`} class="daycal-taken" style={{ top: `${b.top}px`, height: `${b.height}px` }}><span>taken</span></div>;
          })}
          {selOnDay && (() => {
            const b = block(selOnDay[0], selOnDay[1]);
            return <div class="daycal-sel" style={{ top: `${b.top}px`, height: `${b.height}px` }} />;
          })()}
          {isToday && <div class="daycal-now" style={{ top: `${timeToY(nowOfDay)}px` }} />}
        </div>
        </div>
        {showHint && <div class="daycal-hint" aria-hidden="true">{hint}</div>}
      </div>
    </div>
  );

  // ============================ DESKTOP (multi-day) ============================
  const rangeLabel = visibleDays.length
    ? `${RANGE_FMT.format(new Date(visibleDays[0]! * 60000))} – ${RANGE_FMT.format(new Date(visibleDays[visibleDays.length - 1]! * 60000))}`
    : '';
  return (
    <div class="daycal desk">
      <div class="daycal-toolbar">
        <button type="button" class="daycal-nav" onClick={() => setViewStart(Math.max(0, winStart - cols))} disabled={winStart === 0} aria-label="Previous">‹</button>
        <button type="button" class="daycal-today" onClick={() => setViewStart(0)} disabled={winStart === 0}>Today</button>
        <button type="button" class="daycal-nav" onClick={() => setViewStart(Math.min(Math.max(0, days.length - cols), winStart + cols))} disabled={winStart + cols >= days.length} aria-label="Next">›</button>
        <span class="daycal-range">{rangeLabel}</span>
      </div>

      <div class="daycal-colhead">
        <div class="daycal-gutsp" />
        {visibleDays.map((d, i) => {
          const dd = new Date(d * 60000);
          const isT = winStart + i === 0;
          const has = mode === 'paint' ? cellsOnDay(d) > 0 : dayUsable(winStart + i);
          return (
            <div class={`daycal-ch ${isT ? 'today' : ''}`} key={d}>
              <span class="pip-wd">{WD.format(dd)}</span>
              <span class="ch-num">{DNUM.format(dd)}</span>
              {has && <span class="pip-dot" />}
            </div>
          );
        })}
      </div>

      <div class="daycal-deskbody" ref={deskBody} onMouseDown={onDeskDown} onMouseMove={onDeskMove} onMouseUp={onDeskUp} onMouseLeave={onDeskUp}>
        <div class="daycal-deskgrid" style={{ height: `${GRID_H}px` }}>
          <div class="daycal-gutter">
            {Array.from({ length: HOURS + 1 }, (_, h) => (
              <span key={h} class="daycal-glabel" style={{ top: `${h * PXH}px` }}>{h < HOURS ? fmtTime((visibleDays[0] ?? days[0]!) + h * 60) : ''}</span>
            ))}
          </div>
          <div class="daycal-colwrap" ref={colwrap} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {Array.from({ length: HOURS + 1 }, (_, h) => (
              <div key={`hr${h}`} class="daycal-hr wide" style={{ top: `${h * PXH}px` }} />
            ))}
            {visibleDays.map((cd, ci) => {
              const selHere = sel && sel[0] >= cd && sel[0] < cd + 1440 ? sel : null;
              return (
                <div class="daycal-col" key={cd} style={{ gridColumn: ci + 1 }}>
                  {busy.map(([s, e], i) => { const b = blockFor(cd, s, e); return b.hidden ? null : <div key={`b${i}`} class="daycal-busy" style={{ top: `${b.top}px`, height: `${b.height}px` }} />; })}
                  {wins.map(([s, e], i) => { const b = blockFor(cd, s, e); return b.hidden ? null : <div key={`w${i}`} class={`daycal-free ${mode === 'select' ? 'tappable' : ''}`} style={{ top: `${b.top}px`, height: `${b.height}px` }} />; })}
                  {booked.map(([s, e], i) => { const b = blockFor(cd, s, e); return b.hidden ? null : <div key={`k${i}`} class="daycal-taken" style={{ top: `${b.top}px`, height: `${b.height}px` }}><span>taken</span></div>; })}
                  {selHere && (() => { const b = blockFor(cd, selHere[0], selHere[1]); return <div class="daycal-sel" style={{ top: `${b.top}px`, height: `${b.height}px` }} />; })()}
                </div>
              );
            })}
            {todayVisible && <div class="daycal-now wide" style={{ top: `${timeToY(nowOfDay)}px` }} />}
          </div>
        </div>
        {showHint && <div class="daycal-hint" aria-hidden="true">{hint}</div>}
      </div>
    </div>
  );
}
