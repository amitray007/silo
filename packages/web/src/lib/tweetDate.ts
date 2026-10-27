const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
/** X's `created_at`: `Sat Oct 10 06:36:53 +0000 2026`. */
const X_DATE = /^\w{3} (\w{3}) (\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/;

/** Reads X's date format by hand (Safari rejects it) and falls back to ISO. */
export function parseTweetDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const match = X_DATE.exec(raw.trim());
  let iso = raw;
  if (match) {
    const [, mon, day, time, sign, zh, zm, year] = match;
    const month = MONTHS.indexOf(mon ?? '') + 1;
    if (!month) return null;
    iso = `${year}-${String(month).padStart(2, '0')}-${day}T${time}${sign}${zh}:${zm}`;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** X's own footer shape, in the reader's local time: `6:36 AM · Oct 10, 2026`. */
export function formatTweetDate(date: Date, locale?: string, timeZone?: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const day = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });
  return `${time.format(date)} · ${day.format(date)}`;
}
