import { daysBetween, effectiveDate, lastRaceDay } from "../../lib/dates";
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
 * format its name. `date` is the day of the race as it is shown (`effectiveDate`:
 * the 1st for a race known by its month only); `lastDay` is the day that says
 * whether it is over and orders it (`lastRaceDay`: the last day of its month for
 * such a race).
 */
export type ToEnter = {
  participation: ParticipationRecord;
  event: EventRecord;
  format: FormatRecord;
  raceType: RaceTypeRecord;
  date: Temporal.PlainDate;
  lastDay: Temporal.PlainDate;
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
  return {
    participation: record,
    event,
    format,
    raceType,
    date: effectiveDate(format, event),
    lastDay: lastRaceDay(format, event),
  };
}

/**
 * Whether the result of a participation is to enter: it is « Registered » and
 * its race is over (the day of a race is not: it may still be on) for no more
 * than `RESULTS_WINDOW_DAYS` days. `date` is the day that ends the race
 * (`lastDay`, from `lastRaceDay`): a race known by its month only is over the day after its
 * month. « Résultats à saisir » shows these, and « À confirmer »
 * leaves them out (see `pendingOf`): both ask this, so they cannot disagree.
 */
export function isResultToEnter(
  status: ParticipationRecord["status"],
  date: Temporal.PlainDate,
  today: Temporal.PlainDate,
): boolean {
  if (status !== "registered") return false;
  const daysAgo = daysBetween(date, today);
  return daysAgo >= 1 && daysAgo <= RESULTS_WINDOW_DAYS;
}

/**
 * The races whose result is to enter (`isResultToEnter`). The latest comes
 * first, then the name of the event, then the id of the participation (so that
 * the order never depends on the server's). `rows` is left as it is.
 */
export function toEnterOf(rows: ToEnter[], today: Temporal.PlainDate): ToEnter[] {
  return rows
    .filter(({ participation, lastDay }) => isResultToEnter(participation.status, lastDay, today))
    .toSorted(
      (a, b) =>
        Temporal.PlainDate.compare(b.lastDay, a.lastDay) ||
        a.event.name.localeCompare(b.event.name) ||
        a.participation.id.localeCompare(b.participation.id),
    );
}
