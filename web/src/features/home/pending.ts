import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { effectiveDate, lastRaceDay } from "../../lib/dates";
import { pb } from "../../lib/pb";
import type {
  EventRecord,
  FormatRecord,
  ParticipationRecord,
  RaceTypeRecord,
  RunnerRecord,
} from "../../lib/types";
import { useSession } from "../auth/session";
import { toParticipationView, type ParticipationView } from "../events/api";
import { isResultToEnter } from "../results/resultsToEnter";

/**
 * A participation the user has not confirmed: who it is for and who added it
 * (`ParticipationView`), and what it is on: its event, and, unless it is on the
 * event alone ("format to choose"), its format with the race type that gives
 * the format its name.
 */
export type PendingView = ParticipationView & {
  event: EventRecord;
  /** Absent for a participation without a format. */
  format?: FormatRecord;
  raceType?: RaceTypeRecord;
  /** The day of the format, or the start of the event without a format: as it is shown. */
  date: Temporal.PlainDate;
  /**
   * The day that says whether the race is over and orders it (`lastRaceDay`): `date`, except for
   * a race known by its month only, whose last day is the last day of the month.
   */
  lastDay: Temporal.PlainDate;
};

/** The key of the query: the changes of a participation refresh it (see `invalidateEvents`). */
export const PENDING_KEY = ["pending"] as const;

/** The `expand` that gives `toPendingViews` everything it needs. */
export const PENDING_EXPAND = "event,format.race_type,added_by,runner";

// What the server sends for PENDING_EXPAND. An expand that is empty is left
// out of the record, hence all the `?`.
type ExpandedPending = ParticipationRecord & {
  expand?: {
    runner?: RunnerRecord;
    added_by?: RunnerRecord;
    event?: EventRecord;
    format?: FormatRecord & { expand?: { race_type?: RaceTypeRecord } };
  };
};

/**
 * One participation of the answer to a request made with `PENDING_EXPAND`.
 * The shape is the server's contract: a record without something that has to
 * be there (the runner, the event, and, when the participation has a format,
 * the format with its race type) throws.
 */
function toPendingView(record: ExpandedPending): PendingView {
  const event = record.expand?.event;
  if (!event) throw new Error(`participation ${record.id}: its event is missing from the answer`);
  const view = toParticipationView(record);
  if (!record.format)
    return { ...view, event, date: effectiveDate({}, event), lastDay: lastRaceDay({}, event) };

  const format = record.expand?.format;
  const raceType = format?.expand?.race_type;
  if (!format || !raceType) {
    throw new Error(
      `participation ${record.id}: its format or race type is missing from the answer`,
    );
  }
  return {
    ...view,
    event,
    format,
    raceType,
    date: effectiveDate(format, event),
    lastDay: lastRaceDay(format, event),
  };
}

/** The participations of the answer, the ones that come first on top. */
function toPendingViews(records: ExpandedPending[]): PendingView[] {
  return records
    .map(toPendingView)
    .toSorted(
      (a, b) =>
        Temporal.PlainDate.compare(a.lastDay, b.lastDay) ||
        a.event.name.localeCompare(b.event.name) ||
        a.participation.id.localeCompare(b.participation.id),
    );
}

/**
 * The participations to confirm: the views without the ones that « Résultats à
 * saisir » shows (see `isResultToEnter`). A friend who registers the user for
 * a race that is over would otherwise have it twice on the page, with five
 * buttons; entering the result confirms it anyway. Once the race is past the
 * window of the results, nothing else asks, so it stays here. `views` is left
 * as it is.
 */
export function pendingOf(views: PendingView[], today: Temporal.PlainDate): PendingView[] {
  return views.filter(
    ({ participation, lastDay }) => !isResultToEnter(participation.status, lastDay, today),
  );
}

/**
 * The participations of the signed-in user that somebody else added and that
 * they have not confirmed yet. The changes of a participation ask for it
 * again (`invalidateEvents` refreshes `["pending"]`).
 */
export function usePending(): UseQueryResult<PendingView[]> {
  const { user } = useSession();
  const userId = user?.id ?? "";

  return useQuery({
    queryKey: PENDING_KEY,
    queryFn: async () =>
      toPendingViews(
        await pb.collection("participations").getFullList<ExpandedPending>({
          // `user` is the account of the runner: these are the runners of the user.
          filter: pb.filter("runner.user = {:me} && confirmed = false", { me: userId }),
          expand: PENDING_EXPAND,
        }),
      ),
    enabled: userId !== "",
  });
}
