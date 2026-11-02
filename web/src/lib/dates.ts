// Civil dates for events and formats, built on Temporal.
//
// Dates are stored as `YYYY-MM-DD` strings (no time, no zone). "Today" is
// always the day it is in Paris, whatever the zone of the browser.
//
// `Temporal` is only touched inside functions, never at module scope: Safari
// loads the polyfill after the static imports have run (see ./temporal.ts).

export const PARIS = "Europe/Paris";

/** The dates of an event: a single day when there is no end date. */
type EventDates = { start_date: string; end_date?: string };

/** The current day in Paris. `now` is injectable for tests. */
export function today(now?: Temporal.Instant): Temporal.PlainDate {
  return (now ?? Temporal.Now.instant()).toZonedDateTimeISO(PARIS).toPlainDate();
}

/**
 * Milliseconds from `now` to the next midnight in Paris: the instant when
 * `today()` changes. A day is 23 or 25 hours long when the clocks change.
 */
export function msUntilTomorrow(now: Temporal.Instant): number {
  const midnight = now
    .toZonedDateTimeISO(PARIS)
    .toPlainDate()
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: PARIS });
  return midnight.epochMilliseconds - now.epochMilliseconds;
}

/** Reads a `YYYY-MM-DD` string. Throws a RangeError when it is not a real date. */
export function parseDate(s: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(s);
}

/**
 * The day a format takes place: its own date when it has one, otherwise the
 * start of its event. An empty string counts as no date (that is how an empty
 * text field comes back from the API).
 */
export function effectiveDate(
  format: { date?: string },
  event: { start_date: string },
): Temporal.PlainDate {
  return parseDate(format.date || event.start_date);
}

/**
 * Whether the race of a format has started: its day (see `effectiveDate`) is
 * `asOf` (today, for the screens) or before. The day itself counts. Nobody can
 * say they have finished a race, or given up on it, before that.
 */
export function raceStarted(
  format: { date?: string },
  event: { start_date: string },
  asOf: Temporal.PlainDate,
): boolean {
  return Temporal.PlainDate.compare(effectiveDate(format, event), asOf) <= 0;
}

/** First and last day of an event, both included. */
export function eventRange(event: EventDates): {
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
} {
  const start = parseDate(event.start_date);
  const end = event.end_date ? parseDate(event.end_date) : start;
  return { start, end };
}

/** Every day of an event, from its first to its last day. */
export function eventDays(event: EventDates): Temporal.PlainDate[] {
  const { start, end } = eventRange(event);
  const days: Temporal.PlainDate[] = [];
  for (let day = start; Temporal.PlainDate.compare(day, end) <= 0; day = day.add({ days: 1 })) {
    days.push(day);
  }
  return days;
}

/** Whether the event is not over yet: its last day is `asOf` or later. */
export function isUpcoming(event: EventDates, asOf: Temporal.PlainDate): boolean {
  return Temporal.PlainDate.compare(eventRange(event).end, asOf) >= 0;
}

/** Whether any day of the event falls in `from` to `to`, both included. */
export function overlaps(
  event: EventDates,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): boolean {
  const { start, end } = eventRange(event);
  return Temporal.PlainDate.compare(start, to) <= 0 && Temporal.PlainDate.compare(end, from) >= 0;
}

/**
 * Groups items by the month of their date. Nothing is reordered: groups come
 * in order of first appearance and items keep their order, so sorted input
 * gives chronological groups.
 */
export function groupByMonth<T>(
  items: T[],
  dateOf: (t: T) => Temporal.PlainDate,
): { month: Temporal.PlainYearMonth; items: T[] }[] {
  const groups = new Map<string, { month: Temporal.PlainYearMonth; items: T[] }>();
  for (const item of items) {
    const month = dateOf(item).toPlainYearMonth();
    const key = month.toString();
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { month, items: [item] });
    }
  }
  return [...groups.values()];
}

/**
 * The weeks to draw for a month: full rows of 7 days, from the first day of
 * the week on or before the 1st to the last day of the week on or after the
 * last day of the month. `firstDay` is the ISO day of the week the rows start
 * on: 1 is Monday, 7 is Sunday.
 */
export function monthGrid(
  month: Temporal.PlainYearMonth,
  firstDay: number,
): Temporal.PlainDate[][] {
  if (!Number.isInteger(firstDay) || firstDay < 1 || firstDay > 7) {
    throw new RangeError(`firstDay must be an integer from 1 (Monday) to 7 (Sunday): ${firstDay}`);
  }
  const first = month.toPlainDate({ day: 1 });
  const last = month.toPlainDate({ day: month.daysInMonth });
  const before = (first.dayOfWeek - firstDay + 7) % 7;
  // The week ends on the day before `firstDay`, which is ISO day `firstDay - 1`
  // (7 when `firstDay` is 1).
  const after = (((firstDay - 1 - last.dayOfWeek) % 7) + 7) % 7;

  const weeks: Temporal.PlainDate[][] = [];
  let day = first.subtract({ days: before });
  const end = last.add({ days: after });
  while (Temporal.PlainDate.compare(day, end) <= 0) {
    const week: Temporal.PlainDate[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = day.add({ days: 1 });
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * The days left before an event, for a countdown (a ring, a figure): the days
 * from `asOf` (today) to its first day, 0 on that day and while it is under
 * way, and null once its last day is over (it has none). The words of a card
 * or a hero say them beside the picture.
 */
export function daysToGo(
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  asOf: Temporal.PlainDate,
): number | null {
  if (Temporal.PlainDate.compare(end, asOf) < 0) return null;
  return Math.max(0, daysBetween(asOf, start));
}

/** Whole days from `from` to `to`: negative when `to` comes first. */
export function daysBetween(from: Temporal.PlainDate, to: Temporal.PlainDate): number {
  return from.until(to, { largestUnit: "day" }).days;
}

/**
 * Reads a date-time of PocketBase, `YYYY-MM-DD HH:MM:SS.sssZ` (UTC): a space
 * stands where ISO 8601 has a `T`. Throws a RangeError when it is not one,
 * an empty string included.
 */
export function instantOf(pocketbaseDate: string): Temporal.Instant {
  return Temporal.Instant.from(pocketbaseDate.replace(" ", "T"));
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// A month is 30 days and a year 365, counted on the calendar: a year is not 12
// months, so the months stop at 11.
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;
const MAX_MONTHS = 11;

/**
 * How long ago `from` was, as the biggest whole unit that fits, in the shape
 * `Intl.RelativeTimeFormat` takes: a negative value for the past, rounded
 * toward zero (59 minutes is not "1 hour").
 *
 * - under a minute: 0 seconds, which reads "maintenant" (a comment from the
 *   future, because the clock of the browser is late, counts as now too);
 * - then minutes, then hours up to 24 of them;
 * - from a day on, days on the calendar of Paris, not spans of 24 hours: what
 *   happened the day before is "hier" whatever the hour, and 47 hours ago can
 *   be the day before yesterday. Then months (from 30 days) and years (from
 *   365 days).
 */
export function elapsed(
  from: Temporal.Instant,
  now: Temporal.Instant,
): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const ms = now.epochMilliseconds - from.epochMilliseconds;
  if (ms < MINUTE) return { value: 0, unit: "second" };
  if (ms < HOUR) return { value: -Math.trunc(ms / MINUTE), unit: "minute" };
  if (ms < DAY) return { value: -Math.trunc(ms / HOUR), unit: "hour" };

  const days = daysBetween(today(from), today(now));
  // On the day the clocks go back (25 hours long), 24 hours after 00:30 is
  // still the same day: it is hours, not a day.
  if (days === 0) return { value: -Math.trunc(ms / HOUR), unit: "hour" };
  if (days < MONTH_DAYS) return { value: -days, unit: "day" };
  if (days < YEAR_DAYS) {
    return { value: -Math.min(MAX_MONTHS, Math.trunc(days / MONTH_DAYS)), unit: "month" };
  }
  return { value: -Math.trunc(days / YEAR_DAYS), unit: "year" };
}
