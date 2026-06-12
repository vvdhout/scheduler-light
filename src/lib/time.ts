// Rendering helpers. Storage is UTC epoch minutes; everything here renders
// in the viewer's local timezone via Intl.

export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});

export const fmtTime = (min: number) => timeFmt.format(new Date(min * 60000));
export const fmtDay = (min: number) => dayFmt.format(new Date(min * 60000));

/** "Tue, Jun 16, 14:00 (CEST)" style stamp for copy-to-Discord messages. */
export const fmtFull = (min: number) => fullFmt.format(new Date(min * 60000));

/** Local-midnight epoch minutes for today + the next `days - 1` days. */
export function localDayStarts(days: number): number[] {
  const out: number[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    out.push(Math.floor(d.getTime() / 60000));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Local date key (YYYY-MM-DD in viewer tz) for grouping slots by day. */
export function localDayKey(min: number): string {
  const d = new Date(min * 60000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
