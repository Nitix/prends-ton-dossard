import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { effectiveDate } from "../../lib/dates";
import { pb } from "../../lib/pb";
import type {
  EventRecord,
  FormatRecord,
  ParticipationRecord,
  RaceTypeRecord,
  RunnerRecord,
} from "../../lib/types";

// The statistics are worked out in the browser from the participations that
// have a result (« Terminé » or « Abandon »): for a group of a dozen people, a
// route or a view of the server would be more to keep than to compute.

/**
 * A race that was started, and what it is: the participation (its status is
 * `finished` or `dnf`), the runner, the event, and the format with the race
 * type that gives it its name. `date` is the day of the race (`effectiveDate`),
 * whose year is the year of the statistics.
 */
export type ResultRow = {
  participation: ParticipationRecord;
  runner: RunnerRecord;
  event: EventRecord;
  format: FormatRecord;
  raceType: RaceTypeRecord;
  date: Temporal.PlainDate;
};

/**
 * What a set of races adds up to. `km`, `elevation` (in meters) and `seconds`
 * are the sums over the finished races: a measure that is not given counts for
 * nothing, and so does an abandon, which only counts in `dnf`.
 */
export type Totals = {
  finished: number;
  dnf: number;
  km: number;
  elevation: number;
  seconds: number;
};

/**
 * Adds up the races. A finished race counts its distance, its elevation gain
 * and its time when they are given (the API sends 0 for what is not); an
 * abandon only counts as an abandon, whatever else its participation says: a
 * time that survived a change of status must not make the totals. Any other
 * status counts for nothing.
 */
export function totalsOf(rows: ResultRow[]): Totals {
  const totals: Totals = { finished: 0, dnf: 0, km: 0, elevation: 0, seconds: 0 };
  for (const { participation, format } of rows) {
    if (participation.status === "dnf") {
      totals.dnf += 1;
    } else if (participation.status === "finished") {
      totals.finished += 1;
      totals.km += format.distance_km || 0;
      totals.elevation += format.elevation_gain_m || 0;
      totals.seconds += participation.finish_time_s || 0;
    }
  }
  // Distances have decimals: 0.1 + 0.2 must be 0.3, for what is displayed and for the order of `byRunner`.
  totals.km = Math.round(totals.km * 1000) / 1000;
  return totals;
}

/**
 * The totals of each runner who has a race in this year, the one who ran the
 * most kilometers first, then by name (and by id, so that the order never
 * depends on the one of the rows). The year is the one of the day of the race.
 */
export function byRunner(
  rows: ResultRow[],
  year: number,
): { runner: RunnerRecord; totals: Totals }[] {
  const ofRunner = new Map<string, { runner: RunnerRecord; rows: ResultRow[] }>();
  for (const row of rows) {
    if (row.date.year !== year) continue;
    const found = ofRunner.get(row.runner.id);
    if (found) found.rows.push(row);
    else ofRunner.set(row.runner.id, { runner: row.runner, rows: [row] });
  }
  return [...ofRunner.values()]
    .map(({ runner, rows: list }) => ({ runner, totals: totalsOf(list) }))
    .toSorted(
      (a, b) =>
        b.totals.km - a.totals.km ||
        a.runner.name.localeCompare(b.runner.name) ||
        a.runner.id.localeCompare(b.runner.id),
    );
}

/** The totals of each year in which there is a race, the latest year first. */
export function byYear(rows: ResultRow[]): { year: number; totals: Totals }[] {
  const ofYear = new Map<number, ResultRow[]>();
  for (const row of rows) {
    const list = ofYear.get(row.date.year);
    if (list) list.push(row);
    else ofYear.set(row.date.year, [row]);
  }
  return [...ofYear]
    .map(([year, list]) => ({ year, totals: totalsOf(list) }))
    .toSorted((a, b) => b.year - a.year);
}

/** The key of the queries of the results: the changes of a participation refresh them (see `invalidateEvents`). */
export const RESULTS_KEY = ["results"] as const;

/** The `expand` that gives `toResultRow` everything it needs. */
export const STATS_EXPAND = "runner,event,format.race_type";

// What the server sends for STATS_EXPAND. An expand that is empty is left out
// of the record, hence all the `?`.
export type ResultRecord = ParticipationRecord & {
  expand?: {
    runner?: RunnerRecord;
    event?: EventRecord;
    format?: FormatRecord & { expand?: { race_type?: RaceTypeRecord } };
  };
};

/**
 * One participation of the answer to a request made with `STATS_EXPAND`. The
 * shape is the server's contract: a race that was started is on a format, so a
 * record without its runner, its event, its format or the race type of its
 * format throws.
 */
export function toResultRow(record: ResultRecord): ResultRow {
  const runner = record.expand?.runner;
  const event = record.expand?.event;
  const format = record.expand?.format;
  const raceType = format?.expand?.race_type;
  if (!runner) throw new Error(`participation ${record.id}: its runner is missing from the answer`);
  if (!event) throw new Error(`participation ${record.id}: its event is missing from the answer`);
  if (!format || !raceType) {
    throw new Error(
      `participation ${record.id}: its format or the race type of its format is missing from the answer`,
    );
  }
  return {
    participation: record,
    runner,
    event,
    format,
    raceType,
    date: effectiveDate(format, event),
  };
}

/** The latest race first, then the name of the event, then the id of the participation. */
function latestFirst(a: ResultRow, b: ResultRow): number {
  return (
    Temporal.PlainDate.compare(b.date, a.date) ||
    a.event.name.localeCompare(b.event.name) ||
    a.participation.id.localeCompare(b.participation.id)
  );
}

// The statuses that make a result. The filter has nothing from the user in it.
const STARTED = '(status = "finished" || status = "dnf")';

/**
 * The races that were started (finished, or abandoned), of one runner or of
 * everybody, the latest first. The changes of a participation ask for them
 * again (`invalidateEvents` refreshes `["results"]`).
 */
export function useResults(runnerId?: string): UseQueryResult<ResultRow[]> {
  return useQuery({
    queryKey: [...RESULTS_KEY, runnerId ?? "all"],
    queryFn: async () =>
      (
        await pb.collection("participations").getFullList<ResultRecord>({
          filter:
            runnerId === undefined
              ? STARTED
              : pb.filter(`${STARTED} && runner = {:runner}`, { runner: runnerId }),
          expand: STATS_EXPAND,
        })
      )
        .map(toResultRow)
        .toSorted(latestFirst),
  });
}
