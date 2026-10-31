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
import { useSession } from "../auth/session";
import { toParticipationView, type ParticipationView } from "../events/api";

/**
 * A participation the user has not confirmed: who it is for and who added it
 * (`ParticipationView`), and what it is on: its format, the event of the
 * format, and the race type that gives the format its name.
 */
export type PendingView = ParticipationView & {
  event: EventRecord;
  format: FormatRecord;
  raceType: RaceTypeRecord;
  /** The day of the format: its own date, or the start of its event. */
  date: Temporal.PlainDate;
};

/** The `expand` that gives `toPendingViews` everything it needs. */
export const PENDING_EXPAND = "format.event,format.race_type,added_by,runner";

// What the server sends for PENDING_EXPAND. An expand that is empty is left
// out of the record, hence all the `?`.
type ExpandedPending = ParticipationRecord & {
  expand?: {
    runner?: RunnerRecord;
    added_by?: RunnerRecord;
    format?: FormatRecord & { expand?: { event?: EventRecord; race_type?: RaceTypeRecord } };
  };
};

/**
 * One participation of the answer to a request made with `PENDING_EXPAND`.
 * The shape is the server's contract: a record without something that has to
 * be there (the runner, the format with its event and its race type) throws.
 */
function toPendingView(record: ExpandedPending): PendingView {
  const format = record.expand?.format;
  const event = format?.expand?.event;
  const raceType = format?.expand?.race_type;
  if (!format || !event || !raceType) {
    throw new Error(
      `participation ${record.id}: its format, event or race type is missing from the answer`,
    );
  }
  return {
    ...toParticipationView(record),
    event,
    format,
    raceType,
    date: effectiveDate(format, event),
  };
}

/** The participations of the answer, the ones that come first on top. */
function toPendingViews(records: ExpandedPending[]): PendingView[] {
  return records
    .map(toPendingView)
    .toSorted(
      (a, b) =>
        Temporal.PlainDate.compare(a.date, b.date) ||
        a.event.name.localeCompare(b.event.name) ||
        a.participation.id.localeCompare(b.participation.id),
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
    queryKey: ["pending"],
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
