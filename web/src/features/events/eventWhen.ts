import type { Messages } from "../../i18n/fr";
import { isMonthOnly } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { EventView } from "./api";

/** « juin 2027 · date à préciser »: the month of `start`. */
function monthText(start: Temporal.PlainDate, f: Formatters, t: Messages): string {
  return t.event.monthWhen(f.monthTitle(start.toPlainYearMonth()));
}

/**
 * What a race says of its days, wherever it says them: the day (« sam. 13 juin »),
 * the first and last day (« du sam. 13 juin au dim. 14 juin »), or, for a race
 * known by its month only, « juin 2027 · date à préciser ». `style` is `short`
 * (no year, the default) or `long` (with the year; a month always has its year).
 */
export function eventWhen(
  view: { event: { date_precision?: string }; start: EventView["start"]; end: EventView["end"] },
  f: Formatters,
  t: Messages,
  style: "short" | "long" = "short",
): string {
  const { event, start, end } = view;
  if (isMonthOnly(event)) return monthText(start, f, t);
  const day = (d: Temporal.PlainDate) => (style === "long" ? f.dateLong(d) : f.date(d));
  return start.equals(end) ? day(start) : t.event.dateRange(day(start), day(end));
}

/**
 * The day of a participation, or the month of its race when it is known by its
 * month only: the same words as `eventWhen`, for the rows that show one day.
 */
export function dayOrMonth(
  event: { start_date: string; date_precision?: string },
  day: Temporal.PlainDate,
  f: Formatters,
  t: Messages,
  style: "short" | "long" = "short",
): string {
  if (isMonthOnly(event)) return monthText(Temporal.PlainDate.from(event.start_date), f, t);
  return style === "long" ? f.dateLong(day) : f.date(day);
}
