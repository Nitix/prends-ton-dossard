import type { ParticipationRecord } from "../../lib/types";
import type { EventView, FormatView, ParticipationView } from "../events/api";
import { registrationState, type RegistrationState } from "../events/registration";

/**
 * A registration the runner has to make: a participation they are only
 * interested in, in an event whose registration is open or about to be.
 */
export type TodoRow = {
  view: EventView;
  /** Absent for a participation on the event alone ("format to choose"). */
  formatView?: FormatView;
  participation: ParticipationRecord;
  /** The day that orders the row: the opening for `soon` and `today`, the deadline for `open`. */
  day: Temporal.PlainDate;
  /** Where the registration stands: its `daysLeft` is 0 on the day, on which one can still register. */
  state: Extract<RegistrationState, { kind: "soon" | "today" | "open" }>;
};

/** The participations of the runner in the list that are « Interested » (nothing else is left to do). */
function interestedOf(list: ParticipationView[], runnerId: string): ParticipationRecord[] {
  return list
    .filter(
      ({ participation, runner }) =>
        runner.id === runnerId && participation.status === "interested",
    )
    .map(({ participation }) => participation);
}

/**
 * What the runner has to register for: their « Interested » participations
 * (on a format, or on the event alone) in the events whose registration is
 * open, the deadline being today or later, or opens today or later
 * (`registrationState`). An event with no deadline and no opening to come, or
 * whose registration is closed, has nothing to do. `runnerId` is not known
 * while the runner of the user loads: nothing then.
 *
 * The nearest day comes first (the opening of an event that is not open yet,
 * the deadline of the others), then the name of the event, then the id of the
 * participation (so that the order never depends on the server's).
 */
export function todosOf(
  views: EventView[],
  runnerId: string | undefined,
  today: Temporal.PlainDate,
): TodoRow[] {
  if (runnerId === undefined) return [];
  return views
    .flatMap((view): TodoRow[] => {
      const state = registrationState(view.event, today);
      if (state === null || state.kind === "closed") return [];
      const day = state.kind === "open" ? state.deadline : state.opening;
      return [
        ...view.formats.flatMap((formatView) =>
          interestedOf(formatView.participations, runnerId).map((participation) => ({
            view,
            formatView,
            participation,
            day,
            state,
          })),
        ),
        ...interestedOf(view.interested, runnerId).map((participation) => ({
          view,
          participation,
          day,
          state,
        })),
      ];
    })
    .toSorted(
      (a, b) =>
        Temporal.PlainDate.compare(a.day, b.day) ||
        a.view.event.name.localeCompare(b.view.event.name) ||
        a.participation.id.localeCompare(b.participation.id),
    );
}
