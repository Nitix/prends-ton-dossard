import type { EventView, FormatView, ParticipationView } from "./api";

// Who is on an event, as the screens read it. A participation is on a format,
// or, with no format, on the event alone: "interested, format to choose" (it
// is in `EventView.interested`), or supporter (in `EventView.supporters`). A
// supporter comes to cheer and starts nothing: it is not a starter, and the
// cards and the counts of the runners leave it out. A "not starting" one
// (`dns`) is not a runner of the event either: it is out of the cards, the
// filters and the counts, and only the page of the event lists it.

/**
 * The value of the choice "Not decided yet" among the formats of a form. A
 * format is an id of PocketBase, 15 characters long: it is never this.
 */
export const UNDECIDED = "undecided";

/**
 * The value of the choice "I'm coming to cheer" among the formats of a form: a
 * participation on the event alone, as a supporter. Like `UNDECIDED`, it is
 * never the id of a format.
 */
export const SUPPORT = "support";

/** Whether the participation is a start: everything but "not starting". "Did not finish" is a start. */
export function isStarter(p: ParticipationView): boolean {
  return p.participation.status !== "dns";
}

export function starters(list: ParticipationView[]): ParticipationView[] {
  return list.filter(isStarter);
}

/** A "not starting" participation, with the format it is on. */
export type NonStarter = { formatView: FormatView; participationView: ParticipationView };

/** The "not starting" participations of the event, in the order of the formats, then of the names. */
export function nonStarters(view: EventView): NonStarter[] {
  return view.formats.flatMap((formatView) =>
    formatView.participations
      .filter((participationView) => !isStarter(participationView))
      .map((participationView) => ({ formatView, participationView })),
  );
}

/** Whether somebody is interested with no format yet, or starts one of the formats: a supporter does not start. */
export function hasStarters(view: EventView): boolean {
  return (
    view.interested.some(isStarter) ||
    view.formats.some(({ participations }) => participations.some(isStarter))
  );
}

function hasRunner(list: ParticipationView[], runnerId: string): boolean {
  return list.some(({ runner }) => runner.id === runnerId);
}

/**
 * Whether the runner has a participation in the event that is not "not
 * starting", on a format or on the event alone: a supporter is on the event.
 */
export function isOnEvent(view: EventView, runnerId: string): boolean {
  return (
    hasRunner(starters(view.interested), runnerId) ||
    hasRunner(view.supporters, runnerId) ||
    view.formats.some(({ participations }) => hasRunner(starters(participations), runnerId))
  );
}

/** Whether the runner has an "interested" participation in the event, on a format or on the event alone. */
export function isInterested(view: EventView, runnerId: string): boolean {
  const interested = (list: ParticipationView[]) =>
    list.some(
      ({ participation, runner }) =>
        runner.id === runnerId && participation.status === "interested",
    );
  return (
    interested(view.interested) ||
    view.formats.some(({ participations }) => interested(participations))
  );
}

/** What a runner can still choose when they join an event. */
export type JoinOptions = {
  /** The formats where the runner has no participation yet, of any status, in the order of the formats. */
  formats: FormatView[];
  /** Whether "Not decided yet" is offered. */
  undecided: boolean;
  /** Whether "I'm coming to cheer" is offered. */
  support: boolean;
};

/**
 * The server refuses a second participation of a runner on a format, whatever
 * its status, so the formats the runner is on are not offered. A runner who is
 * on the event alone (interested, or supporter) is offered all of them: the
 * server turns that participation into one on the format.
 *
 * "Not decided yet" is for an event that has a choice to make (two formats or
 * more) and "I'm coming to cheer" for any event, even with a single format:
 * both are for a runner who has nothing yet in the event, not even a "not
 * starting", not even one with no format (interested or supporter).
 */
export function joinOptions(view: EventView, runnerId: string): JoinOptions {
  const formats = view.formats.filter(({ participations }) => !hasRunner(participations, runnerId));
  const onAFormat = formats.length < view.formats.length;
  const hasNothing =
    !onAFormat && !hasRunner(view.interested, runnerId) && !hasRunner(view.supporters, runnerId);
  return { formats, undecided: view.formats.length >= 2 && hasNothing, support: hasNothing };
}
