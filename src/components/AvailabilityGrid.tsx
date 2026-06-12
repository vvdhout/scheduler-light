import { useMemo, useRef, useState } from 'preact/hooks';
import type { Win } from '../lib/model';
import { cellsToWindows, deriveSlots, nowMin, overlaps } from '../lib/model';
import { fmtDuration, fmtTime } from '../lib/time';

const CELL_MIN = 30;
const DAY_CHIP_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAY_NUM_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

interface Props {
  days: number[]; // local-midnight epoch minutes
  cells: Set<number>;
  onChange: (cells: Set<number>) => void;
  durationMin: number;
  busy?: Win[];
  booked?: Win[];
}

export function AvailabilityGrid({ days, cells, onChange, durationMin, busy = [], booked = [] }: Props) {
  const [dayIdx, setDayIdx] = useState(0);
  const [allHours, setAllHours] = useState(false);
  // `next` accumulates the whole stroke: building from the `cells` prop on
  // each move loses cells when several moves land between re-renders.
  // `last` is the previous pointer position — fast moves get interpolated so
  // coalesced pointer events can't skip rows.
  const paint = useRef<{ add: boolean; touched: Set<number>; next: Set<number>; last: { x: number; y: number } } | null>(null);
  const now = nowMin();

  const dayStart = days[dayIdx] ?? days[0]!;
  const rows = useMemo(() => {
    const from = allHours ? 0 : 7 * 60;
    const to = allHours ? 24 * 60 : 23 * 60;
    const out: number[] = [];
    for (let m = from; m < to; m += CELL_MIN) out.push(dayStart + m);
    return out;
  }, [dayStart, allHours]);

  const countFor = (start: number) => {
    let n = 0;
    for (const c of cells) if (c >= start && c < start + 1440) n++;
    return n;
  };

  // What a visitor would actually see: duration-length slots fitting inside
  // painted windows, minus booked ranges. Painted cells covered by no slot
  // are "dead" — usually a block shorter than the duration.
  const slots = useMemo(
    () => deriveSlots({ durationMin, stepMin: CELL_MIN, windows: cellsToWindows(cells, CELL_MIN) }, booked, now),
    [cells, durationMin, booked, now],
  );
  const deadCells = useMemo(() => {
    const dead = new Set<number>();
    for (const c of cells) {
      if (c >= now && !slots.some(([s, e]) => overlaps(c, c + CELL_MIN, s, e))) dead.add(c);
    }
    return dead;
  }, [cells, slots, now]);

  const apply = (cell: number) => {
    const p = paint.current;
    if (!p || p.touched.has(cell) || cell < now) return;
    p.touched.add(cell);
    if (p.add) p.next.add(cell);
    else p.next.delete(cell);
    onChange(new Set(p.next));
  };

  const cellFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-cell]');
    return el ? Number((el as HTMLElement).dataset.cell) : null;
  };

  const paintTo = (x: number, y: number) => {
    const p = paint.current;
    if (!p) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - p.last.x, y - p.last.y) / 8));
    for (let i = 1; i <= steps; i++) {
      const cell = cellFromPoint(p.last.x + ((x - p.last.x) * i) / steps, p.last.y + ((y - p.last.y) * i) / steps);
      if (cell != null) apply(cell);
    }
    p.last = { x, y };
  };

  return (
    <div class="grid">
      <div class="day-chips" role="tablist">
        {days.map((d, i) => {
          const date = new Date(d * 60000);
          const n = countFor(d);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={i === dayIdx}
              class={`chip ${i === dayIdx ? 'on' : ''}`}
              onClick={() => setDayIdx(i)}
            >
              <span class="chip-wd">{i === 0 ? 'Today' : DAY_CHIP_FMT.format(date)}</span>
              <span class="chip-day">{DAY_NUM_FMT.format(date)}</span>
              {n > 0 && <span class="chip-dot" aria-label={`${n} slots selected`} />}
            </button>
          );
        })}
      </div>

      <p class="grid-hint muted small-text">Drag on the grid to paint · scroll with the dotted bar</p>

      <div class="cells-wrap">
        <div class="scroll-rail" aria-hidden="true" />
        <div
          class="cells"
          onPointerDown={(e) => {
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (cell == null || cell < now) return;
            e.preventDefault();
            paint.current = { add: !cells.has(cell), touched: new Set(), next: new Set(cells), last: { x: e.clientX, y: e.clientY } };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            apply(cell);
          }}
          onPointerMove={(e) => {
            if (paint.current) paintTo(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            paintTo(e.clientX, e.clientY);
            paint.current = null;
          }}
          onPointerCancel={() => (paint.current = null)}
        >
          {rows.map((cell) => {
            const isHour = (cell - dayStart) % 60 === 0;
            const past = cell < now;
            const isBusy = busy.some(([s, e]) => overlaps(cell, cell + CELL_MIN, s, e));
            const isBooked = booked.some(([s, e]) => overlaps(cell, cell + CELL_MIN, s, e));
            const on = cells.has(cell);
            const dead = on && deadCells.has(cell);
            const deadRunStart = dead && !deadCells.has(cell - CELL_MIN);
            return (
              <div key={cell} class="cell-row">
                <span class="cell-label">{isHour ? fmtTime(cell) : ''}</span>
                <div
                  data-cell={cell}
                  class={`cell ${isHour ? 'hr' : ''} ${on ? 'on' : ''} ${dead ? 'dead' : ''} ${past ? 'past' : ''} ${isBusy ? 'busy' : ''} ${isBooked ? 'booked' : ''}`}
                  aria-disabled={past}
                >
                  {isBooked && <span class="cell-tag">booked</span>}
                  {!isBooked && isBusy && <span class="cell-tag">busy</span>}
                  {!isBooked && !isBusy && deadRunStart && <span class="cell-tag dead-tag">too short</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Below the grid: its height changes with the message, and anything
          above the cells shifting mid-stroke breaks painting. */}
      <p class={`grid-meta small-text ${cells.size > 0 && slots.length === 0 ? 'error' : 'muted'}`}>
        {cells.size === 0
          ? `Paint blocks of at least ${fmtDuration(durationMin)} to create bookable slots.`
          : slots.length === 0
            ? `No bookable slots yet — paint blocks of at least ${fmtDuration(durationMin)}.`
            : `${slots.length} bookable ${fmtDuration(durationMin)} slot${slots.length === 1 ? '' : 's'} this week.`}
      </p>
      <button type="button" class="ghost small" onClick={() => setAllHours(!allHours)}>
        {allHours ? 'Show 07:00 – 23:00' : 'Show all hours'}
      </button>
    </div>
  );
}
