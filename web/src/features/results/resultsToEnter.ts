import { daysBetween, effectiveDate } from "../../lib/dates";
import type {
  EventRecord,
  FormatRecord,
  ParticipationRecord,
  RaceTypeRecord,
} from "../../lib/types";

/** How long after a race its result is still asked for: older races are left alone. */
export const RESULTS_WINDOW_DAYS = 60;

/** The key of the query of the block: the changes of a participation refresh it (see `invalidateEvents`). */
export const RESULTS_TO_ENTER_KEY = ["results-to-enter"] as const;

/** The `expand` that gives `toEnterRow` everything it needs. */
export const RESULTS_EXPAND = "event,format.race_type";

/**
 * A race the runner is registered for, whose result they may have to enter:
 * the participation, and what it is on, with the race type that gives the
 * format its name. `date` is the day of the race (`effectiveDate`).
 */
export type ToEnter = {
  participation: ParticipationRecord;
  event: EventRecord;
  format: FormatRecord;
  raceType: RaceTypeRecord;
  date: Temporal.PlainDate;
};

// What the server sends for RESULTS_EXPAND. An expand that is empty is left
// out of the record, hence all the `?`.
export type RegisteredRecord = ParticipationRecord & {
  expand?: {
    event?: EventRecord;
    format?: FormatRecord & { expand?: { race_type?: RaceTypeRecord } };
  };
};

/**
 * One participation of the answer to a request made with `RESULTS_EXPAND`.
 * The shape is the server's contract: a participation that is registered is
 * on a format, so a record without its event, its format or the race type of
 * its format throws.
 */
export function toEnterRow(record: RegisteredRecord): ToEnter {
  const event = record.expand?.event;
  const format = record.expand?.format;
  const raceType = format?.expand?.race_type;
  if (!event || !format || !raceType) {
    throw new Error(
      `participation ${record.id}: its event, its format or the race type of its format is missing from the answer`,
    );
  }
  return { participation: record, event, format, raceType, date: effectiveDate(format, event) };
}

/**
 * The races whose result is to enter: the ones that are over (the day of a
 * race is not: it may still be on) and not over for more than
 * `RESULTS_WINDOW_DAYS` days. The latest comes first, then the name of the
 * event, then the id of the participation (so that the order never depends on
 * the server's). `rows` is left as it is.
 */
export function toEnterOf(rows: ToEnter[], today: Temporal.PlainDate): ToEnter[] {
  return rows
    .filter(({ date }) => {
      const daysAgo = daysBetween(date, today);
      return daysAgo >= 1 && daysAgo <= RESULTS_WINDOW_DAYS;
    })
    .toSorted(
      (a, b) =>
        Temporal.PlainDate.compare(b.date, a.date) ||
        a.event.name.localeCompare(b.event.name) ||
        a.participation.id.localeCompare(b.participation.id),
    );
}
