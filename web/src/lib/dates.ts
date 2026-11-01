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

/** Whole days from `from` to `to`: negative when `to` comes first. */
export function daysBetween(from: Temporal.PlainDate, to: Temporal.PlainDate): number {
  return from.until(to, { largestUnit: "day" }).days;
}
