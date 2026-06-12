// "Add to calendar" targets: Google / Outlook URL templates and a client-side
// generated .ics download that covers Apple Calendar and everything else.

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC stamp like 20260616T120000Z from epoch minutes. */
function utcStamp(min: number): string {
  const d = new Date(min * 60000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

export function googleUrl(title: string, start: number, end: number, details = ''): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function outlookUrl(title: string, start: number, end: number, details = ''): string {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: new Date(start * 60000).toISOString(),
    enddt: new Date(end * 60000).toISOString(),
    body: details,
  });
  return `https://outlook.live.com/calendar/0/action/compose?${p}`;
}

export function downloadIcs(title: string, start: number, end: number, details = ''): void {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//scheduler-light//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@scheduler-light`,
    `DTSTAMP:${utcStamp(Math.floor(Date.now() / 60000))}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${title.replace(/[\\;,]/g, (c) => '\\' + c)}`,
    details ? `DESCRIPTION:${details.replace(/[\\;,]/g, (c) => '\\' + c)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w-]+/g, '-').toLowerCase() || 'event'}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
