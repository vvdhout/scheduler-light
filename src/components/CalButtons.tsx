import { downloadIcs, googleUrl, outlookUrl } from '../lib/calendar';

interface Props {
  title: string;
  start: number;
  end: number;
  details?: string;
}

export function CalButtons({ title, start, end, details = '' }: Props) {
  return (
    <div class="cal-buttons">
      <a class="ghost small" href={googleUrl(title, start, end, details)} target="_blank" rel="noopener noreferrer">
        Google
      </a>
      <a class="ghost small" href={outlookUrl(title, start, end, details)} target="_blank" rel="noopener noreferrer">
        Outlook
      </a>
      <button type="button" class="ghost small" onClick={() => downloadIcs(title, start, end, details)}>
        .ics
      </button>
    </div>
  );
}
